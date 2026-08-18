// PRD v5 Phase 3 — registry auto-refresh, format gate, schema grounding.
// Pure-function tests only; no network, no live server, no SQLite.
import test from "node:test";
import assert from "node:assert/strict";
import { PROHIBITED_LICENSES, buildDiffReport } from "../server/build_registry.mjs";
import { validateParams } from "../server/format_gate.mjs";
import { checkDeprecation } from "../server/deprecation.mjs";
import { findStaleUsedModels } from "../server/check_freshness.mjs";

test("every currently-registered license is permitted; prohibited licenses are a real, checkable set", () => {
  // Mirrors the vocabulary in shot-builder/providers/av_models.json (PRD v5 §1.1).
  assert.ok(PROHIBITED_LICENSES.has("non-commercial"));
  assert.ok(PROHIBITED_LICENSES.has("research-only"));
  assert.ok(!PROHIBITED_LICENSES.has("proprietary-api"));
});

test("format gate refuses an unsupported aspect_ratio with the supported list, field-level, before any API call", () => {
  const model = { label: "Test Model", params: { aspect_ratio: { enum: ["16:9", "9:16", "1:1"] } } };
  const result = validateParams(model, { aspect_ratio: "2.39:1" });
  assert.equal(result.ok, false);
  assert.equal(result.field, "aspect_ratio");
  assert.deepEqual(result.supported, ["16:9", "9:16", "1:1"]);
  assert.match(result.error, /2\.39:1/);
});

test("format gate refuses a duration outside min/max range", () => {
  const model = { label: "Test Model", params: { duration: { min: 4, max: 12 } } };
  assert.equal(validateParams(model, { duration: 30 }).ok, false);
  assert.equal(validateParams(model, { duration: 8 }).ok, true);
});

test("format gate passes through fields the model doesn't surface at all, and valid values", () => {
  const model = { label: "Test Model", params: { aspect_ratio: { enum: ["16:9"] } } };
  assert.equal(validateParams(model, { aspect_ratio: "16:9" }).ok, true);
  assert.equal(validateParams(model, { some_other_field: "anything" }).ok, true);
  assert.equal(validateParams(model, {}).ok, true);
});

test("deprecated_after refuses clearly on a backdated test entry, and passes for a future date", () => {
  const now = new Date("2026-08-18T00:00:00Z");
  const deprecated = { label: "Old Model", deprecated_after: "2026-01-01T00:00:00Z" };
  const stillLive = { label: "Live Model", deprecated_after: "2099-01-01T00:00:00Z" };
  const undated = { label: "No Date Model", deprecated_after: null };

  const result = checkDeprecation(deprecated, now);
  assert.equal(result.deprecated, true);
  assert.match(result.reason, /2026-01-01/);
  assert.equal(checkDeprecation(stillLive, now).deprecated, false);
  assert.equal(checkDeprecation(undated, now).deprecated, false);
});

test("last_verified staleness flag fires for a recently-used model with a backdated schema, and stays quiet otherwise", () => {
  const now = new Date("2026-08-18T00:00:00Z");
  const registry = {
    models: [
      { id: "stale-model", label: "Stale", last_verified: "2026-06-01T00:00:00Z" }, // >30 days old
      { id: "fresh-model", label: "Fresh", last_verified: "2026-08-15T00:00:00Z" }, // recent
      { id: "unused-stale-model", label: "Unused Stale", last_verified: "2026-01-01T00:00:00Z" }, // stale but never used
    ],
  };
  const usedModelIds = ["stale-model", "fresh-model"]; // unused-stale-model deliberately not "used"

  const stale = findStaleUsedModels(registry, usedModelIds, { staleDays: 30, now });
  assert.equal(stale.length, 1);
  assert.equal(stale[0].model_id, "stale-model");
  assert.ok(stale[0].days_stale >= 30);
});

test("diff report is idempotent on a no-change run, and reports added/removed/changed correctly", () => {
  const v1 = {
    generated_at: "2026-08-17T00:00:00Z",
    models: [
      { id: "a", label: "A", license: "proprietary-api", last_verified: "2026-08-17T00:00:00Z", thumbnail: "x" },
      { id: "b", label: "B", license: "proprietary-api", last_verified: "2026-08-17T00:00:00Z", thumbnail: "x" },
    ],
  };
  // Same content, but a later run's timestamps changed (last_verified/thumbnail
  // are excluded from the diffable subset) — must report zero changes.
  const v2Unchanged = {
    generated_at: "2026-08-18T00:00:00Z",
    models: [
      { id: "a", label: "A", license: "proprietary-api", last_verified: "2026-08-18T00:00:00Z", thumbnail: "y" },
      { id: "b", label: "B", license: "proprietary-api", last_verified: "2026-08-18T00:00:00Z", thumbnail: "y" },
    ],
  };
  const diffNoChange = buildDiffReport(v1, v2Unchanged);
  assert.deepEqual(diffNoChange.added, []);
  assert.deepEqual(diffNoChange.removed, []);
  assert.deepEqual(diffNoChange.changed, []);
  assert.equal(diffNoChange.unchanged_count, 2);

  // A real content change (label) must show up as changed, not masked.
  const v3Changed = {
    generated_at: "2026-08-19T00:00:00Z",
    models: [
      { id: "a", label: "A renamed", license: "proprietary-api", last_verified: "2026-08-19T00:00:00Z", thumbnail: "z" },
      { id: "c", label: "C", license: "proprietary-api", last_verified: "2026-08-19T00:00:00Z", thumbnail: "z" },
    ],
  };
  const diffChanged = buildDiffReport(v2Unchanged, v3Changed);
  assert.deepEqual(diffChanged.added, ["c"]);
  assert.deepEqual(diffChanged.removed, ["b"]);
  assert.deepEqual(diffChanged.changed, ["a"]);

  // No previous registry at all (first-ever run) — everything is "added", no crash.
  const diffFirstRun = buildDiffReport(null, v1);
  assert.deepEqual(diffFirstRun.added.sort(), ["a", "b"]);
  assert.equal(diffFirstRun.compared_against, null);
});
