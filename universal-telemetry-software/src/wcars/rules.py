"""Edge-triggered WCARS rules.

Each rule owns its previous-state memory and emits an Alert only on a
transition into a fault condition. All timing is derived from the CAN frame
timestamp passed into update(), never from the wall clock, so replaying a
recorded session produces the same alerts it produced live.
"""
from __future__ import annotations

import re
import uuid
from typing import Any

from .serialization import Alert, Severity


def _new_id() -> str:
    return uuid.uuid4().hex[:6]


class BaseRule:
    def __init__(self, rule_id: str, rearm_seconds: float = 10.0) -> None:
        self.rule_id = rule_id
        self.rearm_seconds = rearm_seconds
        self._last_fired_ms: dict[str, int] = {}

    def _is_rearmed(self, key: str, ts_ms: int) -> bool:
        last = self._last_fired_ms.get(key)
        if last is None:
            return True
        return (ts_ms - last) >= self.rearm_seconds * 1000

    def _mark_fired(self, key: str, ts_ms: int) -> None:
        self._last_fired_ms[key] = ts_ms

    def _alert(self, severity: Severity, title: str, detail: str,
               value: float | None, ts_ms: int) -> Alert:
        return Alert(
            id=_new_id(),
            rule=self.rule_id,
            severity=severity,
            title=title,
            detail=detail,
            value=value,
            ts=ts_ms,
            replay=False,
        )

    def update(self, decoded: dict, ts_ms: int) -> Alert | None:
        raise NotImplementedError


class VcuStateFaultRule(BaseRule):
    """Fires WARNING on transition into PRECHARGE_ERROR or DEVICE_FAULT.

    Edge-triggered: only fires when state changes from a non-fault state into
    a fault state, or from one fault state into a different fault state.
    Subsequent frames in the same fault state do not re-fire.
    """
    FAULT_STATES = {"PRECHARGE_ERROR", "DEVICE_FAULT"}
    _FAULT_TITLES = {"PRECHARGE_ERROR": "PRECHARGE ERROR", "DEVICE_FAULT": "DEVICE FAULT"}

    def __init__(self, rearm_seconds: float = 0.0) -> None:
        super().__init__("VCU_STATE_FAULT", rearm_seconds=rearm_seconds)
        self._prev: str | None = None

    def update(self, decoded: dict, ts_ms: int) -> Alert | None:
        if decoded["message"] != "VCU_State_Info":
            return None
        state = decoded["signals"].get("State")
        if not isinstance(state, str):
            return None
        prev = self._prev
        self._prev = state
        if prev is not None and state in self.FAULT_STATES and state != prev:
            self._mark_fired("vcu", ts_ms)
            title = self._FAULT_TITLES.get(state, state.replace("_", " "))
            return self._alert(Severity.WARNING, f"VCU {title}", f"from {prev}", None, ts_ms)
        return None


class VcuStateChangeRule(BaseRule):
    """Any non-fault VCU state transition (MEMO)."""
    def __init__(self, rearm_seconds: float = 0.0) -> None:
        super().__init__("VCU_STATE_CHANGE", rearm_seconds=rearm_seconds)
        self._prev: str | None = None

    def update(self, decoded: dict, ts_ms: int) -> Alert | None:
        if decoded["message"] != "VCU_State_Info":
            return None
        state = decoded["signals"].get("State")
        if not isinstance(state, str):
            return None
        prev = self._prev
        self._prev = state
        if prev is not None and state != prev and state not in VcuStateFaultRule.FAULT_STATES:
            return self._alert(Severity.MEMO, f"VCU {state}", f"from {prev}", None, ts_ms)
        return None


