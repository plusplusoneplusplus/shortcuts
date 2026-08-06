# LLM Tools

AI tool factories injected into chat executor sessions. Each factory follows a per-invocation pattern: create a stateful tool + accessor per AI call to avoid cross-request contamination. All tools use `defineTool()` and the `Tool` type imported directly from `@plusplusoneplusplus/coc-agent-sdk` (the provider-neutral contract owner), not via the forge re-export.

## Tool Registry

`llm-tool-registry.ts` is the central registry of user-toggleable LLM tools (`LLM_TOOL_REGISTRY`). Each entry has:
- `name` — tool identifier
- `label` — display name
- `description` — human-readable description
- `enabledByDefault` — whether the tool is on by default

Exports: `DEFAULT_DISABLED_LLM_TOOLS`, `isLlmToolEnabled()`, `filterDisabledLlmTools()`.

**Feature-gated registry entries:** `getEffectiveLlmToolRegistry({ loopsEnabled, canvasEnabled, kustoEnabled })` filters `scheduleWakeup`, the canvas tools (`write_canvas`/`read_canvas`/`extension_canvas`, `CANVAS_LLM_TOOL_NAMES`), and the Kusto tool (`kusto_query`, `KUSTO_LLM_TOOL_NAMES`) out of the settings list when their flags are off.

**Mode-aware defaults:** `getEffectiveDefaultDisabledTools(uiLayoutMode)` disables `tavily_web_search` at registry level. `CLASSIC_MODE_EXTRA_DISABLED_TOOLS` is currently empty, so classic and dev-workflow modes share the same defaults.

**Per-repo overrides:** `PerRepoPreferences.disabledLlmTools` explicitly overrides defaults (empty array = enable all). API: `GET/PUT /api/workspaces/:id/llm-tools-config`.
The GET/PUT response also includes `conversationRetrievalAvailable`, which is
true only when the active `ProcessStore` supports `searchConversations`; the SPA
uses it with the `get_conversation` toggle to decide whether session-context
attachments can be dropped into chat composers. Removed tool names (`create_bug`,
`get_work_item`, `create_update_work_item` — tracked in `REMOVED_LLM_TOOL_NAMES`)
are filtered from config responses and from preferences when those preferences
are rewritten.

## Tool Factories

