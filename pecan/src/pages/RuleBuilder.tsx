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
import RuleMetaForm from "../components/rules/RuleMetaForm";
import SignalPalette from "../components/rules/SignalPalette";
import type { Condition, RuleDoc } from "../lib/wcars/engine/types";
import { getActiveDbcText } from "../utils/canProcessor";
import {
  createRule,
  fetchDbc,
  fetchRules,
  fetchSignals,
  getOmtBaseUrl,
  OmtError,
  setOmtBaseUrl,
} from "../utils/omtClient";
import type { RawSignal } from "../utils/omtClient";
import { validateRuleDoc } from "../utils/ruleValidate";
import { buildIndex, signalsFromDbcText } from "../utils/signalIndex";
import type { SignalIndex, SignalInfo } from "../utils/signalIndex";

type Connection =
  | { kind: "connected" }
  | { kind: "offline"; reason: string }
  | { kind: "mismatch"; carSha: string; localSha: string }
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
    if (localDbc) {
      const localSha = await sha256Hex(localDbc);
      // A rule written against a different DBC stores cleanly and then never
      // fires, so this is blocked rather than warned about.
      if (dbc.sha256 && dbc.sha256 !== localSha) {
        return { connection: { kind: "mismatch", carSha: dbc.sha256, localSha }, signals };
      }
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
  | { kind: "failed"; messages: string[] };

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
  const [carRuleCount, setCarRuleCount] = useState<number | null>(null);
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
      setCarRuleCount(null);
      return;
    }
    try {
      const rules = await fetchRules();
      if (probeToken.current === token) setCarRuleCount(rules.length);
    } catch {
      // The rule count is context, not a capability. A car that answered the
      // catalog but not this is still an authoring session worth having.
      if (probeToken.current === token) setCarRuleCount(null);
    }
  }, []);

  useEffect(() => {
    void runProbe();
  }, [runProbe]);

  const problems = useMemo(() => validateRuleDoc(doc, index), [doc, index]);

  const canSave = connection.kind === "connected" && problems.length === 0
    && saveState.kind !== "saving";

  const handleSave = async () => {
    setSaveState({ kind: "saving" });
    try {
      const saved = await createRule(doc, "pecan");
      setDoc(saved);
      setSaveState({ kind: "saved", name: saved.name });
      void runProbe();
    } catch (error) {
      // The car is authoritative on whether a rule is legal, so its own wording
      // is shown rather than being reworded into something that may not match.
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
          {carRuleCount !== null && (
            <span className="font-mono text-xs text-slate-400">
              {carRuleCount} rule{carRuleCount === 1 ? "" : "s"} on the car
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
            {saveState.kind === "saving" ? "Saving" : "Save to car"}
          </button>
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
          <ul data-testid="rule-save-error" className="space-y-1 text-xs text-amber-200">
            {saveState.messages.map((message) => <li key={message}>{message}</li>)}
          </ul>
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
    </div>
  );
}

export default RuleBuilder;
