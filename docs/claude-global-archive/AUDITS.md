# Audit skills — how to use each

Three global audit skills, all usable from any project/session (installed under `~/.claude/skills/` and `~/.claude/commands/`). None of them edit anything — they report findings, and you pick what to act on.

## `/audit-claude-setup` → `claude-code-audit` skill
**Use for:** is this repo's Claude Code setup itself well-formed? Checks CLAUDE.md size/router pattern, persona language ("you are an expert..."), negative-vs-positive instruction phrasing, prompt-decay risk, skill description quality, and `settings.json` hygiene.
**Run it:** at the start of a new project, after a big CLAUDE.md edit, or whenever instructions feel like they're being ignored/misread.
**Say:** `/audit-claude-setup`

## `/audit-tokens` → `token-usage-audit` skill
**Use for:** why is this session/plan burning through usage faster than expected? Checks cache hit rate, MCP tool deferral status, model/effort config and mid-session switches, hooks that filter noisy output, whether subagents are pinned to cheaper models, and scheduled-task intervals vs. actual cache TTL.
**Run it:** when you're hitting usage limits sooner than expected, after adding an MCP server/plugin/scheduled task, or roughly weekly if cost feels like it's drifting.
**Say:** `/audit-tokens` (or naturally: "why do I keep hitting my limit," "check my cache performance," "is my setup wasting tokens")

## `context-os-audit` (built-in `anthropic-skills:` plugin)
**Use for:** the deep-prune version of the CLAUDE.md/skills/hooks check — not just reporting bloat like `/audit-claude-setup`, but experimentally ablating content and testing whether removing it changes behavior, then proposing a bootstrapped leaner version.
**Run it:** when `/audit-claude-setup` flags real bloat and you want to actually cut it, not just see the report.
**Say:** `/context-os-audit` (invoke via the Skill tool/slash form — it's plugin-provided, not one of the two files above)

## How they relate
- `/audit-claude-setup` and `context-os-audit` both look at *what loads* (CLAUDE.md/skills/hooks content) — one reports, the other prunes.
- `/audit-tokens` looks at *how expensively that content gets resent* (cache/runtime behavior) — a different axis entirely.
- Run `/audit-claude-setup` + `/audit-tokens` together for a full picture of a repo's Claude Code setup; escalate to `context-os-audit` only when you're ready to actually cut content, not just measure it.
