"""Tests for user-defined rule documents: validation and the UserRule interpreter.

Validation tests use a tiny inline DBC so they are independent of which DBC
(secret or example) the environment provides. UserRule behavior tests feed
synthetic decoded dicts directly, so they need no DBC at all.
"""
import cantools
import pytest

from src.wcars.serialization import Severity
from src.wcars.user_rules import (
    validate_rule_doc,
    frame_ids_for_docs,
    UserRule,
    STALENESS_MS,
)

MINI_DBC = """VERSION ""

BS_:

BU_: ECU DAQ

BO_ 256 TEST_MSG: 8 ECU
 SG_ Temp : 0|16@1+ (0.1,0) [0|6553.5] "C" DAQ
 SG_ Mode : 16|8@1+ (1,0) [0|255] "" DAQ

BO_ 257 OTHER_MSG: 8 ECU
 SG_ Speed : 0|16@1+ (0.01,0) [0|655.35] "kph" DAQ

VAL_ 256 Mode 0 "OFF" 1 "RUN" 2 "FAULT" ;
"""


@pytest.fixture(scope="module")
def db():
    return cantools.database.load_string(MINI_DBC, database_format="dbc", strict=False)


def make_doc(**overrides):
    doc = {
        "id": "test-rule-1",
        "name": "Overtemp",
        "enabled": True,
        "severity": "WARNING",
        "message": "OVERTEMP",
        "conditions": [
            {"message": "TEST_MSG", "signal": "Temp", "op": ">", "value": 100.0},
        ],
        "for_seconds": 0.0,
        "rearm_seconds": 0.0,
        "created_by": "test",
        "updated_at": "2026-07-26T00:00:00Z",
    }
    doc.update(overrides)
    return doc


_CAN_IDS = {"TEST_MSG": 256, "OTHER_MSG": 257}


def frame(message, signals, can_id=None):
    return {
        "message": message,
        "can_id": _CAN_IDS[message] if can_id is None else can_id,
        "signals": signals,
    }


