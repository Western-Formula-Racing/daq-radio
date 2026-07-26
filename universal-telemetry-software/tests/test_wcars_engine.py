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