class TorchFaultRule(BaseRule):
    def __init__(self, rearm_seconds: float = 0.0) -> None:
        super().__init__("TORCH_FAULT", rearm_seconds=rearm_seconds)
        self._prev_state: dict[tuple[str, Any], bool] = {}

    def update(self, decoded: dict, ts_ms: int) -> Alert | None:
        if decoded["message"] != "TORCH_FAULT":
            return None
        s = decoded["signals"]
        module = s.get("Module_ID", "?")
        err = s.get("Error_code", 0)
        any_cell = any(s.get(f"Cell_{i}_status") == "Fault" for i in range(12))
        key = (str(module), str(err))
        bad = (err != 0) or any_cell
        was_bad = self._prev_state.get(key, False)
        if bad and not was_bad:
            self._prev_state[key] = True
            return self._alert(Severity.WARNING, f"TORCH {module} FAULT",
                               f"err={err} cell_faults={sum(1 for i in range(12) if s.get(f'Cell_{i}_status') == 'Fault')}",
                               None, ts_ms)
        if not bad:
            self._prev_state[key] = False
        return None


class InvFaultRule(BaseRule):
    """Fires WARNING if any of the 4 M171 fault words is non-zero."""
    def __init__(self, rearm_seconds: float = 0.0) -> None:
        super().__init__("INV_FAULT", rearm_seconds=rearm_seconds)
        self._prev_nonzero: bool = False

    def update(self, decoded: dict, ts_ms: int) -> Alert | None:
        if decoded["message"] != "M171_Fault_Codes":
            return None
        s = decoded["signals"]
        nonzero = any(isinstance(v, (int, float)) and v != 0 for v in s.values())
        if nonzero and not self._prev_nonzero:
            self._prev_nonzero = True
            return self._alert(Severity.WARNING, "INVERTER FAULT", f"hi={s.get('INV_Run_Fault_Hi', 0)} post={s.get('INV_Post_Fault_Hi', 0)}", None, ts_ms)
        if not nonzero:
            self._prev_nonzero = False
        return None


class InvVsmStateRule(BaseRule):
    INTERESTING = {"blink fault code state", "Shutdown state for Key Switch Mode 1", "Reset the inverter"}

    def __init__(self, rearm_seconds: float = 0.0) -> None:
        super().__init__("INV_VSM_STATE", rearm_seconds=rearm_seconds)
        self._prev: str | None = None

    def update(self, decoded: dict, ts_ms: int) -> Alert | None:
        if decoded["message"] != "M170_Internal_States":
            return None
        vsm = decoded["signals"].get("INV_VSM_State")
        if not isinstance(vsm, str):
            return None
        prev = self._prev
        self._prev = vsm
        if prev is not None and vsm != prev and vsm in self.INTERESTING:
            return self._alert(Severity.CAUTION, f"INV VSM {vsm}", f"from {prev}", None, ts_ms)
        return None


# Match "M3_Thermistor2" -> ("3", "2"); "M12_Thermistor7" -> ("12", "7")
_THERMISTOR_RE = re.compile(r"^M(\d+)_Thermistor(\d+)$")
# Match "M3_Cell2_Voltage" -> ("3", "2")
_CELLV_RE = re.compile(r"^M(\d+)_Cell(\d+)_Voltage$")


class TorchCellTempRule(BaseRule):
    """Fires WARNING if any thermistor reading exceeds the threshold."""
    def __init__(self, threshold_c: float = 55.0, rearm_seconds: float = 10.0) -> None:
        super().__init__("TORCH_CELL_TEMP", rearm_seconds=rearm_seconds)
        self.threshold = threshold_c
        self._prev: dict[tuple[str, int], float] = {}

    def update(self, decoded: dict, ts_ms: int) -> Alert | None:
        if not decoded["message"].startswith("TORCH_"):
            return None
        s = decoded["signals"]
        for sig_name, val in s.items():
            m = _THERMISTOR_RE.match(sig_name)
            if not m or not isinstance(val, (int, float)):
                continue
            module = m.group(1)
            therm = int(m.group(2))
            key = (decoded["message"], therm)
            prev = self._prev.get(key, 0.0)
            if val > self.threshold and prev <= self.threshold and self._is_rearmed(f"{decoded['message']}.{therm}", ts_ms):
                self._prev[key] = val
                self._mark_fired(f"{decoded['message']}.{therm}", ts_ms)
                return self._alert(Severity.WARNING,
                                   f"TORCH {module} CELL TEMP",
                                   f"Thermistor {therm} at {val:.1f}C (limit {self.threshold:.0f})",
                                   float(val), ts_ms)
            self._prev[key] = val
        return None


