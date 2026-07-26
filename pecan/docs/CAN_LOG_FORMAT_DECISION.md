# PECAN CAN Log Format Decision

> **Implementation update:** The `.pecan` session container below was planned as `version: 1` with named-object frames. The shipped implementation (`src/utils/pecanSerializer.ts`, `src/utils/replayParser.ts`, `src/types/replay.ts`) instead uses **`version: 2`**, a more compact tuple-based encoding (`frames: [[tRelMs, canId, flags, dataHex], ...]` with a `columns` field documenting the tuple order, and `isExtended`/`direction` packed into a single `flags` bitfield rather than separate fields) — described as "~7x smaller than the v1 named-object format." The parser explicitly rejects `version: 1` files with a message directing users to re-export as v2. Decode-metadata field names in code are camelCase (`dbcName`, `dbcHashSha256`, `importFormat`, `dbcEmbedded`), not the snake_case shown in the Phase 4 spec below. The Phase 1 CSV format and Phase 2/3 import-adapter notes are otherwise still accurate (see the Migration Note update below for one exception: BLF import already shipped, ahead of the planned Vector ASC adapter, which is not yet implemented).

## Decision Summary

Use a machine-readable raw frame format as the canonical PECAN replay format.

DBC remains a separate decode artifact loaded via Settings and is not embedded in log rows.

In addition, PECAN can support an open optional session container that bundles raw frames with replay metadata.

## Open Source Position

- PECAN log formats are open specification artifacts in this repository.
- No vendor lock-in goals: interoperability and portability are first-class requirements.
- Any PECAN profile must be fully documented and implementable by third parties.

## Why Not Custom-Only Format

- Teams will want to open logs in existing tools.
- Future integrations (Vector/CANedge/python tooling) become easier with standard fields.
- Custom-only formats increase migration cost.

## Why Not Raw External Standard Only

- Browser replay needs predictable, minimal fields and strict validation.
- External formats often have optional/variant fields that complicate client parsing.

## Recommended Format Strategy

### Phase 1 (now): PECAN CSV v1 (standard-friendly)

Use CSV as the primary record/replay artifact in-browser with raw frame fields only.

Required columns:

- `t_rel_ms` (number): monotonic milliseconds from log start; replay driver uses this for timing.
- `can_id` (number): numeric CAN id.
- `is_extended` (0|1): 11-bit vs 29-bit frame id mode.
- `direction` (`rx`|`tx`): frame direction.
- `dlc` (0-8): payload length.
- `data_hex` (string): contiguous hex payload, e.g. `1122334455667788`.

Optional columns:

- `t_epoch_ms` (number): original wall-clock timestamp.
- `channel` (string): bus/channel id.
- `source` (string): stream source tag.

Rules:

- Replay timing is driven only by `t_rel_ms`.
- If `t_rel_ms` missing, derive from `t_epoch_ms` by subtracting first frame timestamp.
- Canonical replay input is raw-only. Do not require decoded-value columns.
- Decoding at replay/view time uses the currently loaded DBC from Settings.

### Phase 2: Import adapters

Add import support for common external logs by mapping into PECAN CSV v1 internal model:

- Vector ASC (text) first.
- Optionally BLF/MF4 later (likely via backend/worker + heavier parser path).

**Status:** implemented in the reverse order — BLF import (including zlib-decompressed TSMaster variants) shipped first (`src/utils/replayParser.ts`), wired into the file picker (`.pecan,.json,.csv,.blf,...`). Vector ASC import is not implemented yet. MF4/Parquet (Phase 3) also remain unimplemented.

### Phase 3: Optional analytics format

Parquet can be added for large archival/analytics workflows, but not required for initial browser replay interoperability.

### Phase 4: Optional open PECAN session container

Support an optional JSON container for full-fidelity sharing of replay context while staying open and machine-readable.

Canonical extension: `.pecan`

Container encoding: UTF-8 JSON text (human-editable).

Compatibility recommendation:

- Import accepts both `.pecan` and `.json`.
- Export defaults to `.pecan` to signal session-container semantics.
- Optional MIME type for ecosystem tooling: `application/vnd.pecan+json`.

Top-level shape:

- `format`: `pecan-session`
- `version`: `1`
- `frames`: array of raw frames (same semantic fields as PECAN CSV v1)
- `decode`: optional decode metadata
- `timeline`: optional checkpoints and cursor metadata
- `plots`: optional plot layout and config

Example minimal shape:

```json
{
  "format": "pecan-session",
  "version": 1,
  "frames": [
    {
      "t_rel_ms": 0,
      "can_id": 256,
      "is_extended": 0,
      "direction": "rx",
      "dlc": 8,
      "data_hex": "1122334455667788"
    }
  ]
}
```

Optional decode metadata:

- `decode.dbc_name`: source label only.
- `decode.dbc_hash_sha256`: verification hash of the DBC used when exporting.
- `decode.import_format`: descriptor of upstream format, if adapted (for example asc).
- `decode.dbc_embedded`: optional embedded DBC payload.

Embedded DBC shape:

- `decode.dbc_embedded.format`: `dbc`.
- `decode.dbc_embedded.encoding`: `utf-8`.
- `decode.dbc_embedded.content`: full DBC text.

Embedding policy:

- Embedding DBC is optional and disabled by default for smaller files.
- If embedded DBC exists, importer may offer Use embedded DBC or Keep current DBC.
- If both embedded content and hash exist, hash validation should run against embedded content.

Optional timeline metadata:

- `timeline.checkpoints`: list of named checkpoints with `t_rel_ms`.
- `timeline.window_ms`: last used timeline window.
- `timeline.last_cursor_ms`: last selected replay cursor.

Optional plot metadata:

- `plots.layouts`: list of plot panel definitions and placement.
- `plots.series`: per-plot signal selections and y-axis options.

Rules for container handling:

- Import must succeed if only `frames` are present.
- Unknown optional fields must be ignored, not rejected (forward compatibility).
- Container metadata must never be required to decode raw frames.
- If `decode.dbc_hash_sha256` is present and does not match current DBC, show a non-blocking warning.
- If embedded DBC is present and user chooses it, load it into the replay session decode context.

## Internal Replay Model (TypeScript)

```ts
export interface ReplayFrame {
  tRelMs: number;
  canId: number;
  isExtended: boolean;
  direction: "rx" | "tx";
  dlc: number;
  dataHex: string;
  tEpochMs?: number;
  channel?: string;
  source?: string;
}
```

## Migration Note (Current Trace CSV)

**Status: done.** `exportCsv()` in `src/pages/Trace.tsx` now emits both the machine-readable Phase 1 columns (`t_rel_ms`, `t_epoch_ms`, `can_id`, `is_extended`, `direction`, `dlc`, `data_hex`, `source`) and human-friendly extras (`message_name`, `index`, `timestamp`, `delta_ms`, `can_id_display`, `data_display`) in the same CSV export. The purely human-formatted columns (`Timestamp`, `DLC`, `Data`, `Message`) still exist, but only in the on-screen trace table UI, not in the CSV export.

## Acceptance Criteria

1. User can export a replay-ready PECAN CSV v1 file from trace.
2. User can upload PECAN CSV v1 and replay deterministically in browser.
3. Upload validator rejects malformed rows with clear error messages.
4. Replay timing remains stable across pause/seek/resume.
5. User can import a `.pecan` container (and equivalent `.json`) with only `frames`.
6. If present, optional `decode`, `timeline`, and `plots` metadata restore replay context without being mandatory.
7. Import supports optional embedded DBC content without making it mandatory.
