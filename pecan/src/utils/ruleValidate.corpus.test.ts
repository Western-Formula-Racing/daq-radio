/** Runs the corpus shared with
 * universal-telemetry-software/tests/test_rule_validation_corpus.py.
 *
 * The corpus pins the verdict, not the prose: the car writes for a log and this
 * form writes for a student. What may never differ is whether a document is
 * accepted, because a browser that accepts what the car rejects lets someone
 * believe an unarmed rule is armed.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { buildIndex, signalsFromDbcText } from "./signalIndex";
import { validateRuleDoc } from "./ruleValidate";

const VECTOR_DIR = path.resolve(
  __dirname, "../../../universal-telemetry-software/tests/rule_validation");
// Pinned to the same committed DBC the pytest runner uses, so neither side can
// pass by testing a different car.
const CORPUS_DBC = path.resolve(
  __dirname, "../../../universal-telemetry-software/example.dbc");

const files = fs.readdirSync(VECTOR_DIR).filter((f) => f.endsWith(".json")).sort();
const index = buildIndex(signalsFromDbcText(fs.readFileSync(CORPUS_DBC, "utf-8")));

describe("rule validation corpus", () => {
  it("found the vectors", () => {
    // A directory that silently resolved to nothing would make every case below
    // vacuous while the suite still went green.
    expect(files.length).toBeGreaterThanOrEqual(10);
  });

  it.each(files)("%s", (file) => {
    const vector = JSON.parse(fs.readFileSync(path.join(VECTOR_DIR, file), "utf-8"));
    const problems = validateRuleDoc(vector.rule, index);
    expect(problems.length === 0, `${vector.description} (problems: ${JSON.stringify(problems)})`)
      .toBe(vector.valid);
  });
});
