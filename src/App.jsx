import React, { useEffect, useMemo, useRef, useState } from "react";
import TopBar from "./TopBar.jsx";
import PromptBar, { SHOT_DIRECTION } from "./PromptBar.jsx";
import ModelWall from "./ModelWall.jsx";
import Work from "./Work.jsx";
import Ledger from "./Ledger.jsx";
import Tooling from "./Tooling.jsx";
import CreativeStudio from "./CreativeStudio.jsx";
import { assignInputFields, imageInputFor, mediaInputsFor, mediaTypeForFile, pairedImageModel, remainingCapacity, retainCompatibleAssets, sortModels } from "./modelCatalog.js";

function viewFromHash() {
  const view = window.location.hash.slice(1);
  return ["create", "websites", "documents", "models", "work", "connect"].includes(view) ? view : "create";
}

// Params driven by the schema but kept off the bar. Model defaults are already
// right for concepting, and a wall of knobs is what makes these tools feel like
// software instead of a camera.
const HIDE = new Set([
  "seed", "enable_safety_checker", "output_format", "image_url", "image_urls",
  "guidance_scale", "num_inference_steps", "negative_prompt", "num_frames", "style",
]);

// A creation mode is also a delivery intent. Keep the first frame useful for
// that intent, while still respecting the exact ratios each endpoint exposes.
// The user can change the chip at any time; these are only the starting points.
const FORMAT_FRAME_PREFERENCES = {
  ugc: {
    aspect_ratio: ["9:16", "3:4", "2:3", "1:1", "4:5", "16:9"],
    image_size: ["portrait_16_9", "portrait_4_3", "square_hd", "square"],
  },
  unboxing: {
    aspect_ratio: ["9:16", "3:4", "2:3", "1:1", "4:5", "16:9"],
    image_size: ["portrait_16_9", "portrait_4_3", "square_hd", "square"],
  },
  product: {
    aspect_ratio: ["1:1", "4:5", "4:3", "3:2", "square", "16:9"],
    image_size: ["square_hd", "square", "landscape_4_3", "portrait_4_3"],
  },
  poster: {
    aspect_ratio: ["4:5", "3:4", "1:1", "9:16", "4:3", "16:9"],
    image_size: ["portrait_4_3", "square_hd", "square", "landscape_4_3"],
  },
  hypermotion: {
    aspect_ratio: ["16:9", "21:9", "4:3", "1:1", "9:16"],
    image_size: ["landscape_16_9", "landscape_4_3", "square_hd", "square"],
  },
  tvspot: {
    aspect_ratio: ["16:9", "21:9", "4:3", "1:1", "9:16"],
    image_size: ["landscape_16_9", "landscape_4_3", "square_hd", "square"],
  },
};

function applyFrameDefault(params, model, format) {
  const preferences = FORMAT_FRAME_PREFERENCES[format];
  if (!preferences || !model?.params) return params;

  const next = { ...params };
  for (const field of ["aspect_ratio", "image_size"]) {
    const spec = model.params[field];
    if (!spec?.enum?.length) continue;
    const preferred = preferences[field]?.find((candidate) =>
      spec.enum.some((value) => String(value) === candidate)
    );
    if (preferred !== undefined) {
      next[field] = spec.enum.find((value) => String(value) === preferred);
    }
  }
  return next;
}

async function readJson(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  if (!response.ok) {
    let message = `${response.status} ${response.statusText || "request failed"}`;
    try {
      const payload = JSON.parse(text);
      message = payload.error || payload.detail || message;
    } catch {
      if (text.trim()) message = text.trim();
    }
    throw new Error(message);
  }
  if (!text.trim()) throw new Error("The server returned an empty response");
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("The server returned an invalid response");
  }
}

