// build_registry.mjs — pull the real OpenAPI schema for every endpoint in the
// roster and flatten it into one registry the UI can render controls from.
// This is the whole "aggregator" trick: fal publishes machine-readable schemas,
// so the model picker builds itself instead of being hand-maintained.
//
//   node build_registry.mjs
//
// Writes ./registry.json and ./registry-diff-report.json. Re-run whenever you
// add a model to ROSTER, or periodically to catch schema drift/staleness
// (see check_freshness.mjs for the 30-day staleness flag on recently-used
// models). PRD v5 Phase 3.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));

// Every model in ROSTER is accessed through fal's commercial API — none of
// these are self-hosted open-weight checkpoints, so "proprietary-api" is the
// accurate default license for the whole roster today. An entry can set its
// own `license` (and, for a self-hosted model that's since been pulled or
// superseded, `deprecated_after: "<ISO date>"`) to override this default —
// see PROHIBITED_LICENSES below for what a generate call refuses outright.
const DEFAULT_LICENSE = "proprietary-api";

// Mirrors shot-builder's providers/av_models.json license-gate vocabulary
// (PRD v5 §1.1) so a bad edit to ROSTER can't accidentally make a
// non-commercial/research-only model reachable through Bench either — even
// though no current roster entry uses one of these.
export const PROHIBITED_LICENSES = new Set([
  "non-commercial",
  "research-only",
  "unclear",
]);