"""Safety loop / shutdown circuit rules on 0x420 PackStatus and 0x7D3 VCU_Precharge.

Two DBC generations name the same two bits on 0x420 differently:
  bit 20 is 'Safetyloop_return' in secret-dbc/WFR25.dbc and example.dbc (what the
          backend loads), but 'AIR_Negative_Relay' in the DBCs pecan ships;
  bit 21 is 'HV_Active' in the former and 'AIR_Positive_Relay' in the latter.
Same bit, same meaning, different label. Every rule below reads whichever key is
present so it fires no matter which DBC generation is loaded on the base station.
"""

AIR_NEGATIVE_SIGNALS = ("Safetyloop_return", "AIR_Negative_Relay")
AIR_POSITIVE_SIGNALS = ("HV_Active", "AIR_Positive_Relay")

_RELAY_CLOSED_LABELS = {"1", "on", "closed", "true", "ok", "active", "healthy"}
_RELAY_OPEN_LABELS = {"0", "off", "open", "false", "fault", "tripped", "inactive"}

# 0x420 Fault enum. Carries the specific cause; folded into AIR_FAULT detail text.
PACK_FAULT_LABELS = {
    0: "None", 69: "Thermistor >60C", 70: "Cell <2.5 V", 71: "Cell >4.2 V",
    72: "Cell Delta >0.2V", 73: "Open Cell", 74: "Open Thermistor",
    75: "LTC DIAGN fail", 76: "LTC AXST fail", 77: "LTC CVST fail",
    78: "LTC STATST fail", 79: "LTC ADOW fail", 80: "LTC AXOW fail",
    81: "LTC ADOL fail", 82: "LTC CRC fail", 83: "Current >100A",
    84: "CAN Timeout >2s", 85: ">96 CAN Errors",
}


def _first_signal(signals: dict, names: tuple[str, ...]) -> Any:
    for name in names:
        val = signals.get(name)
        if val is not None:
            return val
    return None


def _relay_closed(value: Any) -> bool | None:
    """True = relay closed/healthy, False = open/tripped, None = unreadable.

    cantools hands back plain ints for these unmapped bits, but a DBC revision
    could add a VAL_ table at any time and turn them into str labels, so accept both.
    """
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    if isinstance(value, str):
        token = value.strip().lower()
        if token in _RELAY_CLOSED_LABELS:
            return True
        if token in _RELAY_OPEN_LABELS:
            return False
    return None


def _is_enum(value: Any, number: int, label: str) -> bool:
    """Match a VAL_-mapped signal by raw number or by decoded label."""
    if isinstance(value, bool):
        return False
    if isinstance(value, (int, float)):
        return int(value) == number
    if isinstance(value, str):
        return value.strip().lower() == label.lower()
    return False


def _pack_fault_label(value: Any) -> str | None:
    """Human label for the 0x420 Fault byte, or None when there is no fault."""
    if isinstance(value, str):
        return None if value.strip().lower() == "none" else value
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        code = int(value)
        if code == 0:
            return None
        return PACK_FAULT_LABELS.get(code, f"code {code}")
    return None


class _RelayOpenRule(BaseRule):
    """Shared body for 'a shutdown-circuit relay went 1 -> 0' rules.

    Relay signals read 1 = closed/healthy, so a fault is the 1 -> 0 edge.
    """
    SIGNALS: tuple[str, ...] = ()
    TITLE = ""
    DETAIL = ""

    def __init__(self, rule_id: str, rearm_seconds: float = 0.0) -> None:
        super().__init__(rule_id, rearm_seconds=rearm_seconds)
        self._prev: bool | None = None

    def update(self, decoded: dict, ts_ms: int) -> Alert | None:
        if decoded["message"] != "PackStatus":
            return None
        closed = _relay_closed(_first_signal(decoded["signals"], self.SIGNALS))
        if closed is None:
            return None
        prev = self._prev
        self._prev = closed
        if prev is True and closed is False:
            self._mark_fired(self.rule_id, ts_ms)
            return self._alert(Severity.WARNING, self.TITLE, self.DETAIL, None, ts_ms)
        return None