function errorDetails(error) {
  const raw = String(error?.message ?? error ?? "");
  const lower = raw.toLowerCase();
  if (lower.includes("exhausted balance") || lower.includes("user is locked") || lower.includes("fal balance is empty")) {
    return {
      title: lower.includes("upload failed") ? "Reference upload paused" : "Generation paused",
      message: lower.includes("upload failed")
        ? "The reference cannot be uploaded while your fal balance is empty. Add funds, then try the upload again."
        : "Your fal balance is empty. Add funds, then return here and try again.",
      action: "Open fal billing",
      href: "https://fal.ai/dashboard/billing",
    };
  }
  if (lower.includes("server is unavailable") || lower.includes("failed to fetch") || lower.includes("cannot reach")) {
    return {
      title: "Studio is offline",
      message: "The local generation server is not responding. Restart it, then retry.",
    };
  }
  if (lower.includes("reference") && (lower.includes("switched") || lower.includes("selected instead"))) {
    return {
      title: lower.includes("removed") ? "Model switched" : "Reference-ready model selected",
      message: raw,
      tone: "info",
    };
  }
  if (lower.includes("cannot use the current attachments")) {
    return {
      title: "Choose a compatible model",
      message: raw,
    };
  }
  return {
    title: "Something stopped this run",
    message: raw.replace(/^error:\s*/i, "") || "Please try again.",
  };
}

function ErrorNotice({ error, onClose }) {
  const details = errorDetails(error);
  return (
    <section className={`error-notice${details.tone === "info" ? " info" : ""}`} role="alert">
      <div>
        <strong>{details.title}</strong>
        <p>{details.message}</p>
      </div>
      <div className="error-actions">
        {details.href && (
          <a href={details.href} target="_blank" rel="noreferrer">{details.action}</a>
        )}
        <button type="button" onClick={onClose} aria-label="Dismiss message">Dismiss</button>
      </div>
    </section>
  );
}

function relativeTime(iso) {
  const elapsed = Date.now() - Date.parse(iso || "");
  if (!Number.isFinite(elapsed) || elapsed < 0) return "pending";
  const minutes = Math.floor(elapsed / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function CatalogStatus({ catalog, syncing, onSync }) {
  const status = catalog?.catalog_sync;
  const newCount = status?.new_endpoint_count;
  return (
    <details className="catalog-status">
      <summary>
        <span>{status?.synced_at ? `Catalog updated ${relativeTime(status.synced_at)}` : "Checking model catalog"}</span>
      </summary>
      <div className="catalog-status-popover">
        <div className="catalog-status-head">
          <div>
            <strong>Live model discovery</strong>
            <span>Automatic refresh every {status?.refresh_hours ?? 6} hours</span>
          </div>
          <button type="button" onClick={onSync} disabled={syncing}>{syncing ? "Syncing…" : "Sync now"}</button>
        </div>
        <dl>
          <div><dt>Production ready</dt><dd>{catalog?.models?.length ?? 0}</dd></div>
          <div><dt>Relevant on fal</dt><dd>{status?.relevant_active_endpoints ?? "—"}</dd></div>
          <div><dt>Awaiting validation</dt><dd>{newCount ?? "—"}</dd></div>
        </dl>
        <p>{status?.policy ?? "The production roster stays stable while fal is checked for new image and video endpoints."}</p>
        {status?.newest?.length > 0 && (
          <div className="catalog-newest">
            <span>Newest detected</span>
            {status.newest.slice(0, 4).map((item) => (
              <a key={item.id} href={item.model_url} target="_blank" rel="noreferrer">
                <b>{item.label}</b><small>{item.category_label}</small>
              </a>
            ))}
          </div>
        )}
      </div>
    </details>
  );
}

function CreditPanel({ billing, locked, refreshing, onRefresh, onClose }) {
  const balance = billing?.available && billing.current_balance != null
    ? new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: billing.currency || "USD",
        maximumFractionDigits: 2,
      }).format(billing.current_balance)
    : null;
  return (
    <aside className="credit-sheet" aria-label="fal credits">
      <div className="credit-sheet-head">
        <div>
          <h3>fal credits</h3>
          <span>Generation balance for this studio</span>
        </div>
        <button type="button" className="ghost-btn" onClick={onClose}>Close</button>
      </div>
      <div className="credit-sheet-body">
        <section className={`balance-card${locked ? " locked" : ""}`}>
          <span>{locked ? "Generation paused" : balance ? "Available balance" : "Balance"}</span>
          <strong>{locked ? "Credits required" : balance ?? "Not available to this key"}</strong>
          <p>{locked
            ? "fal reported that this account is out of credits. Adding credits will unlock generation and reference uploads."
            : billing?.reason ?? "Balance data refreshes directly from fal."}</p>
        </section>
        <a className="topup-button" href={billing?.top_up_url ?? "https://fal.ai/dashboard/billing"} target="_blank" rel="noreferrer">
          Continue to secure top-up <span aria-hidden="true">↗</span>
        </a>
        <button type="button" className="refresh-balance" onClick={onRefresh} disabled={refreshing}>
          {refreshing ? "Checking fal…" : "I’ve added credits — refresh balance"}
        </button>
        <p className="credit-security">Payment and card details stay on fal. Bench never receives or stores them.</p>
      </div>
    </aside>
  );
}

