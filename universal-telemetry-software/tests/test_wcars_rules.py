import pytest

from src.wcars.serialization import Severity
from src.wcars.rules import (
    VcuStateFaultRule,
    VcuStateChangeRule,
    TorchFaultRule,
    InvFaultRule,
    InvVsmStateRule,
    TorchCellTempRule,
    TorchCellImbalanceRule,
    ImdFaultRule,
    AmsFaultRule,
    BspdFaultRule,
    SafetyLoopOpenRule,
    HvLossRule,
    AirFaultRule,
    PrechargeErrorRule,
)


def _sig(name, **signals):
    return {"message": name, "can_id": 0, "signals": signals}


class _Clock:
    """Monotonic frame-time source for tests, in milliseconds.

    Frame time is what the rules now measure, so tests advance this rather
    than sleeping. The default 100ms tick is well inside every re-arm window,
    so tests asserting "does not re-fire" keep their meaning.
    """

    def __init__(self, start: int = 1_000_000_000_000) -> None:
        self.now = start

    def tick(self, ms: int = 100) -> int:
        self.now += ms
        return self.now


def _pack(*, legacy=True, **overrides):
    """0x420 PackStatus frame, all relays healthy unless overridden.

    legacy=True uses the backend DBC names (Safetyloop_return / HV_Active);
    legacy=False uses the pecan DBC names (AIR_Negative_Relay / AIR_Positive_Relay).
    """
    neg, pos = ("Safetyloop_return", "HV_Active") if legacy else ("AIR_Negative_Relay", "AIR_Positive_Relay")
    signals = {
        "PackCurrent": 12.0, "IMDRelay": 1, "AMSRelay": 1, "BSPDRelay": 1,
        "LatchRelay": 1, neg: 1, pos: 1, "SOC": 88.0, "PackStatus": "Active", "Fault": 0,
    }
    for key, val in overrides.items():
        if key == "air_negative":
            signals[neg] = val
        elif key == "air_positive":
            signals[pos] = val
        else:
            signals[key] = val
    return _sig("PackStatus", **signals)


def test_vcu_state_fault_fires_on_drive_to_device_fault():
    c = _Clock()
    r = VcuStateFaultRule()
    r.update(_sig("VCU_State_Info", State="DRIVE"), c.tick())
    a = r.update(_sig("VCU_State_Info", State="DEVICE_FAULT"), c.tick())
    assert a is not None
    assert a.severity == Severity.WARNING
    assert a.rule == "VCU_STATE_FAULT"
    assert "DEVICE FAULT" in a.title


def test_vcu_state_fault_fires_on_precharge_error():
    c = _Clock()
    r = VcuStateFaultRule()
    r.update(_sig("VCU_State_Info", State="STARTUP_DELAY"), c.tick())
    a = r.update(_sig("VCU_State_Info", State="PRECHARGE_ERROR"), c.tick())
    assert a is not None
    assert a.severity == Severity.WARNING


def test_vcu_state_fault_does_not_fire_while_persisted():
    c = _Clock()
    r = VcuStateFaultRule()
    r.update(_sig("VCU_State_Info", State="DRIVE"), c.tick())
    r.update(_sig("VCU_State_Info", State="DEVICE_FAULT"), c.tick())
    # Another frame in DEVICE_FAULT — no new alert
    assert r.update(_sig("VCU_State_Info", State="DEVICE_FAULT"), c.tick()) is None


def test_vcu_state_fault_rearms_after_clear():
    c = _Clock()
    r = VcuStateFaultRule(rearm_seconds=0)
    r.update(_sig("VCU_State_Info", State="DRIVE"), c.tick())
    r.update(_sig("VCU_State_Info", State="DEVICE_FAULT"), c.tick())
    r.update(_sig("VCU_State_Info", State="DRIVE"), c.tick())  # clear
    a = r.update(_sig("VCU_State_Info", State="DEVICE_FAULT"), c.tick())  # re-fire
    assert a is not None


def test_vcu_state_change_memo_for_normal_transition():
    c = _Clock()
    r = VcuStateChangeRule()
    r.update(_sig("VCU_State_Info", State="START"), c.tick())
    a = r.update(_sig("VCU_State_Info", State="PRECHARGE_ENABLE"), c.tick())
    assert a is not None
    assert a.severity == Severity.MEMO


