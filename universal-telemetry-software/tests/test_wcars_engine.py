import pytest

from src.wcars.engine import WcarsEngine
from src.wcars.serialization import Severity
from tests.wcars_dbc_utils import vcu_state_info


def test_engine_emits_alert_on_state_change():
    eng = WcarsEngine(config={"thresholds": {"torch_cell_temp_c": 55.0,
                                              "torch_cell_imbalance_v": 0.10,
                                              "rearm_seconds": 0},
                               "audio": {"enabled": False, "volume": 0.0}})
    eng.feed(vcu_state_info(4), 1_700_000_000_000)  # DRIVE (decodes to "DRIVE" via DBC VAL_)
    alerts = eng.feed(vcu_state_info(6), 1_700_000_000_100)  # DEVICE_FAULT (decodes to "DEVICE_FAULT")
    assert any(a.severity == Severity.WARNING and a.rule == "VCU_STATE_FAULT" for a in alerts)


def test_engine_holds_ring_buffer():
    eng = WcarsEngine(config={"thresholds": {"torch_cell_temp_c": 55.0,
                                              "torch_cell_imbalance_v": 0.10,
                                              "rearm_seconds": 0},
                               "audio": {"enabled": False, "volume": 0.0}})
    eng.feed(vcu_state_info(4), 1_700_000_000_000)
    eng.feed(vcu_state_info(6), 1_700_000_000_100)
    eng.feed(vcu_state_info(6), 1_700_000_000_200)  # no new
    backlog = eng.backlog()
    assert len(backlog) == 1
    assert backlog[0].replay is True


def test_engine_handles_unknown_id_silently():
    eng = WcarsEngine(config={"thresholds": {"torch_cell_temp_c": 55.0,
                                              "torch_cell_imbalance_v": 0.10,
                                              "rearm_seconds": 0},
                               "audio": {"enabled": False, "volume": 0.0}})
    assert eng.feed({"canId": 0x1234, "data": [0] * 8}, 1_700_000_000_000) == []


def test_engine_replaces_config():
    eng = WcarsEngine(config={"thresholds": {"torch_cell_temp_c": 55.0,
                                              "torch_cell_imbalance_v": 0.10,
                                              "rearm_seconds": 0},
                               "audio": {"enabled": False, "volume": 0.0}})
    new_cfg = {"thresholds": {"torch_cell_temp_c": 70.0,
                              "torch_cell_imbalance_v": 0.20,
                              "rearm_seconds": 0},
               "audio": {"enabled": False, "volume": 0.0}}
    eng.set_config(new_cfg)
    assert eng.config["thresholds"]["torch_cell_temp_c"] == 70.0


def test_feed_requires_an_explicit_timestamp():
    # A missing timestamp used to silently fall back to the wall clock, which
    # produced wrong results on replay. It must now be a hard error.
    import pytest
    from src.wcars.engine import WcarsEngine
    engine = WcarsEngine({})
    with pytest.raises(TypeError):
        engine.feed({"canId": 0x7D2, "data": [0, 4, 0, 0, 0, 0, 0, 0]})


def test_feed_stamps_alerts_with_the_supplied_timestamp():
    from src.wcars.engine import WcarsEngine
    engine = WcarsEngine({})
    engine.feed({"canId": 0x7D2, "data": [0, 4, 0, 0, 0, 0, 0, 0]}, 1_700_000_000_000)
    alerts = engine.feed({"canId": 0x7D2, "data": [0, 6, 0, 0, 0, 0, 0, 0]}, 1_700_000_000_250)
    assert alerts, "expected a VCU state transition alert"
    assert all(a.ts == 1_700_000_000_250 for a in alerts)


def test_is_valid_frame_ts_accepts_positive_int():
    from src.websocket_bridge import _is_valid_frame_ts
    assert _is_valid_frame_ts(1_700_000_000_000) is True


def test_is_valid_frame_ts_rejects_negative():
    from src.websocket_bridge import _is_valid_frame_ts
    assert _is_valid_frame_ts(-1) is False


def test_is_valid_frame_ts_rejects_zero():
    from src.websocket_bridge import _is_valid_frame_ts
    assert _is_valid_frame_ts(0) is False


def test_is_valid_frame_ts_rejects_bool_true():
    from src.websocket_bridge import _is_valid_frame_ts
    assert _is_valid_frame_ts(True) is False


def test_is_valid_frame_ts_rejects_bool_false():
    from src.websocket_bridge import _is_valid_frame_ts
    assert _is_valid_frame_ts(False) is False


def test_is_valid_frame_ts_rejects_float():
    from src.websocket_bridge import _is_valid_frame_ts
    assert _is_valid_frame_ts(1_700_000_000_000.0) is False


