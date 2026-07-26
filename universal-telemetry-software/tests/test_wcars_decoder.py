# universal-telemetry-software/tests/test_wcars_decoder.py
from src.wcars.decoder import Decoder, WHITELIST_IDS
from tests.wcars_dbc_utils import vcu_state_info, torch_fault, torch_cell_temp


def test_whitelist_contains_expected_messages():
    assert 0x7D2 in WHITELIST_IDS  # VCU_State_Info
    assert 0x3E8 in WHITELIST_IDS  # TORCH_FAULT
    assert 0xAA in WHITELIST_IDS   # M170_Internal_States


def test_whitelist_contains_pack_status():
    """0x420 is decimal 1056, one past the end of the TORCH cell-temp range(1031, 1056).

    It was silently excluded, so the safety loop was invisible to the engine.
    """
    assert 1056 in WHITELIST_IDS
    assert 0x420 in WHITELIST_IDS
    assert Decoder().is_whitelisted(0x420)


def test_whitelist_contains_safety_and_inverter_messages():
    for can_id in (2003, 514, 2013, 2000, 160, 162, 165, 166, 167, 172, 192):
        assert can_id in WHITELIST_IDS, f"missing 0x{can_id:X}"


def test_decode_pack_status_relays():
    """0x420: IMD/AMS/BSPD/Latch relays at bits 16..19, safety loop 20, HV active 21."""
    dec = Decoder()
    relay_byte = 0b00111111  # all six relay bits closed
    sig = dec.decode({"canId": 0x420, "data": [0, 0, relay_byte, 0, 0, 0, 0, 0]})
    assert sig is not None
    assert sig["message"] == "PackStatus"
    s = sig["signals"]
    assert s["IMDRelay"] == 1
    assert s["AMSRelay"] == 1
    assert s["BSPDRelay"] == 1
    # Dual naming across DBC generations; exactly one of each pair is present
    assert s.get("Safetyloop_return", s.get("AIR_Negative_Relay")) == 1
    assert s.get("HV_Active", s.get("AIR_Positive_Relay")) == 1


def test_decode_vcu_precharge():
    dec = Decoder()
    sig = dec.decode({"canId": 0x7D3, "data": [0b01, 0, 0, 0, 0, 0, 0, 0]})
    assert sig is not None
    assert sig["message"] == "VCU_Precharge"
    assert sig["signals"]["Precharge_Enable"] == "ON"
    assert sig["signals"]["Precharge_OK"] == "OFF"


def test_decode_vcu_state_info():
    dec = Decoder()
    sig = dec.decode(vcu_state_info(4))  # DRIVE
    assert sig is not None
    assert sig["message"] == "VCU_State_Info"
    # The DBC has a VAL_ table for State; cantools returns the enum string
    assert sig["signals"]["State"] == "DRIVE"


def test_decode_torch_fault():
    dec = Decoder()
    sig = dec.decode(torch_fault(module_id=1, error_code=0))
    assert sig is not None
    assert sig["message"] == "TORCH_FAULT"
    # Module_ID has a VAL_ table; Error_code=0 has no entry so it stays int
    assert sig["signals"]["Module_ID"] == "Module 1"
    assert sig["signals"]["Error_code"] == 0


def test_decode_unknown_id_returns_none():
    dec = Decoder()
    assert dec.decode({"canId": 0x999, "data": [0] * 8}) is None


def test_decode_malformed_returns_none():
    dec = Decoder()
    assert dec.decode({"canId": 0x7D2, "data": [1, 2]}) is None  # too short


def test_decode_torch_cell_temp():
    dec = Decoder()
    sig = dec.decode(torch_cell_temp(module=1, cell=1, temp_c_x10=575))
    assert sig is not None
    # Should expose the temp in degrees C as a signal named "T1" (or similar)
    # We don't assert the exact name — just that some numeric signal decodes
    assert any(isinstance(v, (int, float)) for v in sig["signals"].values())


def test_dbc_has_messages_added_since_the_pinned_submodule():
    # These arrived in the DBC repo after the submodule was last pinned. Later
    # WCARS rules read them, so a stale pin must fail loudly rather than make
    # every rule silently return None.
    from src.wcars.decoder import _load_db
    db = _load_db()
    ids = {m.frame_id for m in db.messages}
    for frame_id in (0x422, 0x423, 0x424, 0x425, 0x426, 0x427, 0x428, 0x429):
        assert frame_id in ids, f"0x{frame_id:X} missing - secret-dbc submodule is stale"
