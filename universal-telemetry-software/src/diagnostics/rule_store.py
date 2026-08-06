"""Persistence for user rules: rules.json with atomic writes, an append-only
audit log, optimistic-concurrency conflicts, and broken-rule marking when the
DBC no longer contains what a stored rule references."""
from __future__ import annotations

import copy
import errno
import json
import logging
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path

from ..wcars.user_rules import validate_rule_doc

logger = logging.getLogger("RuleStore")


class RuleStoreError(Exception):
    pass


class NotFoundError(RuleStoreError):
    pass


class ConflictError(RuleStoreError):
    pass


class ValidationError(RuleStoreError):
    def __init__(self, errors: list[str]) -> None:
        super().__init__("; ".join(errors))
        self.errors = errors


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _fsync_dir(path: Path) -> None:
    """Persist a rename or create in the directory entry itself.

    Without this the file contents are durable but the name may not be, so a
    power cut can leave the pre-rename directory and lose an acknowledged write.
    """
    dirfd = os.open(path, os.O_RDONLY)
    try:
        os.fsync(dirfd)
    except OSError as exc:
        # The rename has already committed by the time we get here, so a
        # filesystem that cannot fsync a directory must not turn a successful
        # write into a 500 the caller would retry against an advanced rev.
        if exc.errno not in (errno.EINVAL, errno.ENOTSUP):
            raise
        logger.warning("directory fsync unsupported on %s (%s); write is not "
                       "crash-durable on this filesystem", path, exc)
    finally:
        os.close(dirfd)