def test_torch_fault_fires_on_error_code():
    c = _Clock()
    r = TorchFaultRule()
    r.update(_sig("TORCH_FAULT", Module_ID="Module 1", Error_code=0, **{f"Cell_{i}_status": "Good" for i in range(12)}), c.tick())
    a = r.update(_sig("TORCH_FAULT", Module_ID="Module 1", Error_code="Module overheat (69)",
                      **{f"Cell_{i}_status": "Good" for i in range(12)}), c.tick())
    assert a is not None
    assert a.severity == Severity.WARNING
    assert "Module 1" in a.title


def test_torch_fault_fires_on_cell_status_fault():
    c = _Clock()
    sigs = {f"Cell_{i}_status": "Good" for i in range(12)}
    sigs["Cell_5_status"] = "Fault"
    a = TorchFaultRule().update(_sig("TORCH_FAULT", Module_ID="Module 2", Error_code=0, **sigs), c.tick())
    assert a is not None


def test_torch_fault_does_not_fire_when_all_good():
    c = _Clock()
    a = TorchFaultRule().update(_sig("TORCH_FAULT", Module_ID="Module 1", Error_code=0,
                                     **{f"Cell_{i}_status": "Good" for i in range(12)}), c.tick())
    assert a is None


def test_inv_fault_fires_when_any_fault_word_nonzero():
    c = _Clock()
    a = InvFaultRule().update(_sig("M171_Fault_Codes", INV_Run_Fault_Hi=0, INV_Post_Fault_Hi=0,
                                   INV_Run_Fault_Lo=0, INV_Post_Fault_Lo=0), c.tick())
    assert a is None
    a = InvFaultRule().update(_sig("M171_Fault_Codes", INV_Run_Fault_Hi=1, INV_Post_Fault_Hi=0,
                                   INV_Run_Fault_Lo=0, INV_Post_Fault_Lo=0), c.tick())
    assert a is not None
    assert a.severity == Severity.WARNING


def test_inv_vsm_state_caution_for_blink_fault():
    c = _Clock()
    r = InvVsmStateRule()
    r.update(_sig("M170_Internal_States", INV_VSM_State="VSM ready state"), c.tick())
    a = r.update(_sig("M170_Internal_States", INV_VSM_State="blink fault code state"), c.tick())
    assert a is not None
    assert a.severity == Severity.CAUTION


def test_inv_vsm_state_caution_for_shutdown():
    c = _Clock()
    r = InvVsmStateRule()
    r.update(_sig("M170_Internal_States", INV_VSM_State="Motor Running State"), c.tick())
    a = r.update(_sig("M170_Internal_States", INV_VSM_State="Shutdown state for Key Switch Mode 1"), c.tick())
    assert a is not None


def test_torch_cell_temp_fires_above_threshold():
    c = _Clock()
    r = TorchCellTempRule(threshold_c=55.0)
    sigs = {f"M1_Thermistor{i+1}": 50.0 for i in range(4)}
    r.update(_sig("TORCH_M1_T1", **sigs), c.tick())
    sigs2 = dict(sigs); sigs2["M1_Thermistor1"] = 57.2
    a = r.update(_sig("TORCH_M1_T1", **sigs2), c.tick())
    assert a is not None
    assert "57" in a.detail


def test_torch_cell_temp_does_not_fire_at_threshold_boundary():
    c = _Clock()
    r = TorchCellTempRule(threshold_c=55.0)
    sigs = {f"M1_Thermistor{i+1}": 50.0 for i in range(4)}
    r.update(_sig("TORCH_M1_T1", **sigs), c.tick())
    sigs2 = dict(sigs); sigs2["M1_Thermistor1"] = 54.99
    assert r.update(_sig("TORCH_M1_T1", **sigs2), c.tick()) is None