// The curated roster: the CURRENT flagship of each family, not last year's.
// Verified against fal's live catalog on 2026-08-12. Run `node check_stale.mjs`
// to find out when a family has shipped something newer than what is here.
//
// `pair` is only a navigation hint between sibling endpoints. Whether an
// endpoint can actually consume an image comes from its live OpenAPI schema
// below, never from this hand-written link.
const ROSTER = [
  // --- image from text ---
  { id: "fal-ai/flux-2/flash",                        kind: "image", lane: "t2i", label: "FLUX.2 flash",   vendor: "Black Forest Labs", tier: "fastest", pair: "fal-ai/flux-2-pro/edit" },
  { id: "fal-ai/flux-2-pro",                          kind: "image", lane: "t2i", label: "FLUX.2 pro",     vendor: "Black Forest Labs", pair: "fal-ai/flux-2-pro/edit" },
  { id: "fal-ai/nano-banana-pro",                     kind: "image", lane: "t2i", label: "Nano Banana Pro",vendor: "Google",   pair: "fal-ai/nano-banana-pro/edit" },
  { id: "fal-ai/nano-banana-2",                       kind: "image", lane: "t2i", label: "Nano Banana 2",  vendor: "Google",   pair: "fal-ai/nano-banana-2/edit" },
  { id: "openai/gpt-image-2",                         kind: "image", lane: "t2i", label: "GPT Image 2",    vendor: "OpenAI",   pair: "openai/gpt-image-2/edit" },
  { id: "bytedance/seedream/v5/pro/text-to-image",    kind: "image", lane: "t2i", label: "Seedream 5 pro", vendor: "ByteDance",pair: "bytedance/seedream/v5/pro/edit" },
  { id: "alibaba/qwen-image-3/text-to-image",         kind: "image", lane: "t2i", label: "Qwen Image 3",   vendor: "Alibaba",  pair: "alibaba/qwen-image-3/edit" },
  { id: "fal-ai/recraft/v4.1/text-to-image",          kind: "image", lane: "t2i", label: "Recraft v4.1",   vendor: "Recraft" },
  { id: "xai/grok-imagine-image/v2.0/text-to-image",  kind: "image", lane: "t2i", label: "Grok Imagine 2", vendor: "xAI" },

  // --- image from your image ---
  { id: "fal-ai/nano-banana-pro/edit",                kind: "image", lane: "i2i", label: "Nano Banana Pro edit", vendor: "Google" },
  { id: "fal-ai/nano-banana-2/edit",                  kind: "image", lane: "i2i", label: "Nano Banana 2 edit",   vendor: "Google" },
  { id: "openai/gpt-image-2/edit",                    kind: "image", lane: "i2i", label: "GPT Image 2 edit",     vendor: "OpenAI" },
  { id: "bytedance/seedream/v5/pro/edit",             kind: "image", lane: "i2i", label: "Seedream 5 edit",      vendor: "ByteDance" },
  { id: "alibaba/qwen-image-3/edit",                  kind: "image", lane: "i2i", label: "Qwen Image 3 edit",    vendor: "Alibaba" },
  { id: "fal-ai/flux-2-pro/edit",                     kind: "image", lane: "i2i", label: "FLUX.2 pro edit",      vendor: "Black Forest Labs" },
  // Masked inpaint / canvas outpaint — added 2026-09-01 so a precise,
  // nothing-else-changes edit (fix one region via mask, or extend the
  // canvas a few px on one or more sides) can run through Bench's own
  // ledger instead of a raw fal.run curl call that never shows up in the UI.
  // Endpoint ids + param shapes confirmed live via fal's own docs pages
  // (fal.ai/models/fal-ai/flux-pro/v1/fill/api and
  // .../flux-2-pro/outpaint/api) — image_url/mask_url for fill,
  // image_url + expand_top/bottom/left/right for outpaint.
  { id: "fal-ai/flux-pro/v1/fill",                    kind: "image", lane: "i2i", label: "FLUX.1 Fill pro (inpaint)", vendor: "Black Forest Labs" },
  { id: "fal-ai/flux-2-pro/outpaint",                 kind: "image", lane: "i2i", label: "FLUX.2 pro Outpaint",       vendor: "Black Forest Labs" },

  // --- video from text ---
  { id: "lightricks/ltx-2.5/text-to-video/fast",          kind: "video", lane: "t2v", label: "LTX 2.5 fast",   vendor: "Lightricks", tier: "fastest", pair: "lightricks/ltx-2.5/image-to-video/fast" },
  { id: "fal-ai/kling-video/v3/turbo/standard/text-to-video", kind: "video", lane: "t2v", label: "Kling 3 turbo", vendor: "Kuaishou", pair: "fal-ai/kling-video/v3/pro/image-to-video" },
  { id: "fal-ai/kling-video/v3/pro/text-to-video",        kind: "video", lane: "t2v", label: "Kling 3 pro",    vendor: "Kuaishou",  pair: "fal-ai/kling-video/v3/pro/image-to-video" },
  { id: "bytedance/seedance-2.5/text-to-video",           kind: "video", lane: "t2v", label: "Seedance 2.5",   vendor: "ByteDance", pair: "bytedance/seedance-2.5/image-to-video" },
  { id: "bytedance/seedance-2.0/fast/text-to-video",      kind: "video", lane: "t2v", label: "Seedance 2 fast",vendor: "ByteDance", pair: "bytedance/seedance-2.0/reference-to-video" },
  { id: "minimax/h3/text-to-video",                       kind: "video", lane: "t2v", label: "Hailuo H3",      vendor: "MiniMax",   pair: "minimax/h3/image-to-video" },
  { id: "fal-ai/wan/v2.7/text-to-video",                  kind: "video", lane: "t2v", label: "Wan 2.7",        vendor: "Alibaba",   pair: "wan/v2.6/image-to-video" },
  { id: "fal-ai/veo3.1/fast",                             kind: "video", lane: "t2v", label: "Veo 3.1 fast",   vendor: "Google",    pair: "fal-ai/veo3.1/fast/image-to-video" },
  { id: "fal-ai/veo3.1",                                  kind: "video", lane: "t2v", label: "Veo 3.1",        vendor: "Google",    pair: "fal-ai/veo3.1/reference-to-video" },
  { id: "blackforestlabs/flux-3/text-to-video",           kind: "video", lane: "t2v", label: "FLUX.3 video",   vendor: "Black Forest Labs" },
  { id: "xai/grok-imagine-video/v1.5/text-to-video",      kind: "video", lane: "t2v", label: "Grok Video 1.5", vendor: "xAI" },

  // --- video from your image ---
  { id: "lightricks/ltx-2.5/image-to-video/fast",   kind: "video", lane: "i2v", label: "LTX 2.5 fast i2v", vendor: "Lightricks", tier: "fastest" },
  { id: "fal-ai/kling-video/v3/pro/image-to-video", kind: "video", lane: "i2v", label: "Kling 3 pro i2v",  vendor: "Kuaishou" },
  { id: "bytedance/seedance-2.5/image-to-video",    kind: "video", lane: "i2v", label: "Seedance 2.5 i2v", vendor: "ByteDance" },
  { id: "minimax/h3/image-to-video",                kind: "video", lane: "i2v", label: "Hailuo H3 i2v",    vendor: "MiniMax" },
  { id: "wan/v2.6/image-to-video",                  kind: "video", lane: "i2v", label: "Wan 2.6 i2v",      vendor: "Alibaba" },
  { id: "fal-ai/veo3.1/fast/image-to-video",        kind: "video", lane: "i2v", label: "Veo 3.1 fast i2v", vendor: "Google" },
  { id: "fal-ai/veo3.1/image-to-video",              kind: "video", lane: "i2v", label: "Veo 3.1 i2v",      vendor: "Google" },
  { id: "fal-ai/veo3.1/first-last-frame-to-video",   kind: "video", lane: "i2v", label: "Veo 3.1 first+last frame", vendor: "Google", pair: "fal-ai/veo3.1/reference-to-video" },

  // --- video that keeps YOUR product on model ---
  // These take reference images of a subject rather than a start frame, which
  // is the lane that actually matters for product and UGC ads.
  { id: "fal-ai/veo3.1/reference-to-video",         kind: "video", lane: "r2v", label: "Veo 3.1 reference",  vendor: "Google" },
  { id: "bytedance/seedance-2.0/reference-to-video",kind: "video", lane: "r2v", label: "Seedance 2 reference", vendor: "ByteDance" },
  { id: "minimax/h3/reference-to-video",            kind: "video", lane: "r2v", label: "Hailuo H3 reference", vendor: "MiniMax" },
  { id: "fal-ai/wan/v2.7/reference-to-video",       kind: "video", lane: "r2v", label: "Wan 2.7 reference",  vendor: "Alibaba" },
  { id: "xai/grok-imagine-video/reference-to-video",kind: "video", lane: "r2v", label: "Grok reference",     vendor: "xAI" },

  // --- talking-head / lip-sync / voice (PRD v5 Phase 2, Stage 3 grounding) ---
  // Ported from shot-builder's own AV_MODELS_PATH curation (providers/av_models.json)
  // — same four models it already treats as `permitted: true`, added here so
  // voice_gen.py/talking_head_gen.py can route through Bench instead of calling
  // fal directly. Schemas fetched live 2026-08-18 (PRD §1.1 grounding invariant).
  // Licenses set explicitly (not left to DEFAULT_LICENSE) — verified against
  // each project's own LICENSE file 2026-08-17, same evidence shot-builder's
  // providers/av_models.json cites. Apache-2.0 isn't in PROHIBITED_LICENSES
  // so this doesn't change what's reachable, but DEFAULT_LICENSE
  // ("proprietary-api") would have been a wrong claim about these three.
  { id: "fal-ai/echomimic-v3",                      kind: "video", lane: "talking-head", label: "EchoMimic v3", vendor: "Antgroup", license: "Apache-2.0" },
  { id: "fal-ai/infinitalk",                        kind: "video", lane: "talking-head", label: "InfiniTalk",   vendor: "MeiGen-AI", license: "Apache-2.0" },
  { id: "fal-ai/latentsync",                        kind: "video", lane: "talking-head", label: "LatentSync (lip-sync)", vendor: "ByteDance", license: "Apache-2.0" },
  { id: "fal-ai/elevenlabs/tts/multilingual-v2",    kind: "audio", lane: "tts",          label: "ElevenLabs TTS", vendor: "ElevenLabs" },
];

