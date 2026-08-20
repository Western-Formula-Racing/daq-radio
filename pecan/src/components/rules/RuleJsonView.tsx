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

/** Structural equality for plain JSON values, insensitive to key order.
 *
 * JSON.stringify is not usable here: a parent that rebuilds the rule field by
 * field returns identical content under a different key order, which must still
 * count as the same document.
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, index) => deepEqual(item, b[index]));
  }
  if (typeof a !== "object") return false;
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every((key) => key in right && deepEqual(left[key], right[key]));
}

function parseDoc(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function RuleJsonView({ doc, onChange }: RuleJsonViewProps) {
  const [text, setText] = useState(() => JSON.stringify(doc, null, 2));
  const [error, setError] = useState<string | null>(null);
  // The effect below reads the current text but must not re-run on every keystroke,
  // so it goes through a ref rather than a dependency that would fire mid-typing.
  const textRef = useRef(text);
  const lastDoc = useRef(doc);

  const applyText = (raw: string) => {
    textRef.current = raw;
    setText(raw);
  };

  useEffect(() => {
    // The guard is derived from content, not from remembering which side emitted
    // last. An emission flag has to be cleared on some render, and any re-render
    // that lands between an edit and its echo either clears the flag early or
    // leaves a second, faster edit compared against the first edit's echo; either
    // way the stale document gets re-serialized over what the user is typing.
    // Content answers the same question without depending on render timing: the
    // text needs rewriting only when the incoming document is genuinely new AND
    // is not already what the text on screen says.
    if (deepEqual(doc, lastDoc.current)) return;
    lastDoc.current = doc;
    if (deepEqual(doc, parseDoc(textRef.current))) return;
    applyText(JSON.stringify(doc, null, 2));
    setError(null);
  }, [doc]);

  const handle = (raw: string) => {
    // The text is kept whatever happens: discarding a half-typed edit because it
    // does not parse yet would throw away the user's work mid-keystroke.
    applyText(raw);
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
