"""WCARS engine: subscribes to decoded CAN frames, runs rules, emits alerts.

Synchronous interface (`feed`, `backlog`, `set_config`) so it's trivially
testable. The async Redis subscription wrapper is in the bridge module.
"""
from __future__ import annotations

import copy
import logging
from collections import deque
from typing import Any

from ..log_throttle import LogThrottle, log_throttled_exception
from .config import merge_config
from .decoder import Decoder, load_db
from .user_rules import UserRule, frame_ids_for_docs
from .rules import (
    VcuStateFaultRule,
    VcuStateChangeRule,
    TorchFaultRule,
    InvFaultRule,
    InvVsmStateRule,
    TorchCellTempRule,
    TorchCellImbalanceRule,
    ImdFaultRule,
    AmsFaultRule,
    BspdFaultRule,
    SafetyLoopOpenRule,
    HvLossRule,
    AirFaultRule,
    PrechargeErrorRule,
)
from .serialization import Alert

logger = logging.getLogger("wcars.engine")

RING_BUFFER_SIZE = 200


def _active_docs(docs: list[dict] | None) -> list[dict]:
    return [d for d in (docs or []) if d.get("enabled") and not d.get("broken")]


class WcarsEngine:
    def __init__(self, config: dict[str, Any],
                 user_rule_docs: list[dict] | None = None) -> None:
        self.config = merge_config(config)
        self._user_docs = _active_docs(user_rule_docs)
        self.decoder = Decoder(extra_ids=frame_ids_for_docs(self._user_docs, load_db()))
        self._ring: deque[Alert] = deque(maxlen=RING_BUFFER_SIZE)
        # Per rule id, so one permanently broken rule cannot mask a second one
        # failing for a different reason.
        self._rule_error_throttles: dict[str, LogThrottle] = {}
        self._rules = self._build_rules()

    def _build_rules(self):
        th = self.config["thresholds"]
        rearm = float(th["rearm_seconds"])
        return [
            VcuStateFaultRule(),
            VcuStateChangeRule(),
            TorchFaultRule(),
            InvFaultRule(),
            InvVsmStateRule(),
            TorchCellTempRule(threshold_c=float(th["torch_cell_temp_c"]), rearm_seconds=rearm),
            TorchCellImbalanceRule(threshold_v=float(th["torch_cell_imbalance_v"]), rearm_seconds=rearm),
            ImdFaultRule(),
            AmsFaultRule(),
            BspdFaultRule(),
            SafetyLoopOpenRule(),
            HvLossRule(),
            AirFaultRule(),
            PrechargeErrorRule(timeout_seconds=float(th["precharge_timeout_s"])),
        ] + [UserRule(d) for d in self._user_docs]

    def feed(self, frame: dict, ts_ms: int) -> list[Alert]:
        decoded = self.decoder.decode(frame)
        if decoded is None:
            return []
        emitted: list[Alert] = []
        for rule in self._rules:
            try:
                alert = rule.update(decoded, ts_ms)
            except Exception as exc:
                # Throttled: a rule that raises does so on every frame, and an
                # unthrottled traceback per frame is its own outage.
                throttle = self._rule_error_throttles.setdefault(
                    rule.rule_id, LogThrottle())
                log_throttled_exception(logger, throttle,
                                        f"Rule {rule.rule_id} raised", exc)
                continue
            if alert is not None:
                self._ring.append(alert)
                emitted.append(alert)
        return emitted

    def backlog(self) -> list[Alert]:
        # Replays to a freshly-opened browser must be flagged so the UI can
        # render them as historical rather than live.
        return [Alert(**{**a.__dict__, "replay": True}) for a in self._ring]

    def set_config(self, new_config: dict[str, Any]) -> None:
        self.config = merge_config(new_config)
        self._rules = self._build_rules()

    def set_user_rules(self, docs: list[dict]) -> None:
        """Swap the user rule set. Rule state resets, matching set_config."""
        self._user_docs = _active_docs(docs)
        self.decoder = Decoder(extra_ids=frame_ids_for_docs(self._user_docs, load_db()))
        self._rules = self._build_rules()