class RuleStore:
    """Owns rules.json for one data_dir.

    Single-instance contract: exactly one RuleStore may exist per data_dir, and
    the service must therefore run single-process (one uvicorn worker). _write
    dumps the whole in-memory list without a file lock and without re-reading,
    so a second instance on the same directory would silently overwrite the
    first instance's rules with its own stale snapshot.
    """

    def __init__(self, data_dir: Path, db) -> None:
        """Raises OSError if an unreadable rules.json could not be moved aside.

        Refusing to come up is deliberate: the first write would otherwise
        overwrite a file we failed to preserve a copy of.
        """
        self._db = db
        self.data_dir = data_dir
        self._rules_path = data_dir / "rules.json"
        self._audit_path = data_dir / "audit.jsonl"
        data_dir.mkdir(parents=True, exist_ok=True)
        self._ids_assigned_at_load = False
        self._rules = self._load()
        # A DBC swap between service runs can orphan stored rules; mark them
        # instead of deleting so nobody's work silently disappears.
        wrote = self.revalidate()
        if self._ids_assigned_at_load and not wrote:
            # Persist the ids _load minted so they are stable across restarts;
            # a hand-edited or legacy rules.json must not mint a new id every
            # boot, or every rule identity held by a client goes stale.
            try:
                self._write()
            except OSError as exc:
                logger.warning("could not persist assigned ids to %s (%s); "
                               "serving in-memory ids for this run", self._rules_path, exc)

    def _load(self) -> list[dict]:
        if not self._rules_path.exists():
            return []
        try:
            raw = json.loads(self._rules_path.read_text())
        except (json.JSONDecodeError, OSError) as exc:
            self._quarantine(exc)
            return []
        rules = raw.get("rules") if isinstance(raw, dict) else None
        if not isinstance(rules, list):
            # Parseable but wrong-shaped (schema drift, a bare top-level list):
            # same "the next write destroys it" hazard as an unparseable file.
            self._quarantine(ValueError("no 'rules' list at the top level"))
            return []
        non_dict_count = sum(1 for r in rules if not isinstance(r, dict))
        if non_dict_count:
            logger.warning("dropped %d non-object entr%s from the 'rules' list in %s",
                           non_dict_count, "y" if non_dict_count == 1 else "ies",
                           self._rules_path)
        rules = [r for r in rules if isinstance(r, dict)]
        seen_ids: set[str] = set()
        for rule in rules:
            # A rule without an id, or one that collides with an id already
            # seen in this file, can never be found, updated or deleted
            # unambiguously, so it would be stuck forever; give it a fresh
            # one rather than dropping somebody's work.
            current_id = rule.get("id")
            has_usable_id = isinstance(current_id, str) and current_id
            if not has_usable_id or current_id in seen_ids:
                reason = "a duplicate id" if has_usable_id else "no usable id"
                rule["id"] = str(uuid.uuid4())
                self._ids_assigned_at_load = True
                logger.warning("assigned id %s to a rule with %s in %s",
                               rule["id"], reason, self._rules_path)
            seen_ids.add(rule["id"])
            # Backfill so every document the store hands out carries an int rev
            # and no caller has to know out of band that a missing rev means 0.
            rule["rev"] = self._rev_of(rule)
        return rules

    def _quarantine(self, exc: Exception) -> None:
        """Move an unusable rules.json aside so the next write cannot destroy it.

        Raises if the move fails: coming up empty would let the first write
        overwrite the only copy of everyone's rules.
        """
        # uuid, not a timestamp: this Pi's clock can jump backward before NTP
        # settles, and os.replace onto an existing name is a silent clobber.
        dest = self._rules_path.with_name(
            f"{self._rules_path.name}.corrupt.{uuid.uuid4().hex}")
        try:
            os.replace(self._rules_path, dest)
        except OSError:
            # Only the move itself is a failure to preserve the file; a
            # directory-fsync failure after a successful move must not be
            # reported as "could not move it aside" or the journal misleads
            # whoever reads it later.
            logger.error("could not read %s (%s) and could not move it aside",
                         self._rules_path, exc, exc_info=True)
            raise
        _fsync_dir(self._rules_path.parent)
        logger.error("could not read %s (%s); moved aside to %s and starting empty",
                     self._rules_path, exc, dest)

    def _commit(self, restore: list[dict]) -> None:
        """Persist the already-applied mutation, or undo it if the disk refuses.

        A full or read-only SD card would otherwise leave the store holding a
        change that never reached disk: the engine never gets told about it,
        the tablet lists it as if it were armed, and it disappears at the next
        reboot. Better to fail the request outright.
        """
        try:
            self._write()
        except OSError:
            self._rules[:] = restore
            raise

    def list(self) -> list[dict]:
        # Deep copy: conditions is a list of dicts, and a caller mutating a
        # returned condition must never reach back into the store's state.
        return [copy.deepcopy(r) for r in self._rules]

    def create(self, doc: dict, by: str) -> dict:
        doc = self._normalize(doc)
        errors = validate_rule_doc(doc, self._db)
        if errors:
            raise ValidationError(errors)
        doc["id"] = str(uuid.uuid4())
        doc["created_by"] = by
        doc["updated_at"] = _now_iso()
        doc["rev"] = 1
        doc["broken"] = False
        doc["broken_reason"] = None
        restore = list(self._rules)
        self._rules.append(doc)
        self._commit(restore)
        self._audit("create", doc, by)
        return copy.deepcopy(doc)

    def update(self, rule_id: str, doc: dict, expected_rev: int, by: str) -> dict:
        current = self._find(rule_id)
        # rev, not updated_at: this Pi's clock runs badly skewed before NTP
        # settles, so timestamps are not monotonic and could hide a stale write.
        current_rev = self._rev_of(current)
        if current_rev != expected_rev:
            raise ConflictError(f"rule is at rev {current_rev}")
        doc = self._normalize(doc)
        errors = validate_rule_doc(doc, self._db)
        if errors:
            raise ValidationError(errors)
        doc["id"] = rule_id
        doc["created_by"] = current.get("created_by", by)
        doc["updated_at"] = _now_iso()
        doc["rev"] = current_rev + 1
        doc["broken"] = False
        doc["broken_reason"] = None
        restore = list(self._rules)
        self._rules[self._rules.index(current)] = doc
        self._commit(restore)
        self._audit("update", doc, by)
        return copy.deepcopy(doc)

    def delete(self, rule_id: str, by: str) -> None:
        current = self._find(rule_id)
        restore = list(self._rules)
        self._rules.remove(current)
        self._commit(restore)
        self._audit("delete", current, by)

    def toggle(self, rule_id: str, enabled: bool, by: str) -> dict:
        current = self._find(rule_id)
        # A fresh document rather than an in-place edit, so a failed write can
        # be undone by putting the original object back.
        toggled = copy.deepcopy(current)
        toggled["enabled"] = bool(enabled)
        toggled["updated_at"] = _now_iso()
        toggled["rev"] = self._rev_of(current) + 1
        restore = list(self._rules)
        self._rules[self._rules.index(current)] = toggled
        self._commit(restore)
        self._audit("toggle", toggled, by)
        return copy.deepcopy(toggled)

    def revalidate(self) -> bool:
        changed = False
        for rule in self._rules:
            errors = validate_rule_doc(rule, self._db)
            reason = "; ".join(errors) if errors else None
            if rule.get("broken") != bool(errors) or rule.get("broken_reason") != reason:
                rule["broken"] = bool(errors)
                rule["broken_reason"] = reason
                changed = True
        if changed:
            self._write()
        return changed

    @staticmethod
    def _rev_of(rule: dict) -> int:
        # A rule written before rev existed is treated as rev 0 and picks one up
        # on its next mutation.
        rev = rule.get("rev")
        if isinstance(rev, bool) or not isinstance(rev, int):
            return 0
        return rev

    def _normalize(self, doc: dict) -> dict:
        if not isinstance(doc, dict):
            raise ValidationError(["rule must be a JSON object"])
        # Deep copy: the caller keeps its own dict, and a later mutation of its
        # conditions must not reach the store's rule unvalidated and unaudited.
        doc = copy.deepcopy(doc)
        doc["message"] = str(doc.get("message", "")).upper()
        return doc

    def _find(self, rule_id: str) -> dict:
        for rule in self._rules:
            if rule.get("id") == rule_id:
                return rule
        raise NotFoundError(f"no rule with id {rule_id}")

    def _write(self) -> None:
        # Temp file plus rename so a crash mid-write can never corrupt the
        # only copy of everyone's rules.
        tmp = self._rules_path.with_name(self._rules_path.name + ".tmp")
        with open(tmp, "w") as f:
            json.dump({"rules": self._rules}, f, indent=2)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, self._rules_path)
        _fsync_dir(self._rules_path.parent)

    def _audit(self, action: str, doc: dict, by: str) -> None:
        entry = {"ts": _now_iso(), "action": action,
                 "rule_id": doc.get("id"), "rule_name": doc.get("name"), "by": by}
        if action == "delete":
            # The audit line is the only remaining record of a deleted rule, so
            # keep the whole body to make an accidental delete recoverable.
            entry["rule"] = copy.deepcopy(doc)
        is_new = not self._audit_path.exists()
        with open(self._audit_path, "a") as f:
            f.write(json.dumps(entry) + "\n")
            f.flush()
            os.fsync(f.fileno())
        if is_new:
            # The contents are durable but the name is not until the directory
            # is synced, so a power cut could lose the whole audit log.
            _fsync_dir(self._audit_path.parent)
