/** The rule as editable JSON, kept in step with the builder both ways.
 *
 * This is the structured-text path. It is the document itself rather than a
 * separate syntax, so there is no grammar to maintain in two runtimes and the
 * text pastes straight into the rules file the replay page imports.
 */
import { useEffect, useRef, useState } from "react";

import type { RuleDoc } from "../../lib/wcars/engine/types";

interface RuleJsonViewProps {
  doc: RuleDoc;
  onChange: (next: RuleDoc) => void;
}

function RuleJsonView({ doc, onChange }: RuleJsonViewProps) {
  const [text, setText] = useState(() => JSON.stringify(doc, null, 2));
  const [error, setError] = useState<string | null>(null);
  // Tracks the doc value this view last emitted, so a parent echo of that same
  // change does not stomp the text the user may already be typing past it.
  const emitted = useRef<RuleDoc | null>(null);

  useEffect(() => {
    // A parent echo of the exact doc we just emitted is not a builder change; skip
    // it so it cannot overwrite text the user has since kept typing. Any other doc,
    // including one that merely resembles an earlier emission, must go to screen.
    if (emitted.current !== null && JSON.stringify(emitted.current) === JSON.stringify(doc)) {
      emitted.current = null;
      return;
    }
    setText(JSON.stringify(doc, null, 2));
    setError(null);
    emitted.current = null;
  }, [doc]);

  const handle = (raw: string) => {
    // The text is kept whatever happens: discarding a half-typed edit because it
    // does not parse yet would throw away the user's work mid-keystroke.
    setText(raw);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      setError("That is not valid JSON yet.");
      return;
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      setError("This box holds one rule, written as a JSON object.");
      return;
    }
    setError(null);
    emitted.current = parsed as RuleDoc;
    onChange(parsed as RuleDoc);
  };

  return (
    <div className="rounded-lg border border-white/10 bg-data-module-bg p-4">
      <h2 className="app-section-title mb-2">Rule JSON</h2>
      <textarea
        data-testid="rule-json"
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        className="h-72 w-full rounded border border-white/20 bg-black/40 p-3 font-mono text-xs text-slate-100"
        value={text}
        onChange={(event) => handle(event.target.value)}
      />
      {error !== null && (
        <p data-testid="rule-json-error" className="mt-2 text-xs text-amber-200">
          {error} The builder is still showing the last version that worked.
        </p>
      )}
    </div>
  );
}

export default RuleJsonView;