export default function App() {
  const [activeView, setActiveView] = useState(() => viewFromHash());
  const [catalog, setCatalog] = useState(null);
  const [modelId, setModelId] = useState(null);
  const [format, setFormat] = useState("none");
  const [shotSettings, setShotSettings] = useState({});
  const [idea, setIdea] = useState("");
  const [rewritten, setRewritten] = useState(null);
  const [params, setParams] = useState({});
  const [refs, setRefs] = useState([]);
  const refsRef = useRef([]);
  const [quote, setQuote] = useState(null);
  const [provider, setProvider] = useState("fal");
  const [job, setJob] = useState(null);
  const [shots, setShots] = useState([]);
  const [ledger, setLedger] = useState({ rows: [], summary: null });
  const [showLedger, setShowLedger] = useState(false);
  const [showCredits, setShowCredits] = useState(false);
  const [billing, setBilling] = useState(null);
  const [refreshingBilling, setRefreshingBilling] = useState(false);
  const [falLocked, setFalLocked] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [syncingCatalog, setSyncingCatalog] = useState(false);
  const [activeClient, setActiveClient] = useState(() => {
    try { return localStorage.getItem("bench.active-client") || ""; } catch { return ""; }
  });
  const [clients, setClients] = useState([]);
  // Deliberately separate from ledger.summary (which becomes client-filtered
  // once a client is active) — TopBar's Usage figure is account-wide and
  // shouldn't jump around as the filter changes. Server-side, every endpoint
  // except /api/ledger?client= already returns the unfiltered spendSummary(),
  // so this just needs its own state to avoid being overwritten by the
  // filtered one.
  const [globalSummary, setGlobalSummary] = useState(null);

  useEffect(() => {
    const syncView = () => {
      setActiveView(viewFromHash());
      document.querySelector(".scroll")?.scrollTo({ top: 0 });
    };
    syncView();
    window.addEventListener("hashchange", syncView);
    return () => window.removeEventListener("hashchange", syncView);
  }, []);

  function openView(view) {
    window.location.hash = view;
    setActiveView(view);
  }
  const abortRef = useRef(null);
  const ledgerRetryRef = useRef(null);
  const activeClientRef = useRef(activeClient);
  useEffect(() => { activeClientRef.current = activeClient; }, [activeClient]);

  useEffect(() => {
    try { localStorage.setItem("bench.active-client", activeClient); } catch {}
  }, [activeClient]);

  function refreshClients() {
    readJson("/api/clients").then((d) => setClients(d.rows ?? [])).catch(() => {});
  }

  function refreshGlobalSummary() {
    readJson("/api/ledger").then((l) => setGlobalSummary(l.summary)).catch(() => {});
  }

  const model = useMemo(
    () => catalog?.models.find((m) => m.id === modelId) ?? null,
    [catalog, modelId]
  );
  const referenceModel = useMemo(
    () => pairedImageModel(catalog?.models, model),
    [catalog, model]
  );

  useEffect(() => {
    refsRef.current = refs;
  }, [refs]);

  useEffect(() => {
    let dead = false;
    let retryTimer;

    async function loadCatalog(attempt = 0) {
      try {
        const c = await readJson("/api/models");
        if (!c.models?.length) throw new Error("The model catalog is empty");
        if (dead) return;
        setCatalog(c);
        setModelId((current) => {
          if (current) return current;
          let pinned = "";
          let last = "";
          try {
            pinned = localStorage.getItem("bench.model-filter-pinned") || "";
            last = localStorage.getItem("bench.last-model") || "";
          } catch {}
          const previous = c.models.find((candidate) => candidate.id === last && (!pinned || candidate.kind === pinned));
          return previous?.id ?? sortModels(c.models.filter((candidate) => !pinned || candidate.kind === pinned))[0]?.id ?? c.models[0]?.id ?? null;
        });
        setError(null);
      } catch (e) {
        if (dead) return;
        if (attempt < 12) {
          retryTimer = setTimeout(() => loadCatalog(attempt + 1), Math.min(1800, 450 + attempt * 125));
        } else {
          setError("The studio server is unavailable. Start the app again and retry.");
        }
      }
    }

    loadCatalog();
    refreshBilling();
    refreshClients();
    refreshGlobalSummary();
    return () => {
      dead = true;
      clearTimeout(retryTimer);
      clearTimeout(ledgerRetryRef.current);
    };
  }, []);

  // Fires once on mount (covering the initial load) and again whenever the
  // active client changes — this IS the filter mechanism: refreshLedger
  // reads the client from activeClientRef and re-fetches scoped to it, and
  // since `shots` is derived from the ledger response, Work.jsx's rendering
  // needs no filter logic of its own.
  useEffect(() => {
    clearTimeout(ledgerRetryRef.current);
    refreshLedger();
  }, [activeClient]);

  async function refreshBilling(force = false) {
    setRefreshingBilling(true);
    try {
      const value = await readJson(`/api/fal/billing${force ? "?refresh=1" : ""}`);
      setBilling(value);
      if (value.available && Number(value.current_balance) > 0) setFalLocked(false);
    } catch {
      // Billing visibility must never block the creation UI.
    } finally {
      setRefreshingBilling(false);
    }
  }

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && showCredits) refreshBilling(true);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [showCredits]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const timer = setInterval(() => {
      readJson("/api/catalog/status")
        .then((status) => setCatalog((current) => current ? { ...current, catalog_sync: status } : current))
        .catch(() => {});
    }, 60000);
    return () => clearInterval(timer);
  }, []);

  async function syncCatalog() {
    setSyncingCatalog(true);
    try {
      const status = await readJson("/api/catalog/sync", { method: "POST" });
      setCatalog((current) => current ? { ...current, catalog_sync: status } : current);
    } catch (error) {
      setError(`Catalog sync failed: ${error.message ?? error}`);
    } finally {
      setSyncingCatalog(false);
    }
  }

  function refreshLedger(attempt = 0) {
    const client = activeClientRef.current;
    const query = client ? `?client=${encodeURIComponent(client)}` : "";
    readJson(`/api/ledger${query}`)
      .then((l) => {
        // The active client may have changed again while this request was
        // in flight (e.g. a retry landing late) — drop it rather than
        // showing results filtered for a client that's no longer selected.
        if (activeClientRef.current !== client) return;
        setLedger(l);
        const past = (l.rows ?? [])
          .filter((r) => r.outputs?.length)
          .map((r) => ({ ...r, at: new Date(r.ts).getTime() }));
        setShots(past);
      })
      .catch(() => {
        if (activeClientRef.current !== client) return;
        if (attempt < 12) {
          ledgerRetryRef.current = setTimeout(() => refreshLedger(attempt + 1), Math.min(1800, 450 + attempt * 125));
        }
      });
  }

  async function deleteResult(shot) {
    if (!shot?.archive_id) throw new Error("This result is not in the local archive.");
    try {
      const result = await readJson(`/api/results/${encodeURIComponent(shot.archive_id)}`, { method: "DELETE" });
      setShots((current) => current.filter((candidate) => candidate.archive_id !== shot.archive_id));
      // result.summary is the global figure (server's spendSummary() with no
      // client arg) — feeds globalSummary, not the filtered ledger.summary.
      setGlobalSummary(result.summary);
      setLedger((current) => ({
        ...current,
        rows: (current.rows ?? []).filter((candidate) => candidate.archive_id !== shot.archive_id),
      }));
      refreshLedger();
      refreshClients();
    } catch (deleteError) {
      setError(`Could not delete this result: ${deleteError.message ?? deleteError}`);
      throw deleteError;
    }
  }

  async function toggleStar(shot) {
    if (!shot?.archive_id) return;
    const next = !shot.starred;
    setShots((current) => current.map((s) => (s.archive_id === shot.archive_id ? { ...s, starred: next } : s)));
    try {
      await readJson(`/api/results/${encodeURIComponent(shot.archive_id)}/star`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ starred: next }),
      });
    } catch (starError) {
      setShots((current) => current.map((s) => (s.archive_id === shot.archive_id ? { ...s, starred: !next } : s)));
      setError(`Could not update star: ${starError.message ?? starError}`);
    }
  }

  // Backfill/reassign a generation's client, from the "Assign to client"
  // control on a result card — the everyday tool for sorting the 4 (and
  // growing) generations made before client tagging existed.
  async function setShotClient(shot, client) {
    if (!shot?.archive_id) return;
    try {
      const updated = await readJson(`/api/results/${encodeURIComponent(shot.archive_id)}/client`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client }),
      });
      // If it was reassigned away from whatever's currently being viewed —
      // "All clients" (never removes), "Unassigned" (removes once it gains
      // a client), or a specific client (removes once it no longer matches)
      // — it should drop out of this filtered view rather than linger.
      const stillMatches = activeClient === ""
        || (activeClient === "__none__" ? updated.client === null : updated.client === activeClient);
      if (stillMatches) {
        setShots((current) => current.map((s) => (s.archive_id === shot.archive_id ? { ...s, client: updated.client } : s)));
      } else {
        setShots((current) => current.filter((s) => s.archive_id !== shot.archive_id));
      }
      refreshClients();
    } catch (clientError) {
      setError(`Could not update client: ${clientError.message ?? clientError}`);
    }
  }

  useEffect(() => {
    if (!model) return;
    const next = {};
    for (const [name, spec] of Object.entries(model.params)) {
      if (HIDE.has(name)) continue;
      if (spec.default !== undefined) next[name] = spec.default;
      else if (spec.enum?.length) next[name] = spec.enum[0];
    }
    setParams(next);
    setRewritten(null);
  }, [modelId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const next = Object.fromEntries((SHOT_DIRECTION[format] ?? []).map((field) => [field.id, field.options[0].value]));
    setShotSettings(next);
    setRewritten(null);
  }, [format]);

  useEffect(() => {
    if (!model) return;
    setParams((current) => applyFrameDefault(current, model, format));
  }, [format, modelId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!modelId) return;
    let dead = false;
    readJson("/api/quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ modelId, params }),
    })
      .then((q) => {
        if (dead) return;
        setQuote(q);
        if (!q.kie) setProvider("fal"); // stay on fal if this model has no Kie mapping
      })
      .catch(() => {});
    return () => { dead = true; };
  }, [modelId, params]);

  async function optimize() {
    if (!idea.trim() || !modelId) return;
    const assignment = assignInputFields(model, refs);
    if (!assignment.ok) return setError(assignment.reason);
    setBusy(true); setError(null);
    try {
      const result = await readJson("/api/optimize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idea, modelId, format, params, shotSettings, refCount: refs.length, hasReference: refs.length > 0 }),
      });
      setRewritten(result);
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }

  // Multiple files/picks can land in one burst (a multi-file chooser event,
  // or several starred picks confirmed together). React has not necessarily
  // rendered the previous attachment before the next resolves, so read and
  // update the synchronous ref as the source of truth for the whole burst,
  // then flush to state once at the end.
  function applyAttachedAsset(targetModel, nextAsset) {
    const assignment = assignInputFields(targetModel, [...refsRef.current, nextAsset]);
    if (!assignment.ok) throw new Error(assignment.reason);
    refsRef.current = assignment.assets;
    if (targetModel?.id !== model?.id) {
      setModelId(targetModel.id);
      setRewritten(null);
    }
  }

  // Re-run the full assignment with the requested field pinned on that one
  // asset, so a manual pick still gets arity/limit validation (e.g. picking
  // an already-occupied single-arity field fails cleanly) and roll back on
  // conflict instead of leaving refs in a half-applied state.
  function reassignRef(index, field) {
    const current = refsRef.current;
    if (!current[index]) return;
    const next = current.map((asset, i) => (i === index ? { ...asset, field } : asset));
    const assignment = assignInputFields(model, next);
    if (!assignment.ok) return setError(assignment.reason);
    refsRef.current = assignment.assets;
    setRefs(assignment.assets);
  }

  function targetModelFor(mediaType) {
    let targetModel = model;
    if (!mediaInputsFor(targetModel, mediaType).length && mediaType === "image" && referenceModel) {
      targetModel = referenceModel;
    }
    if (!mediaInputsFor(targetModel, mediaType).length) {
      throw new Error(`${model?.label ?? "This model"} does not accept ${mediaType} input. Choose a compatible model first.`);
    }
    // Check the slot is actually free before the caller uploads anything —
    // assignInputFields would catch this too, but only after a real fal
    // upload already happened. Checked against refsRef.current, not refs,
    // so this stays correct mid-burst when several files attach in one go.
    if (remainingCapacity(targetModel, refsRef.current, mediaType) <= 0) {
      const probe = assignInputFields(targetModel, [...refsRef.current, { media_type: mediaType, url: "__probe__" }]);
      throw new Error(probe.reason ?? `${targetModel.label}'s ${mediaType} input is already full. Remove an existing reference first.`);
    }
    return targetModel;
  }

  // `target` is set when the file came from a named slot's own [+] (or an
  // Element card's frontal/angle button) rather than the generic dropzone —
  // it pins the asset's field (and, for Kling's Elements, which
  // character/object group and role it belongs to) instead of letting
  // assignInputFields auto-pick.
  async function attach(file, target) {
    setBusy(true); setError(null);
    let uploaded = false;
    try {
      const mediaType = mediaTypeForFile(file);
      if (mediaType === "file") throw new Error("Use an image, video, audio file, or PDF.");
      const targetModel = targetModelFor(mediaType);
      const fd = new FormData();
      fd.append("file", file);
      const j = await readJson("/api/upload", { method: "POST", body: fd });
      uploaded = true;
      if (j.error) throw new Error(j.error);
      const nextAsset = {
        ...j,
        url: j.remote_url ?? j.url,
        name: file.name,
        media_type: j.media_type ?? mediaType,
        preview: URL.createObjectURL(file),
        ...(target?.field ? { field: target.field } : {}),
        ...(target?.elementIndex != null ? { element_index: target.elementIndex } : {}),
        ...(target?.elementRole ? { element_role: target.elementRole } : {}),
      };
      applyAttachedAsset(targetModel, nextAsset);
      setRefs(refsRef.current);
    } catch (e) {
      // Only call it an upload failure if a network upload actually ran —
      // a rejected-before-upload slot conflict is a different kind of error
      // and "Upload failed" would be misleading (and wrong: fal was never hit).
      const message = uploaded ? `Upload failed: ${e.message ?? e}` : String(e.message ?? e);
      if (/exhausted balance|user is locked/i.test(message)) setFalLocked(true);
      setError(message);
    }
    finally { setBusy(false); }
  }

  // Reuse one or more starred archive results as fresh references, without
  // a download/Finder round-trip. Each pick goes through /api/reuse-output,
  // which re-hosts the local mirror on fal so the reference stays fetchable
  // even if the original remote_url (a Kie tempfile, say) has expired.
  async function attachFromArchive(outputs) {
    if (!outputs?.length) return;
    setBusy(true); setError(null);
    let attachedCount = 0;
    try {
      const targetModel = targetModelFor("image");
      for (const output of outputs) {
        if (remainingCapacity(targetModel, refsRef.current, "image") <= 0) {
          throw new Error(`${targetModel.label}'s image input is already full.`);
        }
        const j = await readJson("/api/reuse-output", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            local_path: output.local_path,
            content_type: output.content_type,
            name: output.name ?? undefined,
          }),
        });
        if (j.error) throw new Error(j.error);
        const nextAsset = {
          ...j,
          url: j.remote_url ?? j.url,
          name: j.name,
          media_type: j.media_type ?? "image",
          preview: output.local_url ?? j.local_url,
        };
        // A model with single-arity image input can only take the first of
        // a multi-select batch — that is a real, expected stop, not a bug.
        // Surface it as an informative "N attached, rest didn't fit" message
        // rather than letting it read as a generic failure once caught below.
        applyAttachedAsset(targetModel, nextAsset);
        attachedCount++;
      }
    } catch (e) {
      const remaining = outputs.length - attachedCount;
      const message = attachedCount > 0
        ? `Attached ${attachedCount} of ${outputs.length} — ${remaining} more didn't fit: ${e.message ?? e}`
        : `Could not attach starred result: ${e.message ?? e}`;
      if (/exhausted balance|user is locked/i.test(message)) setFalLocked(true);
      setError(message);
    } finally {
      // Flush whatever succeeded even if a later item in the batch failed —
      // losing an already-successful attach because the next one didn't fit
      // would be worse than the partial-batch error above.
      setRefs(refsRef.current);
      setBusy(false);
    }
  }

  async function generate() {
    const prompt = (rewritten?.prompt ?? idea).trim();
    if (!prompt || !modelId) return;

    const assignment = assignInputFields(model, refs);
    if (!assignment.ok) return setError(assignment.reason);

    setBusy(true); setError(null);
    setJob({ phase: "submitting", model: model?.label });

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const useKie = provider === "kie" && quote?.kie;
      const client = activeClient && activeClient !== "__none__" ? activeClient : null;
      const res = await fetch(useKie ? "/api/generate-kie" : "/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: ctrl.signal,
        body: JSON.stringify(useKie ? {
          modelId, prompt, params, rawIdea: idea,
          referenceUrls: refs.map((r) => r.url),
          client,
        } : {
          modelId, prompt, params, format, rawIdea: idea,
          shotSettings, client,
          inputAssets: refs.map(({ url, field, media_type, upload_id, name, element_index, element_role }) => ({
            url, field, media_type, upload_id, name, element_index, element_role,
          })),
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        let message = `Generation failed (${res.status})`;
        try { message = JSON.parse(text).error || message; } catch {}
        throw new Error(message);
      }

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const ev = JSON.parse(line);
          if (ev.phase === "error") {
            if (/exhausted balance|user is locked/i.test(ev.error ?? "")) setFalLocked(true);
            setError(ev.error); setJob(null);
          }
          else if (ev.phase === "done") {
            // Only prepend optimistically if it belongs to the client
            // currently being viewed — a client switch mid-generation
            // shouldn't inject a card into a filtered view it doesn't
            // belong to. refreshLedger() below corrects the view either way.
            const evClient = ev.ledger?.client && ev.ledger.client !== "__none__" ? ev.ledger.client : null;
            const viewingClient = activeClient && activeClient !== "__none__" ? activeClient : null;
            if (evClient === viewingClient) {
              setShots((p) => [{ ...ev.ledger, at: Date.now() }, ...p]);
            }
            setJob(null);
            setGlobalSummary(ev.spend);
            refreshLedger();
            refreshClients();
          } else setJob((j) => ({ ...j, ...ev }));
        }
      }
    } catch (e) {
      if (e.name !== "AbortError") {
        const message = String(e.message ?? e);
        if (/exhausted balance|user is locked/i.test(message)) setFalLocked(true);
        setError(message);
      }
      setJob(null);
    } finally { setBusy(false); abortRef.current = null; }
  }

  function pickModel(nextId) {
    const picked = catalog?.models.find((candidate) => candidate.id === nextId);
    if (!picked) return;
    let switchNotice = null;
    if (refs.length && picked) {
      const retained = retainCompatibleAssets(picked, refs);
      setRefs(retained.assets);
      refsRef.current = retained.assets;
      if (retained.removed.length) {
        const count = retained.removed.length;
        switchNotice = `Switched to ${picked.label}. Removed ${count} incompatible reference${count === 1 ? "" : "s"} because this model cannot accept ${count === 1 ? "it" : "them"}.`;
      }
    }
    setModelId(nextId);
    setRewritten(null);
    setQuote(null);
    try { localStorage.setItem("bench.last-model", nextId); } catch {}
    setError(switchNotice);
  }

  return (
    <div className="shell">
      <a className="skip-link" href="#main-content">Skip to workspace</a>
      <TopBar
        summary={globalSummary}
        activeView={activeView}
        onLedger={() => { setShowCredits(false); setShowLedger((v) => !v); }}
        ledgerOpen={showLedger}
        billing={billing}
        onCredits={() => { setShowLedger(false); setShowCredits((value) => !value); }}
        creditsOpen={showCredits}
        activeClient={activeClient}
        clients={clients}
        onClientChange={setActiveClient}
      />

      <div className="scroll">
        <div className="studio-layout">
          <main className="workspace" id="main-content" tabIndex="-1">
            <div className="workspace-inner">
              {activeView === "create" && <section className="hero view-page" id="create">
                <div className="workspace-head">
                  <div className="hero-copy">
                    <div className="eyebrow">Create</div>
                    <h1>Create a <em>shot</em>.</h1>
                    <p>Choose a model, add a reference if you have one, and describe the result.</p>
                  </div>
                </div>

                <div className="creator">
                  <div className="creator-head">
                    <h2>Describe your shot</h2>
                    {catalog ? (
                      <CatalogStatus catalog={catalog} syncing={syncingCatalog} onSync={syncCatalog} />
                    ) : <span>Loading models</span>}
                  </div>
                  <PromptBar
                    catalog={catalog}
                    model={model}
                    idea={idea}
                    setIdea={(v) => { setIdea(v); setRewritten(null); }}
                    format={format}
                    setFormat={(v) => { setFormat(v); setRewritten(null); }}
                    params={params}
                    setParams={setParams}
                    hide={HIDE}
                    refs={refs}
                    onAttach={attach}
                    onAttachFromArchive={attachFromArchive}
                    onRemoveRef={(i) => setRefs((current) => {
                      const next = current.filter((_, j) => j !== i);
                      refsRef.current = next;
                      return next;
                    })}
                    onReassignRef={reassignRef}
                    rewritten={rewritten}
                    setRewritten={setRewritten}
                    onOptimize={optimize}
                    onGenerate={generate}
                    onPickModel={pickModel}
                    referenceModel={referenceModel}
                    shotSettings={shotSettings}
                    setShotSettings={(next) => { setShotSettings(next); setRewritten(null); }}
                    quote={quote}
                    provider={provider}
                    setProvider={setProvider}
                    busy={busy}
                    running={Boolean(job)}
                    activeClient={activeClient}
                  />
                </div>

                {error && <ErrorNotice error={error} onClose={() => setError(null)} />}
                {!error && !shots.length && !job && (
                  <div className="hint"><span><b>Add a reference</b> if it helps. Then describe the shot in your own words.</span></div>
                )}
                {(job || shots.length > 0) && (
                  <section className="create-results" id="create-results" aria-label="Generated media">
                    <Work job={job} shots={shots} onDelete={deleteResult} onToggleStar={toggleStar} onSetClient={setShotClient} clients={clients} activeClient={activeClient} />
                  </section>
                )}
              </section>}

              {activeView === "work" && (
                <section className="view-page" id="work">
                  <div className="view-heading">
                    <div>
                      <div className="eyebrow">Results</div>
                      <h1>Everything you made.</h1>
                      <p>Images and videos, with the model, prompt, local copy, and actual billed cost attached.</p>
                    </div>
                    <a className="view-action" href="#create">Create another</a>
                  </div>
                  {error && <ErrorNotice error={error} onClose={() => setError(null)} />}
                  <Work job={job} shots={shots} standalone onDelete={deleteResult} onToggleStar={toggleStar} onSetClient={setShotClient} clients={clients} activeClient={activeClient} />
                </section>
              )}

              {activeView === "models" && (
                <section className="view-page" id="models">
                  <div className="view-heading">
                    <div>
                      <div className="eyebrow">Model catalog</div>
                      <h1>Pick the right model.</h1>
                      <p>Compare output type, accepted inputs, speed, and pricing before you commit to a run.</p>
                    </div>
                  </div>
                  <ModelWall
                    catalog={catalog}
                    modelId={modelId}
                    onPick={(nextId) => {
                      pickModel(nextId);
                      openView("create");
                    }}
                  />
                </section>
              )}
              {activeView === "connect" && <Tooling />}
              {activeView === "websites" && <CreativeStudio kind="website" />}
              {activeView === "documents" && <CreativeStudio kind="document" />}
            </div>
          </main>
        </div>
      </div>

      {showLedger && (
        <>
          <div className="modal-scrim" onClick={() => setShowLedger(false)} />
          <Ledger ledger={ledger} onClose={() => setShowLedger(false)} activeClient={activeClient} />
        </>
      )}
      {showCredits && (
        <>
          <div className="modal-scrim" onClick={() => setShowCredits(false)} />
          <CreditPanel
            billing={billing}
            locked={falLocked}
            refreshing={refreshingBilling}
            onRefresh={() => refreshBilling(true)}
            onClose={() => setShowCredits(false)}
          />
        </>
      )}
    </div>
  );
}
