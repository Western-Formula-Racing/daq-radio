/** One condition: a chosen signal, a comparison, and a value.
 *
 * The value control follows the signal. An enum gets a picker of its exact
 * labels, which is what stops a rule being written against a label that is
 * spelled differently in the DBC: such a rule stores cleanly, validates
 * cleanly, and then never fires.
 */
import type { Condition, Op } from "../../lib/wcars/engine/types";
import type { RuleProblem } from "../../utils/ruleValidate";
import type { SignalInfo } from "../../utils/signalIndex";

const ALL_OPS: Op[] = [">", ">=", "<", "<=", "==", "!="];
const EQUALITY_OPS: Op[] = ["==", "!="];

interface ConditionEditorProps {
  condition: Condition;
  info: SignalInfo | null;
  problems: RuleProblem[];
  index: number;
  onChange: (next: Condition) => void;
  onClear: () => void;
}

function ConditionEditor({ condition, info, problems, index, onChange, onClear }: ConditionEditorProps) {
  const isEnum = info?.choices != null;
  const ops = isEnum ? EQUALITY_OPS : ALL_OPS;
  const mine = problems.filter((p) => p.path.startsWith(`conditions.${index}`));

  return (
    <div
      data-testid={`condition-${index}`}
      className="rounded border border-white/10 bg-black/20 p-3"
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="font-mono text-xs text-slate-200">
          <span className="text-slate-400">{condition.message}.</span>
          <span className="uppercase tracking-wide">{condition.signal}</span>
        </div>
        <button
          type="button"
          data-testid={`condition-${index}-clear`}
          className="trace-btn trace-btn-subtle min-h-[44px] !text-[10px]"
          onClick={onClear}
        >
          Clear
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1" role="group" aria-label="Comparison">
          {ops.map((op) => (
            <button
              key={op}
              type="button"
              data-testid={`condition-${index}-op-${op}`}
              aria-pressed={condition.op === op}
              className={`min-h-[44px] min-w-[44px] rounded border px-3 font-mono text-sm ${
                condition.op === op
                  ? "border-cyan-400/60 bg-cyan-500/15 text-cyan-100"
                  : "border-white/20 bg-black/30 text-slate-200"
              }`}
              onClick={() => onChange({ ...condition, op })}
            >
              {op}
            </button>
          ))}
        </div>

        {isEnum ? (
          <select
            data-testid={`condition-${index}-value-enum`}
            className="min-h-[44px] rounded border border-white/20 bg-black/30 px-3 text-sm text-slate-100"
            value={typeof condition.value === "string" ? condition.value : ""}
            onChange={(event) => onChange({ ...condition, value: event.target.value })}
          >
            {typeof condition.value !== "string" && <option value="">Choose a value</option>}
            {info!.choices!.map((choice) => (
              <option key={choice} value={choice}>{choice}</option>
            ))}
          </select>
        ) : (
          <input
            data-testid={`condition-${index}-value-number`}
            type="number"
            inputMode="decimal"
            className="min-h-[44px] w-32 rounded border border-white/20 bg-black/30 px-3 text-sm text-slate-100"
            value={typeof condition.value === "number" ? condition.value : ""}
            onChange={(event) => {
              const raw = event.target.value;
              onChange({ ...condition, value: raw === "" ? raw : Number(raw) });
            }}
          />
        )}

        {!isEnum && info && info.minimum !== null && info.maximum !== null && (
          // Shown as a hint, never enforced: an out-of-range reading is exactly
          // the kind of thing a fault rule exists to catch.
          <span data-testid={`condition-${index}-range`} className="font-mono text-[10px] text-slate-400">
            DBC range {info.minimum} to {info.maximum}{info.unit ? ` ${info.unit}` : ""}
          </span>
        )}
      </div>

      {mine.length > 0 && (
        <ul data-testid={`condition-${index}-problems`} className="mt-2 space-y-1 text-xs text-amber-200">
          {mine.map((problem) => <li key={problem.path + problem.message}>{problem.message}</li>)}
        </ul>
      )}
    </div>
  );
}

export default ConditionEditor;
