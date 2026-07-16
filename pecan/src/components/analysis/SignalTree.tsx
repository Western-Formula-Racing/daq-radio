import { useMemo, useState } from "react";
import type { GroupedSensors, SensorMessageGroup } from "../../types/analysis";

interface SignalTreeProps {
  grouped: GroupedSensors;
  selected: Set<string>;
  onToggle: (signal: string) => void;
}

const UNGROUPED_KEY = "__ungrouped__";

export default function SignalTree({ grouped, selected, onToggle }: SignalTreeProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return grouped;

    const messages: SensorMessageGroup[] = [];
    for (const msg of grouped.messages) {
      const hits = msg.name.toLowerCase().includes(q)
        ? msg.signals
        : msg.signals.filter((s) => s.toLowerCase().includes(q));
      if (hits.length) messages.push({ ...msg, signals: hits });
    }
    const ungrouped = grouped.ungrouped.filter((s) => s.toLowerCase().includes(q));
    return { messages, ungrouped };
  }, [grouped, query]);

  const toggleOpen = (msg: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(msg)) next.delete(msg);
      else next.add(msg);
      return next;
    });

  const forceOpen = query.trim() !== "";

  return (
    <div className="flex min-h-0 flex-col gap-2">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search messages or signals"
        className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm"
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {filtered.messages.map((msg) => {
          const expanded = open.has(msg.name) || forceOpen;
          return (
            <div key={msg.name}>
              <button
                onClick={() => toggleOpen(msg.name)}
                className="flex w-full items-center gap-1 px-1 py-1 text-left text-xs font-medium text-zinc-300 hover:bg-zinc-800"
              >
                <span className="text-zinc-500">{expanded ? "▾" : "▸"}</span>
                {msg.name}
                <span className="ml-auto text-zinc-600">{msg.signals.length}</span>
              </button>
              {expanded &&
                msg.signals.map((sig) => (
                  <label
                    key={sig}
                    className="flex cursor-pointer items-center gap-2 py-0.5 pl-6 pr-2 text-xs text-zinc-400 hover:bg-zinc-800"
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(sig)}
                      onChange={() => onToggle(sig)}
                      className="accent-purple-500"
                    />
                    {sig}
                  </label>
                ))}
            </div>
          );
        })}
        {filtered.ungrouped.length > 0 && (
          <div>
            <button
              onClick={() => toggleOpen(UNGROUPED_KEY)}
              className="flex w-full items-center gap-1 px-1 py-1 text-left text-xs font-medium text-zinc-300 hover:bg-zinc-800"
            >
              <span className="text-zinc-500">
                {open.has(UNGROUPED_KEY) || forceOpen ? "▾" : "▸"}
              </span>
              Ungrouped
              <span className="ml-auto text-zinc-600">{filtered.ungrouped.length}</span>
            </button>
            {(open.has(UNGROUPED_KEY) || forceOpen) &&
              filtered.ungrouped.map((sig) => (
                <label
                  key={sig}
                  className="flex cursor-pointer items-center gap-2 py-0.5 pl-6 pr-2 text-xs text-zinc-400 hover:bg-zinc-800"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(sig)}
                    onChange={() => onToggle(sig)}
                    className="accent-purple-500"
                  />
                  {sig}
                </label>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}
