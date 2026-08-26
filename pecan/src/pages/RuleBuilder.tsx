/** Authoring one of the car's fault rules, without touching code.
 *
 * The page's real subject is where the signal catalog came from. A rule is only
 * meaningful against the DBC the car is actually running, so the shell probes
 * OMT first and every affordance below follows from what that probe found.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CircleSlash, Wifi, WifiOff } from "lucide-react";

import ConditionSlots from "../components/rules/ConditionSlots";
import RuleJsonView from "../components/rules/RuleJsonView";
import RuleList from "../components/rules/RuleList";
import type { StoredRule } from "../components/rules/RuleList";
import RuleMetaForm from "../components/rules/RuleMetaForm";
import SignalPalette from "../components/rules/SignalPalette";
import type { Condition, RuleDoc } from "../lib/wcars/engine/types";
import { getActiveDbcText } from "../utils/canProcessor";
import {
  createRule,
  deleteRule,
  fetchDbc,
  fetchRules,
  fetchSignals,
  getOmtBaseUrl,
  OmtError,
  setOmtBaseUrl,
  toggleRule,
  updateRule,
} from "../utils/omtClient";
import type { RawSignal } from "../utils/omtClient";
import { validateRuleDoc } from "../utils/ruleValidate";
import { buildIndex, signalsFromDbcText } from "../utils/signalIndex";
import type { SignalIndex, SignalInfo } from "../utils/signalIndex";

type Connection =
  | { kind: "connected" }
  | { kind: "offline"; reason: string }
  | { kind: "mismatch"; carSha: string; localSha: string }
  | { kind: "unverified"; reason: string }
  | { kind: "no-catalog" };

const EMPTY_DOC: RuleDoc = {
  id: "", name: "", enabled: true, severity: "WARNING", message: "",
  conditions: [], for_seconds: 0, rearm_seconds: 0,
};

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function probe(localDbc: string): Promise<{ connection: Connection; signals: RawSignal[] }> {
  try {
    const [signals, dbc] = await Promise.all([fetchSignals(), fetchDbc()]);
    // With no local DBC there is nothing to disagree with: the catalog below is
    // the car's own, so a rule written on it is written against what is running.
    if (!localDbc) return { connection: { kind: "connected" }, signals };
    let localSha: string;
    let carSha: string;
    try {
      // An OMT that does not send the digest header, or a proxy that strips it,
      // must not read as agreement. Falling back to hashing the body the car
      // served keeps the comparison ours to make.
      [localSha, carSha] = await Promise.all([
        sha256Hex(localDbc),
        dbc.sha256 ? Promise.resolve(dbc.sha256) : sha256Hex(dbc.text),
      ]);
    } catch (error) {
      // crypto.subtle is absent outside a secure context, which is exactly the
      // plain-http pit stop this page is used from. Say the identity is unknown
      // instead of claiming a match nobody checked.
      const reason = error instanceof Error ? error.message : String(error);
      return { connection: { kind: "unverified", reason }, signals };
    }
    // A rule written against a different DBC stores cleanly and then never
    // fires, so this is blocked rather than warned about.
    if (carSha !== localSha) {
      return { connection: { kind: "mismatch", carSha, localSha }, signals };
    }
    return { connection: { kind: "connected" }, signals };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (!localDbc) return { connection: { kind: "no-catalog" }, signals: [] };
    return { connection: { kind: "offline", reason }, signals: signalsFromDbcText(localDbc) };
  }
}

/** Enough of a digest to tell two DBCs apart by eye without filling the line. */
const shortSha = (sha: string) => sha.slice(0, 12);

type Tab = "palette" | "build" | "json";

const TABS: { id: Tab; label: string }[] = [
  { id: "palette", label: "Palette" },
  { id: "build", label: "Build" },
  { id: "json", label: "JSON" },
];

type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; name: string }
  | { kind: "failed"; messages: string[] }
  | { kind: "conflict" };