const SCHEMA_URL = (id) =>
  `https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=${id}`;

// Params worth surfacing as controls. Everything else stays at model default,
// which is what you want for cheap concepting.
const SURFACE = new Set([
  "aspect_ratio", "image_size", "resolution", "duration", "num_images",
  "negative_prompt", "seed", "quality", "num_frames", "fps",
  "guidance_scale", "num_inference_steps", "generate_audio", "enable_safety_checker",
  "style", "image_url", "image_urls", "output_format",
  "reference_image_urls", "start_image_url", "end_image_url",
  "video_url", "video_urls", "reference_video_urls",
  "audio_url", "audio_urls", "reference_audio_urls", "pdf_url",
  "mask_url", "elements", "multi_prompt",
  // per-side canvas expansion (fal-ai/flux-2-pro/outpaint) — pixels to add
  // on each edge; default 0 if omitted, so surfacing them is what lets a
  // "just expand the sides a little" request actually be expressed as a
  // control instead of silently staying at 0 on every side.
  "expand_top", "expand_bottom", "expand_left", "expand_right", "auto_crop",
  // real creative controls some endpoints expose
  "camera_motion", "shot_type", "thinking_level",
  // models that rewrite your prompt for you. We already wrote it deliberately,
  // so this needs to be visible and off by default.
  "enable_prompt_expansion", "auto_fix",
  // TTS (elevenlabs/tts/multilingual-v2): its own schema names the spoken
  // content "text", not "prompt" — no model in the roster before this one
  // had that shape. Surfaced as a plain param control rather than aliased
  // into the prompt box, so nothing about the prompt-box pipeline needs to
  // special-case a second field name.
  "text", "voice",
]);

