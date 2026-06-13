# LLM Tools

AI tool factories injected into chat executor sessions. Each factory follows a per-invocation pattern: create a stateful tool + accessor per AI call to avoid cross-request contamination. All tools use `defineTool()` and the `Tool` type imported directly from `@plusplusoneplusplus/coc-agent-sdk` (the provider-neutral contract owner), not via the forge re-export.

## Tool Registry

`llm-tool-registry.ts` is the central registry of user-toggleable LLM tools (`LLM_TOOL_REGISTRY`). Each entry has:
- `name` — tool identifier
- `label` — display name
- `description` — human-readable description
- `enabledByDefault` — whether the tool is on by default

Exports: `DEFAULT_DISABLED_LLM_TOOLS`, `isLlmToolEnabled()`, `filterDisabledLlmTools()`.

**Feature-gated registry entries:** `getEffectiveLlmToolRegistry({ loopsEnabled, excalidrawEnabled, canvasEnabled })` filters `scheduleWakeup`, the excalidraw tools, and the canvas tools (`create_canvas`/`update_canvas`/`read_canvas`) out of the settings list when their flags are off.

**Mode-aware defaults:** `getEffectiveDefaultDisabledTools(uiLayoutMode)` disables `tavily_web_search` at registry level, and also disables the work-item tool family (`get_work_item` and `create_update_work_item`) in classic mode.

**Per-repo overrides:** `PerRepoPreferences.disabledLlmTools` explicitly overrides defaults (empty array = enable all). API: `GET/PUT /api/workspaces/:id/llm-tools-config`.
The GET/PUT response also includes `conversationRetrievalAvailable`, which is
true only when the active `ProcessStore` supports `searchConversations`; the SPA
uses it with the `get_conversation` toggle to decide whether session-context
attachments can be dropped into chat composers. Removed tool names such as
`create_bug` are filtered from config responses and from preferences when those
preferences are rewritten.

## Tool Factories

| File | Tool Name | Description |
|------|-----------|-------------|
| `add-diff-comment-tool.ts` | `add_diff_comment` | Anchored review comments on commit diff lines. Pre-binds workspace/commit context. Persists via `DiffCommentsManager`, broadcasts via WebSocket. |
| `ask-user-tool.ts` | `ask_user` | Structured questions (select, multi-select, yes/no, confirm, text). Blocks until user responds. Persists pending payload on `AIProcess.pendingAskUser`, emits SSE event. Results distinguish normal answers, skips, cancellations, and `deferred: true` / `reason: "needs-context"` responses with optional user notes. |
| `resolve-comment-tool.ts` | `resolve_comment` | Marks inline comments as resolved. Tracks resolved IDs in per-invocation Map. |
| `save-classification-tool.ts` | `saveClassification` | Persists complete per-hunk diff classifications for PR/commit/branch-range review. Valid categories are `logic`, `mechanical`, `test`, `simple`, and `generated`; newly saved `test` hunks require `testFidelityComment`, `logic` hunks require `summaryComment`, and critical metadata is validated instead of dropped. |
| `search-conversations-tool.ts` | `search_conversations` | FTS5 full-text search over past conversation history. Requires SQLite-backed `ProcessStore`. |
| `canvas-tools.ts` | `create_canvas`, `update_canvas`, `read_canvas`, `create_or_update_extension_canvas`, `invoke_canvas_capability` | Chat canvas side-panel artifacts (type `markdown` for documents — Mermaid blocks render as diagrams — `code` with a normalized `language` for a single code file, or `extension` for a custom interactive panel). Gated by the `canvas.enabled` config flag (`buildCanvasToolsAddon` reads it from `<dataDir>/config.yaml`, with an injectable override for tests). Persists via `CanvasStore` (`~/.coc/repos/<wsId>/canvases/`), links the canvas to the creating process, applies revision-checked exact-match edits, and emits `canvas-updated` SSE events on the process channel. Extension canvases store `extension/{manifest.json,ui.html,capabilities.js}`; `invoke_canvas_capability` runs a declared capability as a pure `(state, params) => nextState` transform in a `node:vm` sandbox (`canvas-capability-runner.ts`, no require/process, 1s timeout, 1 MB state cap) and writes the result as a revision-checked update. `CANVAS_LLM_TOOL_NAMES` lists all five for registry gating. |
| `get-conversation-tool.ts` | `get_conversation` | Full transcript by processId, compacted to token budget. 5-level progressive compaction. Supports `fromTurn`/`toTurn` paging. |
| `suggest-follow-ups-tool.ts` | `suggest_follow_ups` | Emits follow-up action suggestions after AI response. |
| `tavily-web-search-tool.ts` | `tavily_web_search` | Live web search via Tavily API. Key from `~/.coc/providers.json`. Disabled by default. |
| `get-work-item-tool.ts` | `get_work_item` | Read-only lookup of an existing work item by UUID, `WI-N`, or work-item number. Resolves one target from `workItemId`/`target`/`workItemNumber`; numeric refs match the workspace listing, UUID-like refs read directly via `store.getWorkItem(target, repoId)`. Returns `{ found: true, item }` (full `WorkItem`) or `{ found: false, error }`. Workspace-scoped (`repoId`), so it cannot read items from another workspace, and never mutates, versions, broadcasts, or calls provider write transports. Factory accepts optional `GetWorkItemToolDeps` (`workItemStore`) for injection. |
| `create-update-work-item-tool.ts` | `create_update_work_item` | Creates typed work items and bugs (`work-item`, `bug`, `goal`, `epic`, `feature`, `pbi`), patches common fields on existing items, or saves a full revised plan as the next version for an existing item. Supports hierarchy links via `parentId` (UUID or `null` to unlink), `parentTarget` (UUID/WI-N), and `parentWorkItemNumber`: create children, move items, and unlink parents without REST. All creates and hierarchy-sensitive updates run through the shared command service (`work-items/work-item-commands.ts`) so the tool reuses REST-route validation, GitHub/Azure Boards provider sync, response-cache invalidation, and dashboard broadcasts; the factory accepts optional `CreateUpdateWorkItemToolDeps` (store, process store, feature flags, transports) and reads `workItems.hierarchy.enabled` / `workItems.sync.enabled` from `<dataDir>/config.yaml` when not injected. |

