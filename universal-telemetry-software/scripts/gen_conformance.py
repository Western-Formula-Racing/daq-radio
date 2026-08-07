"""Generate the WCARS conformance corpus in universal-telemetry-software/tests/conformance.

Usage:
    uv run python scripts/gen_conformance.py

Each vector is a scenario built from real CAN frames, run through WcarsEngine, with
whatever it emitted recorded as expected_alerts. The pytest suite and the browser
vitest suite both execute these files, so a rule that fires on the car and not in
replay shows up as a red build instead of a misleading tool.

The scenarios target the timing behaviors that are invisible in the rule JSON and
are therefore where a second implementation drifts: high-water-mark clock, newest
sample wins, a gap resetting the hold, only a large backwards jump resetting state,
and a stale signal evaluating false.

They also pin the numeric value of STALENESS_MS itself, from both sides of both
thresholds it governs. Behavioral vectors alone leave the constant bracketed over a
wide range, and a port that picks any value inside that range is green here and
wrong on the car.

Regeneration is deterministic: the DBC is pinned to the committed example.dbc, rule
ids are fixed strings, keys are sorted, and nothing records a wall clock, so a diff
here means the engine changed.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent
CORPUS_DBC = REPO / "example.dbc"

# Set before importing the decoder, which reads the path at module import time.
os.environ["WFR_DBC_PATH"] = str(CORPUS_DBC)
sys.path.insert(0, str(REPO))

from src.wcars.config import DEFAULT_CONFIG  # noqa: E402
from src.wcars.decoder import Decoder, WHITELIST_IDS, load_db  # noqa: E402
from src.wcars.engine import WcarsEngine  # noqa: E402
from src.wcars.user_rules import frame_ids_for_docs  # noqa: E402
from tests.wcars_dbc_utils import encodable_user_signal  # noqa: E402

OUT_DIR = REPO / "tests" / "conformance"

TRUE_VALUE = 11
FALSE_VALUE = 9
THRESHOLD = 10


def _candidate_messages():
    """Non-whitelisted, non-multiplexed messages that encode from all-zero signals.

    Non-whitelisted matters: a built-in rule reacting to the same frames would add
    alerts the browser engine, which only runs user rules, could never reproduce.
    """
    for msg in sorted(load_db().messages, key=lambda m: m.frame_id):
        if msg.is_multiplexed():
            continue
        if msg.frame_id in WHITELIST_IDS or (msg.frame_id & 0x7FFFFFFF) in WHITELIST_IDS:
            continue
        try:
            msg.encode({s.name: 0 for s in msg.signals}, strict=False)
        except Exception:
            continue
        yield msg


def _second_numeric_signal(exclude_message: str):
    """A plain integer signal on a different message than the primary one.

    A second message is what makes 'stale evaluates false' observable: one signal
    has to keep arriving while the other goes quiet.
    """
    for msg in _candidate_messages():
        if msg.name == exclude_message:
            continue
        for sig in sorted(msg.signals, key=lambda s: s.start):
            if sig.choices or sig.scale != 1 or sig.offset != 0 or sig.is_signed:
                continue
            if sig.length < 8:
                continue
            payload = msg.encode({s.name: (TRUE_VALUE if s.name == sig.name else 0)
                                  for s in msg.signals}, strict=False)
            if msg.decode(bytes(payload)).get(sig.name) == TRUE_VALUE:
                return msg, sig
    raise SystemExit("no second numeric signal available in this DBC")


def _enum_signal():
    for msg in _candidate_messages():
        for sig in sorted(msg.signals, key=lambda s: s.start):
            if sig.choices and len(sig.choices) >= 2:
                return msg, sig
    raise SystemExit("no enum signal available in this DBC")


def _hex(msg, values: dict) -> str:
    raw = {s.name: 0 for s in msg.signals}
    raw.update(values)
    return bytes(msg.encode(raw, strict=False)).hex()


class Corpus:
    def __init__(self) -> None:
        # encodable_user_signal is a test helper and signals failure with
        # pytest.skip, which outside a test session would surface as an opaque
        # Skipped traceback instead of the clean exit the other selectors give.
        try:
            msg_a, sig_a, _, _ = encodable_user_signal()
        except pytest.skip.Exception as exc:
            raise SystemExit(
                f"no encodable non-whitelisted signal in {CORPUS_DBC.name}: {exc}")
        self.a_msg, self.a_sig = msg_a, sig_a
        self.b_msg, self.b_sig = _second_numeric_signal(msg_a.name)
        self.e_msg, self.e_sig = _enum_signal()
        choices = sorted(self.e_sig.choices.items())
        self.e_off_raw, self.e_off = choices[0][0], str(choices[0][1])
        self.e_on_raw, self.e_on = choices[1][0], str(choices[1][1])

    def a(self, ts: int, value: int) -> tuple:
        return (ts, self.a_msg.frame_id, _hex(self.a_msg, {self.a_sig.name: value}))

    def b(self, ts: int, value: int) -> tuple:
        return (ts, self.b_msg.frame_id, _hex(self.b_msg, {self.b_sig.name: value}))

    def e(self, ts: int, raw: int) -> tuple:
        return (ts, self.e_msg.frame_id, _hex(self.e_msg, {self.e_sig.name: raw}))

    def cond_a(self, op: str = ">", value=THRESHOLD) -> dict:
        return {"message": self.a_msg.name, "signal": self.a_sig.name,
                "op": op, "value": value}

    def cond_b(self, op: str = ">", value=THRESHOLD) -> dict:
        return {"message": self.b_msg.name, "signal": self.b_sig.name,
                "op": op, "value": value}

    def cond_e(self, op: str = "==", value=None) -> dict:
        return {"message": self.e_msg.name, "signal": self.e_sig.name,
                "op": op, "value": self.e_on if value is None else value}


def rule(rule_id: str, conditions: list, for_seconds: float = 0.0,
         rearm_seconds: float = 0.0) -> dict:
    return {"id": rule_id, "name": "Conformance rule", "enabled": True,
            "severity": "WARNING", "message": "OVERTEMP", "conditions": conditions,
            "for_seconds": for_seconds, "rearm_seconds": rearm_seconds}


def scenarios(c: Corpus) -> list[dict]:
    hold_2s = 2.0
    out = []

    out.append({
        "name": "for_seconds_hold",
        "description": "Condition true at 10 Hz for 3 s with for_seconds 2: the alert "
                       "lands exactly one hold after the condition first held. The 21 "
                       "frames after the fire also pin the must-go-false latch, since "
                       "rearm_seconds is 0 and only the latch stops a refire per frame.",
        "targets": ["for_seconds", "must_go_false_latch"],
        "rules": [rule("conf-for-seconds", [c.cond_a()], for_seconds=hold_2s)],
        "frames": [c.a(ts, TRUE_VALUE) for ts in range(1000, 4001, 100)],
    })

    out.append({
        "name": "rearm_window",
        "description": "Fires, goes false, comes back inside the 10 s rearm window "
                       "(no refire), then comes back after it (refire).",
        "targets": ["rearm"],
        "rules": [rule("conf-rearm", [c.cond_a()], rearm_seconds=10)],
        "frames": [c.a(1000, TRUE_VALUE), c.a(2000, FALSE_VALUE),
                   c.a(3000, TRUE_VALUE), c.a(6000, FALSE_VALUE),
                   c.a(12000, TRUE_VALUE)],
    })

    out.append({
        "name": "high_water_late_frame",
        "description": "A frame 2 s in the past completes the AND. The hold starts at "
                       "the high-water mark, not at the late frame's own time, so the "
                       "alert lands at 6000 rather than 5000.",
        "targets": ["high_water"],
        "rules": [rule("conf-high-water", [c.cond_a(), c.cond_b()],
                       for_seconds=hold_2s)],
        "frames": [c.a(4000, TRUE_VALUE), c.b(2000, TRUE_VALUE),
                   c.a(5000, TRUE_VALUE), c.a(6000, TRUE_VALUE)],
    })

    out.append({
        "name": "alert_ts_is_frame_time",
        "description": "The frame that completes the AND arrives 2 s late. Timing uses "
                       "the high-water mark but the alert timestamp is the frame's own "
                       "time, so user rules agree with the built-ins on when it happened.",
        # Not a high_water vector: with for_seconds 0 the fire is unconditional on
        # the completing frame and the staleness check passes under either clock,
        # so only the alert timestamp is actually pinned here.
        "targets": ["alert_ts"],
        "rules": [rule("conf-alert-ts", [c.cond_a(), c.cond_b()])],
        "frames": [c.a(5000, TRUE_VALUE), c.b(3000, TRUE_VALUE)],
    })

    out.append({
        "name": "newest_sample_wins",
        "description": "A late frame carrying an older, below-threshold reading is "
                       "discarded rather than applied, so the hold survives it.",
        "targets": ["newest_wins"],
        "rules": [rule("conf-newest-wins", [c.cond_a()], for_seconds=hold_2s)],
        "frames": [c.a(1000, TRUE_VALUE), c.a(2000, TRUE_VALUE),
                   c.a(1500, FALSE_VALUE), c.a(3000, TRUE_VALUE)],
    })

    out.append({
        "name": "gap_resets_hold",
        "description": "True at t=1000, silence for 6 s, true again: the unobserved "
                       "stretch does not count toward the hold, so the hold restarts.",
        "targets": ["gap_resets_hold"],
        "rules": [rule("conf-gap-resets", [c.cond_a()], for_seconds=hold_2s)],
        "frames": [c.a(1000, TRUE_VALUE), c.a(7000, TRUE_VALUE),
                   c.a(8000, TRUE_VALUE), c.a(9000, TRUE_VALUE)],
    })

    out.append({
        "name": "small_backwards_ignored",
        "description": "A 100 ms regression mid-hold is ordinary out-of-order UDP "
                       "arrival, not a source switch: it must not restart the hold, or "
                       "reordering turns into alert spam.",
        "targets": ["small_backwards_ignored"],
        "rules": [rule("conf-small-backwards", [c.cond_a()], for_seconds=hold_2s)],
        "frames": [c.a(1000, TRUE_VALUE), c.a(2900, TRUE_VALUE),
                   c.a(2800, TRUE_VALUE), c.a(3000, TRUE_VALUE)],
    })

    out.append({
        "name": "large_backwards_resets",
        "description": "A 59 s regression is a replay restart: state is wiped, so the "
                       "rule fires again immediately despite a 10 s rearm window, and "
                       "then holds its rearm from the new time.",
        "targets": ["large_backwards_resets"],
        "rules": [rule("conf-large-backwards", [c.cond_a()], rearm_seconds=10)],
        "frames": [c.a(60000, TRUE_VALUE), c.a(1000, TRUE_VALUE),
                   c.a(2000, TRUE_VALUE)],
    })

    out.append({
        "name": "stale_is_false",
        "description": "Two conditions on two messages; one signal stops arriving. Once "
                       "it is older than the staleness window its condition is false, so "
                       "a dead sensor cannot hold the fault on.",
        "targets": ["stale_is_false"],
        "rules": [rule("conf-stale-false", [c.cond_a(), c.cond_b()])],
        "frames": [c.b(1000, TRUE_VALUE), c.a(3000, TRUE_VALUE),
                   c.a(4000, FALSE_VALUE), c.a(6001, TRUE_VALUE),
                   c.a(7000, TRUE_VALUE)],
    })

    out.append({
        "name": "two_conditions_anded",
        "description": "Each condition is true alone without firing; the hold only "
                       "starts once both hold at the same time.",
        "targets": ["for_seconds"],
        "rules": [rule("conf-two-conditions", [c.cond_a(), c.cond_b()],
                       for_seconds=1.0)],
        "frames": [c.a(1000, TRUE_VALUE), c.b(2000, TRUE_VALUE),
                   c.a(2500, TRUE_VALUE), c.a(3000, TRUE_VALUE)],
    })

    out.append({
        "name": "enum_equality",
        "description": f"A VAL_-mapped signal compared with == to '{c.e_on}'. The "
                       "trigger value is null because the first condition is textual, "
                       "and the enum going stale still makes the condition false.",
        "targets": ["stale_is_false"],
        "rules": [rule("conf-enum-equality", [c.cond_e(), c.cond_a()])],
        "frames": [c.a(1000, TRUE_VALUE), c.e(2000, c.e_on_raw),
                   c.a(3000, FALSE_VALUE), c.a(4000, TRUE_VALUE),
                   c.a(5000, FALSE_VALUE), c.a(7100, TRUE_VALUE)],
    })

    # The behavioral vectors above only bracket STALENESS_MS to [4000, 5000] and the
    # backwards-reset threshold to [100, 59000]. These six pin both edges to the
    # exact millisecond, so a port that guesses a value inside those ranges goes red
    # here rather than on the car.
    for age, fresh in ((4999, True), (5000, True), (5001, False)):
        verdict = "fresh" if fresh else "stale"
        out.append({
            "name": f"staleness_{age}_is_{verdict}",
            "description": f"B stops arriving; the frame that would complete the AND "
                           f"lands when B is exactly {age} ms old. STALENESS_MS is "
                           f"5000 and the check is strictly greater, so B is "
                           f"{verdict} and the rule "
                           f"{'fires' if fresh else 'cannot fire'}.",
            "targets": ["staleness_ms_value"] + ([] if fresh else ["stale_is_false"]),
            "rules": [rule(f"conf-staleness-{age}", [c.cond_a(), c.cond_b()])],
            "frames": [c.b(1000, TRUE_VALUE), c.a(1000 + age, TRUE_VALUE)],
        })

    for regression, resets in ((4900, False), (5000, False), (5001, True), (5100, True)):
        verdict = "resets" if resets else "does_not_reset"
        outcome = ("wiped, so the rule refires at once despite the 10 s rearm window"
                   if resets else
                   "kept, so the rearm window still blocks the refire")
        out.append({
            "name": f"backwards_{regression}_{verdict}",
            "description": f"The rule fires at 10000, then frame time steps back by "
                           f"exactly {regression} ms. The reset threshold is "
                           f"STALENESS_MS (5000) and the check is strictly greater, "
                           f"so state is {outcome}.",
            "targets": ["backwards_reset_threshold",
                        "large_backwards_resets" if resets
                        else "small_backwards_ignored"],
            "rules": [rule(f"conf-backwards-{regression}", [c.cond_a()],
                           rearm_seconds=10)],
            "frames": [c.a(10000, TRUE_VALUE), c.a(10000 - regression, TRUE_VALUE)],
        })

    return out


def run(vector: dict) -> tuple[list[dict], list]:
    engine = WcarsEngine(json.loads(json.dumps(DEFAULT_CONFIG)),
                         user_rule_docs=vector["rules"])
    decoder = Decoder(extra_ids=frame_ids_for_docs(vector["rules"], load_db()))
    alerts, decoded = [], []
    for ts_ms, can_id, data_hex in vector["frames"]:
        frame = {"canId": can_id, "data": list(bytes.fromhex(data_hex))}
        # Recorded so the browser suite can feed the interpreter directly instead of
        # re-decoding, keeping that test about rule semantics rather than about two
        # DBC decoders agreeing.
        live = decoder.decode(frame)
        decoded.append(None if live is None
                       else {"message": live["message"], "signals": live["signals"]})
        for alert in engine.feed(frame, ts_ms):
            alerts.append({"rule": alert.rule, "severity": alert.severity.value,
                           "title": alert.title, "detail": alert.detail,
                           "value": alert.value, "ts": alert.ts})
    return alerts, decoded


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    corpus = Corpus()
    for vector in scenarios(corpus):
        vector["frames"] = [[ts, can_id, data_hex]
                            for ts, can_id, data_hex in vector["frames"]]
        vector["expected_alerts"], vector["decoded"] = run(vector)
        vector["dbc"] = CORPUS_DBC.name
        path = OUT_DIR / f"{vector['name']}.json"
        path.write_text(json.dumps(vector, indent=2, sort_keys=True) + "\n")
        print(f"{path.relative_to(REPO)}: {len(vector['frames'])} frames, "
              f"{len(vector['expected_alerts'])} alerts")


if __name__ == "__main__":
    main()
