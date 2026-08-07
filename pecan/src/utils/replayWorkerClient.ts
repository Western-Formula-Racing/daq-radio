/** Main-thread side of the replay worker.
 *
 * Kept apart from the worker entry so a component can import this without Vite
 * pulling the worker's module graph into the page bundle.
 */
import { runReplay } from "../lib/wcars/engine/replayRunner";
import type {
  ProgressCallback,
  ReplayInputFrame,
  ReplayResult,
} from "../lib/wcars/engine/replayRunner";
import type { RuleDoc } from "../lib/wcars/engine/types";
import type { ReplayWorkerMessage, ReplayWorkerRequest } from "../workers/replayWorker";
import { createRuleDecoder } from "./ruleDecode";

export interface ReplayRunHandle {
  result: Promise<ReplayResult>;
  /** Stops the run and rejects the promise. A student who picked the wrong file
   * should not have to wait out a million frames.
   */
  cancel: () => void;
}

export function runReplayInWorker(
  frames: ReplayInputFrame[],
  rules: RuleDoc[],
  dbcText: string,
  onProgress?: ProgressCallback,
): ReplayRunHandle {
  if (typeof Worker === "undefined") {
    // jsdom and older embedded browsers have no Worker. Blocking is worse than
    // not running at all, so the fallback is explicit rather than accidental.
    const result = new Promise<ReplayResult>((resolve, reject) => {
      try {
        resolve(runReplay(frames, rules, createRuleDecoder(dbcText), onProgress));
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
    return { result, cancel: () => {} };
  }

  const worker = new Worker(new URL("../workers/replayWorker.ts", import.meta.url),
    { type: "module" });
  let settled = false;
  let abort: (reason: Error) => void = () => {};

  const result = new Promise<ReplayResult>((resolve, reject) => {
    abort = reject;
    worker.onmessage = (event: MessageEvent<ReplayWorkerMessage>) => {
      const message = event.data;
      if (message.type === "progress") {
        onProgress?.(message.done, message.total);
        return;
      }
      settled = true;
      worker.terminate();
      if (message.type === "done") resolve(message.result);
      else reject(new Error(message.message));
    };
    worker.onerror = (event) => {
      settled = true;
      worker.terminate();
      reject(new Error(event.message || "The replay worker failed to start."));
    };

    const request: ReplayWorkerRequest = { frames, rules, dbcText };
    worker.postMessage(request);
  });

  return {
    result,
    cancel: () => {
      if (settled) return;
      settled = true;
      worker.terminate();
      abort(new Error("Replay run canceled."));
    },
  };
}
