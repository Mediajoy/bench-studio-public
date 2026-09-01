---
name: claude-code-audit
description: >
  Audits a repo's CLAUDE.md, skill descriptions, and .claude/settings.json against current
  (2026) Claude Code best practices — "unhobbling," positive instructional logic, prompt-decay
  ablation, and the Anthropic skills-authoring doctrine. Use this skill whenever the user asks
  to "audit my CLAUDE.md," "check for prompt decay," "is my Claude Code setup outdated,"
  "apply the new Claude Code changes," "run an ablation," or "clean up my instructions/skills."
  Also trigger proactively if a CLAUDE.md exceeds ~200 lines or a skill description reads as
  passive documentation rather than a trigger.
---

# Claude Code Audit — Unhobbling & Prompt-Decay Checklist

Source: internal research summary "The Unhobbled Developer" (2026), covering Anthropic's
80% system-prompt deletion, the persona-prompting debunking (162 personas / 2,500 prompts,
zero gain), and the official skills-authoring playbook. This skill turns that research into
a repeatable audit, not a read-once article.

## What changed, in one paragraph

Frontier models (Claude 5 / Opus 5 / Fable 5) perform *better* with fewer, denser
instructions — excess prompting is "harness friction," not guidance. Personas ("You are a
senior dev") show zero measured benefit. Negative constraints ("don't do X") fight the
model's own training; positive, example-grounded phrasing ("write it like the surrounding
code") wins. Old rules written to patch a weaker model's reasoning gaps now often *hobble* a
stronger one — hence a recommended ablation pass every ~6 months.

## Audit procedure

Run these checks against the target repo/project in order. Report findings as a punch list,
don't rewrite anything until the user confirms.

### 1. Size and structure of CLAUDE.md
- Flag if the root `CLAUDE.md` exceeds ~200 lines (300–350 words is the cited target) — this
  is the "permanent tax" paid every session.
- If it's large, propose the **Router Pattern**: split into topic files (e.g.
  `docs/claude/*.md`) with a thin root file that just points to them by one-line summary,
  loaded on demand rather than always-on. Cite the measured effect (95% startup-context
  reduction in one case study) but don't claim it'll be exactly that for this repo.
- Check for an `index.md`/manifest with one-line-per-file summaries if the project already
  uses a `raw/` / `wiki/` / `deliverables/` style folder structure — flag if missing.

### 2. Persona and role-play language
- Grep for phrases like "You are a...", "act as a...", "as an expert...". Flag each — the
  cited research found zero performance benefit from persona framing. Recommend replacing
  with direct, functional instruction instead (state the task and constraints, not a role).

### 3. Negative vs. positive instructions
- Grep for "don't", "never", "do not" used as *style* guidance (not safety/security rules —
  those stay). For each style-related negative constraint, check whether it can be rephrased
  positively — e.g. "don't use markdown" → "write it as smooth-flowing text paragraphs";
  "don't over-engineer" → "match the surrounding code's density and idiom."
- Do NOT flag negative constraints that encode genuine safety/destructive-action boundaries
  (e.g. this project's own "never force-push," "never delete secrets") — those are correct
  as written; the finding is about *style* rules only.

### 4. Prompt-decay candidates (ablation pass)
- For each rule in CLAUDE.md, classify it as either:
  - **Attention-directing** (points the model at project-specific facts, file locations,
    client context) — keep.
  - **Reasoning-patching** (explains general logic a frontier model already knows —
    e.g. spelling out how to structure a function, generic coding hygiene) — flag as an
    ablation candidate.
- Present the ablation candidates as a list; don't delete anything without the user
  explicitly signing off, since removing a rule that's actually load-bearing (has caught a
  real bug before) is a regression, not a cleanup.

### 5. Skill description quality (if repo has `.claude/skills/` or an agents dir)
- Each skill's `description` field should read as a "pushy" tripwire ("Use this skill
  anytime X is involved"), not passive documentation ("This skill handles X"). Flag passive
  ones.
- Check skill bodies aren't re-explaining things the model already knows from training —
  they should focus on "foot guns" (the specific spots where the model predictably breaks
  for this project/library), not restating API docs.
- Check for excessive ALL-CAPS/shouted imperatives — prefer structural rules or a script
  the model must run over repeated shouting.

### 6. settings.json hygiene
- Check `cleanup_period_days` — if unset, note the 30-day default wipes session history;
  ask if the user wants it raised (e.g. to 365) to preserve resumable sessions.
- Note whether `autocompact` is using a fixed token threshold vs. a percentage — a fixed
  threshold (e.g. 50k–100k tokens) is the recommended pattern over letting it drift to
  higher token counts where retrieval accuracy measurably drops.

## Output format

Give the user a short punch list grouped by the six sections above, each item as
`[keep/flag/ablate] — file:line — one-line reason`. End with a **Recommended next action**
line (usually: "pick 2–3 flagged items to fix now, defer the rest"). Never bulk-edit
CLAUDE.md or settings.json without the user picking which findings to act on first — this
is an audit skill, not an auto-fixer.

## What this skill does NOT do

- It does not touch project-specific hard rules that encode real incidents or safety
  constraints (see e.g. this project's own numbered CLAUDE.md rules) — those aren't
  "prompt decay," they're accumulated debugging history and stay untouched by default.
- It does not run the full 6-month "delete everything and add back line-by-line" ablation
  automatically — that's a deliberate, supervised exercise the user should initiate
  explicitly, not something to trigger from a casual mention.