| File | Tool Name | Description |
|------|-----------|-------------|
| `add-diff-comment-tool.ts` | `add_diff_comment` | Anchored review comments on commit diff lines. Pre-binds workspace/commit context. Persists via `DiffCommentsManager`, broadcasts via WebSocket. |
| `ask-user-tool.ts` | `ask_user` | Structured questions (select, multi-select, yes/no, confirm, text). Blocks until user responds. Persists pending payload on `AIProcess.pendingAskUser`, emits SSE event. Results distinguish normal answers, skips, cancellations, and `deferred: true` / `reason: "needs-context"` responses with optional user notes. |
| `resolve-comment-tool.ts` | `resolve_comment` | Marks inline comments as resolved. Tracks resolved IDs in per-invocation Map. |
| `save-classification-tool.ts` | `saveClassification` | Persists complete per-hunk diff classifications for PR/commit/branch-range review. Valid categories are `logic`, `mechanical`, `test`, `simple`, and `generated`; newly saved `test` hunks require `testFidelityComment`, `logic` hunks require `summaryComment`, and critical metadata is validated instead of dropped. |
| `search-conversations-tool.ts` | `search_conversations` | FTS5 full-text search over past conversation history. Requires SQLite-backed `ProcessStore`. |
| `send-to-conversation-tool.ts` | `send_to_conversation` | Dual-mode conversation dispatch. Create mode omits `processId` and enqueues a brand-new visible chat through the same in-process queue path as `POST /api/queue`; it defaults to the caller workspace and Ask mode, can target another registered workspace, links spawned chats through `payload.context.spawnedFromProcessId`, and accepts concrete `provider` (`copilot`, `codex`, `claude`, `opencode`) plus optional `effortTier` (`very-low`, `low`, `medium`, `high`). An explicit create-mode provider uses that provider's defaults instead of inheriting parent model/effort, and incompatible provider/model/tier choices fail without fallback. Post mode supplies `processId`, ignores any `provider` argument so native session continuity stays on the existing conversation provider, expands `effortTier` against that provider, and lets an explicit `model` override the tier. |
| `canvas-tools.ts` | `write_canvas`, `read_canvas`, `extension_canvas` | Chat canvas side-panel artifacts (three consolidated tools, kept few to limit tool-schema context cost). `write_canvas` creates (omit canvasId) or updates a `markdown`/`code` canvas — Mermaid blocks render as diagrams, `code` takes a normalized `language`, and an optional free-form `purpose` (e.g. `"plan"`) persisted on the descriptor at create time declares semantic intent (a `purpose: 'plan'` canvas surfaces the "Implement this plan" card in the dashboard). `read_canvas` returns content/revision (+ manifest for extensions). `extension_canvas` both authors and runs a custom interactive `extension` canvas: BUILD mode (manifest + capabilities[] + capabilitiesJs + **one of** `uiHtml` or `uiJsx`) vs RUN mode (canvasId + capability + params), dispatched by the presence of `capability`. `uiJsx` is a React component compiled at BUILD time by `esbuild.transform` (`canvas-jsx.ts`, classic runtime → `React.createElement`; a syntax error is a tool error and nothing is saved) into a stored `ui.js`, with the JSX source kept as `ui.jsx` for version history; `libraries` names vendored globals from a fixed allowlist (`canvas-libraries.ts`: react, recharts, papaparse, tailwind — dependency-resolved, react implied) that the panel loads from `/canvas-vendor/*` as classic scripts. Gated by the `canvas.enabled` config flag (`buildCanvasToolsAddon` reads it from `<dataDir>/config.yaml`, with an injectable override for tests). Persists via `CanvasStore` (`~/.coc/repos/<wsId>/canvases/`), links the canvas to the creating process, applies revision-checked exact-match edits, and emits `canvas-updated` SSE events on the process channel. Extension canvases store `extension/{manifest.json,capabilities.js}` plus **either** `ui.html` **or** `ui.js` + `ui.jsx` (`getExtension` reads all three optionally and returns null only when neither UI document exists, so legacy canvases are unaffected; `saveExtension` removes the documents it was not given so a stale `ui.js` cannot shadow a new `ui.html`); RUN mode executes a declared capability as a pure `(state, params) => nextState` transform in a `node:vm` sandbox (`canvas-capability-runner.ts`, no require/process, 1s timeout, 1 MB state cap) and writes the result as a revision-checked update. `extension_canvas` also accepts `files: [{ path, content, encoding? }]` (max 20/call) — data written into the canvas's read-only `files/` directory that the artifact reads back with `CanvasHost.readFile`; passing `canvasId` + `files` with no UI fields attaches data without re-authoring the extension. That directory is the ONLY write path into it: there is no user-upload route and no write endpoint, and reads are served by `GET /canvases/:id/files[/<path>]` behind layered path safety in `canvas-store.ts` (shape → resolve → `isWithinDirectory` → `realpath` re-verify) with 1 MB text / 10 MB binary caps. `CANVAS_LLM_TOOL_NAMES` lists all three for registry gating. |
| `kusto-tools.ts` | `kusto_query` | Runs a Kusto (KQL) query server-side against Azure Data Explorer (official `azure-kusto-data` SDK + `AzureCliCredential`, no CLI shell-out) and persists the result into a new or existing `type: 'kusto'` canvas rendered by `KustoView` (editable query, result table, native charts). Omit `canvasId` to create (default title `Kusto Query`), or pass it to re-run/update; requires an existing target canvas to be `type: 'kusto'`. Returns column schema, a capped row sample (`KUSTO_QUERY_ROW_SAMPLE`), total row count, truncation state, and a `canvas://<id>` embed link. Shares the `runKustoCanvas` execute/truncate/persist path with the `POST /canvases/:id/run` endpoint. Gated by the `kusto.enabled` config flag (`buildKustoToolsAddon` reads it from `<dataDir>/config.yaml`, with an injectable test override); `KUSTO_LLM_TOOL_NAMES` lists it for registry gating. |
| `get-conversation-tool.ts` | `get_conversation` | Full transcript by processId, compacted to token budget. 5-level progressive compaction. Supports `fromTurn`/`toTurn` paging. |
| `suggest-follow-ups-tool.ts` | `suggest_follow_ups` | Emits follow-up action suggestions after AI response. |
| `tavily-web-search-tool.ts` | `tavily_web_search` | Live web search via Tavily API. Key from `~/.coc/providers.json`. Disabled by default. |

> Work items are managed exclusively through the REST routes (`work-item-routes.ts`) and the dashboard; there are no `get_work_item` / `create_update_work_item` LLM tools. The shared command service (`work-items/work-item-commands.ts`) still owns hierarchy validation, provider sync, cache invalidation, and broadcasts for the REST path.

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

Some addons emit a prompt `suffix` wrapped in a named XML-style tag via `tagGuidanceSuffix()` from `prompt-tags.ts` (currently `<web_search_tool>` and the Memory V2 `<memory_tool>` block), so the aggregated `toolGuidance` is self-delimiting. Most addons emit an empty suffix — the follow-up, `ask_user`, and canvas guidance lives entirely in each tool's own `description` (and JSON schema) rather than being duplicated as injected prose, which keeps the assembled system prompt smaller with no loss of instruction. `tagGuidanceSuffix` includes the leading blank-line separator `applyLlmToolPreferences` relies on; the standalone `tagBlock()` helper wraps non-suffix blocks (e.g. the `<citing_rule>` source-location directive). When a tool is disabled its whole tagged block (if any) is dropped with it.

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
