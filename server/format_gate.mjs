// format_gate.mjs — PRD v5 Phase 3: refuse an unsupported aspect ratio,
// duration, resolution, or image_size with the supported list, instead of
// letting it pass through to fal for a 422, or (worse) silently substituting
// a default. Pure functions, no I/O, so this is unit-testable without a
// live server or network call — see tests/format-gate.test.mjs.

// The scalar fields worth enum/range-checking before submit. Everything else
// in `params` passes through untouched (matches build_registry.mjs's SURFACE
// set — these are the fields fal actually documents as constrained).
const CHECKED_FIELDS = ["aspect_ratio", "duration", "resolution", "image_size"];

export function validateParams(model, params) {
  const specs = model?.params ?? {};
  for (const field of CHECKED_FIELDS) {
    if (!(field in params)) continue;
    const spec = specs[field];
    if (!spec) continue; // model doesn't surface this field at all — nothing to check against
    const value = params[field];

    if (spec.enum && !spec.enum.includes(value)) {
      return {
        ok: false,
        field,
        error: `${model.label} does not support ${field}="${value}". Supported: ${spec.enum.join(", ")}.`,
        supported: spec.enum,
      };
    }
    if (typeof value === "number") {
      if (spec.min !== undefined && value < spec.min) {
        return { ok: false, field, error: `${model.label}'s ${field} must be >= ${spec.min} (got ${value}).`, supported: { min: spec.min, max: spec.max } };
      }
      if (spec.max !== undefined && value > spec.max) {
        return { ok: false, field, error: `${model.label}'s ${field} must be <= ${spec.max} (got ${value}).`, supported: { min: spec.min, max: spec.max } };
      }
    }
  }
  return { ok: true };
}
