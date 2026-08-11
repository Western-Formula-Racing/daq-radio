"""FreezeBuffer tests: retention of tracked signals only, window eviction,
downsampling, boundedness, and out-of-order frame times.

All timing here is frame time (ts_ms), never the wall clock, so these tests must
never sleep or read the clock."""
from src.diagnostics.freeze import (
    FREEZE_MAX_HZ, FREEZE_WINDOW_MS, FreezeBuffer, tracked_signals,
)
from src.wcars.engine import WcarsEngine


def test_snapshot_returns_observed_values():
    buf = FreezeBuffer()
    buf.track(["Temp"])
    buf.observe({"Temp": 41.5}, 1000)
    assert buf.snapshot() == {"Temp": [[1000, 41.5]]}


def test_untracked_signals_are_not_retained():
    buf = FreezeBuffer()
    buf.track(["Temp"])
    buf.observe({"Temp": 1.0, "Volts": 400.0}, 1000)
    assert "Volts" not in buf.snapshot()


def test_samples_older_than_the_window_are_evicted():
    buf = FreezeBuffer(window_ms=1000, max_hz=1000.0)
    buf.track(["Temp"])
    for ts in (0, 500, 1000, 1500):
        buf.observe({"Temp": float(ts)}, ts)
    kept = [ts for ts, _ in buf.snapshot()["Temp"]]
    assert kept == [500, 1000, 1500]


def test_downsampling_keeps_the_newest_value_in_each_bucket():
    buf = FreezeBuffer(window_ms=10_000, max_hz=10.0)
    buf.track(["Temp"])
    # Three frames inside one 100 ms bucket: only the last reading survives.
    buf.observe({"Temp": 1.0}, 1000)
    buf.observe({"Temp": 2.0}, 1030)
    buf.observe({"Temp": 3.0}, 1090)
    assert buf.snapshot()["Temp"] == [[1090, 3.0]]


def test_downsampling_retains_one_sample_per_bucket_not_one_total():
    """Regression test for a draft that compared each frame against the sample
    it had just overwritten, so the reference advanced with every frame, the gap
    never reopened, and 100 Hz collapsed to a single retained sample: a freeze
    frame that looks plausible and is useless for diagnosis."""
    buf = FreezeBuffer(window_ms=FREEZE_WINDOW_MS, max_hz=FREEZE_MAX_HZ)
    buf.track(["Temp"])
    for i in range(100):
        buf.observe({"Temp": float(i)}, 1_000_000 + i * 10)
    samples = buf.snapshot()["Temp"]
    # 100 frames of 100 Hz is 1 s of frame time; a 20 Hz cap allows 20 buckets.
    assert 18 <= len(samples) <= 22, f"expected about 20 samples, got {len(samples)}"


def test_buffer_stays_bounded_over_a_long_session():
    buf = FreezeBuffer()
    buf.track(["Temp"])
    for i in range(200_000):
        buf.observe({"Temp": float(i)}, i * 10)
    samples = buf.snapshot()["Temp"]
    # 10 s window at 20 Hz is 200 samples, plus the implementation's slack.
    assert len(samples) <= 210


def test_a_backwards_frame_time_does_not_corrupt_the_ordering():
    buf = FreezeBuffer(window_ms=10_000, max_hz=1000.0)
    buf.track(["Temp"])
    buf.observe({"Temp": 1.0}, 5000)
    buf.observe({"Temp": 2.0}, 4000)
    buf.observe({"Temp": 3.0}, 6000)
    stamps = [ts for ts, _ in buf.snapshot()["Temp"]]
    assert stamps == sorted(stamps)
    assert 4000 not in stamps


def test_string_values_are_retained():
    buf = FreezeBuffer()
    buf.track(["State"])
    buf.observe({"State": "PRECHARGE"}, 1000)
    assert buf.snapshot()["State"] == [[1000, "PRECHARGE"]]


def test_snapshot_of_an_unknown_signal_yields_absence_not_an_error():
    buf = FreezeBuffer()
    buf.track(["Temp"])
    assert buf.snapshot({"Nonexistent"}) == {}
    assert buf.snapshot() == {}


def test_track_replaces_the_retained_set_and_frees_dropped_buffers():
    buf = FreezeBuffer()
    buf.track(["Temp", "Volts"])
    buf.observe({"Temp": 1.0, "Volts": 2.0}, 1000)
    buf.track(["Volts"])
    snap = buf.snapshot()
    assert "Temp" not in snap
    assert snap["Volts"] == [[1000, 2.0]]
    # A signal dropped from the tracked set must not come back on a later frame.
    buf.observe({"Temp": 9.0}, 2000)
    assert "Temp" not in buf.snapshot()


def test_max_hz_zero_disables_downsampling_without_dividing_by_zero():
    buf = FreezeBuffer(window_ms=10_000, max_hz=0.0)
    buf.track(["Temp"])
    buf.observe({"Temp": 1.0}, 1000)
    buf.observe({"Temp": 2.0}, 1001)
    assert len(buf.snapshot()["Temp"]) >= 1


def test_tracked_signals_covers_user_rule_signals_and_whitelisted_messages():
    doc = {
        "id": "r1", "name": "T", "enabled": True, "severity": "WARNING",
        "message": "OVERTEMP",
        "conditions": [{"message": "TORCH_FAULT", "signal": "MadeUpSignal",
                        "op": ">", "value": 1}],
        "for_seconds": 0, "rearm_seconds": 0,
    }
    engine = WcarsEngine({}, user_rule_docs=[doc])
    names = tracked_signals(engine)
    assert "MadeUpSignal" in names
    # Every signal of a whitelisted message is covered too, so a built-in fault
    # gets a freeze frame without anyone listing its signals by hand.
    whitelisted = [m for m in engine.decoder._db.messages
                   if engine.decoder.is_whitelisted(m.frame_id)]
    assert whitelisted, "test DBC has no whitelisted messages"
    assert {s.name for s in whitelisted[0].signals} <= names
