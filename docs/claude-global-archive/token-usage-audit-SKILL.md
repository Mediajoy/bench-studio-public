---
name: token-usage-audit
description: Use this skill whenever the user wants to audit Claude Code token/cost consumption, figure out why they're hitting usage limits, check cache hit rate, decide whether to disable MCP servers or subagents, or diagnose what's burning through their session or plan limits. Trigger on phrases like "audit my token usage," "why do I keep hitting my limit," "check my cache performance," "run a token audit," "is my setup wasting tokens," or "diagnose my Claude Code costs." This is a different job from context-os-audit: that skill prunes CLAUDE.md/skills/hooks bloat (the content of what loads); this skill measures runtime cache and cost behavior (how expensively that content gets resent). Run both together for a full picture, but either can run alone.
---

# Token Usage Audit

The core fact this skill is built around: Claude Code has no memory between API requests. Every turn re-sends the entire conversation from the top. Prompt caching is what makes that affordable — it re-reads unchanged content at roughly 1/10th the price instead of reprocessing it. Almost every "why am I burning tokens" problem is really a "what just broke my cache" problem, not a "what did I type" problem.

This skill is a **measurement pass, not a fix pass**. Report findings; don't change settings or files unless the user separately asks you to act on a specific finding.

---

## Part 1: Run the audit

Work through these seven checks using shell/file tools directly where possible. If a check needs a slash command you can't invoke yourself (this varies by surface), ask the user to run it and paste the output, then continue.

### 1. Memory
Find every CLAUDE.md in scope (project, parent directories, user-level, `@imports`). Report each file's size. This overlaps with **context-os-audit** — if that skill is available and the user wants the deep version of this check (Pile A/B sorting, ablation), hand off to it rather than duplicating. Here, just flag any single file over 5k tokens or a combined total over 10k as a finding.

### 2. Tools / MCP
List connected MCP servers and how many tools each exposes. State plainly whether tool deferral is **ACTIVE** or **NOT** — check `/context`'s tools line for a `deferred` label. Then check for a proxy or gateway: `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BEDROCK_BASE_URL`, `ANTHROPIC_VERTEX_BASE_URL`, `ANTHROPIC_FOUNDRY_BASE_URL`, or any other gateway variable. **Flag this loudly if found** — routing through a custom gateway or an unsupported provider silently disables tool-search deferral, which means every MCP server connect/disconnect (including transient reconnects) invalidates the entire cache instead of just appending. This is easy to miss because nothing warns you in the moment.

### 3. Model & effort
Report the current model and effort level and where each is set (CLI flag, `/config`, settings file). Flag any config that switches model automatically mid-session — `opusplan` (Opus in plan mode, Sonnet in execution) is the most common one, and each toggle between plan and execution is a full model switch under the hood. Also flag fast mode if it's on, and note whether it was turned on at session start (cheap) or mid-session (one expensive turn to rebuild the cache).

### 4. Hooks
List any `PreToolUse` hooks that filter or truncate noisy command output before it reaches context. If there are none, say so — unfiltered test/build/install output lands in context verbatim and gets re-sent for the rest of the session.

### 5. Subagents
List every agent file in project and user agent directories. For each, report whether it sets an explicit `model:` in frontmatter or inherits the session's model. Flag any high-volume-operation subagent (log processing, test running, doc fetching) that isn't pinned to a cheaper model.

### 6. Scheduled work
List every `/loop`, cron task, routine, or background job with its interval. Compare each interval against the **actual cache TTL in effect** — this is not always 1 hour:

| Auth method | Default TTL |
|---|---|
| Claude subscription (Pro/Max/Team/Enterprise) | 1 hour |
| Same, but drawing on usage credits | 5 minutes (unless `ENABLE_PROMPT_CACHING_1H=1` is set) |
| API key, Bedrock, Vertex, Foundry, Claude Platform on AWS | 5 minutes by default |

Flag every scheduled task whose interval is longer than the TTL actually in effect — those miss cache on every single fire and reprocess the full context at full uncached price.

