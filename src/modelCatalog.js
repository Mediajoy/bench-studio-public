export const MODEL_KIND_LABELS = {
  image: "Image",
  video: "Video",
  audio: "Audio",
};

export const MODEL_LANE_LABELS = {
  t2i: "Text to image",
  i2i: "Edit an image",
  t2v: "Text to video",
  i2v: "Image to video",
  r2v: "Reference to video",
  "talking-head": "Talking head / lip-sync",
  tts: "Text to speech",
};

// A small editorial order for the first screen of the picker. This is not a
// performance claim; it puts the most useful starting points for ad work first
// and leaves the full catalog one search away.
export const MODEL_PRIORITY = [
  "fal-ai/veo3.1/fast",
  "fal-ai/kling-video/v3/pro/text-to-video",
  "bytedance/seedance-2.5/text-to-video",
  "fal-ai/veo3.1",
  "fal-ai/kling-video/v3/turbo/standard/text-to-video",
  "lightricks/ltx-2.5/text-to-video/fast",
  "fal-ai/nano-banana-pro",
  "openai/gpt-image-2",
  "fal-ai/flux-2-pro",
  "fal-ai/flux-2/flash",
  "bytedance/seedream/v5/pro/text-to-image",
  "fal-ai/nano-banana-2",
];

export function modelKindLabel(model) {
  return MODEL_KIND_LABELS[model?.kind] ?? "Model";
}

export function modelLaneLabel(model) {
  return MODEL_LANE_LABELS[model?.lane] ?? "General generation";
}

// These two fields are generated from the endpoint's live OpenAPI schema. A
// `pair` is only a navigation hint; it is never enough to prove that a model
// accepts an image.
export function imageInputFor(model) {
  if (model?.capabilities?.primary_image_field) {
    return {
      field: model.capabilities.primary_image_field,
      arity: model.capabilities.image_arity ?? "single",
    };
  }
  if (model?.image_input?.name && model.image_input.arity) {
    return { field: model.image_input.name, arity: model.image_input.arity };
  }
  if (!model?.image_param || !model?.accepts_image) return null;
  return { field: model.image_param, arity: model.accepts_image };
}

export function mediaInputsFor(model, modality) {
  const inputs = model?.capabilities?.inputs ?? [];
  return modality ? inputs.filter((input) => input.modality === modality || input.modality === "mixed") : inputs;
}

// Human-readable labels for the roles build_registry.mjs's roleFor() tags
// each image field with. An unbounded multiple-arity field (e.g. Veo 3.1
// reference's image_urls) reads as "add references," not "image #1, #2..."
// so "source" and "reference" get an arity-aware label.
export const ROLE_LABELS = {
  "start-frame": "Start frame",
  "end-frame": "End frame",
  mask: "Mask",
  reference: "Reference",
  "identity-anchor": "Identity anchor",
  ingredient: "Elements",
  source: "Image",
};

export function roleLabel(input) {
  if (!input) return ROLE_LABELS.source;
  if ((input.role === "source" || input.role === "reference") && input.arity === "multiple") return "Reference";
  return ROLE_LABELS[input.role] ?? ROLE_LABELS.source;
}

// The distinct candidate fields a model exposes for a modality, each carrying
// enough to render a role picker. Returns a single-entry array for the common
// case (one image field) — callers can skip any picker UI when length === 1.
export function imageFieldOptions(model, modality) {
  return mediaInputsFor(model, modality).map((input) => ({
    field: input.field,
    role: input.role,
    arity: input.arity,
    limits: input.limits,
    label: roleLabel(input),
  }));
}

// Some endpoints document a literal prompt-tag convention for addressing an
// attached reference — "Refer to them in the prompt as @Image1, @Image2" or
// (Hailuo's prose variant) "referenced in the prompt as Image 1, Image 2".
// Derived from the schema's own description text, not a per-model table, so
// it stays correct as new endpoints are added to the roster.
export function promptTagFor(input) {
  const description = input?.description ?? "";
  const at = description.match(/prompt as @([A-Za-z]+)1/);
  if (at) return { tagPrefix: `@${at[1]}`, tagStyle: "at" };
  const ordinal = description.match(/prompt as ([A-Z][a-z]+) 1\b/);
  if (ordinal) return { tagPrefix: ordinal[1], tagStyle: "ordinal" };
  return null;
}

