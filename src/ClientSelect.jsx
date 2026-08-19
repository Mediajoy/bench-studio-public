import React, { useEffect, useRef, useState } from "react";
import MenuSelect from "./MenuSelect.jsx";
import { normalizeSlug, displayName } from "./slug.js";

// MenuSelect takes flat {value,label} options and has no free-text input —
// this wraps it with "All clients" / "Unassigned" / each known client /
// "+ New client…", and swaps the trigger for an inline text input when the
// last one is chosen. Kept separate from MenuSelect so its keyboard-nav
// logic doesn't need to grow a text-entry mode.

export default function ClientSelect({ value, clients, onChange }) {
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef(null);

  useEffect(() => {
    if (creating) inputRef.current?.focus();
  }, [creating]);

  if (creating) {
    return (
      <input
        ref={inputRef}
        className="client-select-new"
        type="text"
        placeholder="New client name…"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            const slug = normalizeSlug(draft);
            if (slug) onChange(slug);
            setCreating(false);
            setDraft("");
          } else if (event.key === "Escape") {
            setCreating(false);
            setDraft("");
          }
        }}
        onBlur={() => { setCreating(false); setDraft(""); }}
      />
    );
  }

  const unassignedCount = clients.find((c) => c.client === null)?.n ?? 0;
  const named = clients.filter((c) => c.client !== null);

  // A client just typed via "+ New client…" has zero generations yet, so it
  // isn't in the fetched list — without this, MenuSelect can't find a
  // matching option for the active value and silently falls back to showing
  // "All clients" in the trigger, even though the right client is actually
  // selected (confirmed by the "will be saved as Unassigned" note correctly
  // disappearing). Synthesize a (0)-count entry so the trigger reflects
  // reality until the first generation lands and it appears for real.
  const isKnown = value === "" || value === "__none__" || named.some((c) => c.client === value);
  const pendingNew = !isKnown && value ? [{ value, label: `${displayName(value)} (new)` }] : [];

  const options = [
    { value: "", label: "All clients" },
    ...(unassignedCount ? [{ value: "__none__", label: `Unassigned (${unassignedCount})` }] : []),
    ...pendingNew,
    ...named.map((c) => ({ value: c.client, label: `${displayName(c.client)} (${c.n})` })),
    { value: "__new__", label: "+ New client…" },
  ];

  return (
    <MenuSelect
      value={value}
      options={options}
      placeholder="All clients"
      ariaLabel="Active client"
      className="client-select"
      onChange={(next) => {
        if (next === "__new__") { setCreating(true); return; }
        onChange(next);
      }}
    />
  );
}
