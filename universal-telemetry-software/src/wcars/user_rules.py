"""User-defined WCARS rules: JSON documents built by the OMT form, validated
against the DBC, and interpreted by a generic rule.

Conditions are ANDed and each names both message and signal, since signal
names are not unique across DBC messages. All timing is frame-timestamp time,
never wall clock, so replays produce identical firings.
"""
from __future__ import annotations

import operator
from typing import Any

from .rules import BaseRule
from .serialization import Alert, Severity

STALENESS_MS = 5000
MAX_CONDITIONS = 4
MAX_MESSAGE_LEN = 24
MAX_NAME_LEN = 64

_OPS = {
    ">": operator.gt,
    ">=": operator.ge,
    "<": operator.lt,
    "<=": operator.le,
    "==": operator.eq,
    "!=": operator.ne,
}
_EQUALITY_OPS = {"==", "!="}
_SEVERITIES = {s.value for s in Severity}


def validate_rule_doc(doc: Any, db) -> list[str]:
    """Return human-readable problems; empty list means the document is valid.

    db is a cantools Database used for message/signal existence and enum
    choices. Structural checks and DBC checks are both collected so the form
    can show every problem in one pass.

    A lowercase 'message' is accepted here on purpose: the rule store
    uppercases it before validating, so case is not this function's job.
    """
    if not isinstance(doc, dict):
        return ["rule must be a JSON object"]
    errors: list[str] = []
    name = doc.get("name")
    if not isinstance(name, str) or not name.strip():
        errors.append("name is required")
    elif len(name) > MAX_NAME_LEN:
        errors.append(f"name longer than {MAX_NAME_LEN} chars")
    if doc.get("severity") not in _SEVERITIES:
        errors.append(f"severity must be one of {sorted(_SEVERITIES)}")
    message = doc.get("message")
    if not isinstance(message, str) or not message.strip():
        errors.append("message is required")
    elif len(message) > MAX_MESSAGE_LEN:
        errors.append(f"message longer than {MAX_MESSAGE_LEN} chars (ECVM line width)")
    if not isinstance(doc.get("enabled"), bool):
        errors.append("enabled must be true or false")
    for field in ("for_seconds", "rearm_seconds"):
        v = doc.get(field)
        if isinstance(v, bool) or not isinstance(v, (int, float)) or v < 0:
            errors.append(f"{field} must be a number >= 0")
    conditions = doc.get("conditions")
    if not isinstance(conditions, list) or not 1 <= len(conditions) <= MAX_CONDITIONS:
        errors.append(f"conditions must be a list of 1 to {MAX_CONDITIONS} entries")
        return errors
    for i, cond in enumerate(conditions):
        errors.extend(_validate_condition(cond, i, db))
    return errors


def _validate_condition(cond: Any, i: int, db) -> list[str]:
    label = f"condition {i + 1}"
    if not isinstance(cond, dict):
        return [f"{label}: must be an object"]
    errors: list[str] = []
    op = cond.get("op")
    if op not in _OPS:
        errors.append(f"{label}: op must be one of {sorted(_OPS)}")
    msg_name = cond.get("message")
    sig_name = cond.get("signal")
    if not isinstance(msg_name, str) or not isinstance(sig_name, str):
        errors.append(f"{label}: message and signal are required")
        return errors
    try:
        msg = db.get_message_by_name(msg_name)
    except KeyError:
        errors.append(f"{label}: message '{msg_name}' not in DBC")
        return errors
    sig = next((s for s in msg.signals if s.name == sig_name), None)
    if sig is None:
        errors.append(f"{label}: signal '{sig_name}' not in message '{msg_name}'")
        return errors
    value = cond.get("value")
    choices = {str(c) for c in (sig.choices or {}).values()}
    if isinstance(value, str):
        if op not in _EQUALITY_OPS:
            errors.append(f"{label}: text values only allowed with == or !=")
        if value not in choices:
            errors.append(f"{label}: '{value}' is not a named value of {sig_name}")
    elif isinstance(value, bool) or not isinstance(value, (int, float)):
        errors.append(f"{label}: value must be a number or a named enum value")
    elif choices:
        # The decoder unwraps VAL_-mapped signals to their name, so a numeric
        # comparison on an enum can never match and the rule would be dead.
        errors.append(f"{label}: {sig_name} is an enum; use one of "
                      f"{sorted(choices)} instead of a number")
    return errors