class ImdFaultRule(_RelayOpenRule):
    SIGNALS = ("IMDRelay",)
    TITLE = "IMD FAULT"
    DETAIL = "insulation monitoring device tripped"

    def __init__(self, rearm_seconds: float = 0.0) -> None:
        super().__init__("IMD_FAULT", rearm_seconds=rearm_seconds)


class AmsFaultRule(_RelayOpenRule):
    SIGNALS = ("AMSRelay",)
    TITLE = "AMS FAULT"
    DETAIL = "accumulator management system tripped"

    def __init__(self, rearm_seconds: float = 0.0) -> None:
        super().__init__("AMS_FAULT", rearm_seconds=rearm_seconds)


class BspdFaultRule(_RelayOpenRule):
    SIGNALS = ("BSPDRelay",)
    TITLE = "BSPD FAULT"
    DETAIL = "brake system plausibility device tripped"

    def __init__(self, rearm_seconds: float = 0.0) -> None:
        super().__init__("BSPD_FAULT", rearm_seconds=rearm_seconds)


class SafetyLoopOpenRule(_RelayOpenRule):
    SIGNALS = AIR_NEGATIVE_SIGNALS
    TITLE = "SAFETY LOOP OPEN"
    DETAIL = "shutdown circuit return lost"

    def __init__(self, rearm_seconds: float = 0.0) -> None:
        super().__init__("SAFETY_LOOP_OPEN", rearm_seconds=rearm_seconds)


class HvLossRule(_RelayOpenRule):
    SIGNALS = AIR_POSITIVE_SIGNALS
    TITLE = "HV LOSS"
    DETAIL = "high voltage no longer active"

    def __init__(self, rearm_seconds: float = 0.0) -> None:
        super().__init__("HV_LOSS", rearm_seconds=rearm_seconds)


class AirFaultRule(BaseRule):
    """WARNING when the two AIRs disagree, or PackStatus reports Fault.

    Two triggers, because both mean "the pack contactors are not in a state the
    driver can trust": the AIRs are commanded as a pair, so positive != negative
    means one is welded shut or failed open; and PackStatus == Fault is the BMS
    itself declaring the pack unsafe. The specific cause from the Fault byte is
    folded into the detail text rather than given its own rule ID, because the
    frontend RULE_PAGE map routes on rule ID and a new ID would not route anywhere.

    Note this can co-fire with HV_LOSS / SAFETY_LOOP_OPEN on a real AIR opening:
    during the frame where one AIR has dropped and the other has not, the relays
    genuinely disagree. That is intended - ECAM shows both the cause and the
    consequence - and all three route to the same LOOP page.
    """

    def __init__(self, rearm_seconds: float = 0.0) -> None:
        super().__init__("AIR_FAULT", rearm_seconds=rearm_seconds)
        self._prev_bad: bool = False

    def update(self, decoded: dict, ts_ms: int) -> Alert | None:
        if decoded["message"] != "PackStatus":
            return None
        s = decoded["signals"]
        neg = _relay_closed(_first_signal(s, AIR_NEGATIVE_SIGNALS))
        pos = _relay_closed(_first_signal(s, AIR_POSITIVE_SIGNALS))
        pack_fault = _is_enum(s.get("PackStatus"), 6, "Fault")
        disagree = neg is not None and pos is not None and neg != pos
        bad = disagree or pack_fault
        was_bad = self._prev_bad
        self._prev_bad = bad
        if bad and not was_bad:
            self._mark_fired("air", ts_ms)
            reasons = []
            if disagree:
                reasons.append(f"AIR+ {'closed' if pos else 'open'} / AIR- {'closed' if neg else 'open'}")
            if pack_fault:
                label = _pack_fault_label(s.get("Fault"))
                reasons.append(f"pack fault: {label}" if label else "pack status FAULT")
            return self._alert(Severity.WARNING, "AIR FAULT", "; ".join(reasons), None, ts_ms)
        return None