def test_torch_cell_temp_extracts_module_from_signal_name():
    """Signals on M3_T1 should produce an alert with module 3 in the title."""
    c = _Clock()
    r = TorchCellTempRule(threshold_c=55.0)
    sigs = {f"M3_Thermistor{i+1}": 50.0 for i in range(4)}
    r.update(_sig("TORCH_M3_T1", **sigs), c.tick())
    sigs2 = dict(sigs); sigs2["M3_Thermistor2"] = 60.0
    a = r.update(_sig("TORCH_M3_T1", **sigs2), c.tick())
    assert a is not None
    assert "3" in a.title


def test_torch_cell_imbalance_fires_when_delta_exceeds():
    c = _Clock()
    r = TorchCellImbalanceRule(threshold_v=0.10)
    r.update(_sig("TORCH_M1_V1",
                  M1_Cell1_Voltage=3.7, M1_Cell2_Voltage=3.7, M1_Cell3_Voltage=3.7, M1_Cell4_Voltage=3.7), c.tick())
    a = r.update(_sig("TORCH_M1_V1",
                      M1_Cell1_Voltage=3.85, M1_Cell2_Voltage=3.7, M1_Cell3_Voltage=3.7, M1_Cell4_Voltage=3.7), c.tick())
    assert a is not None
    assert a.severity == Severity.CAUTION


def test_torch_cell_imbalance_tracks_per_module():
    c = _Clock()
    r = TorchCellImbalanceRule(threshold_v=0.10)
    r.update(_sig("TORCH_M1_V1",
                  M1_Cell1_Voltage=3.7, M1_Cell2_Voltage=3.7, M1_Cell3_Voltage=3.7, M1_Cell4_Voltage=3.7), c.tick())
    r.update(_sig("TORCH_M1_V1",
                  M1_Cell1_Voltage=3.85, M1_Cell2_Voltage=3.7, M1_Cell3_Voltage=3.7, M1_Cell4_Voltage=3.7), c.tick())
    a = r.update(_sig("TORCH_M2_V1",
                      M2_Cell1_Voltage=3.95, M2_Cell2_Voltage=3.7, M2_Cell3_Voltage=3.7, M2_Cell4_Voltage=3.7), c.tick())
    assert a is not None


def test_vcu_state_change_fires_once_per_transition():
    # VCU_State_Info arrives at bus rate; a MEMO must not re-fire on every
    # frame that merely repeats the state we already reported.
    c = _Clock()
    r = VcuStateChangeRule()
    r.update(_sig("VCU_State_Info", State="STANDBY"), c.tick())
    first = r.update(_sig("VCU_State_Info", State="DRIVE"), c.tick())
    assert first is not None
    repeats = [r.update(_sig("VCU_State_Info", State="DRIVE"), c.tick()) for _ in range(5)]
    assert repeats == [None] * 5


def test_inv_vsm_state_fires_once_per_transition():
    c = _Clock()
    r = InvVsmStateRule()
    r.update(_sig("M170_Internal_States", INV_VSM_State="idle"), c.tick())
    first = r.update(_sig("M170_Internal_States", INV_VSM_State="blink fault code state"), c.tick())
    assert first is not None
    repeats = [r.update(_sig("M170_Internal_States", INV_VSM_State="blink fault code state"), c.tick())
               for _ in range(5)]
    assert repeats == [None] * 5


# Safety loop / shutdown circuit rules (0x420 PackStatus)

RELAY_RULES = [
    (ImdFaultRule, "IMDRelay", "IMD_FAULT", "IMD FAULT"),
    (AmsFaultRule, "AMSRelay", "AMS_FAULT", "AMS FAULT"),
    (BspdFaultRule, "BSPDRelay", "BSPD_FAULT", "BSPD FAULT"),
    (SafetyLoopOpenRule, "air_negative", "SAFETY_LOOP_OPEN", "SAFETY LOOP OPEN"),
    (HvLossRule, "air_positive", "HV_LOSS", "HV LOSS"),
]


@pytest.mark.parametrize("cls,signal,rule_id,title", RELAY_RULES)
@pytest.mark.parametrize("legacy", [True, False])
def test_relay_rule_fires_on_open_edge(cls, signal, rule_id, title, legacy):
    c = _Clock()
    r = cls()
    assert r.update(_pack(legacy=legacy), c.tick()) is None
    a = r.update(_pack(legacy=legacy, **{signal: 0}), c.tick())
    assert a is not None
    assert a.rule == rule_id
    assert a.title == title
    assert a.severity == Severity.WARNING


