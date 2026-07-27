"""RuleStore tests: persistence, audit trail, optimistic-concurrency conflicts,
and broken-rule marking when the DBC changes underneath stored rules."""
import json

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
    assert len(RuleStore(tmp_path, db).list()) == 1


def test_create_rejects_invalid(tmp_path, db):
    store = RuleStore(tmp_path, db)
    bad = draft() | {"severity": "FATAL"}
    with pytest.raises(ValidationError) as exc:
        store.create(bad, by="a")
    assert any("severity" in e for e in exc.value.errors)
    assert store.list() == []


def test_update_conflict_on_stale_updated_at(tmp_path, db):
    store = RuleStore(tmp_path, db)
    doc = store.create(draft(), by="a")
    store.update(doc["id"], draft(), doc["updated_at"], by="b")
    with pytest.raises(ConflictError):
        store.update(doc["id"], draft(), doc["updated_at"], by="c")


def test_update_unknown_id(tmp_path, db):
    with pytest.raises(NotFoundError):
        RuleStore(tmp_path, db).update("nope", draft(), "x", by="a")


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


def test_atomic_write_leaves_valid_json(tmp_path, db):
    store = RuleStore(tmp_path, db)
    store.create(draft(), by="a")
    raw = json.loads((tmp_path / "rules.json").read_text())
    assert len(raw["rules"]) == 1
    assert not (tmp_path / "rules.json.tmp").exists()


def test_dbc_change_marks_broken_not_deleted(tmp_path, db):
    store = RuleStore(tmp_path, db)
    store.create(draft(), by="a")
    shrunk = cantools.database.load_string(SHRUNK_DBC, database_format="dbc", strict=False)
    reloaded = RuleStore(tmp_path, shrunk)
    (doc,) = reloaded.list()
    assert doc["broken"] is True
    assert "TEST_MSG" in doc["broken_reason"]


def test_corrupt_rules_file_yields_empty_store(tmp_path, db):
    (tmp_path / "rules.json").write_text("{not json")
    assert RuleStore(tmp_path, db).list() == []
