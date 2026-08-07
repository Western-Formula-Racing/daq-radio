/** Runs a whole replay off the main thread.
 *
 * The Task 1 benchmark measured 1M frames decoding in about 8.5 s with rules
 * adding 8-12% on top, so decode is the bottleneck and the pass cannot run on
 * the main thread without freezing the tab. This worker owns the rule-path
 * decoder and reports progress in chunks so the UI can show a bar.
 *
 * The DBC arrives as text rather than being imported here so the worker decodes
 * against exactly the database the page is showing, including one the student
 * loaded at the track.
 */
import { runReplay } from "../lib/wcars/engine/replayRunner";
import type { ReplayInputFrame, ReplayResult } from "../lib/wcars/engine/replayRunner";
import type { RuleDoc } from "../lib/wcars/engine/types";
import { createRuleDecoder } from "../utils/ruleDecode";

export interface ReplayWorkerRequest {
  frames: ReplayInputFrame[];
  rules: RuleDoc[];
  dbcText: string;
}

export type ReplayWorkerMessage =
  | { type: "progress"; done: number; total: number }
  | { type: "done"; result: ReplayResult }
  | { type: "error"; message: string };

self.onmessage = (event: MessageEvent<ReplayWorkerRequest>) => {
  const { frames, rules, dbcText } = event.data;
  try {
    const decode = createRuleDecoder(dbcText);
    const result = runReplay(frames, rules, decode, (done, total) => {
      const message: ReplayWorkerMessage = { type: "progress", done, total };
      self.postMessage(message);
    });
    const message: ReplayWorkerMessage = { type: "done", result };
    self.postMessage(message);
  } catch (error) {
    // A worker that dies silently looks identical to a session with no faults,
    // so every failure is reported back as a message the UI can render.
    const message: ReplayWorkerMessage = {
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    };
    self.postMessage(message);
  }
};