### 7. Cache performance
Prefer the built-in reporting over manual log parsing: if `/usage` is available and recent enough (Claude Code v2.1.251+), it prints a `Prompt cache (main)` line with request count, % of input tokens from cache, miss count, and whether the cache is currently warm or cold. Use that directly.

If it isn't available, parse the newest session log under the projects directory: for every assistant turn, sum `cache_read_input_tokens`, `cache_creation_input_tokens`, `input_tokens`, and `output_tokens`, and report each as a percentage of the total. Report context size on the first and last turn.

### Output format

One table, sorted by cost, highest first:

```
FINDING | SEVERITY | EVIDENCE | WHAT IT IS COSTING ME
```

Severity is RED, AMBER, or GREEN. Evidence is a number or a file path — never an adjective. End with one line: the single highest-leverage change to make. Nothing after it.

**Rules:** measure, don't estimate. Write `UNKNOWN` rather than guessing. Change no file and no setting during this pass. If a command's actual behavior seems to differ from what's described here, verify against `docs.claude.com` before reporting a number — CLI details shift between releases faster than any static reference (including this one) can track.

---

## Part 2: Corrections worth holding onto

These are places where the popular "seven fixes" framing (the version of this that circulates in videos/threads) overstates or oversimplifies. Apply the nuance rather than the blanket version when writing up findings:

- **Compaction isn't unconditionally the most expensive move.** `/compact` sends the full conversation to generate a summary either way, but if the cache is still warm, that request reads the prefix from cache and costs a fraction of what the context size suggests. It's only genuinely the most expensive request when the cache has already gone cold — e.g. resuming a session after a break longer than the TTL. Don't tell the user compaction is always backwards; tell them it's backwards *specifically* when done to "save money" mid-task, versus `/clear` which is unconditionally free.
- **MCP connect/disconnect is only cache-safe when tools are deferred.** State this conditionally, not as a blanket fact — see check #2 above.
- **Subagent token multipliers are illustrative, not a fixed law.** "Agents use ~4x tokens, multi-agent systems ~15x" is real, but it's from Anthropic's Research product, not Claude Code subagents specifically. Claude Code's own Agent Teams feature separately reports ~7x versus a standard session. Use these as ballpark intuition (subagents cost more in aggregate, pay off only when the session has many turns left to amortize the savings), not as numbers to quote precisely for a specific setup.
- **A specific server's token cost (e.g. "GitHub costs 26k tokens") is anecdotal to whoever measured it**, not a fixed number — it depends on how many tools that server exposes and whether deferral is active for it. Measure the user's own setup rather than citing someone else's number.

---

## Part 3: Fixes ranked by leverage (cheat sheet, only after the audit)

Only bring this up after Part 1's findings, and only for whatever the findings actually flagged — don't recite the full list unprompted.

1. **`/clear` between unrelated tasks.** The only unconditionally free reset; resets 100% of accumulated context, not a fraction of it. Use `/rename` first if the user wants to `/resume` it later.
2. **Pick model and effort once, at the start of a session.** Every mid-session change re-reads the full history uncached. This includes plan-mode toggles under `opusplan`.
3. **Filter noisy tool output with a `PreToolUse` hook** instead of letting raw install/test/build output land in context verbatim.
4. **Disable unused MCP servers with `/mcp`**, and confirm `/context` still shows `deferred` for the ones left on.
5. **Use subagents when the session has many turns left to amortize the savings, not when it's about to end.** Pin high-volume subagents to `haiku` in frontmatter.
6. **Match scheduled-task intervals to the cache TTL actually in effect** (see the table in check #6) — not a flat "1 hour" assumption.
7. **Use `/clear` for a fresh start, `/rewind` to undo a few turns, and reserve `/compact` for natural breaks where continuity matters** — not as a cost-saving reflex.

---

## Communication notes

Explain "cache hit," "TTL," and "deferred" briefly in plain language the first time each comes up in a session, rather than assuming familiarity — same approach as context-os-audit. Re-run this audit whenever a plugin, MCP server, or scheduled task is added, or roughly weekly if usage feels like it's drifting.