export function formatPromptTag(tag, index) {
  if (!tag) return "";
  return tag.tagStyle === "ordinal" ? `${tag.tagPrefix} ${index}` : `${tag.tagPrefix}${index}`;
}

// Ordering for the named-slot UI: structural frame anchors first, then the
// image roles a person would reach for next, then other modalities. Roles
// not listed fall to the end of their modality group rather than erroring.
const ROLE_ORDER = ["start-frame", "end-frame", "source", "reference", "mask", "ingredient", "identity-anchor"];
const MODALITY_ORDER = { image: 0, mixed: 0, video: 1, audio: 2, document: 3 };

function slotRank(input) {
  const modalityRank = MODALITY_ORDER[input.modality] ?? 4;
  const roleRank = ROLE_ORDER.indexOf(input.role);
  return modalityRank * 100 + (roleRank === -1 ? ROLE_ORDER.length : roleRank);
}

// Every distinct input the model's schema exposes, across all modalities,
// as a labeled slot the UI can render a named row + [+] for — this is what
// makes a model's real capability visible before anything is attached.
export function inputSlotsFor(model) {
  return mediaInputsFor(model)
    .slice()
    .sort((a, b) => slotRank(a) - slotRank(b))
    .map((input) => {
      const tag = promptTagFor(input);
      return {
        field: input.field,
        role: input.role,
        label: roleLabel(input),
        modality: input.modality,
        arity: input.arity,
        required: Boolean(input.required),
        limits: input.limits,
        description: input.description ?? "",
        capacity: input.arity === "single" ? 1 : input.limits?.max_items ?? Infinity,
        tagPrefix: tag?.tagPrefix ?? null,
        tagStyle: tag?.tagStyle ?? null,
        structured: input.item_type === "object",
      };
    });
}

export function mediaTypeForFile(file) {
  if (file?.type?.startsWith("image/")) return "image";
  if (file?.type?.startsWith("video/")) return "video";
  if (file?.type?.startsWith("audio/")) return "audio";
  if (file?.type === "application/pdf" || /\.pdf$/i.test(file?.name ?? "")) return "document";
  return "file";
}

// Checks a field's `max_megabytes` limit against the incoming asset. Two
// distinct shapes exist in vendor schemas: "total size under 50 MB" (fal's
// Seedance 2.0 video refs) caps the sum across every item in the field;
// "max 30 MB per image" / "10 MB each" (Seedance's own image refs, Wan 2.7's
// references) caps each item independently — summing those would reject a
// perfectly valid multi-file attach. build_capabilities.mjs tags which shape
// applies via `max_megabytes_combined`; this only sums when that's true.
function megabyteOverflow(chosen, assigned, extraAsset) {
  const cap = chosen.limits?.max_megabytes;
  if (!cap) return null;
  const extraMb = (extraAsset?.size_bytes ?? 0) / (1024 * 1024);
  if (!chosen.limits.max_megabytes_combined) {
    return extraMb > cap ? extraMb : null;
  }
  const existingMb = assigned
    .filter((a) => a.field === chosen.field)
    .reduce((sum, a) => sum + (a.size_bytes ?? 0), 0) / (1024 * 1024);
  const totalMb = existingMb + extraMb;
  return totalMb > cap ? totalMb : null;
}