def test_is_valid_frame_ts_rejects_string():
    from src.websocket_bridge import _is_valid_frame_ts
    assert _is_valid_frame_ts("1700000000000") is False


def test_is_valid_frame_ts_rejects_absent_key():
    from src.websocket_bridge import _is_valid_frame_ts
    frame = {}
    assert _is_valid_frame_ts(frame.get("time")) is False

def _recorded_session():
    """A small synthetic session: normal, then a precharge fault, then a VCU fault.

    Timestamps are 100ms apart in car time regardless of how fast the test
    feeds them, which is exactly the property under test.
    """
    base = 1_700_000_000_000
    frames = []
    for i in range(5):
        frames.append(({"canId": 0x7D2, "data": [0, 4, 0, 0, 0, 0, 0, 0]}, base + i * 100))
    # Precharge enabled but never OK, held well past the 2s timeout.
    for i in range(5, 45):
        frames.append(({"canId": 0x7D3, "data": [0x01, 0, 0, 0, 0, 0, 0, 0]}, base + i * 100))
    # VCU drops into DEVICE_FAULT.
    frames.append(({"canId": 0x7D2, "data": [0, 6, 0, 0, 0, 0, 0, 0]}, base + 4600))
    return frames


def test_replay_is_independent_of_feed_speed():
    import time as _time
    from src.wcars.engine import WcarsEngine

    frames = _recorded_session()

    fast = WcarsEngine({})
    fast_alerts = []
    for frame, ts in frames:
        fast_alerts.extend(fast.feed(frame, ts))

    slow = WcarsEngine({})
    slow_alerts = []
    for frame, ts in frames:
        slow_alerts.extend(slow.feed(frame, ts))
        _time.sleep(0.002)  # real time passes; results must not change

    assert [(a.rule, a.ts) for a in fast_alerts] == [(a.rule, a.ts) for a in slow_alerts]
    assert fast_alerts, "session should produce at least one alert"


def test_replay_is_independent_of_when_it_is_run():
    # Feeding the same session twice, separated by real time, must give the
    # same answer. This is the case that was broken by wall-clock re-arm.
    import time as _time
    from src.wcars.engine import WcarsEngine

    frames = _recorded_session()

    first = WcarsEngine({})
    first_alerts = [a for frame, ts in frames for a in first.feed(frame, ts)]

    _time.sleep(0.05)

    second = WcarsEngine({})
    second_alerts = [a for frame, ts in frames for a in second.feed(frame, ts)]

    assert [(a.rule, a.ts, a.detail) for a in first_alerts] == \
           [(a.rule, a.ts, a.detail) for a in second_alerts]


DEFAULT_CORPUS = "/Users/hz/Downloads/2026-05-31/2026-05-31-19-29-31.csv"


def _load_corpus(path):
    """Parse a recorded raw-CAN log into (frame, ts_ms) pairs.

    Log rows are headerless: millis_since_logger_start, "CAN", decimal can_id,
    then 8 data bytes. The offsets are anchored to an arbitrary fixed epoch so
    the frames look like live car time to the engine.
    """
    import csv

    epoch = 1_700_000_000_000
    frames = []
    with open(path, newline="") as fh:
        for row in csv.reader(fh):
            if len(row) < 11 or row[1] != "CAN":
                continue
            try:
                offset_ms = int(row[0])
                can_id = int(row[2])
                data = [int(b) for b in row[3:11]]
            except ValueError:
                continue
            frames.append(({"canId": can_id, "data": data}, epoch + offset_ms))
    return frames


def test_recorded_corpus_replay_is_deterministic():
    """Replaying a real recorded session twice must produce identical alerts.

    Synthetic sessions only exercise the rules the test author thought of; a
    real log exercises whatever the car actually did. The corpus is not in the
    repo, so this skips unless WCARS_REPLAY_CORPUS (or the default download
    path) points at a raw CAN csv.
    """
    import os
    from src.wcars.engine import WcarsEngine

    path = os.getenv("WCARS_REPLAY_CORPUS", DEFAULT_CORPUS)
    if not os.path.exists(path):
        pytest.skip(f"recorded corpus not available at {path}")

    frames = _load_corpus(path)
    assert frames, "corpus parsed to zero frames; the csv layout may have changed"

    def replay():
        eng = WcarsEngine({})
        return [a for frame, ts in frames for a in eng.feed(frame, ts)]

    # Alert.id is a fresh uuid per alert, so it cannot take part in the compare.
    def fingerprint(alerts):
        return [(a.rule, a.severity, a.title, a.detail, a.value, a.ts, a.replay) for a in alerts]

    assert fingerprint(replay()) == fingerprint(replay())
