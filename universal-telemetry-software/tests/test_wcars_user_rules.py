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


def frame(message, signals):
    return {"message": message, "can_id": 256, "signals": signals}


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
