# Phase B replay engine performance spike

Gates the decision to run WCARS replay entirely in the browser (no backend,
no upload). Full method, caveats, and the decode-marginal measurement are in
`.superpowers/sdd/phaseb-task-1-report.md`. This file is the numbers and the
verdict.

## Rule-engine cost (bench.ts, synthetic already-decoded frames)

Command: `node --expose-gc <tsx bin> pecan/src/lib/wcars/engine/bench.ts`

| frames    | rules | wall time | heap delta (Node, approx) |
|-----------|-------|-----------|----------------------------|
| 100,000   | 1     | 19.4 ms   | 0.1 MB                     |
| 100,000   | 10    | 53.3 ms   | 0.3 MB                     |
| 100,000   | 40    | 135.7 ms  | 2.3 MB                     |
| 500,000   | 1     | 101.5 ms  | -1.8 MB (GC noise)          |
| 500,000   | 10    | 257.7 ms  | 1.4 MB                     |
| 500,000   | 40    | 667.9 ms  | -0.8 MB (GC noise)          |
| 1,000,000 | 1     | 201.6 ms  | 0.0 MB                     |
| 1,000,000 | 10    | 509.7 ms  | 2.5 MB                     |
| 1,000,000 | 40    | 1354.3 ms | 0.5 MB                     |

Cold single-shot rerun of the worst cell (1,000,000 frames / 40 rules, no
warm cells before it in-process): 1271.8 ms, heap delta -0.09 MB. Consistent
with the in-sweep number, so JIT warm-up across cells is not skewing the
1M/40 cell materially.

## Decode marginal cost (real `decodeCanMessage`, synthetic frames)

Synthetic frames in `parseReplayFile`'s output shape, decoded against the
real `pecan/src/assets/example.dbc` via candied. 1,000,000 frames, 40 rules.

| pass                | wall time | note                          |
|----------------------|-----------|--------------------------------|
| decode only          | ~8.3-8.6 s | existing path, already ships   |
| decode + 40 rules     | ~9.3 s     |                                 |
| marginal rules cost  | ~0.7-1.0 s | roughly 8-12% on top of decode |

Decode is the dominant cost by roughly 8-9x over the rule engine at the top
of the range. Rules are a real but secondary addition.

## Verdict: FAIL

1,000,000 frames through 40 rules is one uninterrupted synchronous loop.
The rule-engine sweep alone (1.27-1.35 s) is already 6-7x the ~200 ms
responsiveness bar, and decode-plus-rules together (~9.3 s for 1M frames)
is roughly 45x that bar. Neither number can run on the main thread as a
single blocking call without the tab appearing to hang.

This is not a rules-specific problem — decode alone (8.3-8.6 s for 1M
frames) already blows through the budget by itself; rules add a further
~10% on top. So the fix is the same either way: **the replay runner
(decode + rules together) must run inside a Web Worker with chunked
progress, and the UI needs a progress bar.** Do not attempt to ship an
un-chunked main-thread replay pass, even for the rule engine alone —
40 rules at 1M frames is already over budget on its own.