## Supporting Modules

| File | Description |
|------|-------------|
| `diff-line-mapper.ts` | Parses unified diff output and maps source-file line numbers to rendered diff-line indices. |
| `llm-tool-registry.ts` | Central user-toggleable tool list (see above). |
| `index.ts` | Barrel re-exports all factories, mapper, and registry. |

## Chat Tool Assembly

`chat-tool-builder.ts` assembles the common chat tool bundle:
- Collects all applicable tool factories for the current mode
- Applies `applyLlmToolPreferences()` filtering from `prompt-builder.ts`
- Filters by the effective disabled tools list

## Provider Parity (Copilot / Codex / Claude)

The assembled `Tool<any>[]` bundle is passed to every provider via
`SendMessageOptions.tools`. Copilot consumes it natively; Codex and Claude consume
the **same already-filtered array** through `coc-agent-sdk`'s provider-neutral MCP
bridge (`CocToolRuntime` + `CocToolBridgeServer` + the `coc-llm-tools-mcp` stdio
bridge). The runtime calls the same in-process handler closures, so workspace/process
context and `ask_user` blocking are preserved across the bridge. See
[sdk-wrapper.md](sdk-wrapper.md) → *CoC LLM Tools over MCP*. No executor changes are
needed — providers opt in based on `options.tools`.

## Memory Read Tools

`memory-read-tools.ts` provides opt-in read-side tools:
- `memory_search` — BM25 search over bounded memory entries
- `memory_get` — exact entry by id or ordinal
- Gated by `boundedMemory.readTools.enabled` (disabled by default)
- Repo-scoped only, uses `MemoryRecallIndex`

## Key Patterns

- **Per-invocation:** Each AI call gets fresh tool instances — no shared state
- **Pre-binding:** Tools like `add_diff_comment` pre-bind context (workspace, commit) at creation
- **Blocking tools:** `ask_user` returns a Promise resolved externally by the SPA. A needs-context response is not a skip: the result tells the AI to explain the missing context and re-ask if the question is still needed.
- **Progressive compaction:** `get_conversation` applies 5 compaction levels to fit token budgets
- **WebSocket broadcasting:** Side-effect tools broadcast events for real-time SPA updates
