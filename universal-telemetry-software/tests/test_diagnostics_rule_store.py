"""RuleStore tests: persistence, audit trail, optimistic-concurrency conflicts,
and broken-rule marking when the DBC changes underneath stored rules."""
import errno
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
    assert not (tmp_path / "rules.json.tmp").exists()
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


def test_rules_without_id_get_one_assigned_at_load(tmp_path, db):
    keep = draft() | {"id": "keeper", "message": "OVERTEMP"}
    _write_rules_file(tmp_path, [keep, draft(), draft() | {"id": ""}])
    store = RuleStore(tmp_path, db)
    ids = [r["id"] for r in store.list()]
    assert ids[0] == "keeper"
    assert len(ids) == 3 and all(ids) and len(set(ids)) == 3
    # The point of assigning an id is that the rule stops being stuck.
    store.delete(ids[1], by="a")
    assert [r["id"] for r in store.list()] == [ids[0], ids[2]]


def test_id_assigned_at_load_is_persisted_across_restart(tmp_path, db):
    # broken/broken_reason already correct, as they would be after any prior
    # restart, so revalidate() itself has nothing to write here: the id fix
    # is the only thing that can make this rule's id stable.
    legacy = draft() | {"broken": False, "broken_reason": None}
    _write_rules_file(tmp_path, [legacy])
    (assigned,) = RuleStore(tmp_path, db).list()
    first_id = assigned["id"]
    (reloaded,) = RuleStore(tmp_path, db).list()
    assert reloaded["id"] == first_id


def test_duplicate_id_is_reassigned_and_persisted(tmp_path, db):
    # broken/broken_reason preset so revalidate() has nothing to write, same
    # as the normal-restart condition described for the missing-id case.
    dup_a = draft() | {"id": "dup", "name": "A", "broken": False, "broken_reason": None}
    dup_b = draft() | {"id": "dup", "name": "B", "broken": False, "broken_reason": None}
    _write_rules_file(tmp_path, [dup_a, dup_b])
    ids_first = [r["id"] for r in RuleStore(tmp_path, db).list()]
    assert len(set(ids_first)) == 2

    # Restart again before any explicit mutation forces a write of its own;
    # the reassigned id for the second rule must be the same one, not a
    # fresh one minted on every boot.
    store = RuleStore(tmp_path, db)
    ids_second = [r["id"] for r in store.list()]
    assert ids_second == ids_first

    # Both rules must now be reachable through _find, the whole point of
    # reassigning rather than leaving the collision in place.
    store.delete(ids_second[1], by="a")
    assert [r["id"] for r in store.list()] == [ids_second[0]]


def test_legacy_rule_is_listed_with_an_integer_rev(tmp_path, db):
    legacy = draft() | {"id": "legacy-1", "message": "OVERTEMP"}
    legacy.pop("rev", None)
    _write_rules_file(tmp_path, [legacy])
    (doc,) = RuleStore(tmp_path, db).list()
    assert "rev" in doc
    assert doc["rev"] == 0


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


def test_failed_rename_leaves_previous_rules_file_intact(tmp_path, db, monkeypatch):
    store = RuleStore(tmp_path, db)
    store.create(draft(), by="a")
    before = (tmp_path / "rules.json").read_text()

    def boom(*args, **kwargs):
        raise OSError("no rename for you")

    monkeypatch.setattr(os, "replace", boom)
    with pytest.raises(OSError):
        store.create(draft() | {"name": "Second"}, by="b")
    assert (tmp_path / "rules.json").read_text() == before


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


@pytest.mark.parametrize("body", ['{"rules": null}', '[{"id": "a"}]', '{"schema": 2}'])
def test_wrong_shaped_rules_file_is_moved_aside_not_destroyed(tmp_path, db, body):
    (tmp_path / "rules.json").write_text(body)
    store = RuleStore(tmp_path, db)
    store.create(draft(), by="a")
    saved = list(tmp_path.glob("rules.json.corrupt.*"))
    assert len(saved) == 1
    assert saved[0].read_text() == body


def test_store_refuses_to_start_if_it_cannot_quarantine(tmp_path, db, monkeypatch):
    (tmp_path / "rules.json").write_text("{not json")

    def boom(*args, **kwargs):
        raise OSError("read-only filesystem")

    monkeypatch.setattr(os, "replace", boom)
    with pytest.raises(OSError):
        RuleStore(tmp_path, db)
    # Refusing to come up is the whole point: the file is still there to save.
    assert (tmp_path / "rules.json").read_text() == "{not json"


def test_absent_rules_file_is_not_quarantined(tmp_path, db):
    RuleStore(tmp_path, db)
    assert list(tmp_path.glob("rules.json.corrupt.*")) == []


