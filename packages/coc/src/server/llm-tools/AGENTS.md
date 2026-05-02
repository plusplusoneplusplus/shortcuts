# llm-tools

AI tool factories injected into chat executor sessions. Each factory follows a per-invocation pattern: create a stateful tool + accessor per AI call to avoid cross-request contamination. All tools use `defineTool()` from forge.

## Tools

| File | Tool Name | Description |
|------|-----------|-------------|
| `add-diff-comment-tool.ts` | `add_diff_comment` | Leaves anchored review comments on commit diff lines. Pre-binds workspace/commit context; AI provides filePath, lineStart, side, comment. Persists via `DiffCommentsManager`, broadcasts via WebSocket. |
| `ask-user-tool.ts` | `ask_user` | Poses structured questions to the user (select, multi-select, yes/no, confirm, text) and blocks until the user responds. Returns a Promise resolved by `answerQuestion()`/`skipQuestion()`. Emits an SSE event so the SPA renders the interactive widget. |
| `resolve-comment-tool.ts` | `resolve_comment` | Marks inline comments as resolved during AI-assisted comment resolution. Tracks resolved IDs in a per-invocation Map. |
| `search-conversations-tool.ts` | `search_conversations` | FTS5 full-text search over past conversation history. Requires SQLite-backed `ProcessStore`. |
| `get-conversation-tool.ts` | `get_conversation` | Fetches the full transcript of a past session by `processId` (typically from `search_conversations`), compacted to fit a token budget. Applies progressive compaction in 5 levels: strip noise → truncate tool results → drop unimportant tool calls (Read/Glob/Grep/etc.) → truncate prose → drop middle turns. Supports `fromTurn`/`toTurn` paging and `includeToolCalls: false` for prose-only views. |
| `suggest-follow-ups-tool.ts` | `suggest_follow_ups` | Emits follow-up action suggestions displayed after the AI response. |
| `tavily-web-search-tool.ts` | `tavily_web_search` | Live web search via the Tavily Search API (`POST {baseUrl}/search`). Args: `query` (required), `searchDepth`, `topic`, `maxResults` (1–20), `includeAnswer`, `includeRawContent`, `includeDomains`, `excludeDomains`, `days`. API key resolved from `options.apiKey` then `~/.coc/providers.json` → `providers.tavily.apiKey` (configured in Admin → Providers). Returns `{query, answer?, results: [{title, url, snippet, score, publishedDate?, rawContent?}], totalResults}` or an `{error, status?}` envelope on failure (timeout, non-2xx, missing key). |

## Supporting Modules

| File | Description |
|------|-------------|
| `diff-line-mapper.ts` | Parses unified diff output and maps source-file line numbers to rendered diff-line indices used by the SPA's `UnifiedDiffViewer`. |
| `llm-tool-registry.ts` | Central registry of user-toggleable LLM tools (`LLM_TOOL_REGISTRY`). Each entry has `name`, `label`, `description`, `enabledByDefault`. Exports `DEFAULT_DISABLED_LLM_TOOLS` (tools disabled by default — currently just `tavily_web_search`), `isLlmToolEnabled()`, and `filterDisabledLlmTools()`. Per-repo disabled list stored in `PerRepoPreferences.disabledLlmTools`. |
| `index.ts` | Barrel re-exports for all tool factories, mapper utilities, and the LLM tool registry. |