// Endpoints do not agree on what the image parameter is called. Detect it
// rather than assuming, in priority order, so the server sends the right key.
const IMAGE_PARAMS = [
  { name: "image_urls",           arity: "multiple" },
  { name: "reference_image_urls", arity: "multiple" },
  { name: "image_url",            arity: "single" },
  { name: "start_image_url",      arity: "single" },
  { name: "end_image_url",        arity: "single" },
  { name: "first_frame_url",      arity: "single" },
  { name: "last_frame_url",       arity: "single" },
];

function modalityFor(name) {
  if (name === "elements") return "mixed";
  if (!/_urls?$/.test(name)) return null;
  if (/image|mask|frontal|frame/.test(name)) return "image";
  if (/video/.test(name)) return "video";
  if (/audio/.test(name)) return "audio";
  if (/pdf/.test(name)) return "document";
  return null;
}

function roleFor(name) {
  if (name === "elements") return "ingredient";
  if (/start_image|first_frame/.test(name)) return "start-frame";
  if (/end_image|last_frame/.test(name)) return "end-frame";
  if (/mask/.test(name)) return "mask";
  if (/reference/.test(name)) return "reference";
  if (/frontal/.test(name)) return "identity-anchor";
  return "source";
}

// roleFor() only sees the field name, which misses models that reuse a
// generic name like `image_url` for what its own schema description says is
// a start frame (LTX 2.5, Seedance 2.5, Hailuo H3 i2v all do this). Promote
// those using the description text already captured — still schema-derived,
// just a second pass over evidence roleFor() cannot see from the name alone.
const START_FRAME_DESCRIPTION = /first frame|start(ing)? (frame|image)/i;

function refineRoles(mediaInputs) {
  const hasEndFrame = mediaInputs.some((input) => input.role === "end-frame");
  for (const input of mediaInputs) {
    if (input.role !== "source" || input.modality !== "image" || input.arity !== "single") continue;
    if (START_FRAME_DESCRIPTION.test(input.description ?? "")) {
      input.role = "start-frame";
      continue;
    }
    // Companion inference: a model with an end-frame and exactly one other
    // single-arity source image field almost always pairs them, even when
    // this field's own description doesn't say "start".
    if (hasEndFrame) {
      const otherSourceSingles = mediaInputs.filter(
        (other) => other !== input && other.role === "source" && other.modality === "image" && other.arity === "single"
      );
      if (otherSourceSingles.length === 0) input.role = "start-frame";
    }
  }
  return mediaInputs;
}

