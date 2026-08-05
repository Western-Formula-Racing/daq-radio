"""Helpers to build raw CAN frames for the 6 whitelisted WCARS messages.

These are NOT real production CAN IDs — they are tiny synthetic messages
declared in `secret-dbc/WFR25.dbc` with a known structure. We use them so
WCARS tests can be deterministic and run without the actual car.
"""
from __future__ import annotations

import struct
from typing import Iterable

import pytest


def build_frame(can_id: int, data: Iterable[int]) -> dict:
    return {"canId": can_id, "data": list(data)}


def encodable_user_signal():
    """Pick a non-whitelisted, non-enum, non-muxed signal from the loaded DBC
    and produce a frame plus its decoded value, so the test works no matter
    whether secret-dbc or example.dbc is active."""
    from src.wcars.decoder import load_db, WHITELIST_IDS
    db = load_db()
    for msg in db.messages:
        if msg.is_multiplexed():
            continue
        if msg.frame_id in WHITELIST_IDS or (msg.frame_id & 0x7FFFFFFF) in WHITELIST_IDS:
            continue
        for sig in msg.signals:
            if sig.choices:
                continue
            try:
                payload = msg.encode({s.name: 0 for s in msg.signals}, strict=False)
            except Exception:
                break
            value = msg.decode(bytes(payload))[sig.name]
            if not isinstance(value, (int, float)):
                continue
            return msg, sig, list(payload), float(value)
    pytest.skip("no encodable non-whitelisted signal in this DBC")


def vcu_state_info(state: int) -> dict:
    """State at bits 8..15. byte layout: [rtd(1), state(1), throttle(1), brake(2), pad(3)]"""
    return build_frame(0x7D2, [0x00, state & 0xFF, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])


def torch_fault(module_id: int, error_code: int, cell_bits: int = 0) -> dict:
    """Module_ID bits 0..7, Error_code bits 8..15, cell status bits 24..33"""
    byte2 = (cell_bits >> 8) & 0xFF
    byte3 = cell_bits & 0xFF
    return build_frame(0x3E8, [module_id & 0xFF, error_code & 0xFF, byte2, byte3, 0, 0, 0, 0])


def torch_cell_temp(module: int, cell: int, temp_c_x10: int) -> dict:
    """TORCH_M{module}_T{cell}: ID 1031 + 5*(module-1) + (cell-1), temp at bits 0..15 (scale 0.1)"""
    can_id = 1031 + 5 * (module - 1) + (cell - 1)
    return build_frame(can_id, [temp_c_x10 & 0xFF, (temp_c_x10 >> 8) & 0xFF, 0, 0, 0, 0, 0, 0])


def torch_cell_voltage(module: int, cell: int, volts_x1000: int) -> dict:
    """TORCH_M{module}_V{cell}: ID 1006 + 5*(module-1) + (cell-1), volts at bits 0..15 (scale 0.001)"""
    can_id = 1006 + 5 * (module - 1) + (cell - 1)
    return build_frame(can_id, [volts_x1000 & 0xFF, (volts_x1000 >> 8) & 0xFF, 0, 0, 0, 0, 0, 0])


def inv_internal_states(inv_state: int, vsm_state: int) -> dict:
    """M170 byte 2 = inv_state, byte 0 = vsm_state"""
    return build_frame(0xAA, [vsm_state & 0xFF, 0x00, inv_state & 0xFF, 0x00, 0x00, 0x00, 0x00, 0x00])


def inv_fault_codes(fault_bits: int) -> dict:
    """M171: arbitrary fault word"""
    return build_frame(0xAB, list(fault_bits.to_bytes(8, "little")))
