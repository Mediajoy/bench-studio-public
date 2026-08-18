// deprecation.mjs — PRD v5 Phase 3: refuse a generate call cleanly once a
// model's `deprecated_after` date has passed, rather than letting it fail
// opaquely at fal (or, worse, silently keep working past a vendor shutdown
// date until it doesn't). Pure function, no I/O — see tests/deprecation.test.mjs.
//
// No roster entry currently sets deprecated_after (see build_registry.mjs's
// ROSTER) — this exists as the mechanism for when one needs to (the PRD's
// running example is Sora 2's 2026-09-24 API shutdown, which isn't in
// Bench's roster today since Kie proxies it, not fal directly).

export function checkDeprecation(model, now = new Date()) {
  if (!model?.deprecated_after) return { deprecated: false };
  const cutoff = new Date(model.deprecated_after);
  if (Number.isNaN(cutoff.getTime())) return { deprecated: false };
  if (now >= cutoff) {
    return {
      deprecated: true,
      reason: `deprecated after ${model.deprecated_after}`,
    };
  }
  return { deprecated: false };
}
