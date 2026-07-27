"""Persistence for user rules: rules.json with atomic writes, an append-only
audit log, optimistic-concurrency conflicts, and broken-rule marking when the
DBC no longer contains what a stored rule references."""
from __future__ import annotations

import copy
import json
import logging
import os
import time
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
        self._db = db
        self._rules_path = data_dir / "rules.json"
        self._audit_path = data_dir / "audit.jsonl"
        data_dir.mkdir(parents=True, exist_ok=True)
        self._rules = self._load()
        # A DBC swap between service runs can orphan stored rules; mark them
        # instead of deleting so nobody's work silently disappears.
        self.revalidate()

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
            return []
        rules = [r for r in rules if isinstance(r, dict)]
        # A rule without an id can never be found, updated or deleted, so it
        # would be stuck in the file forever; drop it loudly instead.
        usable = [r for r in rules if isinstance(r.get("id"), str) and r["id"]]
        dropped = len(rules) - len(usable)
        if dropped:
            logger.warning("dropped %d rule(s) with no usable id from %s",
                           dropped, self._rules_path)
        return usable

    def _quarantine(self, exc: Exception) -> None:
        """Move an unreadable rules.json aside so the next write cannot destroy it."""
        dest = self._rules_path.with_name(
            f"{self._rules_path.name}.corrupt.{int(time.time())}")
        try:
            os.replace(self._rules_path, dest)
            _fsync_dir(self._rules_path.parent)
        except OSError:
            logger.error("could not read %s (%s) and could not move it aside",
                         self._rules_path, exc)
            return
        logger.error("could not read %s (%s); moved aside to %s and starting empty",
                     self._rules_path, exc, dest)

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
        self._rules.append(doc)
        self._write()
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
        self._rules[self._rules.index(current)] = doc
        self._write()
        self._audit("update", doc, by)
        return copy.deepcopy(doc)

    def delete(self, rule_id: str, by: str) -> None:
        current = self._find(rule_id)
        self._rules.remove(current)
        self._write()
        self._audit("delete", current, by)

    def toggle(self, rule_id: str, enabled: bool, by: str) -> dict:
        current = self._find(rule_id)
        current["enabled"] = bool(enabled)
        current["updated_at"] = _now_iso()
        current["rev"] = self._rev_of(current) + 1
        self._write()
        self._audit("toggle", current, by)
        return copy.deepcopy(current)

    def revalidate(self) -> None:
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
        with open(self._audit_path, "a") as f:
            f.write(json.dumps(entry) + "\n")
            f.flush()
            os.fsync(f.fileno())
