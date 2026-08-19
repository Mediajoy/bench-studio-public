import React, { useEffect, useRef, useState } from "react";
import MenuSelect from "./MenuSelect.jsx";
import { normalizeSlug, displayName } from "./slug.js";

// Same shape as ClientSelect, one level deeper. Series is meaningless
// without a single scope — a series named "sunday-sermons" under one client
// is unrelated to the same name under another (server/db.mjs enforces this
// at the query level: listSeries/renameSeries both take a client, including
// the "__none__" Unassigned bucket). The caller (TopBar) is responsible for
// only rendering this once a single scope is active — a real client OR
// Unassigned — not "All clients", which has no scope to hang a series off.
export default function SeriesSelect({ value, series, onChange }) {
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
        placeholder="New series name…"
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

  const unassignedCount = series.find((s) => s.series === null)?.n ?? 0;
  const named = series.filter((s) => s.series !== null);

  // Same "pending new" synthesis as ClientSelect — a just-typed series has
  // zero generations yet, so it isn't in the fetched list.
  const isKnown = value === "" || value === "__none__" || named.some((s) => s.series === value);
  const pendingNew = !isKnown && value ? [{ value, label: `${displayName(value)} (new)` }] : [];

  const options = [
    { value: "", label: "All series" },
    ...(unassignedCount ? [{ value: "__none__", label: `No series (${unassignedCount})` }] : []),
    ...pendingNew,
    ...named.map((s) => ({ value: s.series, label: s.n > 0 ? `${displayName(s.series)} (${s.n})` : `${displayName(s.series)} (new)` })),
    { value: "__new__", label: "+ New series…" },
  ];

  return (
    <MenuSelect
      value={value}
      options={options}
      placeholder="All series"
      ariaLabel="Active series"
      className="client-select series-select"
      onChange={(next) => {
        if (next === "__new__") { setCreating(true); return; }
        onChange(next);
      }}
    />
  );
}
