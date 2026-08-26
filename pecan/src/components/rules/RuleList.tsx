/** The rules the car is currently holding. */
import type { RuleDoc } from "../../lib/wcars/engine/types";

export type StoredRule = RuleDoc & {
  rev: number;
  broken?: boolean;
  broken_reason?: string | null;
};

const SEVERITY_CLASS: Record<string, string> = {
  WARNING: "border-red-400/35 bg-red-500/10 text-red-100",
  CAUTION: "border-amber-400/35 bg-amber-500/10 text-amber-100",
  MEMO: "border-slate-400/30 bg-slate-500/10 text-slate-200",
};

/** A one-line reading of what the rule watches for, so the list can be checked
 * without opening every rule. */
export function summarize(rule: RuleDoc): string {
  const parts = rule.conditions.map((c) => `${c.signal} ${c.op} ${c.value}`);
  const body = parts.join(" and ");
  return rule.for_seconds > 0 ? `${body} held ${rule.for_seconds} s` : body;
}

interface RuleListProps {
  rules: StoredRule[];
  onEdit: (rule: StoredRule) => void;
  onToggle: (rule: StoredRule) => void;
  onDelete: (rule: StoredRule) => void;
}

function RuleList({ rules, onEdit, onToggle, onDelete }: RuleListProps) {
  if (rules.length === 0) {
    return (
      <p data-testid="rule-list-empty" className="text-sm text-slate-400">
        This car has no rules yet. Build one and save it.
      </p>
    );
  }
  return (
    <ul className="space-y-2">
      {rules.map((rule) => (
        <li
          key={rule.id}
          data-testid={`rule-row-${rule.id}`}
          className={`rounded border p-3 ${SEVERITY_CLASS[rule.severity] ?? SEVERITY_CLASS.MEMO}`}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs uppercase tracking-wide">{rule.severity}</span>
            <span className="text-sm">{rule.name}</span>
            {!rule.enabled && (
              <span className="rounded border border-white/20 px-2 py-0.5 font-mono text-[10px] uppercase text-slate-300">
                Disarmed
              </span>
            )}
          </div>
          <p className="mt-1 font-mono text-xs text-slate-300">{summarize(rule)}</p>
          {rule.broken && (
            // A broken rule is stored but not evaluated, which is invisible
            // unless the reason is put in front of the person who wrote it.
            <p data-testid={`rule-broken-${rule.id}`} className="mt-1 text-xs text-amber-200">
              Not being evaluated: {rule.broken_reason ?? "the car could not build this rule."}
            </p>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" data-testid={`rule-edit-${rule.id}`}
              className="trace-btn trace-btn-subtle min-h-[44px]" onClick={() => onEdit(rule)}>
              Edit
            </button>
            <button type="button" data-testid={`rule-toggle-${rule.id}`}
              className="trace-btn trace-btn-subtle min-h-[44px]" onClick={() => onToggle(rule)}>
              {rule.enabled ? "Disarm" : "Arm"}
            </button>
            <button type="button" data-testid={`rule-delete-${rule.id}`}
              className="trace-btn trace-btn-subtle min-h-[44px]" onClick={() => onDelete(rule)}>
              Delete
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}

export default RuleList;
