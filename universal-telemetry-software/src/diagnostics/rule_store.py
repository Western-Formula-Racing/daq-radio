"""Persistence for user rules: rules.json with atomic writes, an append-only
audit log, optimistic-concurrency conflicts, and broken-rule marking when the
DBC no longer contains what a stored rule references."""
from __future__ import annotations

import copy
import json
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path

from ..wcars.user_rules import validate_rule_doc


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


class RuleStore:
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
        except (json.JSONDecodeError, OSError):
            return []
        rules = raw.get("rules") if isinstance(raw, dict) else None
        if not isinstance(rules, list):
            return []
        return [r for r in rules if isinstance(r, dict)]

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
        doc["broken"] = False
        doc["broken_reason"] = None
        self._rules.append(doc)
        self._write()
        self._audit("create", doc, by)
        return copy.deepcopy(doc)

    def update(self, rule_id: str, doc: dict, expected_updated_at: str, by: str) -> dict:
        current = self._find(rule_id)
        if current["updated_at"] != expected_updated_at:
            raise ConflictError(f"rule changed at {current['updated_at']}")
        doc = self._normalize(doc)
        errors = validate_rule_doc(doc, self._db)
        if errors:
            raise ValidationError(errors)
        doc["id"] = rule_id
        doc["created_by"] = current.get("created_by", by)
        doc["updated_at"] = _now_iso()
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

    def _normalize(self, doc: dict) -> dict:
        if not isinstance(doc, dict):
            raise ValidationError(["rule must be a JSON object"])
        doc = dict(doc)
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

    def _audit(self, action: str, doc: dict, by: str) -> None:
        entry = {"ts": _now_iso(), "action": action,
                 "rule_id": doc.get("id"), "rule_name": doc.get("name"), "by": by}
        with open(self._audit_path, "a") as f:
            f.write(json.dumps(entry) + "\n")