class TestValidation:
    def test_valid_doc_has_no_errors(self, db):
        assert validate_rule_doc(make_doc(), db) == []

    def test_missing_name(self, db):
        errors = validate_rule_doc(make_doc(name=""), db)
        assert any("name" in e for e in errors)

    def test_name_too_long(self, db):
        errors = validate_rule_doc(make_doc(name="x" * 65), db)
        assert any("64" in e for e in errors)

    def test_bad_severity(self, db):
        errors = validate_rule_doc(make_doc(severity="FATAL"), db)
        assert any("severity" in e for e in errors)

    def test_message_too_long(self, db):
        errors = validate_rule_doc(make_doc(message="X" * 25), db)
        assert any("24" in e for e in errors)

    def test_enabled_must_be_bool(self, db):
        errors = validate_rule_doc(make_doc(enabled="yes"), db)
        assert any("enabled" in e for e in errors)

    def test_negative_for_seconds(self, db):
        errors = validate_rule_doc(make_doc(for_seconds=-1), db)
        assert any("for_seconds" in e for e in errors)

    def test_zero_conditions(self, db):
        errors = validate_rule_doc(make_doc(conditions=[]), db)
        assert any("conditions" in e for e in errors)

    def test_five_conditions(self, db):
        cond = {"message": "TEST_MSG", "signal": "Temp", "op": ">", "value": 1}
        errors = validate_rule_doc(make_doc(conditions=[cond] * 5), db)
        assert any("conditions" in e for e in errors)

    def test_unknown_message(self, db):
        cond = {"message": "NOPE", "signal": "Temp", "op": ">", "value": 1}
        errors = validate_rule_doc(make_doc(conditions=[cond]), db)
        assert any("NOPE" in e for e in errors)

    def test_unknown_signal(self, db):
        cond = {"message": "TEST_MSG", "signal": "Nope", "op": ">", "value": 1}
        errors = validate_rule_doc(make_doc(conditions=[cond]), db)
        assert any("Nope" in e for e in errors)

    def test_bad_op(self, db):
        cond = {"message": "TEST_MSG", "signal": "Temp", "op": "~", "value": 1}
        errors = validate_rule_doc(make_doc(conditions=[cond]), db)
        assert any("op" in e for e in errors)

    def test_string_value_needs_equality_op(self, db):
        cond = {"message": "TEST_MSG", "signal": "Mode", "op": ">", "value": "RUN"}
        errors = validate_rule_doc(make_doc(conditions=[cond]), db)
        assert any("==" in e for e in errors)

    def test_string_value_must_be_a_choice(self, db):
        cond = {"message": "TEST_MSG", "signal": "Mode", "op": "==", "value": "SLEEP"}
        errors = validate_rule_doc(make_doc(conditions=[cond]), db)
        assert any("SLEEP" in e for e in errors)

    def test_valid_enum_condition(self, db):
        cond = {"message": "TEST_MSG", "signal": "Mode", "op": "==", "value": "FAULT"}
        assert validate_rule_doc(make_doc(conditions=[cond]), db) == []

    def test_not_a_dict(self, db):
        assert validate_rule_doc([], db) == ["rule must be a JSON object"]

    def test_negative_rearm_seconds(self, db):
        errors = validate_rule_doc(make_doc(rearm_seconds=-1), db)
        assert any("rearm_seconds" in e for e in errors)

    def test_condition_not_a_dict(self, db):
        errors = validate_rule_doc(make_doc(conditions=["nope"]), db)
        assert any("must be an object" in e for e in errors)

    def test_condition_missing_message(self, db):
        cond = {"signal": "Temp", "op": ">", "value": 1}
        errors = validate_rule_doc(make_doc(conditions=[cond]), db)
        assert any("message and signal are required" in e for e in errors)

    def test_condition_missing_signal(self, db):
        cond = {"message": "TEST_MSG", "op": ">", "value": 1}
        errors = validate_rule_doc(make_doc(conditions=[cond]), db)
        assert any("message and signal are required" in e for e in errors)

    def test_value_must_be_number_or_named_value(self, db):
        cond = {"message": "TEST_MSG", "signal": "Temp", "op": ">", "value": None}
        errors = validate_rule_doc(make_doc(conditions=[cond]), db)
        assert any("number or a named enum value" in e for e in errors)

    def test_bool_value_rejected(self, db):
        cond = {"message": "TEST_MSG", "signal": "Temp", "op": ">", "value": True}
        errors = validate_rule_doc(make_doc(conditions=[cond]), db)
        assert any("number or a named enum value" in e for e in errors)

    def test_numeric_value_on_enum_signal_rejected(self, db):
        # the decoder always hands enums to rules as their name, so a numeric
        # comparison would validate clean and then never fire
        cond = {"message": "TEST_MSG", "signal": "Mode", "op": "==", "value": 2}
        errors = validate_rule_doc(make_doc(conditions=[cond]), db)
        assert any("Mode is an enum" in e for e in errors)

    def test_numeric_inequality_on_enum_signal_rejected(self, db):
        cond = {"message": "TEST_MSG", "signal": "Mode", "op": ">=", "value": 2}
        errors = validate_rule_doc(make_doc(conditions=[cond]), db)
        assert any("Mode is an enum" in e for e in errors)

    def test_numeric_value_on_plain_signal_allowed(self, db):
        cond = {"message": "TEST_MSG", "signal": "Temp", "op": ">", "value": 2}
        assert validate_rule_doc(make_doc(conditions=[cond]), db) == []


class TestFrameIds:
    def test_collects_frame_ids(self, db):
        docs = [make_doc(), make_doc(conditions=[
            {"message": "OTHER_MSG", "signal": "Speed", "op": ">", "value": 1},
        ])]
        assert frame_ids_for_docs(docs, db) == {256, 257}

    def test_unknown_message_skipped(self, db):
        docs = [make_doc(conditions=[
            {"message": "NOPE", "signal": "X", "op": ">", "value": 1},
        ])]
        assert frame_ids_for_docs(docs, db) == set()


