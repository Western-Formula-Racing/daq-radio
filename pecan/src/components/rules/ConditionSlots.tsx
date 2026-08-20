/** The AND-ed conditions of a rule, filled by tapping an armed signal into a slot.
 *
 * The joiner is a fixed label rather than a chooser: the engine only ANDs, and
 * offering an OR would promise a capability the car does not have.
 */
import ConditionEditor from "./ConditionEditor";
import { MAX_CONDITIONS } from "../../lib/wcars/engine/userRule";
import type { Condition } from "../../lib/wcars/engine/types";
import { findSignal } from "../../utils/signalIndex";
import type { SignalIndex, SignalInfo } from "../../utils/signalIndex";
import type { RuleProblem } from "../../utils/ruleValidate";

interface ConditionSlotsProps {
  conditions: Condition[];
  index: SignalIndex | null;
  armed: SignalInfo | null;
  problems: RuleProblem[];
  onChange: (next: Condition[]) => void;
  onPlaced: () => void;
}

/** A placement that is valid the moment it lands, so a half-built rule never
 * reports an error the author did not cause. */
function conditionFor(info: SignalInfo): Condition {
  return info.choices != null && info.choices.length > 0
    ? { message: info.message, signal: info.signal, op: "==", value: info.choices[0] }
    : { message: info.message, signal: info.signal, op: ">", value: 0 };
}

function ConditionSlots({ conditions, index, armed, problems, onChange, onPlaced }: ConditionSlotsProps) {
  const place = (at: number) => {
    if (armed === null) return;
    const next = [...conditions];
    next[at] = conditionFor(armed);
    onChange(next);
    onPlaced();
  };

  const structural = problems.filter((p) => p.path === "conditions");

  return (
    <div className="space-y-2">
      {conditions.map((condition, i) => (
        <div key={`${condition.message}.${condition.signal}.${i}`}>
          {i > 0 && (
            <p data-testid="condition-joiner" className="py-1 text-center font-mono text-xs uppercase tracking-widest text-slate-400">
              AND
            </p>
          )}
          <div className="relative">
            <ConditionEditor
              condition={condition}
              info={index === null ? null : findSignal(index, condition.message, condition.signal)}
              problems={problems}
              index={i}
              onChange={(next) => {
                const list = [...conditions];
                list[i] = next;
                onChange(list);
              }}
              onClear={() => onChange(conditions.filter((_, at) => at !== i))}
            />
            {armed !== null && (
              <button
                type="button"
                data-testid={`condition-${i}-replace`}
                className="absolute inset-0 rounded border-2 border-dashed border-cyan-400/70 bg-cyan-500/10 text-xs font-mono uppercase tracking-wide text-cyan-100"
                onClick={() => place(i)}
              >
                Tap to replace with {armed.signal}
              </button>
            )}
          </div>
        </div>
      ))}

      {conditions.length < MAX_CONDITIONS && (
        <>
          {conditions.length > 0 && (
            <p data-testid="condition-joiner-next" className="py-1 text-center font-mono text-xs uppercase tracking-widest text-slate-500">
              AND
            </p>
          )}
          <button
            type="button"
            data-testid="condition-empty-slot"
            disabled={armed === null}
            className={`min-h-[64px] w-full rounded border-2 border-dashed px-3 py-4 text-center font-mono text-xs uppercase tracking-wide ${
              armed === null
                ? "border-white/15 text-slate-500"
                : "border-cyan-400/70 bg-cyan-500/10 text-cyan-100"
            }`}
            onClick={() => place(conditions.length)}
          >
            {armed === null ? "Pick a signal to add a condition" : `Tap to place ${armed.signal}`}
          </button>
        </>
      )}

      {structural.length > 0 && (
        <ul data-testid="condition-structural-problems" className="space-y-1 text-xs text-amber-200">
          {structural.map((problem) => <li key={problem.message}>{problem.message}</li>)}
        </ul>
      )}
    </div>
  );
}

export default ConditionSlots;
