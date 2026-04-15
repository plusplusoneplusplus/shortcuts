# llm-tools

AI tool factories injected into chat executor sessions. Each factory follows a per-invocation pattern: create a stateful tool + accessor per AI call to avoid cross-request contamination. All tools use `defineTool()` from forge.

## Tools

| File | Tool Name | Description |
|------|-----------|-------------|
| `add-diff-comment-tool.ts` | `add_diff_comment` | Leaves anchored review comments on commit diff lines. Pre-binds workspace/commit context; AI provides filePath, lineStart, side, comment. Persists via `DiffCommentsManager`, broadcasts via WebSocket. |
| `resolve-comment-tool.ts` | `resolve_comment` | Marks inline comments as resolved during AI-assisted comment resolution. Tracks resolved IDs in a per-invocation Map. |
| `search-conversations-tool.ts` | `search_conversations` | FTS5 full-text search over past conversation history. Requires SQLite-backed `ProcessStore`. |
| `suggest-follow-ups-tool.ts` | `suggest_follow_ups` | Emits follow-up action suggestions displayed after the AI response. |
| `update-task-status-tool.ts` | `update_task_status` | Updates task file status (e.g. in-progress, done) when executing against a plan file. |

## Supporting Modules

| File | Description |
|------|-------------|
| `diff-line-mapper.ts` | Parses unified diff output and maps source-file line numbers to rendered diff-line indices used by the SPA's `UnifiedDiffViewer`. |
| `index.ts` | Barrel re-exports for all tool factories and mapper utilities. |
