"""RuleStore tests: persistence, audit trail, optimistic-concurrency conflicts,
and broken-rule marking when the DBC changes underneath stored rules."""
import json
import os

import cantools
import pytest

from src.diagnostics.rule_store import (
    RuleStore, NotFoundError, ConflictError, ValidationError,
)

MINI_DBC = """VERSION ""

BS_:

BU_: ECU DAQ

BO_ 256 TEST_MSG: 8 ECU
 SG_ Temp : 0|16@1+ (0.1,0) [0|6553.5] "C" DAQ
"""

# Same bus without TEST_MSG, to simulate a DBC change breaking a stored rule
SHRUNK_DBC = """VERSION ""

BS_:

BU_: ECU DAQ

BO_ 257 OTHER_MSG: 8 ECU
 SG_ Speed : 0|16@1+ (0.01,0) [0|655.35] "kph" DAQ
"""


@pytest.fixture
def db():
    return cantools.database.load_string(MINI_DBC, database_format="dbc", strict=False)


def draft():
    return {
        "name": "Overtemp",
        "enabled": True,
        "severity": "WARNING",
        "message": "overtemp",
        "conditions": [
            {"message": "TEST_MSG", "signal": "Temp", "op": ">", "value": 100.0},
        ],
        "for_seconds": 0.0,
        "rearm_seconds": 0.0,
    }


def test_create_assigns_id_and_uppercases_message(tmp_path, db):
    store = RuleStore(tmp_path, db)
    doc = store.create(draft(), by="haorui")
    assert doc["id"]
    assert doc["message"] == "OVERTEMP"
    assert doc["created_by"] == "haorui"
    assert doc["broken"] is False


def test_create_persists_across_reload(tmp_path, db):
    RuleStore(tmp_path, db).create(draft(), by="a")
    (doc,) = RuleStore(tmp_path, db).list()
    # A stricter validate_rule_doc would mark every rule broken on every
    # restart, which must fail here rather than pass silently.
    assert doc["broken"] is False


def test_mutating_submitted_doc_does_not_reach_store(tmp_path, db):
    store = RuleStore(tmp_path, db)
    submitted = draft()
    created = store.create(submitted, by="a")
    submitted["conditions"][0]["value"] = 999
    submitted["name"] = "hijacked"
    (held,) = store.list()
    assert held["conditions"][0]["value"] == created["conditions"][0]["value"] == 100.0
    assert held["name"] == "Overtemp"


def test_create_rejects_invalid(tmp_path, db):
    store = RuleStore(tmp_path, db)
    bad = draft() | {"severity": "FATAL"}
    with pytest.raises(ValidationError) as exc:
        store.create(bad, by="a")
    assert any("severity" in e for e in exc.value.errors)
    assert store.list() == []


def test_update_conflict_on_stale_rev(tmp_path, db):
    store = RuleStore(tmp_path, db)
    doc = store.create(draft(), by="a")
    assert doc["rev"] == 1
    second = store.update(doc["id"], draft(), doc["rev"], by="b")
    assert second["rev"] == 2
    with pytest.raises(ConflictError):
        store.update(doc["id"], draft(), doc["rev"], by="c")


def test_toggle_bumps_rev(tmp_path, db):
    store = RuleStore(tmp_path, db)
    doc = store.create(draft(), by="a")
    assert store.toggle(doc["id"], enabled=False, by="b")["rev"] == 2


def test_update_unknown_id(tmp_path, db):
    with pytest.raises(NotFoundError):
        RuleStore(tmp_path, db).update("nope", draft(), 1, by="a")


def _write_rules_file(tmp_path, rules):
    (tmp_path / "rules.json").write_text(json.dumps({"rules": rules}))


def test_legacy_rule_without_rev_is_rev_zero_and_backfills(tmp_path, db):
    legacy = draft() | {"id": "legacy-1", "message": "OVERTEMP", "created_by": "a"}
    _write_rules_file(tmp_path, [legacy])
    store = RuleStore(tmp_path, db)
    updated = store.update("legacy-1", draft(), 0, by="b")
    assert updated["rev"] == 1


