from datetime import datetime, timedelta, timezone

import pytest

from backend import state_queries as stq


T0 = datetime(2026, 6, 20, 15, 0, tzinfo=timezone.utc)


def test_validate_states_request_accepts_normal_window():
    stq.validate_states_request(T0, T0 + timedelta(hours=2))


@pytest.mark.parametrize(
    "start,end,match",
    [
        (T0, T0, "start must be before end"),
        (T0, T0 - timedelta(hours=1), "start must be before end"),
        (T0, T0 + timedelta(days=8), "seven days"),
    ],
)
def test_validate_states_request_rejects_bad_windows(start, end, match):
    with pytest.raises(ValueError, match=match):
        stq.validate_states_request(start, end)


def test_transitions_sql_quotes_signal_and_uses_lag_and_gap():
    sql = stq.build_transitions_sql("wfr26", "INV_VSM_State")
    assert '"INV_VSM_State"' in sql
    assert "LAG" in sql
    assert "interval '5 seconds'" in sql
    assert "prev_value IS DISTINCT FROM value" in sql
    assert "%(start)s" in sql and "%(end)s" in sql


def test_transitions_sql_rejects_invalid_identifiers():
    with pytest.raises(ValueError):
        stq.build_transitions_sql("wfr26", "bad-name; DROP")
    with pytest.raises(ValueError):
        stq.build_transitions_sql("Wfr26; --", "State")


def test_lookback_sql_bounds_lookback_and_orders_desc():
    sql = stq.build_lookback_sql("wfr26", "State")
    assert "time < %(start)s" in sql
    assert "time >= %(lookback)s" in sql
    assert "ORDER BY time DESC LIMIT 1" in sql


def test_assemble_segments_splits_on_value_change():
    rows = [(1000, 0, None), (5000, 4, 4900)]
    segments = stq.assemble_segments(rows, None, 0, 9000)
    assert segments == [
        {"start_ms": 1000, "end_ms": 5000, "value": 0},
        {"start_ms": 5000, "end_ms": 9000, "value": 4},
    ]


def test_assemble_segments_splits_on_gap_and_closes_at_prev_time():
    rows = [(0, 4, None), (20000, 4, 8000)]
    segments = stq.assemble_segments(rows, None, 0, 25000)
    assert segments == [
        {"start_ms": 0, "end_ms": 8000, "value": 4},
        {"start_ms": 20000, "end_ms": 25000, "value": 4},
    ]


def test_assemble_segments_seeds_state_from_before_window():
    rows = [(2000, 4, None)]
    segments = stq.assemble_segments(rows, 1, 0, 9000)
    assert segments == [
        {"start_ms": 0, "end_ms": 2000, "value": 1},
        {"start_ms": 2000, "end_ms": 9000, "value": 4},
    ]


def test_assemble_segments_merges_seed_equal_to_first_value():
    rows = [(2000, 4, None)]
    segments = stq.assemble_segments(rows, 4, 0, 9000)
    assert segments == [{"start_ms": 0, "end_ms": 9000, "value": 4}]


def test_assemble_segments_skips_seed_when_first_sample_is_late():
    rows = [(7000, 4, None)]
    segments = stq.assemble_segments(rows, 1, 0, 9000)
    assert segments == [{"start_ms": 7000, "end_ms": 9000, "value": 4}]


def test_assemble_segments_empty_inputs():
    assert stq.assemble_segments([], 4, 0, 9000) == []
    assert stq.assemble_segments([(0, 4, None)], None, 0, None) == []


def test_label_segments_uses_choices_with_numeric_fallback():
    segments = [
        {"start_ms": 0, "end_ms": 1, "value": 4},
        {"start_ms": 1, "end_ms": 2, "value": 9},
    ]
    labeled = stq.label_segments(segments, {4: "DRIVE"})
    assert labeled[0]["label"] == "DRIVE"
    assert labeled[1]["label"] == "state 9"
    unlabeled = stq.label_segments([{"start_ms": 0, "end_ms": 1, "value": 6}], None)
    assert unlabeled[0]["label"] == "state 6"


def test_decode_fault_segments_extracts_named_bits():
    segments = [{"start_ms": 0, "end_ms": 100, "value": 0b1000000000101}]
    faults = stq.decode_fault_segments(segments, stq.RUN_FAULT_NAMES, 0)
    assert faults == {
        "Motor Over-speed Fault": [(0, 100)],
        "Over-voltage Fault": [(0, 100)],
        "Motor Over-temperature Fault": [(0, 100)],
    }


def test_decode_fault_segments_uses_bit_offset_for_hi_word():
    segments = [{"start_ms": 0, "end_ms": 100, "value": 0b1}]
    faults = stq.decode_fault_segments(segments, stq.RUN_FAULT_NAMES, 16)
    assert faults == {"Brake Input Shorted Fault": [(0, 100)]}


def test_decode_fault_segments_skips_reserved_bits():
    # RUN bit 13 is reserved (None).
    segments = [{"start_ms": 0, "end_ms": 100, "value": 1 << 13}]
    assert stq.decode_fault_segments(segments, stq.RUN_FAULT_NAMES, 0) == {}


def test_merge_intervals_merges_overlaps_and_keeps_disjoint():
    merged = stq.merge_intervals([(0, 10), (5, 20), (30, 40)])
    assert merged == [
        {"start_ms": 0, "end_ms": 20},
        {"start_ms": 30, "end_ms": 40},
    ]


def test_fault_name_tables_shape():
    assert len(stq.POST_FAULT_NAMES) == 32
    assert len(stq.RUN_FAULT_NAMES) == 32
    assert stq.RUN_FAULT_NAMES[11] == "CAN Command Message Lost Fault"
    assert stq.POST_FAULT_NAMES[22] == "Precharge Timeout"
