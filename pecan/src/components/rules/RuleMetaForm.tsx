/** Everything about a rule that is not a condition. */
import type { ChangeEvent } from "react";

import type { RuleDoc, Severity } from "../../lib/wcars/engine/types";
import type { RuleProblem } from "../../utils/ruleValidate";

const SEVERITIES: Severity[] = ["WARNING", "CAUTION", "MEMO"];
const MAX_MESSAGE_LEN = 24;

interface RuleMetaFormProps {
  doc: RuleDoc;
  problems: RuleProblem[];
  onChange: (next: RuleDoc) => void;
}

function RuleMetaForm({ doc, problems, onChange }: RuleMetaFormProps) {
  const field = (path: string) => {
    const mine = problems.filter((p) => p.path === path);
    return mine.length > 0 ? (
      <ul data-testid={`rule-problem-${path}`} className="mt-1 space-y-1 text-xs text-amber-200">
        {mine.map((problem) => <li key={problem.path + problem.message}>{problem.message}</li>)}
      </ul>
    ) : null;
  };
  const inputClass = "min-h-[44px] w-full rounded border border-white/20 bg-black/30 px-3 text-sm text-slate-100";
  const labelClass = "block font-mono text-[10px] uppercase tracking-wide text-slate-400";

  // A partial entry like "-" or "1e", or an emptied field, parses to NaN. Emit it
  // anyway so validateRuleDoc's Number.isFinite check can flag it, rather than
  // silently falling back to 0, which is a legal "fire immediately" value.
  const numberField = (path: "for_seconds" | "rearm_seconds") => (event: ChangeEvent<HTMLInputElement>) => {
    // Number("") is 0, not NaN, which would let an emptied field through as a
    // legal (and dangerous) "fire immediately" value; force it to NaN instead.
    const raw = event.target.value;
    onChange({ ...doc, [path]: raw === "" ? NaN : Number(raw) });
  };

  return (
    <div className="space-y-3">
      <div>
        <label className={labelClass} htmlFor="rule-name">Name</label>
        <input
          id="rule-name" data-testid="rule-name" className={inputClass} value={doc.name}
          onChange={(event) => onChange({ ...doc, name: event.target.value })}
        />
        {field("name")}
      </div>

      <div>
        <label className={labelClass} htmlFor="rule-message">
          Display message
          {/* Counted because the limit exists to fit the car's fault display line: silently
              truncating on the car would show a driver a different fault. */}
          <span data-testid="rule-message-count" className="ml-2 text-slate-500">
            {doc.message.length}/{MAX_MESSAGE_LEN}
          </span>
        </label>
        <input
          id="rule-message" data-testid="rule-message" className={inputClass} value={doc.message}
          onChange={(event) => onChange({ ...doc, message: event.target.value })}
        />
        {field("message")}
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="flex-1">
          <label className={labelClass} htmlFor="rule-severity">Severity</label>
          <select
            id="rule-severity" data-testid="rule-severity" className={inputClass} value={doc.severity}
            onChange={(event) => onChange({ ...doc, severity: event.target.value as Severity })}
          >
            {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          {field("severity")}
        </div>
        <div className="flex-1">
          <label className={labelClass} htmlFor="rule-for-seconds">Hold for (s)</label>
          <input
            id="rule-for-seconds" data-testid="rule-for-seconds" type="number" inputMode="decimal"
            min={0} step="0.1" className={inputClass}
            value={Number.isFinite(doc.for_seconds) ? doc.for_seconds : ""}
            onChange={numberField("for_seconds")}
          />
          {field("for_seconds")}
        </div>
        <div className="flex-1">
          <label className={labelClass} htmlFor="rule-rearm-seconds">Re-arm after (s)</label>
          <input
            id="rule-rearm-seconds" data-testid="rule-rearm-seconds" type="number" inputMode="decimal"
            min={0} step="1" className={inputClass}
            value={Number.isFinite(doc.rearm_seconds) ? doc.rearm_seconds : ""}
            onChange={numberField("rearm_seconds")}
          />
          {field("rearm_seconds")}
        </div>
      </div>

      <button
        type="button" data-testid="rule-enabled" aria-pressed={doc.enabled}
        className={`min-h-[44px] rounded border px-4 font-mono text-xs uppercase tracking-wide ${
          doc.enabled
            ? "border-emerald-400/50 bg-emerald-500/15 text-emerald-100"
            : "border-white/20 bg-black/30 text-slate-400"
        }`}
        onClick={() => onChange({ ...doc, enabled: !doc.enabled })}
      >
        {doc.enabled ? "Armed" : "Disarmed"}
      </button>
    </div>
  );
}

export default RuleMetaForm;