export function assignInputFields(model, assets) {
  const usage = new Map();
  const assigned = [];
  for (const asset of assets) {
    const candidates = mediaInputsFor(model, asset.media_type).sort((a, b) => {
      if (a.field === model?.capabilities?.primary_image_field) return -1;
      if (b.field === model?.capabilities?.primary_image_field) return 1;
      // Prefer single-arity fields (start/end/mask) over unbounded
      // multiple-arity ones (elements/reference) when both are open, so a
      // 2-image "start + end frame" attach defaults correctly without a
      // picker — reversed from the old "multiple beats single" order, which
      // silently misrouted Kling's 2nd image into `elements`.
      if (a.arity === "single" && b.arity !== "single") return -1;
      if (b.arity === "single" && a.arity !== "single") return 1;
      return 0;
    });
    if (!candidates.length) {
      return { ok: false, asset, reason: `${model?.label ?? "This model"} does not accept ${asset.media_type} input.` };
    }
    if (asset.field) {
      const chosen = candidates.find((input) => input.field === asset.field);
      if (!chosen) {
        return { ok: false, asset, reason: `${model?.label ?? "This model"} does not have a "${asset.field}" input.` };
      }
      // Structured fields (Kling's `elements`) are an array of objects, one
      // per character/object — not a flat pool of images. Validate by group
      // (element_index) instead of the field's overall arity: at most one
      // frontal image per element, and up to 3 supporting angle images.
      if (chosen.item_type === "object") {
        if (asset.element_role !== "frontal" && asset.element_role !== "angle") {
          return { ok: false, asset, reason: `${model?.label ?? "This model"}'s ${roleLabel(chosen)} images must be tagged as a frontal or angle image.` };
        }
        const groupKey = `${chosen.field}:${asset.element_index}`;
        const group = usage.get(groupKey) ?? { frontal: 0, angle: 0 };
        const elementLabel = `Element ${Number(asset.element_index) + 1}`;
        if (asset.element_role === "frontal" && group.frontal >= 1) {
          return { ok: false, asset, full: true, reason: `${elementLabel} already has a frontal image. Remove it first.` };
        }
        if (asset.element_role === "angle" && group.angle >= 3) {
          return { ok: false, asset, full: true, reason: `${elementLabel} already has 3 angle images, the max fal accepts.` };
        }
        group[asset.element_role]++;
        usage.set(groupKey, group);
        assigned.push({ ...asset, field: chosen.field });
        continue;
      }
      const count = usage.get(chosen.field) ?? 0;
      const full = chosen.arity === "single" ? count > 0 : chosen.limits?.max_items && count >= chosen.limits.max_items;
      if (full) {
        return { ok: false, asset, full: true, reason: `${model?.label ?? "This model"}'s ${roleLabel(chosen)} slot is already full. Remove an existing reference first.` };
      }
      const overflowMb = megabyteOverflow(chosen, assigned, asset);
      if (overflowMb != null) {
        const scope = chosen.limits.max_megabytes_combined ? "combined" : "per file";
        const detail = chosen.limits.max_megabytes_combined
          ? ` — this attachment would put it at ${overflowMb.toFixed(1)} MB`
          : ` — this file is ${overflowMb.toFixed(1)} MB`;
        return { ok: false, asset, full: true, reason: `${model?.label ?? "This model"}'s ${roleLabel(chosen)} slot allows ${chosen.limits.max_megabytes} MB ${scope}${detail}. Remove an existing reference first.` };
      }
      usage.set(chosen.field, count + 1);
      assigned.push({ ...asset, field: chosen.field });
      continue;
    }
    let oversizeCandidate = null;
    let oversizeMb = null;
    const chosen = candidates.find((input) => {
      const count = usage.get(input.field) ?? 0;
      if (input.arity === "single") return count === 0;
      if (input.limits?.max_items && count >= input.limits.max_items) return false;
      const overflow = megabyteOverflow(input, assigned, asset);
      if (overflow != null) { oversizeCandidate = input; oversizeMb = overflow; return false; }
      return true;
    });
    if (!chosen) {
      // A size overflow is a more specific, more actionable message than the
      // generic "slot full" below — surface it when that's what actually blocked
      // the attach, rather than implying the count limit was hit.
      if (oversizeCandidate) {
        const scope = oversizeCandidate.limits.max_megabytes_combined ? "combined" : "per file";
        const detail = oversizeCandidate.limits.max_megabytes_combined
          ? ` — this attachment would put it at ${oversizeMb.toFixed(1)} MB`
          : ` — this file is ${oversizeMb.toFixed(1)} MB`;
        return { ok: false, asset, full: true, reason: `${model?.label ?? "This model"}'s ${roleLabel(oversizeCandidate)} slot allows ${oversizeCandidate.limits.max_megabytes} MB ${scope}${detail}. Remove an existing reference first.` };
      }
      // Candidates exist but are all occupied — different from "unsupported"
      // above. Report it as a slot conflict so callers (and the resulting
      // error text) don't call this an "upload failure" or imply the model
      // can't take this modality at all.
      const slots = candidates.map((c) => (c.arity === "single" ? "1" : c.limits?.max_items ?? "unlimited")).join(", ");
      return {
        ok: false,
        asset,
        full: true,
        reason: `${model?.label ?? "This model"}'s ${asset.media_type} input${candidates.length > 1 ? "s are" : " is"} already full (${slots} slot${candidates.length > 1 || slots !== "1" ? "s" : ""}). Remove an existing reference first.`,
      };
    }
    usage.set(chosen.field, (usage.get(chosen.field) ?? 0) + 1);
    assigned.push({ ...asset, field: chosen.field });
  }
  return { ok: true, assets: assigned };
}

