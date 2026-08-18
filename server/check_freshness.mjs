// check_freshness.mjs — PRD v5 Phase 3: flag any model whose registry
// schema is >30 days stale AND has actually been used recently, so a
// forgotten refresh doesn't silently drift from fal's real schema.
//
//   node server/check_freshness.mjs [--stale-days 30] [--used-within-days 30]
//
// This answers the PRD's "a ledger.py command flags any recently-used
// model whose schema is older than 30 days" requirement, but from Bench's
// own SQLite `generations` table rather than shot-builder's ledger.py —
// which doesn't exist yet (see _reference/PHASE-0-FINDINGS.md correction
// #1) and, more importantly, Bench already has both pieces of data this
// needs (the registry's last_verified, and real usage history) without a
// cross-repo dependency.

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const HERE = dirname(fileURLToPath(import.meta.url));

export function findStaleUsedModels(registry, usedModelIds, { staleDays = 30, now = new Date() } = {}) {
  const cutoff = new Date(now.getTime() - staleDays * 24 * 60 * 60 * 1000);
  const usedSet = new Set(usedModelIds);
  const stale = [];
  for (const model of registry.models) {
    if (!usedSet.has(model.id)) continue;
    const verified = model.last_verified ? new Date(model.last_verified) : null;
    if (!verified || Number.isNaN(verified.getTime()) || verified < cutoff) {
      stale.push({
        model_id: model.id,
        label: model.label,
        last_verified: model.last_verified ?? null,
        days_stale: verified ? Math.floor((now - verified) / (24 * 60 * 60 * 1000)) : null,
      });
    }
  }
  return stale;
}

const isCli = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isCli) {
  const args = process.argv.slice(2);
  const flag = (name, def) => {
    const i = args.indexOf(name);
    return i === -1 ? def : Number(args[i + 1]);
  };
  const staleDays = flag("--stale-days", 30);
  const usedWithinDays = flag("--used-within-days", 30);

  const registry = JSON.parse(readFileSync(join(HERE, "registry.json"), "utf8"));

  const DATA = resolve(process.env.BENCH_DATA_DIR || join(HERE, "..", "data"));
  const dbPath = join(DATA, "bench.db");
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const sinceIso = new Date(Date.now() - usedWithinDays * 24 * 60 * 60 * 1000).toISOString();
  const rows = db.prepare("SELECT DISTINCT model_id FROM generations WHERE ts >= ?").all(sinceIso);
  db.close();
  const usedModelIds = rows.map((r) => r.model_id);

  const stale = findStaleUsedModels(registry, usedModelIds, { staleDays });

  console.log(`Checked ${usedModelIds.length} model(s) used in the last ${usedWithinDays} day(s) against a ${staleDays}-day freshness window.`);
  if (!stale.length) {
    console.log("Nothing stale.");
  } else {
    console.log(`${stale.length} stale:`);
    for (const s of stale) {
      console.log(`  ${s.model_id} — last_verified ${s.last_verified ?? "(never)"} (${s.days_stale ?? "?"} days ago)`);
    }
    console.log("\nRun `npm run registry` to refresh.");
  }
}
