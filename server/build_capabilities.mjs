import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

function readProfiles(dir) {
  const profiles = {};
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".json") || file === "pricing.json") continue;
    try { Object.assign(profiles, JSON.parse(readFileSync(join(dir, file), "utf8"))); }
    catch (error) { console.warn(`Skipping ${file}: ${error.message}`); }
  }
  return profiles;
}

function findNumber(description, patterns) {
  for (const pattern of patterns) {
    const match = String(description ?? "").match(pattern);
    if (match) return Number(match[1]);
  }
  return null;
}

// A size limit phrased as "total size under 50 MB" / "combined ... 50 MB"
// caps the sum across every item in the field. One phrased as "max 30 MB
// per image" / "10 MB each" caps every item individually — summing those
// against each other would reject perfectly valid multi-file attachments.
// Default to per-item (the more common phrasing, and the safer assumption:
// under-rejecting a combined cap is a fal-side 400, but over-rejecting a
// per-item cap blocks a valid attach outright).
function megabyteLimit(text) {
  const combined = String(text ?? "").match(/(?:total\s+(?:size\s+)?|combined[^.]*?)under\s+(\d+)\s*mb/i)
    ?? String(text ?? "").match(/combined[^.]*?(\d+)\s*mb/i);
  if (combined) return { max_megabytes: Number(combined[1]), max_megabytes_combined: true };
  const perItem = String(text ?? "").match(/max(?:imum)?\s*(?:size)?:?\s+(\d+)\s*mb/i)
    ?? String(text ?? "").match(/under\s+(\d+)\s*mb/i);
  if (perItem) return { max_megabytes: Number(perItem[1]), max_megabytes_combined: false };
  return { max_megabytes: null, max_megabytes_combined: false };
}

function inferredLimits(input) {
  const text = input.description ?? "";
  return {
    min_items: input.min_items ?? null,
    max_items: input.max_items ?? findNumber(text, [
      /up to\s+(\d+)\s+(?:images?|videos?|audio files?|files?|references?|elements?)/i,
      /max(?:imum)?\s+(?:of\s+)?(\d+)\s+(?:images?|videos?|audio files?|files?|references?|elements?)/i,
    ]),
    ...megabyteLimit(text),
    min_seconds: findNumber(text, [/(\d+)\s*(?:-|to)\s*\d+\s*seconds/i]),
    max_seconds: findNumber(text, [/(?:-|to)\s*(\d+)\s*seconds/i, /max(?:imum)?\s+(\d+)\s*seconds/i]),
  };
}

function profileEvidence(profile) {
  if (!profile) return null;
  const queue = [profile];
  while (queue.length) {
    const value = queue.shift();
    if (!value || typeof value !== "object") continue;
    for (const [key, nested] of Object.entries(value)) {
      if (/reference_image_behavior|input_requirements|media_inputs/i.test(key) && typeof nested === "string") {
        return nested.slice(0, 900);
      }
      if (nested && typeof nested === "object") queue.push(nested);
    }
  }
  return null;
}

export function buildCapabilityManifest(registry, profiles = {}) {
  const models = registry.models.map((model) => {
    const inputs = (model.media_inputs ?? []).map((input) => ({
      field: input.name,
      modality: input.modality,
      role: input.role,
      arity: input.arity,
      required: Boolean(input.required),
      description: input.description ?? "",
      accepted_type: input.type,
      item_type: input.items?.type ?? null,
      limits: inferredLimits(input),
      provenance: [{ source: "fal-openapi", status: "schema-supported", checked_at: registry.generated_at }],
    }));
    const modalities = [...new Set(inputs.map((input) => input.modality))];
    return {
      model_id: model.id,
      label: model.label,
      vendor: model.vendor,
      output: model.kind,
      lane: model.lane,
      license: model.license ?? null,
      deprecated_after: model.deprecated_after ?? null,
      last_verified: model.last_verified ?? registry.generated_at,
      inputs,
      modalities,
      primary_image_field: model.image_input?.name ?? null,
      image_arity: model.image_input?.arity ?? null,
      prompt_profile: Boolean(profiles[model.id]),
      researched_input_evidence: profileEvidence(profiles[model.id]),
      confidence: inputs.length ? "schema-supported" : "schema-reports-no-media-input",
    };
  });
  return {
    version: 1,
    generated_at: new Date().toISOString(),
    schema_generated_at: registry.generated_at,
    source: registry.source,
    status_legend: {
      "schema-supported": "Declared by fal's live OpenAPI schema; not necessarily exercised.",
      "submission-verified": "A real request containing this field was accepted.",
      "output-verified": "A generated result was manually or automatically checked against the input.",
      failed: "A real request containing this field was rejected.",
      untested: "No current evidence exists.",
    },
    models,
  };
}

export function loadOrBuildCapabilityManifest({ registry, profiles, path }) {
  if (existsSync(path)) {
    try {
      const current = JSON.parse(readFileSync(path, "utf8"));
      if (current.schema_generated_at === registry.generated_at) return current;
    } catch {}
  }
  const manifest = buildCapabilityManifest(registry, profiles);
  writeFileSync(path, JSON.stringify(manifest, null, 2));
  return manifest;
}

const isCli = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isCli) {
  const registry = JSON.parse(readFileSync(join(HERE, "registry.json"), "utf8"));
  const profiles = readProfiles(join(HERE, "profiles"));
  const manifest = buildCapabilityManifest(registry, profiles);
  writeFileSync(join(HERE, "capabilities.json"), JSON.stringify(manifest, null, 2));
  console.log(`wrote capabilities.json: ${manifest.models.length} models`);
}