def test_legacy_rule_missing_updated_at_conflicts_not_crashes(tmp_path, db):
    legacy = draft() | {"id": "legacy-1", "message": "OVERTEMP"}
    legacy.pop("updated_at", None)
    _write_rules_file(tmp_path, [legacy])
    store = RuleStore(tmp_path, db)
    with pytest.raises(ConflictError):
        store.update("legacy-1", draft(), 7, by="b")


def test_rules_without_id_are_dropped_at_load(tmp_path, db):
    keep = draft() | {"id": "keeper", "message": "OVERTEMP"}
    _write_rules_file(tmp_path, [keep, draft(), draft() | {"id": ""}])
    assert [r["id"] for r in RuleStore(tmp_path, db).list()] == ["keeper"]


def test_delete_and_toggle(tmp_path, db):
    store = RuleStore(tmp_path, db)
    doc = store.create(draft(), by="a")
    toggled = store.toggle(doc["id"], enabled=False, by="b")
    assert toggled["enabled"] is False
    store.delete(doc["id"], by="b")
    assert store.list() == []
    with pytest.raises(NotFoundError):
        store.delete(doc["id"], by="b")


def test_audit_lines_appended(tmp_path, db):
    store = RuleStore(tmp_path, db)
    doc = store.create(draft(), by="a")
    store.toggle(doc["id"], enabled=False, by="b")
    store.delete(doc["id"], by="c")
    lines = [json.loads(l) for l in (tmp_path / "audit.jsonl").read_text().splitlines()]
    assert [l["action"] for l in lines] == ["create", "toggle", "delete"]
    assert lines[0]["by"] == "a" and lines[0]["rule_id"] == doc["id"]


def test_delete_audit_entry_carries_full_rule_body(tmp_path, db):
    store = RuleStore(tmp_path, db)
    doc = store.create(draft(), by="a")
    store.delete(doc["id"], by="b")
    lines = [json.loads(l) for l in (tmp_path / "audit.jsonl").read_text().splitlines()]
    assert lines[-1]["rule"] == doc
    assert "rule" not in lines[0]


def test_failed_rename_leaves_previous_rules_file_intact(tmp_path, db):
    store = RuleStore(tmp_path, db)
    first = store.create(draft(), by="a")
    before = (tmp_path / "rules.json").read_text()

    def boom(*args, **kwargs):
        raise OSError("no rename for you")

    original = os.replace
    os.replace = boom
    try:
        with pytest.raises(OSError):
            store.create(draft() | {"name": "Second"}, by="b")
    finally:
        os.replace = original
    raw = json.loads((tmp_path / "rules.json").read_text())
    assert (tmp_path / "rules.json").read_text() == before
    assert [r["id"] for r in raw["rules"]] == [first["id"]]


def test_dbc_change_marks_broken_not_deleted(tmp_path, db):
    store = RuleStore(tmp_path, db)
    store.create(draft(), by="a")
    shrunk = cantools.database.load_string(SHRUNK_DBC, database_format="dbc", strict=False)
    reloaded = RuleStore(tmp_path, shrunk)
    (doc,) = reloaded.list()
    assert doc["broken"] is True
    assert "TEST_MSG" in doc["broken_reason"]


def test_restoring_dbc_unbreaks_the_rule(tmp_path, db):
    RuleStore(tmp_path, db).create(draft(), by="a")
    shrunk = cantools.database.load_string(SHRUNK_DBC, database_format="dbc", strict=False)
    assert RuleStore(tmp_path, shrunk).list()[0]["broken"] is True
    (doc,) = RuleStore(tmp_path, db).list()
    assert doc["broken"] is False
    assert doc["broken_reason"] is None


def test_corrupt_rules_file_yields_empty_store(tmp_path, db):
    (tmp_path / "rules.json").write_text("{not json")
    assert RuleStore(tmp_path, db).list() == []


def test_corrupt_rules_file_is_moved_aside_not_destroyed(tmp_path, db):
    (tmp_path / "rules.json").write_text("{not json")
    store = RuleStore(tmp_path, db)
    store.create(draft(), by="a")
    saved = list(tmp_path.glob("rules.json.corrupt.*"))
    assert len(saved) == 1
    assert saved[0].read_text() == "{not json"
    assert (tmp_path / "rules.json").read_text() != "{not json"
