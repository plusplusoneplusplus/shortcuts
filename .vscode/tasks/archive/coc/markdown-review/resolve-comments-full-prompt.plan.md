# Resolve Comments: Show Full Prompt with Enriched Comment Info

## Problem

When a "Resolve all comments" task is enqueued and the user clicks on it in the
CoC dashboard queue, the prompt shown is the truncated `promptPreview` (≤ 80 chars,
e.g. `"# Document Revision Request\n\nPlease review and address the following..."`)
rather than the full AI prompt. Additionally, `buildBatchResolvePrompt` omits
several fields that are available on each `TaskComment` and would help the AI
produce better revisions: `author`, `tags`, `replies`, `aiResponse`, and `category`.

## Goal

1. **Show the full real prompt** in the task detail panel for `resolve-comments`
   tasks, the same way `follow-prompt` tasks expose a "Full Prompt (Resolved)" expandable.
2. **Enrich the per-comment prompt block** with all contextually useful fields so
   the AI has richer input to work with.

---

## Acceptance Criteria

- [x] Clicking a `resolve-comments` queue task in the SPA opens a detail view that
      displays the complete `promptTemplate` (not the 80-char preview).
- [x] The full prompt section is expandable/collapsible (consistent with other task
      types in the panel).
- [x] `buildBatchResolvePrompt` (in `task-comments-handler.ts`) includes, for each
      comment:
  - `author` (if set)
  - `tags` (if non-empty)
  - `category` (if set)
  - `replies` thread (if non-empty) — shown as a nested blockquote list
  - `aiResponse` (if set) — labelled "Previous AI Response" to give context
- [x] Fields that are absent/empty are silently omitted (no empty lines added).
- [x] Existing snapshot/unit tests for `buildBatchResolvePrompt` are updated.
- [x] The SPA task detail panel renders `resolve-comments` payload with a labelled
      "Prompt" block using the `promptTemplate` value.

---

## Relevant Files

| File | Purpose |
|------|---------|
| `packages/coc/src/server/task-comments-handler.ts` | `buildBatchResolvePrompt()` — prompt builder |
| `packages/coc/src/server/queue-executor-bridge.ts` | `executeResolveComments()` — stores `promptPreview` / `fullPrompt` |
| `packages/coc-server/src/task-types.ts` | `ResolveCommentsPayload` type |
| `packages/coc/src/server/spa/` | SPA dashboard — `PendingTaskInfoPanel` task detail view |
| `packages/coc-server/src/websocket.ts` | `toProcessSummary()` — strips `fullPrompt` for WS messages |

---

## Subtasks

### 1 — Enrich `buildBatchResolvePrompt` with additional comment fields

In `task-comments-handler.ts`, extend the per-comment loop to emit:

```
**Author:** <author>          (if present)
**Category:** <category>      (if present)
**Tags:** <tag1>, <tag2>       (if non-empty)
**Previous AI Response:**
<aiResponse>                   (if present)
**Replies:**
> <reply1 author>: <reply1 text>
> <reply2 author>: <reply2 text>   (if non-empty)
```

Fields appended after the existing `**Comment:**` and before `**Requested Action:**`.

### 2 — Add `resolve-comments` case to SPA task detail panel

In the SPA (`PendingTaskInfoPanel` or equivalent), add a branch for
`type === 'resolve-comments'` that renders:

- **Document:** `payload.filePath`
- **Comments:** comma-separated count / IDs from `payload.commentIds`
- **Prompt:** full `payload.promptTemplate` in a `<pre>` / expandable block

This mirrors how `follow-prompt` tasks render their prompt content.

### 3 — Update `executeResolveComments` `promptPreview`

Currently the preview is the first 80 chars of the raw prompt text (which is always
the boilerplate header). Change it to a more informative summary, e.g.:
`"Resolve N comment(s) in <filePath>"` — derived from the payload, not from
truncating the prompt.

### 4 — Update tests

- Update / add unit tests for `buildBatchResolvePrompt` covering the new fields.
- Add/update SPA rendering snapshot or unit test for `resolve-comments` payload.

---

## Notes

- The `replies` field on `TaskComment` is `Reply[]`. Each reply has at minimum a
  `comment` string and optionally an `author`. Emit them as a blockquote list.
- `aiResponse` may be a multi-line string; wrap it verbatim so the AI can see what
  was previously suggested.
- Keep the new fields optional — backward-compatible with comments that lack them.
- The `fullPrompt` field is already stored in the process store by
  `executeResolveComments`; exposing it via the existing
  `GET /api/queue/:id/resolved-prompt` endpoint (or a new property on the queue
  task response) is the cleanest path for the SPA to retrieve it.