class PrechargeErrorRule(BaseRule):
    """WARNING when 0x7D3 Precharge_Enable is ON but Precharge_OK stays OFF.

    Precharge legitimately takes time, so Enable ON with OK OFF is normal for the
    first moments of every startup. We only fire once the pair has held that way
    for `timeout_seconds`, then latch until the condition clears (OK comes ON or
    Enable goes OFF) so a stuck precharge does not re-fire at bus rate.

    Overlaps with VcuStateFaultRule, which emits VCU_STATE_FAULT when the VCU
    state enum on 0x7D2 reaches PRECHARGE_ERROR. Different signal path, different
    rule ID, both legitimately fire for one physical event; they are not
    de-duplicated across messages because neither can observe the other's frame.
    """

    def __init__(self, timeout_seconds: float = 2.0, rearm_seconds: float = 0.0) -> None:
        super().__init__("PRECHARGE_ERROR", rearm_seconds=rearm_seconds)
        self.timeout_seconds = timeout_seconds
        self._pending_since_ms: int | None = None
        self._latched: bool = False

    def update(self, decoded: dict, ts_ms: int) -> Alert | None:
        if decoded["message"] != "VCU_Precharge":
            return None
        s = decoded["signals"]
        enable = _relay_closed(s.get("Precharge_Enable"))
        ok = _relay_closed(s.get("Precharge_OK"))
        if enable is None or ok is None:
            return None
        bad = enable and not ok
        if not bad:
            self._pending_since_ms = None
            self._latched = False
            return None
        now = ts_ms
        if self._pending_since_ms is None:
            self._pending_since_ms = now
        elapsed = (now - self._pending_since_ms) / 1000.0
        latched = self._latched
        if elapsed >= self.timeout_seconds:
            self._latched = True
        if latched or elapsed < self.timeout_seconds:
            return None
        self._mark_fired("precharge", ts_ms)
        return self._alert(Severity.WARNING, "PRECHARGE ERROR",
                           f"precharge enabled but not OK after {elapsed:.1f}s", None, ts_ms)


class TorchCellImbalanceRule(BaseRule):
    """Fires CAUTION if max-min cell voltage in a module exceeds threshold."""
    def __init__(self, threshold_v: float = 0.10, rearm_seconds: float = 10.0) -> None:
        super().__init__("TORCH_CELL_IMBALANCE", rearm_seconds=rearm_seconds)
        self.threshold = threshold_v
        self._prev_bad: dict[str, bool] = {}

    def update(self, decoded: dict, ts_ms: int) -> Alert | None:
        if not decoded["message"].startswith("TORCH_"):
            return None
        s = decoded["signals"]
        # Only look at cell voltages in this message
        vals: list[tuple[str, float]] = []
        module = "?"
        for sig_name, val in s.items():
            m = _CELLV_RE.match(sig_name)
            if m and isinstance(val, (int, float)):
                module = m.group(1)
                vals.append((m.group(2), float(val)))
        if len(vals) < 2:
            return None
        voltages = [v for _, v in vals]
        delta = max(voltages) - min(voltages)
        was_bad = self._prev_bad.get(decoded["message"], False)
        if delta > self.threshold and not was_bad and self._is_rearmed(decoded["message"], ts_ms):
            self._prev_bad[decoded["message"]] = True
            self._mark_fired(decoded["message"], ts_ms)
            return self._alert(Severity.CAUTION,
                               f"TORCH {module} CELL IMBALANCE",
                               f"delta {delta:.3f}V (limit {self.threshold:.2f})",
                               float(delta), ts_ms)
        if delta <= self.threshold:
            self._prev_bad[decoded["message"]] = False
        return None