@pytest.mark.parametrize("cls,signal,rule_id,title", RELAY_RULES)
@pytest.mark.parametrize("legacy", [True, False])
def test_relay_rule_does_not_refire_on_repeats(cls, signal, rule_id, title, legacy):
    c = _Clock()
    r = cls()
    r.update(_pack(legacy=legacy), c.tick())
    assert r.update(_pack(legacy=legacy, **{signal: 0}), c.tick()) is not None
    repeats = [r.update(_pack(legacy=legacy, **{signal: 0}), c.tick()) for _ in range(5)]
    assert repeats == [None] * 5


@pytest.mark.parametrize("cls,signal,rule_id,title", RELAY_RULES)
def test_relay_rule_rearms_after_relay_closes(cls, signal, rule_id, title):
    c = _Clock()
    r = cls()
    r.update(_pack(), c.tick())
    r.update(_pack(**{signal: 0}), c.tick())
    r.update(_pack(), c.tick())  # relay closes again
    assert r.update(_pack(**{signal: 0}), c.tick()) is not None


@pytest.mark.parametrize("cls,signal,rule_id,title", RELAY_RULES)
def test_relay_rule_accepts_string_labels(cls, signal, rule_id, title):
    """A DBC revision could add a VAL_ table and hand back str labels."""
    c = _Clock()
    r = cls()
    r.update(_pack(**{signal: "Closed"}), c.tick())
    a = r.update(_pack(**{signal: "Open"}), c.tick())
    assert a is not None
    assert a.rule == rule_id


@pytest.mark.parametrize("cls,signal,rule_id,title", RELAY_RULES)
def test_relay_rule_ignores_other_messages(cls, signal, rule_id, title):
    c = _Clock()
    assert cls().update(_sig("VCU_State_Info", State="DRIVE"), c.tick()) is None


def test_relay_rule_does_not_fire_on_first_frame_already_open():
    """No prior state means no observed edge, so stay quiet."""
    c = _Clock()
    assert ImdFaultRule().update(_pack(IMDRelay=0), c.tick()) is None


@pytest.mark.parametrize("legacy", [True, False])
def test_air_fault_fires_when_airs_disagree(legacy):
    c = _Clock()
    r = AirFaultRule()
    assert r.update(_pack(legacy=legacy), c.tick()) is None
    a = r.update(_pack(legacy=legacy, air_positive=0), c.tick())
    assert a is not None
    assert a.rule == "AIR_FAULT"
    assert a.severity == Severity.WARNING
    assert "AIR" in a.detail


@pytest.mark.parametrize("legacy", [True, False])
def test_air_fault_does_not_refire_on_repeats(legacy):
    c = _Clock()
    r = AirFaultRule()
    r.update(_pack(legacy=legacy), c.tick())
    assert r.update(_pack(legacy=legacy, air_negative=0), c.tick()) is not None
    repeats = [r.update(_pack(legacy=legacy, air_negative=0), c.tick()) for _ in range(5)]
    assert repeats == [None] * 5


def test_air_fault_fires_on_pack_status_fault_label():
    c = _Clock()
    r = AirFaultRule()
    r.update(_pack(), c.tick())
    a = r.update(_pack(PackStatus="Fault", Fault=71), c.tick())
    assert a is not None
    assert "Cell >4.2 V" in a.detail


def test_air_fault_fires_on_pack_status_fault_raw_enum():
    c = _Clock()
    r = AirFaultRule()
    r.update(_pack(PackStatus=3, Fault=0), c.tick())
    a = r.update(_pack(PackStatus=6, Fault=84), c.tick())
    assert a is not None
    assert "CAN Timeout >2s" in a.detail


def test_air_fault_quiet_when_both_airs_open_together():
    """Both AIRs open is a normal shutdown, not a contactor fault."""
    c = _Clock()
    r = AirFaultRule()
    r.update(_pack(), c.tick())
    assert r.update(_pack(air_negative=0, air_positive=0), c.tick()) is None