function resolveRef(ref, doc) {
  // "#/components/schemas/Foo" -> doc.components.schemas.Foo
  return ref.replace(/^#\//, "").split("/").reduce((o, k) => o?.[k], doc);
}

function findInputSchema(doc, endpointId) {
  const schemas = doc.components?.schemas ?? {};
  // fal names the input schema variously; prefer an explicit *Input, else the
  // schema referenced by the queue submit path's requestBody.
  const submit = Object.entries(doc.paths ?? {}).find(([p]) => !p.includes("{"));
  const ref =
    submit?.[1]?.post?.requestBody?.content?.["application/json"]?.schema?.$ref;
  if (ref) return resolveRef(ref, doc);
  const key = Object.keys(schemas).find((k) => /Input$/.test(k));
  return key ? schemas[key] : null;
}

function flattenParam(name, spec, doc) {
  let s = spec;
  if (s?.$ref) s = resolveRef(s.$ref, doc) ?? s;

  // The outer wrapper carries title/description/default; the branches carry the
  // type. Keep the outer ones before unwrapping or we lose the default.
  const outer = { title: s.title, description: s.description, default: s.default };

  if (s.anyOf) {
    const branches = s.anyOf.filter((b) => b.type !== "null");
    // fal offers "named preset OR custom {width,height}" for sizes. The presets
    // are what you want as a control; the object branch is an escape hatch.
    s = branches.find((b) => b.enum) ?? branches[0] ?? s;
    if (s.$ref) s = resolveRef(s.$ref, doc) ?? s;
  }

  const out = {
    name,
    type: s.type ?? (s.enum ? "string" : "unknown"),
    title: outer.title ?? s.title ?? name,
    description: outer.description ?? s.description ?? "",
  };
  if (s.enum) out.enum = s.enum;
  const def = outer.default !== undefined ? outer.default : s.default;
  if (def !== undefined) out.default = def;
  if (s.minimum !== undefined) out.min = s.minimum;
  if (s.maximum !== undefined) out.max = s.maximum;
  if (s.minItems !== undefined) out.min_items = s.minItems;
  if (s.maxItems !== undefined) out.max_items = s.maxItems;
  if (s.minLength !== undefined) out.min_length = s.minLength;
  if (s.maxLength !== undefined) out.max_length = s.maxLength;
  if (s.format) out.format = s.format;
  if (s.items) {
    let items = s.items;
    if (items.$ref) items = resolveRef(items.$ref, doc) ?? items;
    out.items = {
      type: items.type ?? (items.enum ? "string" : "unknown"),
      ...(items.format ? { format: items.format } : {}),
      ...(items.enum ? { enum: items.enum } : {}),
    };
  }
  if (s.examples) out.examples = s.examples;
  return out;
}

async function fetchModel(entry) {
  const res = await fetch(SCHEMA_URL(entry.id));
  if (!res.ok) throw new Error(`${entry.id} -> HTTP ${res.status}`);
  const doc = await res.json();
  const meta = doc.info?.["x-fal-metadata"] ?? {};
  const input = findInputSchema(doc, entry.id);
  const props = input?.properties ?? {};
  const license = entry.license ?? DEFAULT_LICENSE;
  if (PROHIBITED_LICENSES.has(license)) {
    throw new Error(`${entry.id}: license '${license}' is prohibited (PRD v5 §1.1) — refusing to build a registry entry for it.`);
  }

  const imageInputs = IMAGE_PARAMS.filter((p) => p.name in props);
  const imageParam = imageInputs[0] ?? null;
  const mediaInputs = refineRoles(Object.entries(props)
    .filter(([name]) => modalityFor(name))
    .map(([name, spec]) => {
      const normalized = flattenParam(name, spec, doc);
      return {
        ...normalized,
        modality: modalityFor(name),
        role: roleFor(name),
        arity: normalized.type === "array" ? "multiple" : "single",
        required: (input?.required ?? []).includes(name),
      };
    }));

  const params = {};
  for (const [name, spec] of Object.entries(props)) {
    if (name === "prompt") continue; // the prompt box is its own thing
    if (!SURFACE.has(name)) continue;
    params[name] = flattenParam(name, spec, doc);
  }

  return {
    ...entry,
    license,
    deprecated_after: entry.deprecated_after ?? null,
    last_verified: new Date().toISOString(),
    category: meta.category ?? null,
    thumbnail: meta.thumbnailUrl ?? null,
    // These are derived from the endpoint schema, not the roster metadata.
    image_input: imageParam ? {
      name: imageParam.name,
      arity: imageParam.arity,
      required: (input?.required ?? []).includes(imageParam.name),
    } : null,
    image_inputs: imageInputs.map((p) => p.name),
    media_inputs: mediaInputs,
    // Kept for compatibility with older local registry files.
    accepts_image: imageParam?.arity ?? null,
    image_param: imageParam?.name ?? null,
    required: input?.required ?? [],
    params,
  };
}

// Diffable subset — excludes last_verified/generated_at/thumbnail so a
// no-change re-run reports zero diffs instead of "every model's timestamp
// changed" noise. This is what buildDiffReport() compares.
function diffableModel(model) {
  const { last_verified, thumbnail, ...rest } = model;
  return rest;
}

export function buildDiffReport(previous, current) {
  const prevById = new Map((previous?.models ?? []).map((m) => [m.id, diffableModel(m)]));
  const curById = new Map(current.models.map((m) => [m.id, diffableModel(m)]));
  const added = [...curById.keys()].filter((id) => !prevById.has(id));
  const removed = [...prevById.keys()].filter((id) => !curById.has(id));
  const changed = [];
  for (const id of curById.keys()) {
    if (!prevById.has(id)) continue;
    const before = JSON.stringify(prevById.get(id));
    const after = JSON.stringify(curById.get(id));
    if (before !== after) changed.push(id);
  }
  return {
    generated_at: current.generated_at,
    compared_against: previous?.generated_at ?? null,
    added,
    removed,
    changed,
    unchanged_count: curById.size - added.length - changed.length,
  };
}

// Guard the actual fetch loop behind the CLI check (matches
// build_capabilities.mjs's pattern) — this module is also imported by
// tests for buildDiffReport()/PROHIBITED_LICENSES, and importing it must
// never trigger 37 live HTTP calls as a side effect.
const isCli = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isCli) {
  const models = [];
  const failed = [];
  for (const entry of ROSTER) {
    try {
      models.push(await fetchModel(entry));
      process.stdout.write(".");
    } catch (err) {
      failed.push({ id: entry.id, error: String(err) });
      process.stdout.write("x");
    }
  }
  process.stdout.write("\n");

  const registry = {
    generated_at: new Date().toISOString(),
    source: "fal.ai public OpenAPI queue schemas",
    count: models.length,
    models,
    failed,
  };

  const registryPath = join(HERE, "registry.json");
  const previous = existsSync(registryPath) ? JSON.parse(readFileSync(registryPath, "utf8")) : null;
  const diff = buildDiffReport(previous, registry);

  writeFileSync(registryPath, JSON.stringify(registry, null, 2));
  writeFileSync(join(HERE, "registry-diff-report.json"), JSON.stringify(diff, null, 2));

  console.log(`wrote registry.json: ${models.length} models, ${failed.length} failed`);
  if (failed.length) console.log(failed);
  console.log(
    `diff vs previous run: +${diff.added.length} added, -${diff.removed.length} removed, ` +
    `~${diff.changed.length} changed, ${diff.unchanged_count} unchanged`
  );
}
