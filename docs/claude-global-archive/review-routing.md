Run the model-routing kit's log review script against the current project, then summarize the result in plain language:

```
python3 "/Users/shahramsedehi/Documents/Github Local/model-routing/model-routing-kit/review-routing-log.py"
```

This reads `.claude/model-routing-log.jsonl` in the current project (or `~/.claude/model-routing-log.jsonl` as a fallback) and tallies, per subagent (`quick-lookup`/haiku, `implement`/sonnet, `architect`/opus), how often it self-reported `ESCALATE: yes` (task was too big for its tier) or `DOWNGRADE: yes` (task was too small for its tier).

After running it:
- If a subagent has a high escalate rate, propose either bumping its `model` field up a tier or narrowing its `description` in `.claude/agents/<name>.md` so fewer borderline tasks land there.
- If `architect` has a high downgrade rate, propose tightening its `description` so easy tasks stop reaching it.
- If every row shows "unknown," follow the script's own instructions to inspect the raw log (`tail -1 .claude/model-routing-log.jsonl | python3 -m json.tool`) and report back what the actual field names look like before proposing a fix to `review-routing-log.py`.
- Don't edit any `.claude/agents/*.md` file without confirming the specific change with me first — this command is for reporting, not auto-tuning.