// How many more assets of a given modality this model can still take on top
// of currentAssets — e.g. a single-arity image field with one already
// attached has 0 remaining. Used to cap a multi-select picker up front
// rather than letting assignInputFields reject the overflow after the fact.
// Only currentAssets of the same modality matter for this count — an
// unrelated attached asset (e.g. an audio ref) must not make an empty image
// slot read as full. Returns Infinity, not a made-up finite number, when the
// model's declared limit is genuinely unbounded (no max_items).
export function remainingCapacity(model, currentAssets, mediaType) {
  const relevant = (currentAssets ?? []).filter((a) => a.media_type === mediaType);
  const candidates = mediaInputsFor(model, mediaType);
  if (!candidates.length) return 0;
  if (candidates.some((input) => input.arity === "multiple" && !input.limits?.max_items)) return Infinity;

  let assets = [...relevant];
  let count = 0;
  const HARD_CAP = 200; // generous ceiling for the sum of declared finite limits, not a UI-facing number
  while (count < HARD_CAP) {
    const assignment = assignInputFields(model, [...assets, { media_type: mediaType, url: `__probe_${count}__` }]);
    if (!assignment.ok) break;
    assets = assignment.assets;
    count++;
  }
  return count;
}

// Model selection should never feel broken because an old attachment no
// longer fits. Keep every asset the new endpoint can accept, remap its field,
// and return the remainder so the UI can explain what was removed.
//
// Strip the old field/element assignment before reassigning: those names are
// specific to the model the asset was attached under, and assignInputFields'
// manual-field branch now validates a set `field` strictly (added for the
// UI's slot picker) rather than ignoring it — so carrying a stale field name
// across a model switch would hard-reject instead of remapping. Dropping it
// here routes back through the auto-pick path, which is what "remap" means.
export function retainCompatibleAssets(model, assets) {
  let compatible = [];
  const removed = [];
  for (const asset of assets) {
    const { field: _field, element_index: _ei, element_role: _er, ...rest } = asset;
    const assignment = assignInputFields(model, [...compatible, rest]);
    if (assignment.ok) compatible = assignment.assets;
    else removed.push(asset);
  }
  return { assets: compatible, removed };
}

export function pairedImageModel(models, model) {
  const paired = models?.find((candidate) => candidate.id === model?.pair);
  return imageInputFor(paired) ? paired : null;
}

export function modelPriority(model) {
  const exact = MODEL_PRIORITY.indexOf(model.id);
  if (exact !== -1) return exact;

  // Keep reference/image-to-video siblings near their parent model, while
  // keeping the catalog deterministic when new endpoints arrive.
  const family = MODEL_PRIORITY.findIndex((id) => {
    const stem = id.split("/").slice(0, 3).join("/");
    return model.id.startsWith(stem);
  });
  if (family !== -1) return family + 0.4;
  if (model.tier === "fastest") return 30;
  return 100 + (model.kind === "video" ? 1 : 0);
}

export function sortModels(models) {
  return [...models].sort((a, b) => {
    const priority = modelPriority(a) - modelPriority(b);
    if (priority !== 0) return priority;
    return a.label.localeCompare(b.label);
  });
}
