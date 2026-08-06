"""LogThrottle tests: the shared gate that keeps a persistent per-frame fault
from writing a traceback per frame to the Pi's SD card."""
import logging

from src.log_throttle import LogThrottle, log_throttled_exception, suppressed_suffix


def test_first_take_always_emits():
    t = LogThrottle(interval_s=30.0)
    assert t.take() == (True, True, 0)


def test_subsequent_takes_are_suppressed_and_counted():
    t = LogThrottle(interval_s=30.0)
    t.take()
    for _ in range(5):
        assert t.take() == (False, False, 0)


def test_emits_again_after_the_interval_with_the_suppressed_count():
    clock = [100.0]
    t = LogThrottle(interval_s=30.0, monotonic=lambda: clock[0])
    assert t.take()[0] is True
    for _ in range(9):
        t.take()
    clock[0] += 30.0
    emit, first, dropped = t.take()
    assert (emit, first, dropped) == (True, False, 9)


def test_suppressed_count_resets_after_an_emit():
    clock = [0.0]
    t = LogThrottle(interval_s=10.0, monotonic=lambda: clock[0])
    t.take()
    t.take()
    clock[0] += 10.0
    assert t.take()[2] == 1
    t.take()
    clock[0] += 10.0
    assert t.take()[2] == 1


def test_log_throttled_exception_logs_traceback_once_then_counts(caplog):
    logger = logging.getLogger("test.throttle")
    clock = [0.0]
    t = LogThrottle(interval_s=5.0, monotonic=lambda: clock[0])
    exc = ValueError("boom")
    with caplog.at_level(logging.INFO, logger="test.throttle"):
        for _ in range(50):
            log_throttled_exception(logger, t, "Widget failed", exc)
        clock[0] += 5.0
        log_throttled_exception(logger, t, "Widget failed", exc)

    records = [r for r in caplog.records if r.name == "test.throttle"]
    assert len(records) == 2
    assert records[0].levelno == logging.ERROR and records[0].exc_info is not None
    assert records[1].exc_info is None
    assert "49" in records[1].getMessage()


def test_a_quiet_gap_rearms_the_throttle():
    clock = [0.0]
    t = LogThrottle(interval_s=30.0, monotonic=lambda: clock[0])
    assert t.take() == (True, True, 0)
    clock[0] += 30.0
    assert t.take() == (True, True, 0)


def test_a_continuous_fault_does_not_rearm_the_throttle():
    clock = [0.0]
    t = LogThrottle(interval_s=30.0, monotonic=lambda: clock[0])
    t.take()
    for _ in range(3):
        clock[0] += 1.0
        t.take()
    clock[0] += 30.0
    emit, is_first, dropped = t.take()
    assert (emit, is_first) == (True, False) and dropped == 3


def test_a_new_fault_after_a_quiet_gap_logs_a_full_traceback_again(caplog):
    logger = logging.getLogger("test.throttle.rearm")
    clock = [0.0]
    t = LogThrottle(interval_s=5.0, monotonic=lambda: clock[0])
    with caplog.at_level(logging.INFO, logger="test.throttle.rearm"):
        log_throttled_exception(logger, t, "Widget failed", ValueError("startup blip"))
        clock[0] += 3600.0
        log_throttled_exception(logger, t, "Widget failed", KeyError("canId"))

    records = [r for r in caplog.records if r.name == "test.throttle.rearm"]
    assert len(records) == 2
    assert all(r.exc_info is not None for r in records)


def test_the_throttled_line_names_the_exception_class(caplog):
    logger = logging.getLogger("test.throttle.classname")
    clock = [0.0]
    t = LogThrottle(interval_s=5.0, monotonic=lambda: clock[0])
    exc = KeyError("canId")
    with caplog.at_level(logging.INFO, logger="test.throttle.classname"):
        log_throttled_exception(logger, t, "WCARS engine error", exc)
        log_throttled_exception(logger, t, "WCARS engine error", exc)
        clock[0] += 5.0
        log_throttled_exception(logger, t, "WCARS engine error", exc)

    records = [r for r in caplog.records if r.name == "test.throttle.classname"]
    assert len(records) == 2
    assert "KeyError" in records[1].getMessage()


def test_suppressed_suffix_is_empty_when_nothing_was_dropped():
    assert suppressed_suffix(0, 30.0) == ""
    assert "5" in suppressed_suffix(5, 30.0)
