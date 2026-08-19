// Shared by ClientSelect.jsx and SeriesSelect.jsx. Mirrors server/db.mjs's
// normalizeSlug exactly — duplicated rather than shared across the
// Node/browser boundary, since it's small and pure. Keeps a freshly-typed
// "Grace Church" matching the slug the server will store it as, so a
// dropdown's selected state doesn't go stale the moment the fetched list
// comes back with "grace-church" instead.
export function normalizeSlug(value) {
  if (!value) return null;
  const slug = String(value)
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
  return slug || null;
}

export function displayName(slug, emptyLabel = "Unassigned") {
  if (!slug) return emptyLabel;
  return slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