def test_empty_rules_list_is_not_quarantined(tmp_path, db):
    _write_rules_file(tmp_path, [])
    RuleStore(tmp_path, db)
    assert list(tmp_path.glob("rules.json.corrupt.*")) == []


def test_quarantine_names_do_not_collide_when_the_clock_repeats(tmp_path, db):
    for _ in range(3):
        (tmp_path / "rules.json").write_text("{not json")
        RuleStore(tmp_path, db)
    assert len(list(tmp_path.glob("rules.json.corrupt.*"))) == 3


def test_audit_log_creation_is_directory_synced(tmp_path, db, monkeypatch):
    synced = []
    import src.diagnostics.rule_store as rule_store

    monkeypatch.setattr(rule_store, "_fsync_dir", lambda p: synced.append(p))
    store = RuleStore(tmp_path, db)
    doc = store.create(draft(), by="a")
    # Once for rules.json, once for the newly created audit.jsonl.
    assert synced == [tmp_path, tmp_path]
    synced.clear()
    # Only the create of audit.jsonl needs the directory entry synced.
    store.toggle(doc["id"], enabled=False, by="b")
    assert synced == [tmp_path]


@pytest.mark.parametrize("err", [errno.EINVAL, errno.ENOTSUP])
def test_unsupported_directory_fsync_does_not_fail_a_committed_write(tmp_path, db,
                                                                    monkeypatch, err):
    real_fsync = os.fsync
    store = RuleStore(tmp_path, db)

    def picky_fsync(fd):
        if os.fstat(fd).st_mode & 0o040000:
            raise OSError(err, os.strerror(err))
        return real_fsync(fd)

    monkeypatch.setattr(os, "fsync", picky_fsync)
    doc = store.create(draft(), by="a")
    assert doc["rev"] == 1
    assert [r["id"] for r in RuleStore(tmp_path, db).list()] == [doc["id"]]


def test_unrelated_directory_fsync_error_still_propagates(tmp_path, db, monkeypatch):
    real_fsync = os.fsync
    store = RuleStore(tmp_path, db)

    def picky_fsync(fd):
        if os.fstat(fd).st_mode & 0o040000:
            raise OSError(errno.EIO, "I/O error")
        return real_fsync(fd)

    monkeypatch.setattr(os, "fsync", picky_fsync)
    with pytest.raises(OSError):
        store.create(draft(), by="a")


class TestWriteFailureLeavesStoreUnchanged:
    """A full or read-only SD card must not leave the store holding a change
    that never reached disk: the engine would not have it, the tablet would
    show it, and it would vanish at the next reboot."""

    @staticmethod
    def _break_writes(store, monkeypatch):
        def boom():
            raise OSError(errno.ENOSPC, "No space left on device")
        monkeypatch.setattr(store, "_write", boom)

    def test_create_rolls_back(self, tmp_path, db, monkeypatch):
        store = RuleStore(tmp_path, db)
        self._break_writes(store, monkeypatch)
        with pytest.raises(OSError):
            store.create(draft(), by="haorui")
        assert store.list() == []

    def test_update_rolls_back(self, tmp_path, db, monkeypatch):
        store = RuleStore(tmp_path, db)
        created = store.create(draft(), by="haorui")
        self._break_writes(store, monkeypatch)
        changed = draft() | {"name": "Renamed"}
        with pytest.raises(OSError):
            store.update(created["id"], changed, created["rev"], by="haorui")
        assert store.list() == [created]

    def test_delete_rolls_back(self, tmp_path, db, monkeypatch):
        store = RuleStore(tmp_path, db)
        created = store.create(draft(), by="haorui")
        self._break_writes(store, monkeypatch)
        with pytest.raises(OSError):
            store.delete(created["id"], by="haorui")
        assert store.list() == [created]

    def test_toggle_rolls_back(self, tmp_path, db, monkeypatch):
        store = RuleStore(tmp_path, db)
        created = store.create(draft(), by="haorui")
        self._break_writes(store, monkeypatch)
        with pytest.raises(OSError):
            store.toggle(created["id"], False, by="haorui")
        assert store.list() == [created]

    def test_failed_create_is_not_audited(self, tmp_path, db, monkeypatch):
        store = RuleStore(tmp_path, db)
        self._break_writes(store, monkeypatch)
        with pytest.raises(OSError):
            store.create(draft(), by="haorui")
        assert not (tmp_path / "audit.jsonl").exists()

    def test_next_successful_write_does_not_persist_the_phantom(self, tmp_path, db, monkeypatch):
        store = RuleStore(tmp_path, db)
        self._break_writes(store, monkeypatch)
        with pytest.raises(OSError):
            store.create(draft(), by="haorui")
        monkeypatch.undo()
        kept = store.create(draft() | {"name": "Second"}, by="haorui")
        on_disk = json.loads((tmp_path / "rules.json").read_text())["rules"]
        assert [r["id"] for r in on_disk] == [kept["id"]]
