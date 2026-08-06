"""LogThrottle tests: the shared gate that keeps a persistent per-frame fault
from writing a traceback per frame to the Pi's SD card."""
import logging

from src.log_throttle import LogThrottle, log_throttled_exception


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
