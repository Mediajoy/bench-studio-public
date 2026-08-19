import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

function parseJson(value, fallback = null) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function entryKey(row) {
  if (row.request_id) return `request:${row.request_id}`;
  return `legacy:${createHash("sha256")
    .update(JSON.stringify([row.ts, row.model, row.prompt, row.outputs]))
    .digest("hex")}`;
}

// Canonical form for a client/series tag — a slug, not free text. This is
// what lets shot-builder's project slugs (workspace/projects/<slug>/) and
// Bench's own client tags refer to the same client without a separate
// mapping step, and stops "Grace Church" / "grace church" / "grace-church"
// becoming three different clients. Display name is prettified from the
// slug in the UI; there's no separate display-name column to keep in sync.
function normalizeSlug(value) {
  if (value == null) return null;
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

export function normalizeClient(value) {
  return normalizeSlug(value);
}

// series is a sub-category *under* client (e.g. client "grace-church",
// series "sunday-sermons" vs "youth-promos") — same slug shape, same
// normalization, kept as its own named function so call sites read clearly
// and so the two can diverge later without a silent shared-function surprise.
export function normalizeSeries(value) {
  return normalizeSlug(value);
}

// Three-state filter shared by every read path that can be scoped to a
// client or series column, so they can't drift from each other:
//   undefined/null -> no filter (today's behavior, backward compatible)
//   "__none__"     -> only untagged rows (column IS NULL)
//   any other value -> only that value's rows (normalized first)
// Returns null (no predicate) or { sql, args } for the caller to AND/WHERE in.
function slugPredicate(column, value) {
  if (value === undefined || value === null) return null;
  if (value === "__none__") return { sql: `${column} IS NULL`, args: [] };
  return { sql: `${column} = ?`, args: [normalizeSlug(value)] };
}

function clientPredicate(client) {
  return slugPredicate("client", client);
}

function seriesPredicate(series) {
  return slugPredicate("series", series);
}

// Combine an arbitrary list of predicates (each null or {sql,args}) into one
// WHERE clause, or "" if none apply. Used wherever a query can be filtered
// by client AND series simultaneously (series is meaningless without a
// client scope, but the DB layer doesn't enforce that — the UI does, by only
// showing the series selector once a specific client is active).
function combinePredicates(preds) {
  const active = preds.filter(Boolean);
  if (!active.length) return { sql: "", args: [] };
  return {
    sql: " WHERE " + active.map((p) => p.sql).join(" AND "),
    args: active.flatMap((p) => p.args),
  };
}

export function createStore({ dbPath, legacyLedgerPath }) {
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA synchronous = NORMAL;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS generations (
      id INTEGER PRIMARY KEY,
      entry_key TEXT NOT NULL UNIQUE,
      request_id TEXT,
      ts TEXT NOT NULL,
      model_id TEXT NOT NULL,
      label TEXT,
      vendor TEXT,
      kind TEXT,
      lane TEXT,
      format TEXT,
      cost REAL,
      cost_confidence TEXT,
      payload_json TEXT NOT NULL,
      starred INTEGER NOT NULL DEFAULT 0,
      client TEXT,
      series TEXT
    );
    CREATE INDEX IF NOT EXISTS generations_ts_idx ON generations(ts DESC);
    CREATE INDEX IF NOT EXISTS generations_model_idx ON generations(model_id, ts DESC);

    CREATE TABLE IF NOT EXISTS assets (
      id INTEGER PRIMARY KEY,
      generation_id INTEGER REFERENCES generations(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      field_name TEXT,
      position INTEGER NOT NULL DEFAULT 0,
      remote_url TEXT,
      local_path TEXT,
      local_url TEXT,
      content_type TEXT,
      width INTEGER,
      height INTEGER,
      created_at TEXT NOT NULL,
      UNIQUE(generation_id, role, position)
    );
    CREATE INDEX IF NOT EXISTS assets_remote_idx ON assets(remote_url);

    CREATE TABLE IF NOT EXISTS uploads (
      id INTEGER PRIMARY KEY,
      upload_id TEXT NOT NULL UNIQUE,
      original_name TEXT NOT NULL,
      media_type TEXT NOT NULL,
      content_type TEXT,
      size_bytes INTEGER,
      remote_url TEXT NOT NULL,
      local_path TEXT NOT NULL,
      local_url TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS capability_checks (
      model_id TEXT NOT NULL,
      input_field TEXT NOT NULL,
      status TEXT NOT NULL,
      source TEXT NOT NULL,
      evidence TEXT,
      details_json TEXT,
      verified_at TEXT,
      PRIMARY KEY(model_id, input_field, source)
    );

    CREATE TABLE IF NOT EXISTS catalog_syncs (
      id INTEGER PRIMARY KEY,
      synced_at TEXT NOT NULL UNIQUE,
      payload_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      prompt TEXT NOT NULL,
      template TEXT,
      status TEXT NOT NULL,
      stage TEXT,
      progress INTEGER NOT NULL DEFAULT 0,
      output_dir TEXT NOT NULL,
      entry_file TEXT,
      artifact_file TEXT,
      preview_url TEXT,
      error TEXT,
      model TEXT,
      reasoning TEXT,
      stages_json TEXT NOT NULL DEFAULT '[]',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS projects_created_idx ON projects(created_at DESC);
  `);

  // CREATE TABLE IF NOT EXISTS above doesn't retrofit new columns onto a
  // database that already exists on disk — starred was added after the
  // generations table was first created, so backfill it here. The index is
  // created unconditionally afterward (IF NOT EXISTS) since brand-new
  // databases get the column via CREATE TABLE directly and skip this guard.
  const hasStarredColumn = db.prepare("PRAGMA table_info(generations)").all()
    .some((col) => col.name === "starred");
  if (!hasStarredColumn) {
    db.exec("ALTER TABLE generations ADD COLUMN starred INTEGER NOT NULL DEFAULT 0");
  }
  db.exec("CREATE INDEX IF NOT EXISTS generations_starred_idx ON generations(starred, ts DESC)");

  // Same retrofit pattern as starred above — client was added after this
  // table already existed on disk for real users.
  const hasClientColumn = db.prepare("PRAGMA table_info(generations)").all()
    .some((col) => col.name === "client");
  if (!hasClientColumn) {
    db.exec("ALTER TABLE generations ADD COLUMN client TEXT");
  }
  db.exec("CREATE INDEX IF NOT EXISTS generations_client_idx ON generations(client, ts DESC)");

  // Same retrofit pattern again — series is a sub-category under client,
  // added in the same session as client but as its own column so a
  // generation can be tagged with a client and no series (common case).
  const hasSeriesColumn = db.prepare("PRAGMA table_info(generations)").all()
    .some((col) => col.name === "series");
  if (!hasSeriesColumn) {
    db.exec("ALTER TABLE generations ADD COLUMN series TEXT");
  }
  db.exec("CREATE INDEX IF NOT EXISTS generations_client_series_idx ON generations(client, series, ts DESC)");

  const insertGeneration = db.prepare(`
    INSERT INTO generations (
      entry_key, request_id, ts, model_id, label, vendor, kind, lane, format,
      cost, cost_confidence, payload_json, client, series
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(entry_key) DO UPDATE SET
      request_id=excluded.request_id,
      ts=excluded.ts,
      model_id=excluded.model_id,
      label=excluded.label,
      vendor=excluded.vendor,
      kind=excluded.kind,
      lane=excluded.lane,
      format=excluded.format,
      cost=excluded.cost,
      cost_confidence=excluded.cost_confidence,
      payload_json=excluded.payload_json,
      client=COALESCE(excluded.client, generations.client),
      series=COALESCE(excluded.series, generations.series)
  `);
  const findGeneration = db.prepare("SELECT id FROM generations WHERE entry_key = ?");
  const insertAsset = db.prepare(`
    INSERT INTO assets (
      generation_id, role, field_name, position, remote_url, local_path,
      local_url, content_type, width, height, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(generation_id, role, position) DO UPDATE SET
      field_name=excluded.field_name,
      remote_url=excluded.remote_url,
      local_path=COALESCE(excluded.local_path, assets.local_path),
      local_url=COALESCE(excluded.local_url, assets.local_url),
      content_type=COALESCE(excluded.content_type, assets.content_type),
      width=COALESCE(excluded.width, assets.width),
      height=COALESCE(excluded.height, assets.height)
  `);

  function addGeneration(row) {
    const key = entryKey(row);
    insertGeneration.run(
      key,
      row.request_id ?? null,
      row.ts ?? new Date().toISOString(),
      row.model ?? row.model_id ?? "unknown",
      row.label ?? null,
      row.vendor ?? null,
      row.kind ?? null,
      row.lane ?? null,
      row.format ?? null,
      Number.isFinite(Number(row.cost)) ? Number(row.cost) : null,
      row.cost_confidence ?? null,
      JSON.stringify(row),
      normalizeClient(row.client),
      normalizeSeries(row.series),
    );
    const generationId = Number(findGeneration.get(key).id);
    (row.outputs ?? []).forEach((output, position) => {
      insertAsset.run(
        generationId,
        "output",
        null,
        position,
        output.url ?? output.remote_url ?? null,
        output.local_path ?? null,
        output.local_url ?? null,
        output.content_type ?? null,
        output.width ?? null,
        output.height ?? null,
        row.ts ?? new Date().toISOString(),
      );
    });
    return generationId;
  }

  function migrateLegacyLedger() {
    const migrated = db.prepare("SELECT value FROM meta WHERE key = 'legacy_ledger_migrated'").get();
    if (migrated || !legacyLedgerPath || !existsSync(legacyLedgerPath)) return 0;
    let count = 0;
    db.exec("BEGIN");
    try {
      for (const line of readFileSync(legacyLedgerPath, "utf8").split("\n")) {
        if (!line.trim()) continue;
        const row = parseJson(line);
        if (!row) continue;
        addGeneration(row);
        count++;
      }
      db.prepare("INSERT OR REPLACE INTO meta(key, value) VALUES('legacy_ledger_migrated', ?)")
        .run(new Date().toISOString());
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return count;
  }

  const assetQuery = db.prepare("SELECT * FROM assets WHERE generation_id = ? AND role = 'output' ORDER BY position");

  function generationRow(record) {
    const payload = parseJson(record.payload_json, {});
    const assets = assetQuery.all(record.id);
    return {
      ...payload,
      archive_id: Number(record.id),
      starred: Boolean(record.starred),
      // The column wins over whatever's in the stale payload_json copy —
      // otherwise renameClient()/renameSeries() would silently not show in
      // the UI while being correct in the DB (payload_json still holds the
      // old name).
      client: record.client ?? null,
      series: record.series ?? null,
      outputs: assets.map((asset) => ({
        url: asset.remote_url,
        remote_url: asset.remote_url,
        local_url: asset.local_url,
        local_path: asset.local_path,
        content_type: asset.content_type,
        width: asset.width,
        height: asset.height,
      })),
    };
  }

  function listGenerations(limit = 200, client = undefined, series = undefined) {
    const where = combinePredicates([clientPredicate(client), seriesPredicate(series)]);
    const rows = db.prepare(`SELECT * FROM generations${where.sql} ORDER BY ts DESC LIMIT ?`).all(...where.args, limit);
    return rows.map(generationRow);
  }

  function listStarred(limit = 100, client = undefined, series = undefined) {
    const where = combinePredicates([{ sql: "starred = 1", args: [] }, clientPredicate(client), seriesPredicate(series)]);
    const rows = db.prepare(`SELECT * FROM generations${where.sql} ORDER BY ts DESC LIMIT ?`).all(...where.args, limit);
    return rows.map(generationRow);
  }

  function setStarred(id, starred) {
    const numericId = Number(id);
    if (!Number.isInteger(numericId) || numericId < 1) return null;
    db.prepare("UPDATE generations SET starred = ? WHERE id = ?").run(starred ? 1 : 0, numericId);
    const record = db.prepare("SELECT * FROM generations WHERE id = ?").get(numericId);
    return record ? generationRow(record) : null;
  }

  function setClient(id, client) {
    const numericId = Number(id);
    if (!Number.isInteger(numericId) || numericId < 1) return null;
    db.prepare("UPDATE generations SET client = ? WHERE id = ?").run(normalizeClient(client), numericId);
    const record = db.prepare("SELECT * FROM generations WHERE id = ?").get(numericId);
    return record ? generationRow(record) : null;
  }

  function setSeries(id, series) {
    const numericId = Number(id);
    if (!Number.isInteger(numericId) || numericId < 1) return null;
    db.prepare("UPDATE generations SET series = ? WHERE id = ?").run(normalizeSeries(series), numericId);
    const record = db.prepare("SELECT * FROM generations WHERE id = ?").get(numericId);
    return record ? generationRow(record) : null;
  }

  function listClients() {
    const rows = db.prepare(`
      SELECT client, COUNT(*) n, MAX(ts) last_ts, COALESCE(SUM(cost), 0) spend
      FROM generations GROUP BY client ORDER BY last_ts DESC
    `).all();
    return rows.map((row) => ({
      client: row.client ?? null,
      n: Number(row.n),
      last_ts: row.last_ts,
      spend: Number(Number(row.spend).toFixed(4)),
    }));
  }

  // Series is a sub-category *under* client — scoped to one client at a
  // time, not global. Unlike listClients(), this always takes a client
  // filter (a series named "sunday-sermons" under Grace Church is unrelated
  // to one with the same name under a different client — grouping across
  // clients would silently merge two unrelated series).
  function listSeries(client) {
    const pred = clientPredicate(client);
    const where = combinePredicates([pred]);
    const rows = db.prepare(`
      SELECT series, COUNT(*) n, MAX(ts) last_ts, COALESCE(SUM(cost), 0) spend
      FROM generations${where.sql} GROUP BY series ORDER BY last_ts DESC
    `).all(...where.args);
    return rows.map((row) => ({
      series: row.series ?? null,
      n: Number(row.n),
      last_ts: row.last_ts,
      spend: Number(Number(row.spend).toFixed(4)),
    }));
  }

  function renameClient(from, to) {
    const fromSlug = normalizeClient(from);
    const toSlug = normalizeClient(to);
    if (!toSlug) throw new Error("renameClient: 'to' must not be empty");
    const pred = fromSlug ? "client = ?" : "client IS NULL";
    const args = fromSlug ? [toSlug, fromSlug] : [toSlug];
    const result = db.prepare(`UPDATE generations SET client = ? WHERE ${pred}`).run(...args);
    return { from: fromSlug, to: toSlug, updated: Number(result.changes) };
  }

  // Scoped to a client, same reasoning as listSeries() — renaming a series
  // only makes sense within one client's rows.
  function renameSeries(client, from, to) {
    const clientSlug = normalizeClient(client);
    const fromSlug = normalizeSeries(from);
    const toSlug = normalizeSeries(to);
    if (!toSlug) throw new Error("renameSeries: 'to' must not be empty");
    const clientPred = clientSlug ? "client = ?" : "client IS NULL";
    const seriesPred = fromSlug ? "series = ?" : "series IS NULL";
    const result = db.prepare(`UPDATE generations SET series = ? WHERE ${clientPred} AND ${seriesPred}`).run(toSlug, ...(clientSlug ? [clientSlug] : []), ...(fromSlug ? [fromSlug] : []));
    return { client: clientSlug, from: fromSlug, to: toSlug, updated: Number(result.changes) };
  }

  function deleteGeneration(id) {
    const numericId = Number(id);
    if (!Number.isInteger(numericId) || numericId < 1) return null;
    const generation = db.prepare("SELECT * FROM generations WHERE id = ?").get(numericId);
    if (!generation) return null;
    const assets = db.prepare("SELECT * FROM assets WHERE generation_id = ? ORDER BY position").all(numericId);
    db.prepare("DELETE FROM generations WHERE id = ?").run(numericId);
    return {
      archive_id: numericId,
      request_id: generation.request_id,
      assets: assets.map((asset) => ({
        local_path: asset.local_path,
        local_url: asset.local_url,
        content_type: asset.content_type,
      })),
    };
  }

  function spendSummary(client = undefined, series = undefined) {
    const now = new Date();
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const where = combinePredicates([clientPredicate(client), seriesPredicate(series)]);
    const all = db.prepare(`
      SELECT COUNT(*) total_generations, COALESCE(SUM(cost), 0) all_time,
             SUM(CASE WHEN cost IS NULL THEN 1 ELSE 0 END) unpriced
      FROM generations${where.sql}
    `).get(...where.args);
    const monthWhere = combinePredicates([{ sql: "substr(ts, 1, 7) = ?", args: [ym] }, clientPredicate(client), seriesPredicate(series)]);
    const month = db.prepare(`
      SELECT COUNT(*) month_generations, COALESCE(SUM(cost), 0) month
      FROM generations${monthWhere.sql}
    `).get(...monthWhere.args);
    return {
      month: Number(Number(month.month).toFixed(4)),
      all_time: Number(Number(all.all_time).toFixed(4)),
      month_generations: Number(month.month_generations),
      total_generations: Number(all.total_generations),
      unpriced: Number(all.unpriced),
      month_label: ym,
    };
  }

  function recordUpload(upload) {
    db.prepare(`
      INSERT OR REPLACE INTO uploads (
        upload_id, original_name, media_type, content_type, size_bytes,
        remote_url, local_path, local_url, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      upload.upload_id,
      upload.original_name,
      upload.media_type,
      upload.content_type ?? null,
      upload.size_bytes ?? null,
      upload.remote_url,
      upload.local_path,
      upload.local_url,
      upload.created_at,
    );
  }

  function missingOutputAssets(limit = 50) {
    return db.prepare(`
      SELECT assets.*, generations.request_id, generations.ts
      FROM assets JOIN generations ON generations.id = assets.generation_id
      WHERE assets.role = 'output' AND assets.remote_url IS NOT NULL AND assets.local_url IS NULL
      ORDER BY generations.ts DESC LIMIT ?
    `).all(limit);
  }

  function updateAssetMirror(assetId, { localPath, localUrl, contentType }) {
    db.prepare(`UPDATE assets SET local_path = ?, local_url = ?, content_type = COALESCE(?, content_type) WHERE id = ?`)
      .run(localPath, localUrl, contentType ?? null, assetId);
  }

  function recordCapabilityCheck(check) {
    db.prepare(`
      INSERT INTO capability_checks (
        model_id, input_field, status, source, evidence, details_json, verified_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(model_id, input_field, source) DO UPDATE SET
        status=excluded.status,
        evidence=excluded.evidence,
        details_json=excluded.details_json,
        verified_at=excluded.verified_at
    `).run(
      check.model_id,
      check.input_field,
      check.status,
      check.source,
      check.evidence ?? null,
      JSON.stringify(check.details ?? null),
      check.verified_at ?? null,
    );
  }

  function capabilityChecks() {
    return db.prepare("SELECT * FROM capability_checks ORDER BY model_id, input_field, source").all()
      .map((row) => ({ ...row, details: parseJson(row.details_json) }));
  }

  function storageSummary() {
    const generations = db.prepare("SELECT COUNT(*) count FROM generations").get();
    const assets = db.prepare(`
      SELECT COUNT(*) total,
             SUM(CASE WHEN local_url IS NOT NULL THEN 1 ELSE 0 END) mirrored,
             SUM(CASE WHEN local_url IS NULL AND remote_url IS NOT NULL THEN 1 ELSE 0 END) remote_only
      FROM assets WHERE role = 'output'
    `).get();
    const uploads = db.prepare("SELECT COUNT(*) count, COALESCE(SUM(size_bytes), 0) bytes FROM uploads").get();
    return {
      generations: Number(generations.count),
      outputs: Number(assets.total),
      mirrored_outputs: Number(assets.mirrored ?? 0),
      remote_only_outputs: Number(assets.remote_only ?? 0),
      uploads: Number(uploads.count),
      upload_bytes: Number(uploads.bytes),
    };
  }

  function recordCatalogSync(payload) {
    if (!payload?.synced_at) return;
    db.prepare("INSERT OR REPLACE INTO catalog_syncs(synced_at, payload_json) VALUES(?, ?)")
      .run(payload.synced_at, JSON.stringify(payload));
  }

  function projectRow(row) {
    if (!row) return null;
    return {
      ...row,
      stages: parseJson(row.stages_json, []),
      metadata: parseJson(row.metadata_json, {}),
    };
  }

  function createProject(project) {
    db.prepare(`
      INSERT INTO projects (
        id, kind, title, prompt, template, status, stage, progress, output_dir,
        model, reasoning, stages_json, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      project.id, project.kind, project.title, project.prompt, project.template ?? null,
      project.status ?? "queued", project.stage ?? "Queued", project.progress ?? 0,
      project.output_dir, project.model ?? null, project.reasoning ?? null,
      JSON.stringify(project.stages ?? []), JSON.stringify(project.metadata ?? {}),
      project.created_at, project.updated_at,
    );
    return getProject(project.id);
  }

  function updateProject(id, changes) {
    const current = getProject(id);
    if (!current) return null;
    const next = { ...current, ...changes, updated_at: changes.updated_at ?? new Date().toISOString() };
    db.prepare(`
      UPDATE projects SET title=?, prompt=?, template=?, status=?, stage=?, progress=?,
        entry_file=?, artifact_file=?, preview_url=?, error=?, model=?, reasoning=?,
        stages_json=?, metadata_json=?, updated_at=? WHERE id=?
    `).run(
      next.title, next.prompt, next.template ?? null, next.status, next.stage ?? null,
      next.progress ?? 0, next.entry_file ?? null, next.artifact_file ?? null,
      next.preview_url ?? null, next.error ?? null, next.model ?? null, next.reasoning ?? null,
      JSON.stringify(next.stages ?? []), JSON.stringify(next.metadata ?? {}), next.updated_at, id,
    );
    return getProject(id);
  }

  function getProject(id) {
    return projectRow(db.prepare("SELECT * FROM projects WHERE id = ?").get(id));
  }

  function listProjects(kind, limit = 100) {
    const rows = kind
      ? db.prepare("SELECT * FROM projects WHERE kind = ? ORDER BY created_at DESC LIMIT ?").all(kind, limit)
      : db.prepare("SELECT * FROM projects ORDER BY created_at DESC LIMIT ?").all(limit);
    return rows.map(projectRow);
  }

  return {
    db,
    addGeneration,
    listGenerations,
    listStarred,
    setStarred,
    setClient,
    listClients,
    renameClient,
    setSeries,
    listSeries,
    renameSeries,
    deleteGeneration,
    spendSummary,
    recordUpload,
    missingOutputAssets,
    updateAssetMirror,
    recordCapabilityCheck,
    capabilityChecks,
    storageSummary,
    recordCatalogSync,
    createProject,
    updateProject,
    getProject,
    listProjects,
    migrateLegacyLedger,
    close: () => db.close(),
  };
}
