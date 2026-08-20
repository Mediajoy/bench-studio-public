import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import MenuSelect from "./MenuSelect.jsx";
import {
  assignInputFields,
  formatPromptTag,
  imageFieldOptions,
  imageInputFor,
  inputSlotsFor,
  mediaInputsFor,
  modelKindLabel,
  modelLaneLabel,
  modelPriority,
  remainingCapacity,
  sortModels,
} from "./modelCatalog.js";

// One bar, one action. Everything that changes the output is a chip inside it,
// including the model, so you never leave the thing you are typing in.

function prettyParam(name, value) {
  const raw = String(value);
  const named = {
    square_hd: "Square HD",
    square: "Square",
    portrait_4_3: "Portrait 4:3",
    portrait_16_9: "Portrait 16:9",
    landscape_4_3: "Landscape 4:3",
    landscape_16_9: "Landscape 16:9",
  };
  if (name === "image_size" && named[raw]) return named[raw];
  if (name === "duration") {
    if (raw.toLowerCase() === "auto") return "Auto";
    if (/^\d+(\.\d+)?s$/i.test(raw)) return raw;
    return `${raw} ${raw === "1" ? "second" : "seconds"}`;
  }
  if (name === "fps") return `${raw} fps`;
  if (name === "num_images") return `${raw} ${raw === "1" ? "image" : "images"}`;
  if (["generate_audio", "enable_prompt_expansion", "auto_fix"].includes(name)) {
    return raw === "true" ? "On" : raw === "false" ? "Off" : raw;
  }
  return raw
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function paramLabel(name) {
  const labels = {
    aspect_ratio: "Aspect ratio",
    duration: "Duration",
    resolution: "Resolution",
    image_size: "Image size",
    camera_motion: "Camera motion",
    shot_type: "Shot type",
    quality: "Quality",
    thinking_level: "Thinking level",
    fps: "Frame rate",
    num_images: "Number of images",
    generate_audio: "Generate audio",
    enable_prompt_expansion: "Prompt expansion",
    auto_fix: "Auto fix",
  };
  return labels[name] ?? prettyParam("", name);
}

export const SHOT_DIRECTION = {
  ugc: [
    {
      id: "creator",
      label: "Creator",
      options: [
        { value: "any creator", label: "Any creator" },
        { value: "a woman in her 20s", label: "Woman in her 20s" },
        { value: "a man in his 30s", label: "Man in his 30s" },
        { value: "a founder or expert", label: "Founder or expert" },
      ],
    },
    {
      id: "setting",
      label: "Setting",
      options: [
        { value: "a real home setting", label: "Real home" },
        { value: "a bathroom mirror", label: "Bathroom mirror" },
        { value: "a kitchen counter", label: "Kitchen counter" },
        { value: "the front seat of a car", label: "Car interior" },
      ],
    },
    {
      id: "beat",
      label: "Beat",
      options: [
        { value: "a problem, product proof, then a reaction", label: "Problem → proof → reaction" },
        { value: "a quick honest testimonial", label: "Quick testimonial" },
        { value: "a product demonstration with one clear result", label: "Product demonstration" },
        { value: "an unexpected first impression", label: "First impression" },
      ],
    },
    {
      id: "camera",
      label: "Camera",
      options: [
        { value: "a front-facing selfie camera", label: "Front-facing selfie" },
        { value: "a friend filming handheld", label: "Friend filming" },
        { value: "a close handheld product detail", label: "Close handheld" },
        { value: "a locked-off phone on a surface", label: "Phone on surface" },
      ],
    },
  ],
  unboxing: [
    {
      id: "view",
      label: "View",
      options: [
        { value: "top-down hands opening the package", label: "Top-down hands" },
        { value: "an over-the-shoulder unboxing", label: "Over the shoulder" },
        { value: "a close handheld reveal", label: "Close reveal" },
      ],
    },
    {
      id: "surface",
      label: "Surface",
      options: [
        { value: "a warm kitchen table", label: "Kitchen table" },
        { value: "a clean desk by a window", label: "Desk by a window" },
        { value: "a soft bedroom surface", label: "Bedroom surface" },
      ],
    },
    {
      id: "moment",
      label: "Moment",
      options: [
        { value: "the satisfying reveal of the product", label: "Satisfying reveal" },
        { value: "the first use straight from the box", label: "First use" },
        { value: "a close look at the packaging details", label: "Packaging details" },
      ],
    },
  ],
  hypermotion: [
    {
      id: "movement",
      label: "Movement",
      options: [
        { value: "a fast push-in with a sharp orbit", label: "Push-in + orbit" },
        { value: "a whip-pan between product details", label: "Whip-pan details" },
        { value: "a smooth floating macro move", label: "Floating macro" },
      ],
    },
    {
      id: "light",
      label: "Light",
      options: [
        { value: "a crisp electric blue rim light", label: "Electric blue rim" },
        { value: "hard studio light with deep shadows", label: "Hard studio light" },
        { value: "warm sunset light with bright highlights", label: "Warm highlights" },
      ],
    },
  ],
  tvspot: [
    {
      id: "camera",
      label: "Camera",
      options: [
        { value: "a locked-off hero composition", label: "Locked hero" },
        { value: "a slow, deliberate dolly forward", label: "Slow dolly" },
        { value: "a graceful product orbit", label: "Product orbit" },
      ],
    },
    {
      id: "mood",
      label: "Mood",
      options: [
        { value: "quiet, refined and confident", label: "Quiet + refined" },
        { value: "bold and high-contrast", label: "Bold + high contrast" },
        { value: "warm, optimistic and human", label: "Warm + human" },
      ],
    },
  ],
};

function ShotDirection({ format, values, onChange }) {
  const fields = SHOT_DIRECTION[format] ?? [];
  if (!fields.length) return null;

  return (
    <section className="shot-direction" aria-label="Shot direction">
      <div className="shot-direction-head">
        <div>
          <strong>Direct the shot</strong>
          <span>Optional choices that guide the rewrite</span>
        </div>
        <span className="shot-direction-mode">{format === "ugc" ? "UGC recipe" : "Creative recipe"}</span>
      </div>
      <div className="shot-direction-fields">
        {fields.map((field) => (
          <div className="shot-direction-field" key={field.id}>
            <span>{field.label}</span>
            <MenuSelect
              value={values[field.id] ?? field.options[0].value}
              options={field.options}
              ariaLabel={field.label}
              className="direction-menu"
              onChange={(value) => onChange({ ...values, [field.id]: value })}
            />
          </div>
        ))}
      </div>
    </section>
  );
}

// One thumbnail + remove button + optional prompt-tag chip, shared by the
// plain slots and the element cards below.
function SlotThumb({ asset, index, onRemove, tag, onInsertTag }) {
  const tagText = tag ? formatPromptTag(tag, index) : null;
  return (
    <span className="slot-thumb-wrap">
      {asset.media_type === "image" ? (
        <img className="slot-thumb" src={asset.preview} alt={asset.name} />
      ) : (
        <span className={`attach-file attach-file-${asset.media_type}`} title={asset.name}>
          <b>{asset.media_type === "document" ? "PDF" : asset.media_type}</b>
          <small>{asset.name}</small>
        </span>
      )}
      <button type="button" className="attach-remove" onClick={onRemove} aria-label={`Remove ${asset.name}`} title="Remove">×</button>
      {tagText && (
        <button
          type="button"
          className="slot-tag"
          onClick={() => onInsertTag(tagText)}
          title={`Insert ${tagText} into the prompt — this reference does nothing unless the prompt names it`}
        >
          {tagText}
        </button>
      )}
    </span>
  );
}

// A plain (non-structured) named row: label, its attached thumbs, and a [+]
// while there's still capacity. This is what makes a model's real inputs
// visible before you ever attach anything, instead of a generic "+" that
// silently auto-routes to whichever field is open.
function SlotRow({ slot, assets, onOpenPicker, onRemove, onInsertTag, busy }) {
  const full = assets.length >= slot.capacity;
  const tag = slot.tagPrefix ? { tagPrefix: slot.tagPrefix, tagStyle: slot.tagStyle } : null;
  return (
    <div className="input-slot" title={slot.description || undefined}>
      <div className="input-slot-head">
        <span className="input-slot-label">{slot.label}</span>
        {slot.required && assets.length === 0 && <span className="input-slot-required">Required</span>}
      </div>
      <div className="input-slot-body">
        {assets.map((asset, i) => (
          <SlotThumb
            key={asset.url}
            asset={asset}
            index={i + 1}
            tag={tag}
            onInsertTag={onInsertTag}
            onRemove={() => onRemove(asset)}
          />
        ))}
        {!full && (
          <button
            type="button"
            className="slot-add"
            onClick={() => onOpenPicker(slot.field)}
            disabled={busy}
            aria-label={`Add ${slot.label}`}
          >
            +
          </button>
        )}
      </div>
    </div>
  );
}

// Kling's `elements` is the one structured field in the roster: an array of
// character/object objects (one required frontal image, up to 3 supporting
// angle images), addressed in the prompt as @Element1, @Element2... Each
// element gets its own card rather than one flat thumbnail row.
function ElementsSlot({ slot, assets, onOpenPicker, onRemove, onInsertTag, busy }) {
  const groups = new Map();
  for (const asset of assets) {
    const idx = asset.element_index ?? 0;
    if (!groups.has(idx)) groups.set(idx, { frontal: null, angles: [] });
    const group = groups.get(idx);
    if (asset.element_role === "frontal") group.frontal = asset;
    else group.angles.push(asset);
  }
  const indices = [...groups.keys()].sort((a, b) => a - b);
  const nextIndex = indices.length ? Math.max(...indices) + 1 : 0;
  const tag = slot.tagPrefix ? { tagPrefix: slot.tagPrefix, tagStyle: slot.tagStyle } : null;

  return (
    <div className="input-slot input-slot-elements" title={slot.description || undefined}>
      <div className="input-slot-head">
        <span className="input-slot-label">{slot.label}</span>
        <span className="input-slot-hint">Character or object — frontal + up to 3 angles</span>
      </div>
      <div className="element-cards">
        {indices.map((idx) => {
          const group = groups.get(idx);
          return (
            <div className="element-card" key={idx}>
              <div className="element-card-head">
                <span>Element {idx + 1}</span>
                {tag && (
                  <button type="button" className="slot-tag" onClick={() => onInsertTag(formatPromptTag(tag, idx + 1))}>
                    {formatPromptTag(tag, idx + 1)}
                  </button>
                )}
              </div>
              <div className="element-card-body">
                {group.frontal ? (
                  <SlotThumb asset={group.frontal} index={idx + 1} onRemove={() => onRemove(group.frontal)} />
                ) : (
                  <button type="button" className="slot-add slot-add-frontal" disabled={busy} onClick={() => onOpenPicker(slot.field, idx, "frontal")}>
                    + Frontal
                  </button>
                )}
                {group.angles.map((asset) => (
                  <SlotThumb key={asset.url} asset={asset} index={idx + 1} onRemove={() => onRemove(asset)} />
                ))}
                {group.frontal && group.angles.length < 3 && (
                  <button type="button" className="slot-add" disabled={busy} onClick={() => onOpenPicker(slot.field, idx, "angle")}>
                    + Angle
                  </button>
                )}
              </div>
            </div>
          );
        })}
        <button type="button" className="element-add" disabled={busy} onClick={() => onOpenPicker(slot.field, nextIndex, "frontal")}>
          + Element
        </button>
      </div>
    </div>
  );
}

const PRICE_UNITS = {
  images: "image",
  megapixels: "megapixel",
  "processed megapixels": "processed megapixel",
  seconds: "second",
  "compute seconds": "compute second",
  units: "unit",
};

function modelPrice(model) {
  const pricing = model?.pricing;
  if (!pricing) return "Price unavailable";
  const amount = Number(pricing.price);
  const value = amount < 0.01
    ? amount.toFixed(5).replace(/0+$/, "").replace(/\.$/, "")
    : amount.toFixed(amount < 0.1 ? 3 : 2).replace(/0+$/, "").replace(/\.$/, "");
  return `$${value} / ${PRICE_UNITS[pricing.unit] ?? pricing.unit}`;
}

function ModelPicker({ model, models, onChange, referenceActive, refs = [] }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [popoverStyle, setPopoverStyle] = useState(null);
  const [pinnedFilter, setPinnedFilter] = useState(() => {
    try { return localStorage.getItem("bench.model-filter-pinned") || ""; } catch { return ""; }
  });
  const [kindFilter, setKindFilter] = useState(() => {
    try {
      return localStorage.getItem("bench.model-filter-pinned") || localStorage.getItem("bench.model-filter") || "all";
    } catch { return "all"; }
  });
  const rootRef = useRef(null);
  const popoverRef = useRef(null);
  const searchRef = useRef(null);
  const normalizedQuery = query.trim().toLowerCase();
  const kindCounts = models.reduce((counts, candidate) => {
    counts[candidate.kind] = (counts[candidate.kind] ?? 0) + 1;
    return counts;
  }, {});
  const filteredModels = sortModels(models.filter((candidate) => {
    const matchesKind = normalizedQuery || kindFilter === "all" || candidate.kind === kindFilter;
    const matchesQuery = !normalizedQuery ||
      `${candidate.label} ${candidate.vendor} ${candidate.id} ${modelLaneLabel(candidate)}`.toLowerCase().includes(normalizedQuery);
    return matchesKind && matchesQuery;
  }));
  const popularModelId = filteredModels.find((candidate) => modelPriority(candidate) < 6)?.id;

  function measurePopover() {
    const trigger = rootRef.current?.getBoundingClientRect();
    if (!trigger) return null;
    const headerBottom = document.querySelector(".top")?.getBoundingClientRect().bottom ?? 0;
    const edge = 12;
    const gap = 8;
    const safeTop = headerBottom + 10;
    const width = Math.min(470, window.innerWidth - edge * 2);
    const availableAbove = Math.max(180, trigger.top - safeTop - gap);
    const availableBelow = Math.max(180, window.innerHeight - trigger.bottom - edge - gap);
    const useAbove = availableAbove >= availableBelow;
    return {
      left: Math.max(edge, Math.min(trigger.left, window.innerWidth - width - edge)),
      top: useAbove ? safeTop : trigger.bottom + gap,
      width,
      maxHeight: useAbove ? availableAbove : availableBelow,
    };
  }

  useEffect(() => {
    try { localStorage.setItem("bench.model-filter", kindFilter); } catch {}
  }, [kindFilter]);

  function chooseFilter(next) {
    setKindFilter(next);
    setQuery("");
    if (next === "all" || model.kind === next) return;

    const compatible = sortModels(models.filter((candidate) =>
      candidate.kind === next && (!refs.length || assignInputFields(candidate, refs).ok)
    ));
    if (compatible[0]) {
      onChange(compatible[0].id);
      setOpen(false);
    }
  }

  function togglePinnedFilter() {
    const next = pinnedFilter === kindFilter ? "" : kindFilter;
    setPinnedFilter(next);
    try {
      if (next) localStorage.setItem("bench.model-filter-pinned", next);
      else localStorage.removeItem("bench.model-filter-pinned");
    } catch {}
  }

  useEffect(() => {
    if (!open) return undefined;
    const closeOnOutsideClick = (event) => {
      if (!rootRef.current?.contains(event.target) && !popoverRef.current?.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    const placePopover = () => setPopoverStyle(measurePopover());
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", placePopover);
    document.querySelector(".scroll")?.addEventListener("scroll", placePopover, { passive: true });
    placePopover();
    requestAnimationFrame(() => searchRef.current?.focus());
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", placePopover);
      document.querySelector(".scroll")?.removeEventListener("scroll", placePopover);
    };
  }, [open]);

  function choose(candidate) {
    onChange(candidate.id);
    setOpen(false);
    setQuery("");
  }

  return (
    <div ref={rootRef} className={`model-picker${open ? " open" : ""}`}>
      <button
        type="button"
        className="model-picker-trigger"
        aria-label={`Change model, current ${model.label}, ${modelKindLabel(model)}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => {
          if (!current) {
            setKindFilter(model.kind);
            setQuery("");
            setPopoverStyle(measurePopover());
          }
          return !current;
        })}
      >
        {model.thumbnail && <img src={model.thumbnail} alt="" />}
        <span className="model-picker-name">{model.label}</span>
        <span className={`model-picker-kind kind-${model.kind}${referenceActive ? " reference" : ""}`}>
          {referenceActive ? modelLaneLabel(model) : modelKindLabel(model)}
        </span>
        <i className="menu-chevron" aria-hidden="true" />
      </button>

      {open && createPortal((
        <div ref={popoverRef} className="model-picker-popover" style={popoverStyle ?? undefined}>
          <div className="model-picker-head">
            <div className="model-picker-head-copy">
              <strong>Choose a model</strong>
              <span>Start with the output type</span>
            </div>
            <div className="model-picker-head-actions">
              <span className="model-picker-count">{models.length} available</span>
              {kindFilter !== "all" && (
                <button
                  type="button"
                  className={`model-filter-pin${pinnedFilter === kindFilter ? " active" : ""}`}
                  aria-pressed={pinnedFilter === kindFilter}
                  onClick={togglePinnedFilter}
                  title={pinnedFilter === kindFilter ? "Remove this default" : `Open ${modelKindLabel({ kind: kindFilter })} models by default`}
                >
                  <i aria-hidden="true" />
                  {pinnedFilter === kindFilter ? "Default" : "Make default"}
                </button>
              )}
            </div>
          </div>
          <div className="model-kind-filter" role="group" aria-label="Filter models by output type">
            <span className="model-kind-filter-label">Output</span>
            <div className="model-kind-filter-options">
              {[
                { id: "all", label: "All", count: models.length },
                { id: "image", label: "Image", count: kindCounts.image ?? 0 },
                { id: "video", label: "Video", count: kindCounts.video ?? 0 },
              ].filter((filter) => filter.id === "all" || filter.count > 0).map((filter) => (
                <button
                  key={filter.id}
                  type="button"
                  className={`model-kind-filter-button${kindFilter === filter.id ? " active" : ""}`}
                  aria-pressed={kindFilter === filter.id}
                  aria-label={filter.id === "all" ? "Show all models" : `Switch output to ${filter.label}`}
                  onClick={() => chooseFilter(filter.id)}
                >
                  <span className={`model-kind-filter-mark ${filter.id}`} aria-hidden="true" />
                  <span className="model-kind-filter-name">{filter.label}</span>
                  <b>{filter.count}</b>
                </button>
              ))}
            </div>
          </div>
          <input
            ref={searchRef}
            className="model-search"
            type="search"
            value={query}
            placeholder="Search models"
            aria-label="Search models"
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="model-list" role="listbox" aria-label="Available models">
            {filteredModels.map((candidate) => (
              <button
                type="button"
                role="option"
                aria-selected={candidate.id === model.id}
                className={`model-option${candidate.id === model.id ? " selected" : ""}`}
                key={candidate.id}
                onClick={() => choose(candidate)}
              >
                {candidate.thumbnail ? (
                  <img src={candidate.thumbnail} alt="" />
                ) : (
                  <span className="model-option-placeholder" aria-hidden="true" />
                )}
                <span className="model-option-copy">
                  <b>{candidate.label}</b>
                  <small>
                    {candidate.vendor} · {modelLaneLabel(candidate)} · {modelPrice(candidate)}
                    {candidate.capabilities?.modalities?.length ? ` · takes ${candidate.capabilities.modalities.join(" + ")}` : ""}
                  </small>
                </span>
                <span className="model-option-tail">
                  <span className={`model-option-kind kind-${candidate.kind}`}>{modelKindLabel(candidate)}</span>
                  {candidate.id === popularModelId && <em className="model-option-recommended">Popular</em>}
                  {candidate.tier === "fastest" && <em>Fast</em>}
                  {candidate.id === model.id && <strong aria-label="Selected">✓</strong>}
                </span>
              </button>
            ))}
            {!filteredModels.length && (
              <div className="model-empty">
                No {kindFilter === "all" ? "models" : `${kindFilter} models`} match “{query}”.
              </div>
            )}
          </div>
        </div>
      ), document.body)}
    </div>
  );
}

// Pick one or more starred archive results to reuse as fresh references,
// instead of downloading and re-uploading through Finder. Fetches on open
// so it always reflects the latest starred set.
function StarredPicker({ onClose, onPick, maxSelectable, activeClient, activeSeries }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  // Infinity means "no declared limit" — don't cap the picker or print a
  // fabricated number, just let selection run free for those models.
  const capped = maxSelectable != null && Number.isFinite(maxSelectable);
  const atLimit = capped && selected.size >= maxSelectable;

  useEffect(() => {
    let dead = false;
    // Scoped to the active client/series so a church shoot doesn't get
    // offered a salon's starred reference plates in the picker — and so
    // Unassigned doesn't get offered every client's starred plates either,
    // now that Unassigned is a first-class scope like any client.
    const client = activeClient || null;
    const series = client && activeSeries && activeSeries !== "__none__" ? activeSeries : null;
    const params = new URLSearchParams();
    if (client) params.set("client", client);
    if (series) params.set("series", series);
    const query = params.toString() ? `?${params.toString()}` : "";
    fetch(`/api/results/starred${query}`)
      .then((r) => r.json())
      .then((d) => { if (!dead) setRows(d.rows ?? []); })
      .catch(() => { if (!dead) setError("Could not load starred results."); });
    return () => { dead = true; };
  }, [activeClient, activeSeries]);

  // One selectable item per output, not per starred generation — a
  // multi-output generation (num_images > 1) should offer every image, and
  // an output whose local mirror never landed (asset.local_path null, the
  // same thing store.missingOutputAssets() tracks) can't be reused since
  // /api/reuse-output requires a real file on disk to re-upload.
  const items = (rows ?? []).flatMap((row) =>
    row.outputs.map((output, index) => ({
      key: `${row.archive_id}:${index}`,
      row,
      output,
      unavailable: !output.local_path,
    }))
  );

  function toggle(key) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        if (atLimit) return current;
        next.add(key);
      }
      return next;
    });
  }

  function confirm() {
    const chosen = items
      .filter((item) => selected.has(item.key))
      .map((item) => {
        const [, outputIndex] = item.key.split(":");
        const base = item.row.label || "reference";
        return { ...item.output, name: item.row.outputs.length > 1 ? `${base}-${Number(outputIndex) + 1}` : base };
      });
    if (chosen.length) onPick(chosen);
  }

  return createPortal((
    <div className="starred-picker-backdrop" role="dialog" aria-label="Choose from starred results" onClick={onClose}>
      <div className="starred-picker" onClick={(e) => e.stopPropagation()}>
        <div className="starred-picker-head">
          <strong>Starred results</strong>
          <button type="button" className="dropzone-close" onClick={onClose} aria-label="Close">Close</button>
        </div>
        {capped && maxSelectable === 0 && (
          <p className="starred-picker-empty">
            The current model's image reference slot is already full. Remove an attached reference first.
          </p>
        )}
        {error && <p className="starred-picker-empty">{error}</p>}
        {!error && rows && !rows.length && (
          <p className="starred-picker-empty">
            Nothing starred yet. Star a result in your archive first, then it'll show up here.
          </p>
        )}
        {!error && rows === null && <p className="starred-picker-empty">Loading…</p>}
        {!error && rows && rows.length > 0 && !(capped && maxSelectable === 0) && (
          <>
            <div className="starred-picker-grid">
              {items.map((item) => {
                const { key, row, output, unavailable } = item;
                const src = output.local_url || output.url;
                const isVideo = String(output.content_type ?? "").startsWith("video");
                const on = selected.has(key);
                const disabled = unavailable || (!on && atLimit);
                const title = unavailable
                  ? "This result's local copy is missing, so it can't be reused as a reference."
                  : disabled
                  ? `This model only takes ${maxSelectable} reference image${maxSelectable === 1 ? "" : "s"}`
                  : undefined;
                return (
                  <button
                    type="button"
                    key={key}
                    className={`starred-picker-item${on ? " on" : ""}${unavailable ? " unavailable" : ""}`}
                    onClick={() => toggle(key)}
                    aria-pressed={on}
                    disabled={disabled}
                    title={title}
                  >
                    {isVideo ? (
                      <video src={src} muted playsInline preload="metadata" />
                    ) : (
                      <img src={src} alt={row.label || "Starred result"} loading="lazy" />
                    )}
                    <span className="starred-picker-check" aria-hidden="true">{on ? "✓" : ""}</span>
                  </button>
                );
              })}
            </div>
            <div className="starred-picker-foot">
              <span>
                {selected.size} selected
                {capped ? ` · ${Math.max(0, maxSelectable - selected.size)} more can fit` : ""}
              </span>
              <button type="button" className="starred-picker-confirm" onClick={confirm} disabled={!selected.size}>
                Attach {selected.size || ""}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  ), document.body);
}

export default function PromptBar({
  catalog, model, idea, setIdea, format, setFormat,
  params, setParams, hide, refs, onAttach, onAttachFromArchive, onRemoveRef, onReassignRef,
  rewritten, setRewritten, onOptimize, onGenerate,
  quote, busy, running, onPickModel, referenceModel, shotSettings, setShotSettings,
  provider, setProvider, activeClient, activeSeries,
}) {
  const fileRef = useRef(null);
  const ideaRef = useRef(null);
  const rewrittenRef = useRef(null);
  const [openRewrite, setOpenRewrite] = useState(true);
  const [showDropzone, setShowDropzone] = useState(false);
  const [showStarredPicker, setShowStarredPicker] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [pendingAttach, setPendingAttach] = useState(null);
  const [tagWarning, setTagWarning] = useState(null);

  // This block (and the two effects below it) must stay ABOVE the
  // `!catalog || !model` early return — every function here is null-safe
  // (optional-chains through model/referenceModel), and hooks must run
  // unconditionally on every render. Moving them below the guard means they
  // silently skip while catalog is still loading, then start firing once it
  // resolves — React sees a different hook count between renders and throws,
  // which unmounts the whole component (the "flashes, then goes blank" bug).
  const slotsModel = inputSlotsFor(model).length ? model : (referenceModel && inputSlotsFor(referenceModel).length ? referenceModel : null);
  const slots = slotsModel ? inputSlotsFor(slotsModel) : [];
  const showNamedSlots = slots.length > 1;
  const slotAccept = (field) => {
    const slot = slots.find((s) => s.field === field);
    const modality = slot?.modality === "mixed" ? "image" : slot?.modality;
    return {
      image: "image/png,image/jpeg,image/webp,image/gif",
      video: "video/mp4,video/quicktime",
      audio: "audio/mpeg,audio/wav,audio/x-wav",
      document: "application/pdf",
    }[modality] ?? "";
  };

  function openSlotPicker(field, elementIndex, elementRole) {
    setPendingAttach({ field, elementIndex, elementRole });
    // Mutate the accept attribute directly — React's state update won't
    // re-render before the file dialog opens, and the dialog needs the
    // right filter the instant click() fires.
    if (fileRef.current) fileRef.current.accept = slotAccept(field);
    fileRef.current?.click();
  }

  function insertTag(text) {
    const target = rewritten ? rewrittenRef.current : ideaRef.current;
    const value = rewritten ? (rewritten.prompt ?? "") : idea;
    const start = target ? target.selectionStart : value.length;
    const end = target ? target.selectionEnd : value.length;
    const spacer = start > 0 && value[start - 1] && !/\s/.test(value[start - 1]) ? " " : "";
    const next = value.slice(0, start) + spacer + text + value.slice(end);
    if (rewritten) setRewritten({ ...rewritten, prompt: next });
    else setIdea(next);
    const caret = start + spacer.length + text.length;
    requestAnimationFrame(() => {
      if (!target) return;
      target.focus();
      target.selectionStart = target.selectionEnd = caret;
    });
  }

  // Every prompt tag ("@Image1", "Image 1"...) implied by what's currently
  // attached — used to warn if a rewrite silently drops a reference the
  // prompt named, since an unnamed reference is inert to the model.
  const expectedTags = slots.flatMap((slot) => {
    if (!slot.tagPrefix) return [];
    const tag = { tagPrefix: slot.tagPrefix, tagStyle: slot.tagStyle };
    const fieldRefs = refs.filter((r) => r.field === slot.field);
    if (slot.structured) {
      const indices = [...new Set(fieldRefs.map((r) => r.element_index ?? 0))].sort((a, b) => a - b);
      return indices.map((idx) => formatPromptTag(tag, idx + 1));
    }
    return fieldRefs.map((_, i) => formatPromptTag(tag, i + 1));
  });

  // Kie's and Wavespeed's request builders only ever read the first
  // reference — if a 2nd attachment lands while either is selected
  // (start+end frame, an Elements group), fall back to fal rather than
  // leaving a doomed selection active. HeyGen is the opposite case: it
  // needs exactly one image AND one audio ref, so it falls back the moment
  // either goes missing rather than when a count threshold is crossed.
  const hasImageRef = refs.some((r) => r.media_type === "image");
  const hasAudioRef = refs.some((r) => r.media_type === "audio");
  useEffect(() => {
    if ((provider === "kie" || provider === "wavespeed") && refs.length > 1) setProvider("fal");
    if (provider === "heygen" && (!hasImageRef || !hasAudioRef)) setProvider("fal");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refs.length, provider, hasImageRef, hasAudioRef]);

  useEffect(() => {
    if (!rewritten?.prompt) { setTagWarning(null); return; }
    const dropped = expectedTags.filter((tag) => idea.includes(tag) && !rewritten.prompt.includes(tag));
    setTagWarning(dropped.length
      ? `The rewrite dropped ${dropped.join(", ")} — add ${dropped.length === 1 ? "it" : "them"} back in if you still want that reference used.`
      : null);
    // Only re-check when the rewrite itself changes, not on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rewritten?.prompt]);

  if (!catalog || !model) {
    return (
      <div className="bar-wrap">
        <div className="bar-loading" aria-busy="true">
          <span className="loading-orb" aria-hidden="true" />
          <div>
            <strong>Connecting to the model catalog</strong>
            <span>Loading the controls for your first shot.</span>
          </div>
          <small>Just a moment</small>
        </div>
      </div>
    );
  }

  // Endpoints list their params in arbitrary order, so rank by what a person
  // actually reaches for. Without this, an interesting control like LTX's
  // camera_motion gets pushed off the bar by plumbing.
  const CHIP_ORDER = [
    "aspect_ratio", "duration", "resolution", "image_size", "camera_motion",
    "shot_type", "quality", "thinking_level", "fps", "num_images",
    "generate_audio", "enable_prompt_expansion", "auto_fix",
  ];
  const rank = (n) => {
    const i = CHIP_ORDER.indexOf(n);
    return i === -1 ? 99 : i;
  };

  const chipParams = Object.entries(model.params)
    .filter(([n, s]) => !hide.has(n) && s.enum?.length)
    .sort(([a], [b]) => rank(a) - rank(b))
    .slice(0, 5);

  const ready = Boolean((rewritten?.prompt ?? idea).trim());
  const rewriteWords = String(rewritten?.prompt ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
  const canAttach = Boolean(imageInputFor(model) || referenceModel);
  const imageTargetModel = imageInputFor(model) ? model : referenceModel;
  const directInputs = mediaInputsFor(model);
  const acceptedModalities = [...new Set(directInputs.map((input) => input.modality).filter((item) => item !== "mixed"))];
  if (!acceptedModalities.includes("image") && referenceModel) acceptedModalities.push("image");
  const canAttachMedia = acceptedModalities.length > 0;
  const accept = acceptedModalities.map((type) => ({
    image: "image/png,image/jpeg,image/webp,image/gif",
    video: "video/mp4,video/quicktime",
    audio: "audio/mpeg,audio/wav,audio/x-wav",
    document: "application/pdf",
  }[type])).filter(Boolean).join(",");
  const acceptedLabel = acceptedModalities.map((type) => type === "document" ? "PDF" : type).join(", ");
  const attachmentHint = directInputs.length === 0 && referenceModel
    ? `Attaching an image switches to ${referenceModel.label}`
    : acceptedLabel
    ? `This model accepts ${acceptedLabel}`
    : "Choose a compatible model first";

  const quickFormats = [
    { id: "ugc", label: "UGC ad" },
    { id: "none", label: "Freeform" },
    { id: "unboxing", label: "Unboxing" },
    { id: "product", label: "Product still" },
  ];
  const quickFormatIds = new Set(quickFormats.map(({ id }) => id));
  const otherFormats = (catalog.formats ?? []).filter(({ id }) => !quickFormatIds.has(id));
  const otherFormatOptions = otherFormats.map(({ id, label }) => ({ value: id, label }));

  async function addFiles(fileList) {
    const files = Array.from(fileList ?? []);
    const target = pendingAttach;
    setPendingAttach(null);
    for (const file of files) await onAttach(file, target ?? undefined);
  }

  return (
    <div className="bar-wrap">
      <div className="bar">
        <div className="preset-row" aria-label="Creation mode">
          <span className="preset-label">Mode</span>
          {quickFormats.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={`preset${format === preset.id ? " on" : ""}`}
              onClick={() => setFormat(preset.id)}
            >
              {preset.label}
            </button>
          ))}
          {format === "ugc" && <span className="preset-detail">one creator / one beat / phone-native</span>}
          {otherFormats.length > 0 && (
            <div className={`preset-more${quickFormatIds.has(format) ? "" : " on"}`}>
              <MenuSelect
                value={quickFormatIds.has(format) ? "" : format}
                options={otherFormatOptions}
                placeholder="More modes"
                ariaLabel="More creation modes"
                onChange={setFormat}
              />
            </div>
          )}
        </div>

        <ShotDirection format={format} values={shotSettings} onChange={setShotSettings} />

        {showNamedSlots && (
          <div className="input-slots">
            {slots.map((slot) =>
              slot.structured ? (
                <ElementsSlot
                  key={slot.field}
                  slot={slot}
                  assets={refs.filter((r) => r.field === slot.field)}
                  onOpenPicker={openSlotPicker}
                  onRemove={(asset) => onRemoveRef(refs.indexOf(asset))}
                  onInsertTag={insertTag}
                  busy={busy}
                />
              ) : (
                <SlotRow
                  key={slot.field}
                  slot={slot}
                  assets={refs.filter((r) => r.field === slot.field)}
                  onOpenPicker={(field) => openSlotPicker(field)}
                  onRemove={(asset) => onRemoveRef(refs.indexOf(asset))}
                  onInsertTag={insertTag}
                  busy={busy}
                />
              )
            )}
          </div>
        )}

        <div className="bar-top">
          {!showNamedSlots && refs.length > 0 && (
            <div className="attach-thumbs">
              {refs.map((r, i) => {
                const roleModel = r.media_type === "image" ? imageTargetModel : model;
                const fieldOptions = imageFieldOptions(roleModel, r.media_type);
                const showRolePicker = onReassignRef && fieldOptions.length > 1;
                const currentField = r.field ?? fieldOptions.find((o) => o.field === r.field)?.field;
                const occupied = new Set(refs.filter((other) => other !== r).map((other) => other.field));
                const roleOptions = fieldOptions
                  .filter((option) => option.field === currentField || !occupied.has(option.field))
                  .map((option) => ({ value: option.field, label: option.label }));
                return (
                  <span className="attach-thumb-wrap" key={r.url}>
                    {r.media_type === "image" ? (
                      <img className="attach-thumb" src={r.preview} alt={r.name} />
                    ) : (
                      <span className={`attach-file attach-file-${r.media_type}`} title={r.name}>
                        <b>{r.media_type === "document" ? "PDF" : r.media_type}</b>
                        <small>{r.name}</small>
                      </span>
                    )}
                    <button
                      type="button"
                      className="attach-remove"
                      onClick={() => onRemoveRef(i)}
                      aria-label={`Remove ${r.name}`}
                      title="Remove reference"
                    >×</button>
                    {showRolePicker && (
                      <MenuSelect
                        value={currentField}
                        options={roleOptions}
                        ariaLabel={`Role for ${r.name}`}
                        className="attach-role-menu"
                        onChange={(field) => onReassignRef(i, field)}
                      />
                    )}
                  </span>
                );
              })}
            </div>
          )}

          {!showDropzone && !showNamedSlots && (
            <button
              type="button"
              className="attach"
              onClick={() => setShowDropzone(true)}
              disabled={busy || !canAttachMedia}
              aria-expanded={false}
              aria-label="Add input media"
              title={
                imageInputFor(model)
                  ? `Attach a reference image using ${modelLaneLabel(model)}`
                  : referenceModel
                  ? `Attach a reference image, this switches to ${modelLaneLabel(referenceModel)}`
                  : "This model does not take a reference image"
              }
            >
              +
            </button>
          )}
          {onAttachFromArchive && (
            <button
              type="button"
              className="attach attach-starred"
              onClick={() => setShowStarredPicker(true)}
              disabled={busy || !canAttachMedia}
              aria-label="Attach a starred result as a reference"
              title="Pick from your starred results instead of uploading a file"
            >
              ★
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept={accept}
            multiple
            hidden
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = "";
            }}
          />

          <textarea
            ref={ideaRef}
            id="prompt-idea"
            name="prompt"
            value={idea}
            placeholder="Describe what you want to make..."
            onChange={(e) => setIdea(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                rewritten ? onGenerate() : onOptimize();
              }
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                onGenerate();
              }
            }}
          />

          <button type="button" className="go" onClick={rewritten ? onGenerate : onOptimize} disabled={busy || !ready}>
            {running ? "Running" : busy ? "Working" : rewritten ? "Generate" : "Refine prompt"}
          </button>
        </div>

        {(!activeClient || activeClient === "__none__") && (
          <p className="client-note">Will be saved as Unassigned — pick a client in the top bar to tag it.</p>
        )}

        {showDropzone && (
          <div className="dropzone-wrap">
            <div
              className={`dropzone${dragging ? " dragging" : ""}`}
              role="button"
              tabIndex={canAttachMedia ? 0 : -1}
              aria-label="Add input media"
              aria-disabled={!canAttachMedia}
              onClick={() => {
                if (canAttachMedia && !busy) fileRef.current?.click();
              }}
              onKeyDown={(e) => {
                if ((e.key === "Enter" || e.key === " ") && canAttachMedia && !busy) {
                  e.preventDefault();
                  fileRef.current?.click();
                }
              }}
              onDragEnter={(e) => { e.preventDefault(); setDragging(true); }}
              onDragOver={(e) => e.preventDefault()}
              onDragLeave={(e) => {
                if (e.currentTarget === e.target) setDragging(false);
              }}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                addFiles(e.dataTransfer.files);
              }}
            >
              <div className="dropzone-visual" aria-hidden="true">
                <span className="dropzone-card dropzone-card-back" />
                <span className="dropzone-card dropzone-card-front"><i /></span>
                <span className="dropzone-sweep" />
              </div>
              <div className="dropzone-copy">
                <strong>{dragging ? "Release to attach" : "Drop media here"}</strong>
                <span>{attachmentHint} · or click to browse</span>
              </div>
              {refs.length > 0 && (
                <span className="dropzone-count">
                  {refs.length} {refs.length === 1 ? "file" : "files"} attached · matched to {modelLaneLabel(model)}
                </span>
              )}
            </div>
            <button
              type="button"
              className="dropzone-close"
              aria-label="Close input media area"
              onClick={(e) => {
                e.stopPropagation();
                setShowDropzone(false);
                setDragging(false);
              }}
            >
              Close
            </button>
          </div>
        )}

        {showStarredPicker && (
          <StarredPicker
            activeClient={activeClient}
            activeSeries={activeSeries}
            onClose={() => setShowStarredPicker(false)}
            onPick={(outputs) => {
              onAttachFromArchive?.(outputs);
              setShowStarredPicker(false);
            }}
            maxSelectable={imageTargetModel ? remainingCapacity(imageTargetModel, refs, "image") : 0}
          />
        )}

        <div className="bar-chips">
          <ModelPicker
            model={model}
            models={catalog.models}
            onChange={onPickModel}
            referenceActive={refs.length > 0}
            refs={refs}
          />

          {chipParams.map(([name, spec]) => (
            <span className="chip" key={name} title={spec.description}>
              <MenuSelect
                value={params[name] ?? spec.default ?? spec.enum[0]}
                options={spec.enum.map((o) => ({ value: String(o), label: prettyParam(name, o) }))}
                ariaLabel={paramLabel(name)}
                onChange={(value) => setParams((p) => ({ ...p, [name]: value }))}
              />
            </span>
          ))}

          {quote?.kie || quote?.wavespeed || quote?.heygen ? (
            <div className="provider-toggle" role="radiogroup" aria-label="Generation provider">
              <button
                type="button"
                className={`provider-opt${provider === "fal" ? " on" : ""}`}
                onClick={() => setProvider("fal")}
                disabled={busy}
              >
                fal ${quote.cost?.toFixed(3) ?? "?"}
              </button>
              {quote.kie ? (
                <button
                  type="button"
                  className={`provider-opt${provider === "kie" ? " on" : ""}`}
                  onClick={() => setProvider("kie")}
                  disabled={busy || refs.length > 1}
                  title={refs.length > 1
                    ? `Kie only supports one reference per request — ${refs.length} are attached. Remove references down to one, or use fal.`
                    : `${quote.kie.basis}\n${
                        quote.kie.last_verified
                          ? `Price last verified ${quote.kie.last_verified} (${quote.kie.verified_via})`
                          : "Price provenance unknown — never confirmed against a live source"
                      }`}
                >
                  Kie ${quote.kie.cost.toFixed(3)}
                  {!quote.kie.last_verified ? <sup className="price-unverified">?</sup> : null}
                </button>
              ) : null}
              {quote.kie?.source_url ? (
                <a
                  className="price-source-link"
                  href={quote.kie.source_url}
                  target="_blank"
                  rel="noreferrer"
                  title="Check the current Kie price for this model"
                  onClick={(e) => e.stopPropagation()}
                >
                  check price
                </a>
              ) : null}
              {quote.wavespeed ? (
                <button
                  type="button"
                  className={`provider-opt${provider === "wavespeed" ? " on" : ""}`}
                  onClick={() => setProvider("wavespeed")}
                  disabled={busy || refs.length > 1}
                  title={refs.length > 1
                    ? `Wavespeed only supports one reference per request here — ${refs.length} are attached. Remove references down to one, or use fal.`
                    : `${quote.wavespeed.basis}\n${
                        quote.wavespeed.last_verified
                          ? `Price last verified ${quote.wavespeed.last_verified} (${quote.wavespeed.verified_via})`
                          : "Price provenance unknown — never confirmed against a live source"
                      }`}
                >
                  Wavespeed ${quote.wavespeed.cost.toFixed(3)}
                  {!quote.wavespeed.last_verified ? <sup className="price-unverified">?</sup> : null}
                </button>
              ) : null}
              {quote.wavespeed?.source_url ? (
                <a
                  className="price-source-link"
                  href={quote.wavespeed.source_url}
                  target="_blank"
                  rel="noreferrer"
                  title="Check the current Wavespeed price for this model"
                  onClick={(e) => e.stopPropagation()}
                >
                  check price
                </a>
              ) : null}
              {quote.heygen ? (
                <button
                  type="button"
                  className={`provider-opt${provider === "heygen" ? " on" : ""}`}
                  onClick={() => setProvider("heygen")}
                  disabled={busy || !hasImageRef || !hasAudioRef}
                  title={!hasImageRef || !hasAudioRef
                    ? "HeyGen needs both a reference image and a reference audio clip attached."
                    : `${quote.heygen.basis}\n${
                        quote.heygen.last_verified
                          ? `Price last verified ${quote.heygen.last_verified} (${quote.heygen.verified_via})`
                          : "Price provenance unknown — never confirmed against a live source"
                      }`}
                >
                  HeyGen ${quote.heygen.cost.toFixed(3)}
                  {!quote.heygen.last_verified ? <sup className="price-unverified">?</sup> : null}
                </button>
              ) : null}
              {quote.heygen?.source_url ? (
                <a
                  className="price-source-link"
                  href={quote.heygen.source_url}
                  target="_blank"
                  rel="noreferrer"
                  title="Check the current HeyGen price for this model"
                  onClick={(e) => e.stopPropagation()}
                >
                  check price
                </a>
              ) : null}
            </div>
          ) : null}

          {quote?.cost != null ? (
            <span className="bar-price exact" title={quote.basis}>
              <span>Estimated total{quote.kie || quote.wavespeed || quote.heygen ? ` (${provider === "kie" ? "Kie" : provider === "wavespeed" ? "Wavespeed" : provider === "heygen" ? "HeyGen" : "fal"})` : ""}</span>
              <b>${(
                provider === "kie" && quote.kie ? quote.kie.cost
                : provider === "wavespeed" && quote.wavespeed ? quote.wavespeed.cost
                : provider === "heygen" && quote.heygen ? quote.heygen.cost
                : quote.cost
              ).toFixed(3)}</b>
            </span>
          ) : quote?.confidence === "unquotable" ? (
            <span className="bar-price metered" title={quote.basis}>
              <span className="bar-price-label">Usage-based pricing</span>
              <span className="bar-price-rate">
                <strong>${quote.unit_price}</strong>
                <span>per {PRICE_UNITS[quote.unit] ?? quote.unit}</span>
              </span>
              <small>Exact total shown after generation</small>
            </span>
          ) : null}
        </div>
      </div>

      {rewritten && (
        <section className="rewrite" aria-label="Editable prompt draft">
          <div className="rewrite-head">
            <div className="rewrite-title">
              <strong>Prompt draft</strong>
              <span>
                {rewritten.optimized
                  ? `Tuned for ${model.label}`
                  : `Sent as written · ${rewritten.reason}`}
              </span>
            </div>
            <div className="rewrite-actions">
              <button type="button" className="rewrite-action" onClick={() => setRewritten(null)}>Discard</button>
              <button
                type="button"
                className="rewrite-action"
                aria-expanded={openRewrite}
                onClick={() => setOpenRewrite((v) => !v)}
              >
                {openRewrite ? "Hide" : "Edit draft"}
              </button>
            </div>
          </div>
          {openRewrite && (
            <div className="rewrite-body">
              <label htmlFor="rewritten-prompt">Edit the wording before you generate.</label>
              <textarea
                ref={rewrittenRef}
                id="rewritten-prompt"
                name="rewritten-prompt"
                aria-label="Editable rewritten prompt"
                value={rewritten.prompt}
                onChange={(e) => setRewritten({ ...rewritten, prompt: e.target.value })}
              />
              {tagWarning && <div className="tag-warning">{tagWarning}</div>}
              <div className="rewrite-foot">
                <span>{rewriteWords} {rewriteWords === 1 ? "word" : "words"}</span>
                <span>Your edits are used for the next generation.</span>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
