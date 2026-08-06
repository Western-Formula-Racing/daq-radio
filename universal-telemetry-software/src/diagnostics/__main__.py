"""OMT diagnostics service entrypoint.

Run on the car Pi: uv run python -m src.diagnostics
Composes the rule store, engine host, and API; uvicorn serves on OMT_PORT."""
from __future__ import annotations

import logging
import os
from pathlib import Path

import uvicorn

from ..wcars.decoder import DBC_PATH, load_db
from .app import create_app
from .engine_host import EngineHost
from .rule_store import RuleStore

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")

logger = logging.getLogger("diagnostics.main")


def main() -> None:
    data_dir = Path(os.getenv("WCARS_DATA_DIR", "./wcars-data"))
    config_path = Path(os.getenv("WCARS_CONFIG_PATH", str(data_dir / "wcars_config.json")))
    bridge_url = os.getenv("WCARS_BRIDGE_WS_URL", "ws://127.0.0.1:9080")
    port = int(os.getenv("OMT_PORT", "9090"))
    static_env = os.getenv("OMT_STATIC_DIR")

    db = load_db()
    try:
        store = RuleStore(data_dir, db)
    except OSError as exc:
        # RuleStore.__init__ raises OSError only when it cannot even quarantine an
        # unreadable rules.json; that is unrecoverable without operator action, so
        # fail loudly once instead of falling back to a silent empty store (which
        # would look like "no rules configured" and hide real data loss).
        logger.critical(
            "Cannot open the WCARS rule store at %s: %s. The service will not "
            "start until this is fixed (check permissions and the rules.json "
            "file in that directory).", data_dir, exc,
        )
        raise SystemExit(1) from exc
    host = EngineHost(config_path, store)
    app = create_app(store, host, Path(DBC_PATH), db, bridge_url=bridge_url,
                     static_dir=Path(static_env) if static_env else None)
    # No workers=: RuleStore is exactly one instance per data dir and every route
    # handler stays on the single event loop the frame feed runs on. Multiple
    # uvicorn workers would each own a separate store and engine, corrupting
    # rules.json with concurrent writers.
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")


if __name__ == "__main__":
    main()