def frame_ids_for_docs(docs: list[dict], db) -> set[int]:
    """Arbitration IDs the decoder must accept so these rules see their signals.

    cantools may store extended IDs with bit 31 set while frames arrive with
    the raw 29-bit ID, so both forms are included.
    """
    ids: set[int] = set()
    for doc in docs:
        for cond in doc.get("conditions", []):
            if not isinstance(cond, dict):
                continue
            try:
                msg = db.get_message_by_name(cond.get("message"))
            except KeyError:
                continue
            ids.add(msg.frame_id)
            ids.add(msg.frame_id & 0x7FFFFFFF)
    return ids


class UserRule(BaseRule):
    """Interprets one user rule document.

    Condition values persist across frames: each decoded frame updates the
    signals it carries, then all conditions are evaluated against the latest
    values. A signal not seen within STALENESS_MS evaluates false, so a dead
    sensor cannot keep a threshold rule firing.
    """

    def __init__(self, doc: dict) -> None:
        super().__init__(f"USER:{doc['id']}",
                         rearm_seconds=float(doc.get("rearm_seconds", 0)))
        self.doc = doc
        self._for_ms = int(float(doc.get("for_seconds", 0)) * 1000)
        self._severity = Severity(doc["severity"])
        # (message, signal) -> (value, last seen ts_ms)
        self._latest: dict[tuple[str, str], tuple[Any, int]] = {}
        self._satisfied_since: int | None = None
        self._fired_ts: int | None = None
        self._false_since_fire = True
        self._last_ts: int | None = None

    def update(self, decoded: dict, ts_ms: int) -> Alert | None:
        # Only a source switch or a replay restart is worth wiping state for.
        # Frame time stepping back by less than the staleness window is ordinary
        # out-of-order UDP arrival, and resetting on that would restart every
        # hold and clear the fired timestamp, turning reordering into spam.
        if self._last_ts is not None and self._last_ts - ts_ms > STALENESS_MS:
            self._reset_timing()
            self._last_ts = ts_ms
        else:
            self._last_ts = ts_ms if self._last_ts is None \
                else max(self._last_ts, ts_ms)
        # Timing runs on the high-water mark: a late frame must never rewind a
        # hold or a rearm window, since a negative duration would stall any
        # hold and delay rearm until real time caught back up.
        now = self._last_ts
        msg_name = decoded["message"]
        touched = False
        for cond in self.doc["conditions"]:
            key = (cond["message"], cond["signal"])
            if cond["message"] == msg_name and cond["signal"] in decoded["signals"]:
                prev = self._latest.get(key)
                # A late frame carries an older reading than the one already
                # held, so newest sample wins and the stale one is discarded.
                if prev is not None and ts_ms < prev[1]:
                    continue
                # A gap in this signal means the hold was never observed to be
                # continuous, so nothing before the gap may count toward it, and
                # an unobserved stretch is not evidence the condition held.
                if prev is not None and ts_ms - prev[1] > STALENESS_MS:
                    self._satisfied_since = None
                    self._false_since_fire = True
                self._latest[key] = (decoded["signals"][cond["signal"]], ts_ms)
                touched = True
        # Unrelated frames still matter once a hold is in progress: their
        # timestamps are how a now-stale condition gets noticed and reset.
        if not touched and self._satisfied_since is None:
            return None
        if not all(self._cond_true(c, now) for c in self.doc["conditions"]):
            self._satisfied_since = None
            self._false_since_fire = True
            return None
        if self._satisfied_since is None:
            self._satisfied_since = now
        if now - self._satisfied_since < self._for_ms:
            return None
        if self._fired_ts is not None and (
                not self._false_since_fire
                or now - self._fired_ts < self.rearm_seconds * 1000):
            return None
        self._fired_ts = now
        self._false_since_fire = False
        return self._alert(self._severity, self.doc["message"], self.doc["name"],
                           self._trigger_value(), ts_ms)

    def _reset_timing(self) -> None:
        """Drop every timestamped memory so the rule starts as if newly built."""
        self._latest.clear()
        self._satisfied_since = None
        self._fired_ts = None
        self._false_since_fire = True

    def _cond_true(self, cond: dict, ts_ms: int) -> bool:
        entry = self._latest.get((cond["message"], cond["signal"]))
        if entry is None:
            return False
        value, seen_ts = entry
        if ts_ms - seen_ts > STALENESS_MS:
            return False
        target = cond["value"]
        if isinstance(target, str):
            return _OPS[cond["op"]](str(value), target)
        if not isinstance(value, (int, float)):
            return False
        return _OPS[cond["op"]](float(value), float(target))

    def _trigger_value(self) -> float | None:
        first = self.doc["conditions"][0]
        entry = self._latest.get((first["message"], first["signal"]))
        if entry is not None and isinstance(entry[0], (int, float)):
            return float(entry[0])
        return None
