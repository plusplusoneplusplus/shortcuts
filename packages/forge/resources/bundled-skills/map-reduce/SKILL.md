---
name: map-reduce
description: >-
  Process a list of items by dispatching one sub-agent per item in parallel
  (up to max_parallel concurrent), then aggregate results into a final
  summary. Same per-item sub-task and final summary contract as for-each —
  only the dispatch order differs. Only invoke when the user explicitly asks
  for the map-reduce skill or pattern by name. Do not auto-select for general
  tasks.
metadata:
  author: "Yiheng Tao"
  version: "0.0.1"
---

# Map-Reduce (Parallel)

Use when items are fully independent and throughput / wall-clock time matters. If items must be processed in order, or later items depend on earlier results, use **for-each** instead. The per-item sub-task and final summary contracts below are identical between the two skills.

## Workflow

1. Identify the item list. If the user did not provide it, ask once via `ask_user`. Confirm before proceeding if there are more than 5 items.
2. Dispatch all per-item sub-agents concurrently, up to `max_parallel` (default 5) at a time. As each one settles, dispatch the next pending item until every item has been mapped.
3. After every dispatched mapper has settled (success or recorded error), produce the final summary.

## Per-item sub-task (identical to for-each)

Dispatch one sub-agent per item with:
- A stable item `id` plus enough metadata to act on it (path, URL, identifier).
- The user-provided task description, scoped strictly to that item.
- An expected result shape: short structured output with key findings, evidence pointers, and a confidence note.
- Instruction: do not summarize across items, do not process items outside the assigned one, and on unrecoverable failure return `{ id, error }` instead of raising.

Use `claude-sonnet-4.6` or `gpt-5.4` for mappers. Prefer the `explore` agent for read-only work and `general-purpose` for mutations.

## Final summary (identical to for-each)

Dispatch a single summary sub-agent (or produce inline) that reads every per-item result and writes a markdown report containing:
- A header line "N of M items succeeded".
- A table or sectioned list keyed by item `id` with key findings.
- A dedicated "Errors" section listing every `{ id, error }` result.
- Actionable next steps if any.

Use `claude-opus-4.6` for the summary. Present the final report to the user.
