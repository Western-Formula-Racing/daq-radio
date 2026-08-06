"""Every conformance vector must reproduce in the Python engine.

These files are the contract with the browser engine: the TS suite loads the same
directory. A vector that passes here and fails there means the runtimes diverged."""
import json
from pathlib import Path

import pytest

from src.wcars.config import load_config
from src.wcars.engine import WcarsEngine

VECTOR_DIR = Path(__file__).parent / "conformance"

# The corpus is pinned to the committed example.dbc rather than whichever DBC
# conftest happened to select, so regenerating produces byte-identical files on a
# machine with or without the secret-dbc submodule. The corpus exists to pin rule
# timing, and which DBC is checked out is a different concern with its own test.
CORPUS_DBC = Path(__file__).parent.parent / "example.dbc"

REQUIRED_TARGETS = {
    "high_water", "newest_wins", "gap_resets_hold", "small_backwards_ignored",
    "large_backwards_resets", "stale_is_false", "rearm", "for_seconds",
}


@pytest.fixture(autouse=True, scope="module")
def _pin_corpus_dbc():
    """Load the corpus DBC for this module only, restoring what was there before.

    The decoder caches the database globally, so both the path and the caches have
    to be put back or later modules would keep reading example.dbc.
    """
    from src.wcars import decoder
    previous = decoder.DBC_PATH
    decoder.DBC_PATH = str(CORPUS_DBC)
    decoder._load_db.cache_clear()
    decoder._msg_id_map.cache_clear()
    yield
    decoder.DBC_PATH = previous
    decoder._load_db.cache_clear()
    decoder._msg_id_map.cache_clear()


def _vectors():
    return sorted(VECTOR_DIR.glob("*.json"))


def _run(vector, tmp_path):
    engine = WcarsEngine(load_config(tmp_path / "c.json"),
                         user_rule_docs=vector["rules"])
    produced = []
    for ts_ms, can_id, data_hex in vector["frames"]:
        for alert in engine.feed(
                {"canId": can_id, "data": list(bytes.fromhex(data_hex))}, ts_ms):
            produced.append({"rule": alert.rule, "severity": alert.severity.value,
                             "title": alert.title, "detail": alert.detail,
                             "value": alert.value, "ts": alert.ts})
    return produced


def test_vector_directory_is_not_empty():
    assert _vectors(), "no conformance vectors generated"


def test_every_timing_behavior_is_covered():
    covered = set()
    for path in _vectors():
        covered.update(json.loads(path.read_text())["targets"])
    missing = REQUIRED_TARGETS - covered
    assert not missing, f"no vector pins these behaviors: {sorted(missing)}"


@pytest.mark.parametrize("path", _vectors(), ids=lambda p: p.stem)
def test_vector_reproduces(path, tmp_path):
    vector = json.loads(path.read_text())
    assert _run(vector, tmp_path) == vector["expected_alerts"]


@pytest.mark.parametrize("path", _vectors(), ids=lambda p: p.stem)
def test_recorded_decode_matches_the_live_decoder(path):
    """The browser suite feeds the recorded decode instead of decoding itself.

    If the recording drifts from what the decoder actually produces, that suite
    would keep passing against data this engine no longer sees.
    """
    from src.wcars.decoder import Decoder
    from src.wcars.user_rules import frame_ids_for_docs
    from src.wcars.decoder import load_db

    vector = json.loads(path.read_text())
    decoder = Decoder(extra_ids=frame_ids_for_docs(vector["rules"], load_db()))
    assert len(vector["decoded"]) == len(vector["frames"])
    for (ts_ms, can_id, data_hex), recorded in zip(vector["frames"], vector["decoded"]):
        live = decoder.decode({"canId": can_id, "data": list(bytes.fromhex(data_hex))})
        if live is None:
            assert recorded is None
        else:
            assert recorded == {"message": live["message"], "signals": live["signals"]}


def test_a_vector_fails_when_the_expectation_is_wrong(tmp_path):
    """Guards the harness itself: a corrupted expectation must be detected."""
    vector = json.loads(_vectors()[0].read_text())
    engine = WcarsEngine(load_config(tmp_path / "c.json"),
                         user_rule_docs=vector["rules"])
    produced = []
    for ts_ms, can_id, data_hex in vector["frames"]:
        for alert in engine.feed(
                {"canId": can_id, "data": list(bytes.fromhex(data_hex))}, ts_ms):
            produced.append(alert.rule)
    assert produced != ["definitely-not-a-real-rule-id"]
