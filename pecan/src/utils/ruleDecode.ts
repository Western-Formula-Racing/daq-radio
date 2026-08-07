/** Decodes CAN frames into the flat shape the rule interpreter expects.
 *
 * Deliberately separate from PECAN's display decoder in canProcessor.ts. That
 * one produces {sensorReading, unit} per signal and, for a VAL_-mapped signal,
 * puts the raw number in sensorReading and the label in unit. The car's Python
 * decoder unwraps an enum to a plain string, so a rule written as
 * {"op": "==", "value": "DRIVE"} fires on the car and would never fire in a
 * replay driven by the display shape. Since the rule path and the display path
 * already share no frames, decoding twice is cheaper than changing a decoder
 * every PECAN panel depends on.
 */
import { Can, Dbc } from "candied";

import type { DecodeForRules } from "../lib/wcars/engine/replayRunner";
import type { DecodedFrame } from "../lib/wcars/engine/types";

const CAN_EFF_FLAG = 0x80000000;
const CAN_STD_MAX = 0x7ff;

// DBC files flag extended 29-bit ids with bit 31; recorded frames carry the raw
// arbitration id, so the flag has to be put back before the lookup.
function toDbcId(rawCanId: number): number {
  const id = rawCanId >>> 0;
  return id > CAN_STD_MAX ? (id | CAN_EFF_FLAG) >>> 0 : id;
}

function hexToBytes(dataHex: string): number[] | null {
  if (dataHex.length % 2 !== 0) return null;
  const bytes: number[] = new Array(dataHex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    const byte = parseInt(dataHex.substr(i * 2, 2), 16);
    if (Number.isNaN(byte)) return null;
    bytes[i] = byte;
  }
  return bytes;
}

/** Scale a raw reading the way cantools does, without candied's range clamp.
 *
 * candied clamps signal.value to the DBC's declared [min|max]; cantools does not.
 * That silently diverges the two runtimes on exactly the readings a diagnostics
 * tool exists to catch: PackCurrent 0xFFFF is 3277.5 on the car and clamps to
 * 3276 here, so a rule watching for an over-range current could never fire in
 * replay. Recompute from rawValue when the factor and offset are available.
 */
function scaledValue(signal: any): number {
  const def = signal.boundData?.signal;
  const factor = def?.factor;
  const offset = def?.offset;
  if (typeof signal.rawValue !== "number"
      || typeof factor !== "number" || typeof offset !== "number") {
    return signal.value;
  }
  return signal.rawValue * factor + offset;
}

export function createRuleDecoder(dbcText: string): DecodeForRules {
  const can = new Can();
  can.database = new Dbc().load(dbcText);

  return (canId: number, dataHex: string): DecodedFrame | null => {
    const bytes = hexToBytes(dataHex);
    if (bytes === null) return null;

    let decoded;
    try {
      decoded = can.decode(can.createFrame(toDbcId(canId), bytes));
      if (!decoded) {
        // The recorder and the DBC can disagree about the extended-id flag, so
        // one toggle is tried before giving up, matching the display decoder.
        const flipped = toDbcId(canId) & CAN_EFF_FLAG
          ? toDbcId(canId) & ~CAN_EFF_FLAG
          : (toDbcId(canId) | CAN_EFF_FLAG) >>> 0;
        decoded = can.decode(can.createFrame(flipped >>> 0, bytes));
      }
    } catch {
      return null;
    }
    if (!decoded || !(decoded.boundSignals instanceof Map)) return null;

    const signals: Record<string, number | string> = {};
    decoded.boundSignals.forEach((signal, name) => {
      // candied writes the VAL_ label into physValue when the scaled value has
      // one; reading the table directly avoids guessing from a formatted string.
      const table = signal.boundData?.signal?.valueTable;
      const label = table ? table.get(signal.value) : undefined;
      if (typeof label === "string") {
        signals[name] = label;
        return;
      }
      signals[name] = scaledValue(signal);
    });

    return { message: decoded.name, signals };
  };
}
