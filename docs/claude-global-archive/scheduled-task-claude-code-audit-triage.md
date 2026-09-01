---
name: claude-code-audit-triage
description: Ranks repos by diff volume (last 3 days), then runs audit-claude-setup + audit-tokens on the top repos
---

Step 0 — dedup check. This task is scheduled to fire at both 9 AM and 11 AM as a fallback in case the app wasn't open at 9. Read `/Users/shahramsedehi/.claude/scheduled-tasks/claude-code-audit-triage/.last-run-date` if it exists. If its contents match today's date (YYYY-MM-DD, local time), the 9 AM run already completed today — stop here, do nothing else, don't report anything. Otherwise continue, and at the very end of a successful run, write today's date into that file (creating it if needed) so the 11 AM fallback skips cleanly if 9 AM already ran.

Step 1 — find the busiest repos. Survey git repos under `/Users/shahramsedehi/Documents/Github Local/` (one level deep — each subfolder that is its own git repo; skip non-repo folders and skip anything under a repo's own `node_modules`/`.git`). For each repo, compute a diff-volume score:
- Uncommitted change size: `git status --porcelain | wc -l` plus `git diff --shortstat` (staged + unstaged) line counts.
- Recent churn: `git log --since="3 days ago" --shortstat` summed across commits (insertions + deletions), on whatever the current branch is.
Score = uncommitted lines changed + churn lines changed. Rank all repos by score, descending. Skip any repo whose git remote or local state you can't read (report it as UNKNOWN, don't fail the whole run).

Step 2 — audit the top repos. Take the top 3 repos by score (fewer than 3 if fewer repos exist, and skip any repo that has essentially zero score — don't audit an idle repo just to fill the quota). For each of those repos only, run:
1. The `claude-code-audit` skill (same as `/audit-claude-setup`): CLAUDE.md size/router pattern/persona language/instruction style/prompt-decay risk, `.claude/skills/` description quality, `.claude/settings.json` hygiene.
2. The `token-usage-audit` skill (same as `/audit-tokens`): CLAUDE.md size overlap, MCP tool deferral status, model/effort config, hooks filtering noisy output, subagent model pinning, scheduled-task intervals vs. cache TTL, cache hit rate.

Both are measurement passes only — never edit a file or setting in any of these repos during this run.

Step 3 — report. Start with a one-line ranking table (repo | diff score | uncommitted lines | churn lines) for ALL repos surveyed, so it's clear why the top 3 were chosen. Then, per audited repo, give the two audit tables (FINDING | SEVERITY | EVIDENCE | WHAT IT IS COSTING ME) clearly labeled by repo and by which skill produced them, each ending with its single highest-leverage fix. If a finding overlaps between the two audits for the same repo, mention it once and cross-reference rather than duplicating the row.

Step 4 — mark done. Write today's date (YYYY-MM-DD) to `/Users/shahramsedehi/.claude/scheduled-tasks/claude-code-audit-triage/.last-run-date`, overwriting any prior content.