def test_air_fault_clears_and_rearms():
    c = _Clock()
    r = AirFaultRule()
    r.update(_pack(), c.tick())
    assert r.update(_pack(air_positive=0), c.tick()) is not None
    assert r.update(_pack(), c.tick()) is None
    assert r.update(_pack(air_positive=0), c.tick()) is not None


# Precharge (0x7D3 VCU_Precharge)

def _precharge(enable, ok):
    return _sig("VCU_Precharge", Precharge_Enable=enable, Precharge_OK=ok)


def test_precharge_error_fires_when_enabled_but_not_ok():
    c = _Clock()
    r = PrechargeErrorRule(timeout_seconds=0.0)
    a = r.update(_precharge("ON", "OFF"), c.tick())
    assert a is not None
    assert a.rule == "PRECHARGE_ERROR"
    assert a.severity == Severity.WARNING
    assert a.title == "PRECHARGE ERROR"


def test_precharge_error_accepts_raw_bits():
    c = _Clock()
    r = PrechargeErrorRule(timeout_seconds=0.0)
    assert r.update(_precharge(1, 0), c.tick()) is not None


def test_precharge_error_does_not_refire_on_repeats():
    c = _Clock()
    r = PrechargeErrorRule(timeout_seconds=0.0)
    assert r.update(_precharge("ON", "OFF"), c.tick()) is not None
    repeats = [r.update(_precharge("ON", "OFF"), c.tick()) for _ in range(5)]
    assert repeats == [None] * 5


def test_precharge_error_silent_while_within_timeout():
    c = _Clock()
    r = PrechargeErrorRule(timeout_seconds=60.0)
    assert r.update(_precharge("ON", "OFF"), c.tick()) is None
    assert r.update(_precharge("ON", "OFF"), c.tick()) is None


def test_precharge_error_silent_when_ok():
    c = _Clock()
    r = PrechargeErrorRule(timeout_seconds=0.0)
    assert r.update(_precharge("ON", "ON"), c.tick()) is None
    assert r.update(_precharge("OFF", "OFF"), c.tick()) is None


def test_precharge_error_rearms_after_successful_precharge():
    c = _Clock()
    r = PrechargeErrorRule(timeout_seconds=0.0)
    assert r.update(_precharge("ON", "OFF"), c.tick()) is not None
    r.update(_precharge("ON", "ON"), c.tick())  # precharge completes
    assert r.update(_precharge("ON", "OFF"), c.tick()) is not None


def test_precharge_error_ignores_other_messages():
    c = _Clock()
    assert PrechargeErrorRule(timeout_seconds=0.0).update(_pack(), c.tick()) is None


def test_alert_timestamp_comes_from_the_frame_not_the_wall_clock():
    # Replaying an old session must stamp alerts with when they happened, not
    # with when the replay ran.
    r = VcuStateFaultRule()
    r.update(_sig("VCU_State_Info", State="DRIVE"), 1_000_000)
    a = r.update(_sig("VCU_State_Info", State="DEVICE_FAULT"), 1_000_500)
    assert a is not None
    assert a.ts == 1_000_500


def test_rearm_window_measured_in_frame_time():
    # A 10s re-arm must mean 10s of car time, not 10s of replay wall time.
    r = TorchCellTempRule(threshold_c=55.0, rearm_seconds=10.0)
    base = 5_000_000
    r.update(_sig("TORCH_M1_T1", M1_Thermistor1=20.0), base)
    first = r.update(_sig("TORCH_M1_T1", M1_Thermistor1=60.0), base + 100)
    assert first is not None
    # Drop below, come back up 2s later: still inside the re-arm window.
    r.update(_sig("TORCH_M1_T1", M1_Thermistor1=20.0), base + 1_000)
    too_soon = r.update(_sig("TORCH_M1_T1", M1_Thermistor1=60.0), base + 2_000)
    assert too_soon is None
    # 11s after the first fire, it may fire again.
    r.update(_sig("TORCH_M1_T1", M1_Thermistor1=20.0), base + 10_000)
    rearmed = r.update(_sig("TORCH_M1_T1", M1_Thermistor1=60.0), base + 11_100)
    assert rearmed is not None
