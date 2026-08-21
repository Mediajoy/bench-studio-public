import React, { useEffect, useMemo, useRef, useState } from "react";
import { displayName } from "./slug.js";

// Results, big. Each one keeps its own price and billing confidence.

const FORMAT_LABELS = {
  ugc: "UGC ad",
  unboxing: "Unboxing",
  hypermotion: "Hyper motion",
  tvspot: "TV spot",
  product: "Product still",
  poster: "Ad with headline",
};

export default function Work({ job, shots, standalone = false, onDelete, onToggleStar, onSetClient, clients = [], activeClient = "", onSetSeries, activeSeries = "", pendingSeries = {} }) {
  const clientLabel = activeClient === "__none__" ? "Unassigned"
    : activeClient ? displayName(activeClient)
    : null;
  const seriesLabel = activeClient
    ? (activeSeries === "__none__" ? "No series" : activeSeries ? displayName(activeSeries) : null)
    : null;
  const scopeLabel = [clientLabel, seriesLabel].filter(Boolean).join(" — ");
  return (
    <div className={`wall results-wall${standalone ? " standalone" : ""}`}>
      <div className="wall-head">
        <h2>{scopeLabel ? `${standalone ? "Library" : "Results"} — ${scopeLabel}` : (standalone ? "Library" : "Your results")}</h2>
        <span>{shots.length} {shots.length === 1 ? "result" : "results"}</span>
        <div className="rule" />
        <span>${shots.reduce((a, s) => a + (Number(s.cost) || 0), 0).toFixed(3)} spent{scopeLabel ? ` (${scopeLabel})` : ""}</span>
      </div>

      {!job && !shots.length ? (
        <div className="results-empty">
          <strong>No results yet</strong>
          <span>Your generated images and videos will appear here.</span>
          <a href="#create">Create your first shot</a>
        </div>
      ) : (
        <div className="masonry">
          {job && <Job job={job} />}
          {shots.map((s) => (
            <Shot
              key={`${s.archive_id ?? s.request_id}-${s.at}`}
              shot={s}
              onDelete={onDelete}
              onToggleStar={onToggleStar}
              onSetClient={onSetClient}
              clients={clients}
              onSetSeries={onSetSeries}
              pendingSeries={pendingSeries}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Job({ job }) {
  return (
    <div className="job">
      <div className="ph pulse">{job.status ?? job.phase}</div>
      <div className="meta">
        <span>{job.model ?? ""}</span>
        <span>
          {job.queue_position != null ? `queue ${job.queue_position}` : ""}
          {job.estimate?.cost != null ? ` · ~$${job.estimate.cost.toFixed(3)}` : ""}
        </span>
      </div>
      <div className="bar-lite"><i /></div>
    </div>
  );
}

function Shot({ shot, onDelete, onToggleStar, onSetClient, clients = [], onSetSeries, pendingSeries = {} }) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [starring, setStarring] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [assigningSeries, setAssigningSeries] = useState(false);
  const [seriesOptions, setSeriesOptions] = useState([]);
  const [pathCopied, setPathCopied] = useState(false);
  const verified = shot.cost_confidence === "verified";
  const formatLabel = FORMAT_LABELS[shot.format];
  const idea = String(shot.raw_idea || shot.prompt || "").trim();
  const resultLabel = shot.label || "Untitled result";
  // Unassigned is a first-class scope too — a shot with no client can still
  // take a series, it just files under the "__none__" bucket instead of a
  // named client (the server already groups client IS NULL rows this way).
  const shotScope = shot.client ?? "__none__";

  // Series is scoped to THIS shot's own client/scope, independent of
  // whatever client filter is active in TopBar — the earlier version tied
  // this to the globally active client, which meant the control silently
  // disappeared from Details whenever you weren't specifically filtered to
  // that exact client (looked like a missing feature, not an empty state).
  // Fetched lazily on open rather than passed down, since the global
  // seriesList in App.jsx is scoped to one client at a time and can't serve
  // every shot's own scope in a mixed "All clients" view.
  useEffect(() => {
    if (!detailsOpen) return;
    setSeriesOptions([]); // stop the previous scope's series from staying selectable for a beat while this reassigns
    let dead = false;
    fetch(`/api/series?client=${encodeURIComponent(shotScope)}`)
      .then((r) => r.json())
      .then((d) => { if (!dead) setSeriesOptions(d.rows ?? []); })
      .catch(() => {});
    return () => { dead = true; };
  }, [detailsOpen, shot.client]);

  // Merge fetched rows with this shot's own pending (zero-generation, just
  // created in the TopBar) series for the SAME scope, plus the shot's
  // current value defensively so it never renders blank. Scope-matched only
  // — a series created under Unassigned must not leak into a real client's
  // Details and manufacture a cross-client series.
  const seriesSelectOptions = useMemo(() => {
    const seen = new Set();
    const options = [];
    for (const row of seriesOptions) {
      if (!row.series || seen.has(row.series)) continue;
      seen.add(row.series);
      options.push({ value: row.series, label: displayName(row.series), isNew: false });
    }
    for (const slug of pendingSeries[shotScope] ?? []) {
      if (!slug || seen.has(slug)) continue;
      seen.add(slug);
      options.push({ value: slug, label: `${displayName(slug)} (new)`, isNew: true });
    }
    if (shot.series && !seen.has(shot.series)) {
      options.push({ value: shot.series, label: displayName(shot.series), isNew: false });
    }
    return options;
  }, [seriesOptions, pendingSeries, shotScope, shot.series]);

  async function assignClient(event) {
    const next = event.target.value || null;
    setAssigning(true);
    try {
      await onSetClient?.(shot, next);
    } finally {
      setAssigning(false);
    }
  }

  async function assignSeries(event) {
    const next = event.target.value || null;
    setAssigningSeries(true);
    try {
      await onSetSeries?.(shot, next);
    } finally {
      setAssigningSeries(false);
    }
  }

  async function removeResult() {
    setDeleting(true);
    try {
      await onDelete?.(shot);
    } finally {
      setDeleting(false);
    }
  }

  async function toggleStar() {
    setStarring(true);
    try {
      await onToggleStar?.(shot);
    } finally {
      setStarring(false);
    }
  }

  // The absolute filesystem path, not the /media/... URL the <img>/<video>
  // tags use — that's what's actually useful to paste into Finder, a
  // terminal, or another app. Only present when the archive kept a local
  // copy (local_path is unset for remote-only rows).
  const localPath = shot.outputs?.[0]?.local_path;
  async function copyPath() {
    if (!localPath) return;
    await navigator.clipboard.writeText(localPath);
    setPathCopied(true);
    setTimeout(() => setPathCopied(false), 1400);
  }

  return (
    <div className="work">
      {shot.outputs.map((o, i) => {
        const source = o.local_url || o.url;
        const isVideo =
          String(o.content_type ?? "").startsWith("video") || /\.mp4($|\?)/.test(source);
        return isVideo ? (
          <VideoPreview key={i} src={source} />
        ) : (
          <img key={i} src={source} alt={resultLabel} loading="lazy" />
        );
      })}

      <span className="work-tag" title={shot.cost_basis}>
        <span className={`dot ${verified ? "verified" : "estimated"}`} />
        {verified ? "Billed" : "Est."} ${Number(shot.cost ?? 0).toFixed(3)}
      </span>

      <div className="work-foot">
        <div className="l">
          <div className="work-title">
            <span className="work-name">{resultLabel}</span>
            {formatLabel && <span className="work-format">{formatLabel}</span>}
            {shot.client && <span className="work-client">{displayName(shot.client)}</span>}
            {shot.series && <span className="work-client work-series">{displayName(shot.series)}</span>}
          </div>
          <div className="work-actions">
            {onToggleStar && shot.archive_id && (
              <button
                type="button"
                className={`work-star${shot.starred ? " on" : ""}`}
                onClick={toggleStar}
                disabled={starring}
                aria-pressed={Boolean(shot.starred)}
                aria-label={shot.starred ? `Unstar ${resultLabel}` : `Star ${resultLabel}`}
                title={shot.starred ? "Starred — click to unstar" : "Star this result so you can pick it as a reference later"}
              >
                {shot.starred ? "★" : "☆"}
              </button>
            )}
            <button type="button" onClick={() => setDetailsOpen((value) => !value)} aria-expanded={detailsOpen}>
              {detailsOpen ? "Hide details" : "Details"}
            </button>
            <a href={shot.outputs[0]?.local_url || shot.outputs[0]?.url} download aria-label={`Download ${resultLabel}`}>Download</a>
            {localPath && (
              <button
                type="button"
                className="work-copy-path"
                onClick={copyPath}
                aria-label={`Copy the local file path for ${resultLabel}`}
                title={localPath}
              >
                {pathCopied ? "Copied" : "Copy path"}
              </button>
            )}
            {onDelete && shot.archive_id && (
              <button type="button" className="work-delete" onClick={() => setConfirmingDelete(true)} aria-label={`Delete ${resultLabel}`}>
                Delete
              </button>
            )}
          </div>
        </div>
        <div className="p">{idea}</div>
        {detailsOpen && (
          <div className="work-details">
            <dl>
              <div><dt>Model</dt><dd>{shot.label}</dd></div>
              <div><dt>Cost</dt><dd>{verified ? "Verified billed amount" : "Estimate"} · ${Number(shot.cost ?? 0).toFixed(4)}</dd></div>
              {shot.request_id && <div><dt>Request</dt><dd>{shot.request_id}</dd></div>}
              <div><dt>Archive</dt><dd>{shot.outputs.some((output) => output.local_url) ? "Saved locally" : "Remote copy only"}</dd></div>
              {localPath && (
                <div>
                  <dt>Local path</dt>
                  <dd className="work-path-row">
                    <code>{localPath}</code>
                    <button type="button" onClick={copyPath} aria-label={`Copy the local file path for ${resultLabel}`}>
                      {pathCopied ? "Copied" : "Copy"}
                    </button>
                  </dd>
                </div>
              )}
              {onSetClient && shot.archive_id && (
                <div>
                  <dt>Client</dt>
                  <dd>
                    <select value={shot.client ?? ""} onChange={assignClient} disabled={assigning} aria-label={`Assign ${resultLabel} to a client`}>
                      <option value="">Unassigned</option>
                      {clients.filter((c) => c.client).map((c) => (
                        <option key={c.client} value={c.client}>{displayName(c.client)}</option>
                      ))}
                    </select>
                  </dd>
                </div>
              )}
              {onSetSeries && shot.archive_id && (
                <div>
                  <dt>Series</dt>
                  <dd>
                    <select value={shot.series ?? ""} onChange={assignSeries} disabled={assigningSeries} aria-label={`Assign ${resultLabel} to a series`}>
                      <option value="">No series</option>
                      {seriesSelectOptions.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </dd>
                </div>
              )}
            </dl>
            <strong>Prompt sent</strong>
            <p>{shot.prompt}</p>
            {shot.outputs[0]?.remote_url && <a className="hosted-copy" href={shot.outputs[0].remote_url} target="_blank" rel="noreferrer">Open fal-hosted copy ↗</a>}
          </div>
        )}
        {confirmingDelete && (
          <div className="work-delete-confirm" role="group" aria-label={`Confirm deletion of ${resultLabel}`}>
            <div>
              <strong>Delete this result?</strong>
              <span>Removes it from Bench and deletes the local copy. The fal-hosted copy may remain.</span>
            </div>
            <div>
              <button type="button" onClick={() => setConfirmingDelete(false)} disabled={deleting}>Keep it</button>
              <button type="button" className="danger" onClick={removeResult} disabled={deleting}>
                {deleting ? "Deleting…" : "Delete result"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function VideoPreview({ src }) {
  const videoRef = useRef(null);
  const soundEnabledRef = useRef(false);
  const [soundEnabled, setSoundEnabled] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;

    video.defaultMuted = true;
    video.muted = true;

    const scrollRoot = document.querySelector(".scroll");
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          if (!soundEnabledRef.current) video.muted = true;
          video.play().catch(() => {});
        } else {
          video.pause();
        }
      },
      { root: scrollRoot, rootMargin: "120px 0px", threshold: 0.35 }
    );

    observer.observe(video);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    soundEnabledRef.current = soundEnabled;
    if (!video) return;
    video.muted = !soundEnabled;
    if (soundEnabled && video.volume === 0) video.volume = 1;
  }, [soundEnabled]);

  const keepSoundIntentional = (event) => {
    const video = event.currentTarget;
    if (!soundEnabledRef.current && !video.muted) {
      video.muted = true;
    } else if (soundEnabledRef.current && video.muted) {
      setSoundEnabled(false);
    }
  };

  return (
    <div className="work-video-shell">
      <video
        ref={videoRef}
        className="work-video"
        src={src}
        controls
        loop
        muted={!soundEnabled}
        playsInline
        preload="metadata"
        onVolumeChange={keepSoundIntentional}
        aria-label="Generated video preview"
      />
      <button
        type="button"
        className={`work-sound-toggle${soundEnabled ? " enabled" : ""}`}
        onClick={() => setSoundEnabled((enabled) => !enabled)}
        aria-pressed={soundEnabled}
        aria-label={soundEnabled ? "Mute this video" : "Unmute this video"}
      >
        {soundEnabled ? "Sound on" : "Muted"}
      </button>
    </div>
  );
}
