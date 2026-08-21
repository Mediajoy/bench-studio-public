#!/usr/bin/env node
// One-time migration: rename every existing data/outputs/ file from its
// opaque provider-request-id name (df51cbd33db5dfcee8fba44de0857a60-0.png)
// to a meaningful one (have-her-look-directly-at-the-camera_2026-08-19_df51cbd3.png),
// and update the SQLite assets table so every local_path/local_url stays
// correct — otherwise every card in Results/Ledger pointing at a renamed
// file would 404.
//
// This is the SAME naming scheme server.mjs's meaningfulFilename() applies
// to new generations going forward — kept as a duplicate ~15-line function
// here rather than imported, since server.mjs isn't structured as an
// importable module (it runs app.listen() at load time). If that scheme
// ever changes, update both places.
//
// Dry-run by default — prints every planned rename without touching
// anything. Pass --confirm to actually rename files and update the DB.
//
// Usage:
//   node server/rename_outputs.mjs            # preview only
//   node server/rename_outputs.mjs --confirm   # actually do it

import { DatabaseSync } from "node:sqlite";
import { existsSync, renameSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = resolve(process.env.BENCH_DATA_DIR || join(HERE, "..", "data"));
const DB_PATH = join(DATA, "bench.db");
const OUTPUTS = join(DATA, "outputs");

const CONFIRM = process.argv.includes("--confirm");

function parseJson(value, fallback = null) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function slugify(text, maxLength = 60) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength)
    .replace(/-+$/g, "");
}

function meaningfulFilename({ text, date, requestId, position = 0, extension }) {
  const slug = slugify(text) || "render";
  const day = (date || new Date().toISOString()).slice(0, 10);
  const shortId = String(requestId ?? "").replace(/[^a-zA-Z0-9]/g, "").slice(0, 8) || Math.random().toString(36).slice(2, 10);
  const positionSuffix = position > 0 ? `-${position}` : "";
  return `${slug}_${day}${positionSuffix}_${shortId}${extension}`;
}

function main() {
  if (!existsSync(DB_PATH)) {
    console.error(`no database at ${DB_PATH} — nothing to migrate`);
    process.exit(1);
  }
  const db = new DatabaseSync(DB_PATH);

  const rows = db.prepare(`
    SELECT assets.id, assets.local_path, assets.position,
           generations.label, generations.payload_json, generations.ts, generations.request_id
    FROM assets JOIN generations ON generations.id = assets.generation_id
    WHERE assets.role = 'output' AND assets.local_path IS NOT NULL
    ORDER BY generations.ts
  `).all();

  console.log(`${rows.length} local output file(s) to consider.\n`);

  const usedNames = new Set();
  let renamed = 0;
  let missingOnDisk = 0;
  let alreadyGood = 0;

  for (const row of rows) {
    const oldPath = row.local_path;
    const payload = parseJson(row.payload_json, {});
    const text = payload.raw_idea || payload.prompt || row.label || `render-${row.id}`;
    const extension = extname(oldPath) || ".bin";

    let filename = meaningfulFilename({ text, date: row.ts, requestId: row.request_id, position: row.position, extension });
    // Guard against two different assets computing the identical name
    // (same prompt text, same day, same short id truncation) — extremely
    // unlikely given request ids are unique, but a silent overwrite would
    // be a real data-loss bug, so check rather than assume.
    let suffix = 2;
    const base = filename.slice(0, -extension.length);
    while (usedNames.has(filename)) {
      filename = `${base}-${suffix}${extension}`;
      suffix++;
    }
    usedNames.add(filename);

    const newPath = join(OUTPUTS, filename);

    if (oldPath === newPath) {
      alreadyGood++;
      continue;
    }
    if (!existsSync(oldPath)) {
      console.warn(`  [skip, file missing on disk] ${oldPath}`);
      missingOnDisk++;
      continue;
    }

    console.log(`  ${oldPath.split("/").pop()}\n  -> ${filename}\n`);

    if (CONFIRM) {
      renameSync(oldPath, newPath);
      db.prepare("UPDATE assets SET local_path = ?, local_url = ? WHERE id = ?")
        .run(newPath, `/media/${filename}`, row.id);
    }
    renamed++;
  }

  console.log(`\n${CONFIRM ? "Renamed" : "Would rename"}: ${renamed}. Already fine: ${alreadyGood}. Missing on disk: ${missingOnDisk}.`);
  if (!CONFIRM && renamed > 0) {
    console.log("\nDry run only — nothing changed. Re-run with --confirm to actually rename files and update the database.");
  }
  db.close();
}

main();
