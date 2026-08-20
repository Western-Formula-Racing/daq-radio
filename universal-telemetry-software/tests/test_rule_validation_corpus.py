"""Runs the rule-validation corpus shared with pecan/src/utils/ruleValidate.corpus.test.ts.

The corpus pins whether a document is valid, not the wording of the errors: the
car writes for a log and the browser form writes for a student, and forcing one
voice on both would be worse than letting the prose differ. What must never
differ is the verdict, because a browser that accepts what the car rejects lets
someone believe an unarmed rule is armed.

Pinned to the committed example.dbc, never secret-dbc, so this passes on a
machine without the submodule. Mirrors test_conformance.py.
"""
import json
from pathlib import Path

import cantools
import pytest

from src.wcars.user_rules import validate_rule_doc

VECTOR_DIR = Path(__file__).parent / "rule_validation"
CORPUS_DBC = Path(__file__).parent.parent / "example.dbc"

VECTORS = sorted(p.name for p in VECTOR_DIR.glob("*.json"))


@pytest.fixture(scope="module")
def db():
    return cantools.database.load_file(CORPUS_DBC)


def test_the_corpus_is_not_empty():
    # A glob that silently matches nothing would make every assertion below
    # vacuous and the whole gate would pass while testing nothing.
    assert len(VECTORS) >= 10


@pytest.mark.parametrize("filename", VECTORS)
def test_vector(filename, db):
    vector = json.loads((VECTOR_DIR / filename).read_text())
    errors = validate_rule_doc(vector["rule"], db)
    assert (errors == []) is vector["valid"], (
        f"{filename}: expected valid={vector['valid']}, got errors={errors}")