/** The rev and the car's verdict on the rule belong to the car, not to the
 * document being edited, so they are dropped before it is sent back. */
function editableCopy(rule: StoredRule): RuleDoc {
  return {
    id: rule.id,
    name: rule.name,
    enabled: rule.enabled,
    severity: rule.severity,
    message: rule.message,
    // Copied, not shared: editing a condition here must not reach back into the
    // list still showing what the car holds.
    conditions: rule.conditions.map((condition) => ({ ...condition })),
    for_seconds: rule.for_seconds,
    rearm_seconds: rule.rearm_seconds,
  };
}

function exportRule(doc: RuleDoc): void {
  // An array, because that is what the replay page's importer reads and what a
  // rules file holds; a bare object would need unwrapping by hand.
  const blob = new Blob([JSON.stringify([doc], null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  const slug = doc.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  link.download = `${slug || "rule"}.rules.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function RuleBuilder() {
  const [doc, setDoc] = useState<RuleDoc>(EMPTY_DOC);
  const [armed, setArmed] = useState<SignalInfo | null>(null);
  const [index, setIndex] = useState<SignalIndex | null>(null);
  const [connection, setConnection] = useState<Connection>({ kind: "no-catalog" });
  const [probing, setProbing] = useState(true);
  const [rules, setRules] = useState<StoredRule[] | null>(null);
  // Which stored rule the form is editing, and at which rev. Null means the
  // next save creates a rule rather than replacing one.
  const [editing, setEditing] = useState<StoredRule | null>(null);
  const [url, setUrl] = useState(() => getOmtBaseUrl());
  const [tab, setTab] = useState<Tab>("palette");
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });

  // A slow probe that is superseded by a Reconnect must not land on top of the
  // newer answer, so each run carries a token and only the latest one is kept.
  const probeToken = useRef(0);

  const runProbe = useCallback(async () => {
    const token = ++probeToken.current;
    setProbing(true);
    const result = await probe(getActiveDbcText());
    if (probeToken.current !== token) return;
    setConnection(result.connection);
    setIndex(result.connection.kind === "no-catalog" ? null : buildIndex(result.signals));
    setProbing(false);
    if (result.connection.kind === "no-catalog" || result.connection.kind === "offline") {
      setRules(null);
      return;
    }
    try {
      const stored = await fetchRules() as StoredRule[];
      if (probeToken.current === token) setRules(stored);
    } catch {
      // The rule list is context, not a capability. A car that answered the
      // catalog but not this is still an authoring session worth having.
      if (probeToken.current === token) setRules(null);
    }
  }, []);

  useEffect(() => {
    void runProbe();
  }, [runProbe]);

  const problems = useMemo(() => validateRuleDoc(doc, index), [doc, index]);

  // While a probe is in flight the verdict on screen belongs to the previous
  // address, so a save started here would go to a car nobody has checked yet.
  const canSave = connection.kind === "connected" && !probing && problems.length === 0
    && saveState.kind !== "saving";

  /** Takes the car's answer as the new truth, so a second save carries the rev
   * the car just minted rather than the one it has already superseded. */
  const adoptSaved = (saved: RuleDoc) => {
    setDoc(saved);
    const stored = saved as StoredRule;
    // Guessing a rev would either overwrite someone else's edit or, if editing
    // were dropped instead, save a second copy of the same rule.
    setEditing(typeof stored.rev === "number" ? stored : editing);
  };

  const handleSave = async () => {
    setSaveState({ kind: "saving" });
    try {
      const saved = editing === null
        ? await createRule(doc, "pecan")
        : await updateRule(editing.id, doc, editing.rev, "pecan");
      adoptSaved(saved);
      setSaveState({ kind: "saved", name: saved.name });
      void runProbe();
    } catch (error) {
      if (!(error instanceof OmtError)) {
        setSaveState({
          kind: "failed",
          messages: [error instanceof Error ? error.message : String(error)],
        });
        return;
      }
      if (error.status === 409) {
        setSaveState({ kind: "conflict" });
        return;
      }
      // The car is authoritative on whether a rule is legal, so its own wording
      // is shown rather than being reworded into something that may not match.
      setSaveState({
        kind: "failed",
        messages: error.status === 503
          // Saying only "failed" here would leave someone believing the rule is
          // armed on the car when the car never received it.
          ? [...error.messages, "The rule was not stored and the car is not checking it."]
          : error.messages,
      });
    }
  };

  const handleEdit = (rule: StoredRule) => {
    setEditing(rule);
    setDoc(editableCopy(rule));
    setArmed(null);
    setSaveState({ kind: "idle" });
    setTab("build");
  };

  const handleNew = () => {
    setEditing(null);
    setDoc(EMPTY_DOC);
    setArmed(null);
    setSaveState({ kind: "idle" });
  };

  /** Pulls the car's copy back over the form after a conflict, which is the
   * point of refusing the write: the other person's edit is not thrown away. */
  const handleReload = async () => {
    try {
      const stored = await fetchRules() as StoredRule[];
      setRules(stored);
      const fresh = editing === null ? undefined : stored.find((r) => r.id === editing.id);
      if (fresh) handleEdit(fresh);
      else handleNew();
    } catch (error) {
      setSaveState({
        kind: "failed",
        messages: [error instanceof Error ? error.message : String(error)],
      });
    }
  };

  const handleToggle = async (rule: StoredRule) => {
    try {
      await toggleRule(rule.id, !rule.enabled, "pecan");
      void runProbe();
    } catch (error) {
      setSaveState({
        kind: "failed",
        messages: error instanceof OmtError
          ? error.messages
          : [error instanceof Error ? error.message : String(error)],
      });
    }
  };

  const handleDelete = async (rule: StoredRule) => {
    // Deleting a rule silently disarms a check the team may be relying on, and
    // the rows sit under a thumb on a tablet.
    if (!window.confirm(`Delete '${rule.name}'? The car will stop checking it.`)) return;
    try {
      await deleteRule(rule.id);
      if (editing?.id === rule.id) handleNew();
      void runProbe();
    } catch (error) {
      setSaveState({
        kind: "failed",
        messages: error instanceof OmtError
          ? error.messages
          : [error instanceof Error ? error.message : String(error)],
      });
    }
  };

  const handleUrlBlur = () => {
    setOmtBaseUrl(url);
    void runProbe();
  };

  const setConditions = (next: Condition[]) => setDoc((prev) => ({ ...prev, conditions: next }));

  const chip = probing
    ? { label: "Checking", Icon: Wifi, className: "border-white/20 bg-black/30 text-slate-300" }
    : connection.kind === "connected"
      ? { label: "Connected", Icon: Wifi, className: "border-emerald-400/50 bg-emerald-500/15 text-emerald-100" }
      : connection.kind === "offline"
        ? { label: "Offline", Icon: WifiOff, className: "border-amber-400/50 bg-amber-500/15 text-amber-100" }
        : connection.kind === "mismatch"
          ? { label: "Different DBC", Icon: AlertTriangle, className: "border-red-400/50 bg-red-500/15 text-red-100" }
          : connection.kind === "unverified"
            ? { label: "Unverified DBC", Icon: AlertTriangle, className: "border-red-400/50 bg-red-500/15 text-red-100" }
            : { label: "No signals", Icon: CircleSlash, className: "border-red-400/50 bg-red-500/15 text-red-100" };

  const paletteEmptyReason = probing
    ? "Looking for the car."
    : "PECAN has no DBC loaded and the car is not reachable, so there is nothing "
      + "to write a rule against. Load a DBC on the dashboard, or put this tablet "
      + "on the car's network and reconnect.";

  // Below lg the panes share one column, so only the chosen one is shown. It is
  // hidden with CSS rather than unmounted: the JSON box holds half-typed text
  // that switching tabs must not throw away, and a JS media query would be a
  // second copy of the breakpoint to keep in step with this class.
  const paneClass = (name: Tab) => `${tab === name ? "block" : "hidden"} lg:block`;

  const disabled = connection.kind === "no-catalog";
  const panelClass = "rounded-lg border border-white/10 bg-data-module-bg p-4";

  return (
    <div className="min-h-full p-4 text-slate-200">
      <header className="mb-4 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="app-section-title">Rule Builder</h1>
          <span
            data-testid="omt-connection"
            className={`flex min-h-[44px] items-center gap-2 rounded border px-3 font-mono text-xs uppercase tracking-wide ${chip.className}`}
          >
            <chip.Icon size={16} aria-hidden="true" />
            {chip.label}
          </span>
          {rules !== null && (
            <span className="font-mono text-xs text-slate-400">
              {rules.length} rule{rules.length === 1 ? "" : "s"} on the car
            </span>
          )}
          {editing !== null && (
            <span data-testid="editing-notice" className="font-mono text-xs text-cyan-200">
              Editing '{editing.name}' (rev {editing.rev})
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[16rem] flex-1">
            <label className="block font-mono text-[10px] uppercase tracking-wide text-slate-400" htmlFor="omt-url">
              OMT address
            </label>
            <input
              id="omt-url"
              data-testid="omt-url"
              className="min-h-[44px] w-full rounded border border-white/20 bg-black/30 px-3 text-sm text-slate-100"
              value={url}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              placeholder="http://car.local:9090"
              onChange={(event) => setUrl(event.target.value)}
              onBlur={handleUrlBlur}
            />
          </div>
          <button
            type="button"
            data-testid="omt-reconnect"
            className="trace-btn trace-btn-subtle min-h-[44px]"
            onClick={() => void runProbe()}
          >
            Reconnect
          </button>
        </div>

        {connection.kind === "mismatch" && (
          <p
            data-testid="dbc-mismatch-notice"
            className={`${panelClass} text-sm text-red-100`}
          >
            The car is running a different DBC from the one PECAN has loaded. Car:{" "}
            <span className="font-mono">{shortSha(connection.carSha)}</span>. PECAN:{" "}
            <span className="font-mono">{shortSha(connection.localSha)}</span>. Saving is blocked,
            because a rule written against the wrong DBC saves without complaint and then never
            fires on the car. Load the car's DBC in PECAN, or reflash the car, then reconnect.
          </p>
        )}

        {connection.kind === "unverified" && (
          <p data-testid="dbc-unverified-notice" className={`${panelClass} text-sm text-red-100`}>
            The car answered, but PECAN could not check that it is running the same DBC (
            {connection.reason}). Saving is blocked rather than risking a rule that stores fine and
            never fires. Open PECAN over https, or export the rule and import it on the car.
          </p>
        )}

        {connection.kind === "offline" && (
          <p data-testid="omt-offline-notice" className={`${panelClass} text-sm text-amber-100`}>
            The car did not answer ({connection.reason}), so these signals come from the DBC PECAN
            has loaded. Everything here still works except saving to the car. Export the rule and
            import it when you are back on the car's network.
          </p>
        )}

        {connection.kind === "no-catalog" && !probing && (
          <p data-testid="no-catalog-notice" className={`${panelClass} text-sm text-red-100`}>
            There is no signal catalog: the car is not reachable and PECAN has no DBC loaded. The
            builder stays disabled until one of those is fixed.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            data-testid="rule-save"
            disabled={!canSave}
            className="trace-btn trace-btn-primary min-h-[44px] disabled:cursor-not-allowed disabled:opacity-40"
            onClick={() => void handleSave()}
          >
            {saveState.kind === "saving"
              ? "Saving"
              : editing === null ? "Save to car" : "Update on car"}
          </button>
          {editing !== null && (
            <button
              type="button"
              data-testid="rule-new"
              className="trace-btn trace-btn-subtle min-h-[44px]"
              onClick={handleNew}
            >
              New rule
            </button>
          )}
          <button
            type="button"
            data-testid="rule-export"
            className="trace-btn trace-btn-subtle min-h-[44px]"
            onClick={() => exportRule(doc)}
          >
            Export JSON
          </button>
          <span data-testid="rule-save-state" className="text-xs text-slate-400">
            {saveState.kind === "saved"
              ? `Saved '${saveState.name}' to the car.`
              : connection.kind !== "connected"
                ? "Saving needs a reachable car running this DBC. Export instead."
                : problems.length > 0
                  ? `${problems.length} thing${problems.length === 1 ? "" : "s"} to fix before this can be saved.`
                  : "Ready to save."}
          </span>
        </div>

        {saveState.kind === "failed" && (
          <ul data-testid="save-problems" className="space-y-1 text-xs text-amber-200">
            {saveState.messages.map((message) => <li key={message}>{message}</li>)}
          </ul>
        )}

        {saveState.kind === "conflict" && (
          <div data-testid="save-conflict" className={`${panelClass} space-y-2 text-sm text-amber-100`}>
            <p>
              Someone else changed this rule on the car since it was opened here. Saving would
              throw their edit away, so it was refused. Load the car's copy and redo the change on
              top of it.
            </p>
            <button
              type="button"
              data-testid="save-conflict-reload"
              className="trace-btn trace-btn-subtle min-h-[44px]"
              onClick={() => void handleReload()}
            >
              Load the car's copy
            </button>
          </div>
        )}
      </header>

      <div role="tablist" aria-label="Rule builder panes" className="mb-3 flex gap-2 lg:hidden">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`builder-tab-${id}`}
            data-testid={`builder-tab-${id}`}
            aria-selected={tab === id}
            aria-controls={`builder-pane-${id}`}
            className={`min-h-[44px] flex-1 rounded border px-3 font-mono text-xs uppercase tracking-wide ${
              tab === id
                ? "border-cyan-400/60 bg-cyan-500/15 text-cyan-100"
                : "border-white/15 bg-black/20 text-slate-400"
            }`}
            onClick={() => setTab(id)}
          >
            {tab === id ? `▸ ${label}` : label}
          </button>
        ))}
      </div>

      <div className="lg:grid lg:grid-cols-[280px_minmax(0,1fr)_360px] lg:gap-4 lg:items-start">
        <div id="builder-pane-palette" role="tabpanel" aria-labelledby="builder-tab-palette" className={paneClass("palette")}>
          <SignalPalette
            index={index}
            armed={armed}
            onArm={setArmed}
            emptyReason={paletteEmptyReason}
          />
        </div>

        <div id="builder-pane-build" role="tabpanel" aria-labelledby="builder-tab-build" className={paneClass("build")}>
          <fieldset disabled={disabled} className={`${panelClass} space-y-4`}>
            <legend className="sr-only">Rule</legend>
            <h2 className="app-section-title">Rule</h2>
            <RuleMetaForm doc={doc} problems={problems} onChange={setDoc} />
            <div>
              <h3 className="app-section-title mb-2">Conditions</h3>
              <ConditionSlots
                conditions={doc.conditions}
                index={index}
                armed={armed}
                problems={problems}
                onChange={setConditions}
                // One tap places one condition; leaving the signal armed would
                // fill the next slot too on the following tap.
                onPlaced={() => setArmed(null)}
              />
            </div>
          </fieldset>
        </div>

        <div id="builder-pane-json" role="tabpanel" aria-labelledby="builder-tab-json" className={paneClass("json")}>
          <RuleJsonView doc={doc} onChange={setDoc} />
        </div>
      </div>

      {rules !== null && (
        <section className={`${panelClass} mt-4`}>
          <h2 className="app-section-title mb-2">On the car</h2>
          <RuleList
            rules={rules}
            onEdit={handleEdit}
            onToggle={(rule) => void handleToggle(rule)}
            onDelete={(rule) => void handleDelete(rule)}
          />
        </section>
      )}
    </div>
  );
}

export default RuleBuilder;
