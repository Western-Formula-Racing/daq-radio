import os
from pathlib import Path
import sys

CONE_DETECTION_PATH = Path(__file__).parent / "cone-detection"
if str(CONE_DETECTION_PATH) not in sys.path:
    sys.path.insert(0, str(CONE_DETECTION_PATH))

# The WCARS decoder defaults to the in-container DBC (/app/dbc_uploads/active.dbc), which
# does not exist on a dev machine. Prefer the secret-dbc submodule; fall back to
# example.dbc so the wcars tests still run in CI, which does not check out
# submodules. Set before any test imports src.wcars.decoder, which reads
# WFR_DBC_PATH at module import time.
if "WFR_DBC_PATH" not in os.environ:
    for _candidate in (Path(__file__).parent.parent / "secret-dbc" / "WFR25.dbc",
                       Path(__file__).parent / "example.dbc"):
        if _candidate.exists():
            os.environ["WFR_DBC_PATH"] = str(_candidate)
            break