class TestUserRule:
    def test_fires_when_condition_true(self):
        rule = UserRule(make_doc())
        alert = rule.update(frame("TEST_MSG", {"Temp": 130.0}), 1000)
        assert alert is not None
        assert alert.severity == Severity.WARNING
        assert alert.title == "OVERTEMP"
        assert alert.detail == "Overtemp"
        assert alert.rule == "USER:test-rule-1"
        assert alert.ts == 1000
        assert alert.value == 130.0

    def test_no_fire_below_threshold(self):
        rule = UserRule(make_doc())
        assert rule.update(frame("TEST_MSG", {"Temp": 99.0}), 1000) is None

    def test_two_conditions_anded_across_messages(self):
        doc = make_doc(conditions=[
            {"message": "TEST_MSG", "signal": "Temp", "op": ">", "value": 100},
            {"message": "OTHER_MSG", "signal": "Speed", "op": ">", "value": 5},
        ])
        rule = UserRule(doc)
        assert rule.update(frame("TEST_MSG", {"Temp": 130.0}), 1000) is None
        alert = rule.update(frame("OTHER_MSG", {"Speed": 10.0}), 1100)
        assert alert is not None

    def test_for_seconds_holds_before_firing(self):
        rule = UserRule(make_doc(for_seconds=2.0))
        assert rule.update(frame("TEST_MSG", {"Temp": 130.0}), 1000) is None
        assert rule.update(frame("TEST_MSG", {"Temp": 130.0}), 2900) is None
        assert rule.update(frame("TEST_MSG", {"Temp": 130.0}), 3000) is not None

    def test_condition_drop_resets_hold(self):
        rule = UserRule(make_doc(for_seconds=2.0))
        rule.update(frame("TEST_MSG", {"Temp": 130.0}), 1000)
        rule.update(frame("TEST_MSG", {"Temp": 50.0}), 2000)
        rule.update(frame("TEST_MSG", {"Temp": 130.0}), 2100)
        assert rule.update(frame("TEST_MSG", {"Temp": 130.0}), 4000) is None
        assert rule.update(frame("TEST_MSG", {"Temp": 130.0}), 4100) is not None

    def test_no_refire_while_held_true(self):
        rule = UserRule(make_doc())
        assert rule.update(frame("TEST_MSG", {"Temp": 130.0}), 1000) is not None
        assert rule.update(frame("TEST_MSG", {"Temp": 131.0}), 2000) is None

    def test_rearm_requires_false_and_window(self):
        rule = UserRule(make_doc(rearm_seconds=10.0))
        assert rule.update(frame("TEST_MSG", {"Temp": 130.0}), 1000) is not None
        # goes false, but rearm window not yet elapsed
        rule.update(frame("TEST_MSG", {"Temp": 50.0}), 2000)
        assert rule.update(frame("TEST_MSG", {"Temp": 130.0}), 3000) is None
        # window elapsed since fire and it has been false in between
        rule.update(frame("TEST_MSG", {"Temp": 50.0}), 10500)
        assert rule.update(frame("TEST_MSG", {"Temp": 130.0}), 11500) is not None

    def test_stale_condition_blocks_fire(self):
        doc = make_doc(conditions=[
            {"message": "TEST_MSG", "signal": "Temp", "op": ">", "value": 100},
            {"message": "OTHER_MSG", "signal": "Speed", "op": ">", "value": 5},
        ])
        rule = UserRule(doc)
        rule.update(frame("OTHER_MSG", {"Speed": 10.0}), 1000)
        # Speed sample is now older than the staleness window
        assert rule.update(
            frame("TEST_MSG", {"Temp": 130.0}), 1000 + STALENESS_MS + 1) is None

    def test_enum_string_equality(self):
        doc = make_doc(conditions=[
            {"message": "TEST_MSG", "signal": "Mode", "op": "==", "value": "FAULT"},
        ])
        rule = UserRule(doc)
        assert rule.update(frame("TEST_MSG", {"Mode": "RUN"}), 1000) is None
        alert = rule.update(frame("TEST_MSG", {"Mode": "FAULT"}), 2000)
        assert alert is not None
        assert alert.value is None

    def test_unrelated_frame_ignored(self):
        rule = UserRule(make_doc())
        assert rule.update(frame("OTHER_MSG", {"Speed": 1.0}), 1000) is None

    def test_sample_exactly_at_staleness_window_is_still_fresh(self):
        doc = make_doc(conditions=[
            {"message": "TEST_MSG", "signal": "Temp", "op": ">", "value": 100},
            {"message": "OTHER_MSG", "signal": "Speed", "op": ">", "value": 5},
        ])
        rule = UserRule(doc)
        rule.update(frame("OTHER_MSG", {"Speed": 10.0}), 1000)
        assert rule.update(
            frame("TEST_MSG", {"Temp": 130.0}), 1000 + STALENESS_MS) is not None

    def test_unrelated_frame_past_staleness_resets_hold(self):
        # single condition, so this also pins staleness on a one-condition rule
        rule = UserRule(make_doc(for_seconds=2.0))
        assert rule.update(frame("TEST_MSG", {"Temp": 130.0}), 1000) is None
        assert rule.update(
            frame("OTHER_MSG", {"Speed": 1.0}), 1000 + STALENESS_MS + 1) is None
        # the hold restarts from the returning sample instead of completing
        assert rule.update(frame("TEST_MSG", {"Temp": 130.0}), 7000) is None
        assert rule.update(frame("TEST_MSG", {"Temp": 130.0}), 8000) is None
        assert rule.update(frame("TEST_MSG", {"Temp": 130.0}), 9000) is not None

    def test_unrelated_frame_notices_staleness_and_allows_refire(self):
        # after a fire, only unrelated traffic is seen; the lapse of the rule's
        # own signal is what re-arms it, and only an unrelated frame can show it
        rule = UserRule(make_doc())
        assert rule.update(frame("TEST_MSG", {"Temp": 130.0}), 1000) is not None
        assert rule.update(
            frame("OTHER_MSG", {"Speed": 1.0}), 1000 + STALENESS_MS + 1) is None
        assert rule.update(frame("TEST_MSG", {"Temp": 130.0}), 20000) is not None

    def test_long_observation_gap_does_not_satisfy_hold(self):
        rule = UserRule(make_doc(for_seconds=10.0))
        assert rule.update(frame("TEST_MSG", {"Temp": 130.0}), 0) is None
        # the link drops and resumes a minute later with the condition still true
        assert rule.update(frame("TEST_MSG", {"Temp": 130.0}), 60000) is None
        assert rule.update(frame("TEST_MSG", {"Temp": 130.0}), 64000) is None
        assert rule.update(frame("TEST_MSG", {"Temp": 130.0}), 68000) is None
        assert rule.update(frame("TEST_MSG", {"Temp": 130.0}), 70000) is not None

    def test_total_outage_allows_refire(self):
        # nothing at all arrives during the gap, so the rule cannot have watched
        # the fault clear and come back; the gap is not evidence it held
        rule = UserRule(make_doc())
        assert rule.update(frame("TEST_MSG", {"Temp": 130.0}), 1000) is not None
        assert rule.update(frame("TEST_MSG", {"Temp": 130.0}), 61000) is not None

    def test_for_seconds_with_rearm_seconds(self):
        rule = UserRule(make_doc(for_seconds=2.0, rearm_seconds=10.0))
        assert rule.update(frame("TEST_MSG", {"Temp": 130.0}), 1000) is None
        assert rule.update(frame("TEST_MSG", {"Temp": 130.0}), 3000) is not None
        rule.update(frame("TEST_MSG", {"Temp": 50.0}), 4000)
        # hold not met yet after the condition came back
        assert rule.update(frame("TEST_MSG", {"Temp": 130.0}), 5000) is None
        # hold met, but the rearm window since the fire at 3000 has not elapsed
        assert rule.update(frame("TEST_MSG", {"Temp": 130.0}), 8000) is None
        assert rule.update(frame("TEST_MSG", {"Temp": 130.0}), 12000) is None
        assert rule.update(frame("TEST_MSG", {"Temp": 130.0}), 13500) is not None

    def test_timestamp_going_backwards_resets_timing(self):
        rule = UserRule(make_doc(for_seconds=2.0))
        assert rule.update(frame("TEST_MSG", {"Temp": 130.0}), 100000) is None
        # replay restart or source switch: frame time jumps back
        assert rule.update(frame("TEST_MSG", {"Temp": 130.0}), 1000) is None
        assert rule.update(frame("TEST_MSG", {"Temp": 130.0}), 2500) is None
        assert rule.update(frame("TEST_MSG", {"Temp": 130.0}), 3000) is not None

    def test_large_backwards_step_clears_the_fired_timestamp(self):
        rule = UserRule(make_doc(rearm_seconds=60.0))
        assert rule.update(frame("TEST_MSG", {"Temp": 130.0}), 100000) is not None
        # a replay restart is a new source, so the old fire must not gate it
        assert rule.update(frame("TEST_MSG", {"Temp": 130.0}), 1000) is not None

    def test_small_backwards_step_does_not_reset_hold(self):
        # the RF link delivers out-of-order and gap-recovered datagrams as a
        # matter of course, and a hold longer than the reordering must survive
        rule = UserRule(make_doc(for_seconds=10.0))
        assert rule.update(frame("TEST_MSG", {"Temp": 130.0}), 10000) is None
        assert rule.update(frame("TEST_MSG", {"Temp": 130.0}), 14800) is None
        # a recovered datagram arrives 200 ms late
        assert rule.update(frame("TEST_MSG", {"Temp": 130.0}), 14600) is None
        assert rule.update(frame("TEST_MSG", {"Temp": 130.0}), 18000) is None
        assert rule.update(frame("TEST_MSG", {"Temp": 130.0}), 20000) is not None

    def test_small_backwards_step_does_not_bypass_rearm(self):
        rule = UserRule(make_doc(rearm_seconds=10.0))
        assert rule.update(frame("TEST_MSG", {"Temp": 130.0}), 10000) is not None
        rule.update(frame("TEST_MSG", {"Temp": 50.0}), 11000)
        # reordering must not drop the fired timestamp and let the rule respam
        assert rule.update(frame("TEST_MSG", {"Temp": 130.0}), 10800) is None
        assert rule.update(frame("TEST_MSG", {"Temp": 130.0}), 12000) is None
