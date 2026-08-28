# LLM Tools

AI tool factories injected into chat executor sessions. Each factory creates a stateful
tool + accessor **per invocation** so state never leaks across requests. All tools use
`defineTool()` and the `Tool` type imported directly from `@plusplusoneplusplus/coc-agent-sdk`
(the provider-neutral contract owner), not via the forge re-export.

## Tool Registry

`llm-tool-registry.ts` owns `LLM_TOOL_REGISTRY`, the list of user-toggleable tools. Each entry
has `name`, `label`, `description`, and `enabledByDefault`. Exports:
`DEFAULT_DISABLED_LLM_TOOLS`, `isLlmToolEnabled()`, `filterDisabledLlmTools()`.

### Gating

`getEffectiveLlmToolRegistry({ loopsEnabled, canvasEnabled, kustoEnabled })` filters
`scheduleWakeup`, the canvas tools (`CANVAS_LLM_TOOL_NAMES`), and `kusto_query`
(`KUSTO_LLM_TOOL_NAMES`) out of the settings list when their flags are off.

`getEffectiveDefaultDisabledTools(uiLayoutMode)` disables `tavily_web_search` at registry
level. `CLASSIC_MODE_EXTRA_DISABLED_TOOLS` is empty, so classic and dev-workflow modes share
the same defaults.

### Per-repo overrides

`PerRepoPreferences.disabledLlmTools` overrides defaults explicitly (empty array = enable all),
via `GET/PUT /api/workspaces/:id/llm-tools-config`. Responses also carry
`conversationRetrievalAvailable`, true only when the active `ProcessStore` supports
`searchConversations`; the SPA pairs it with the `get_conversation` toggle to decide whether
session-context attachments can be dropped into composers. Names in `REMOVED_LLM_TOOL_NAMES`
(`create_bug`, `get_work_item`, `create_update_work_item`) are filtered out of config responses
and out of preferences when those are rewritten. Work items are managed exclusively through
`work-item-routes.ts` and the dashboard; the shared `work-items/work-item-commands.ts` service
owns hierarchy validation, provider sync, cache invalidation, and broadcasts for that path.

## Tool Factories

| File | Tool Name | Description |
|------|-----------|-------------|
| `add-diff-comment-tool.ts` | `add_diff_comment` | Anchored review comments on commit diff lines. Pre-binds workspace/commit context. Persists via `DiffCommentsManager`, broadcasts via WebSocket. |
| `ask-user-tool.ts` | `ask_user` | Structured questions (select, multi-select, yes/no, confirm, text). Blocks until the user responds. Persists the pending payload on `AIProcess.pendingAskUser` and emits an SSE event. Results distinguish answers, skips, cancellations, `deferred: true` / `reason: "needs-context"` responses with optional notes, and `reason: "unavailable"` short-circuits on non-interactive turns. |
| `resolve-comment-tool.ts` | `resolve_comment` | Marks inline comments resolved; tracks resolved IDs in a per-invocation Map. |
| `save-classification-tool.ts` | `saveClassification` | Persists per-hunk diff classifications for PR/commit/branch-range review. Categories: `logic`, `mechanical`, `test`, `simple`, `generated`. New `test` hunks require `testFidelityComment`, `logic` hunks require `summaryComment`; critical metadata is validated rather than dropped. |
| `search-conversations-tool.ts` | `search_conversations` | FTS5 full-text search over past conversations. Requires a SQLite-backed `ProcessStore`. |
| `send-to-conversation-tool.ts` | `send_to_conversation` | Dual-mode dispatch — see below. |
| `canvas-tools.ts` | `write_canvas`, `read_canvas`, `extension_canvas` | Chat canvas side-panel artifacts — see below. |
| `kusto-tools.ts` | `kusto_query` | Kusto/KQL against Azure Data Explorer — see below. |
| `get-conversation-tool.ts` | `get_conversation` | Full transcript by processId, compacted to a token budget via 5 progressive levels. Supports `fromTurn`/`toTurn` paging. |
| `suggest-follow-ups-tool.ts` | `suggest_follow_ups` | Emits follow-up action suggestions after an AI response. |
| `tavily-web-search-tool.ts` | `tavily_web_search` | Live web search via Tavily. Key from `~/.coc/providers.json`. Disabled by default. |

### send_to_conversation

Create mode omits `processId` and enqueues a brand-new visible chat through the same
in-process queue path as `POST /api/queue`. It defaults to the caller workspace and Ask mode,
can target another registered workspace, links spawned chats via
`payload.context.spawnedFromProcessId`, and accepts a concrete `provider` (`copilot`, `codex`,
`claude`, `opencode`) plus optional `effortTier` (`very-low`…`high`). An explicit create-mode
provider uses that provider's defaults instead of inheriting parent model/effort; incompatible
provider/model/tier combinations fail without fallback.

Post mode supplies `processId`, ignores any `provider` argument so native session continuity
stays on the existing conversation's provider, expands `effortTier` against that provider, and
lets an explicit `model` override the tier.

### Canvas tools

Three consolidated tools, kept few to limit tool-schema context cost. Gated by the
`canvas.enabled` config flag (`buildCanvasToolsAddon` reads `<dataDir>/config.yaml`, with an
injectable test override); `CANVAS_LLM_TOOL_NAMES` lists all three for registry gating.

`write_canvas` creates (omit `canvasId`) or updates a `markdown`/`code` canvas. Mermaid blocks
render as diagrams, `code` takes a normalized `language`, and an optional free-form `purpose`
persisted on the descriptor at create time declares semantic intent (`purpose: 'plan'` surfaces
the "Implement this plan" card). `read_canvas` returns content/revision plus the manifest for
extensions.

`extension_canvas` authors and runs custom interactive `extension` canvases, dispatched by the
presence of `capability`. BUILD mode takes manifest + `capabilities[]` + `capabilitiesJs` +
**one of** `uiHtml` or `uiJsx`; RUN mode takes `canvasId` + `capability` + `params`. `uiJsx` is
compiled at BUILD time by `esbuild.transform` (`canvas-jsx.ts`, classic runtime →
`React.createElement`) into a stored `ui.js`, keeping the source as `ui.jsx` for history; a
syntax error is a tool error and nothing is saved. esbuild is loaded with `await import`
*inside* the transform, never at module scope, because this file sits on a static import chain
the server walks at boot — a top-level import turns a missing esbuild into a startup crash. It
must stay a production dependency of `@plusplusoneplusplus/coc` with `**/@esbuild/**` in the
desktop `asarUnpack`. `libraries` names vendored globals from the fixed allowlist in
`canvas-libraries.ts` (react, recharts, papaparse, tailwind — dependency-resolved, react
implied), loaded by the panel from `/canvas-vendor/*` as classic scripts.

Persistence goes through `CanvasStore` (`~/.coc/repos/<wsId>/canvases/`), a facade over
per-contract services (write queue, record/extension/comment repositories, file sandbox,
corruption diagnostics). Every mutation runs inside the per-canvas lock, and a revision's
descriptor/artifact/snapshot are staged and published together. The store links the canvas to
the creating process, applies revision-checked exact-match edits, and emits `canvas-updated`
SSE events on the process channel. Extension canvases store
`extension/{manifest.json,capabilities.js}` plus **either** `ui.html` **or** `ui.js` + `ui.jsx`;
`getExtension` returns null only when neither UI document exists, and `saveExtension` removes
documents it was not given so a stale `ui.js` cannot shadow a new `ui.html`.

RUN mode executes a capability and writes the result as a revision-checked update through the
per-canvas queue in `canvas-capability-queue.ts` — runs for one canvas never overlap, and each
re-reads the canvas inside its critical section so run N+1 sees N's output. A capability is by
default a pure `(state, params) => nextState` transform in a `node:vm` sandbox
(`canvas-capability-runner.ts`: no require/process, 1s timeout, 1 MB state cap). Declaring
`async: true` runs it instead in a `worker_threads` worker built from
`CAPABILITY_WORKER_SOURCE` (`canvas-capability-worker.ts`, started with `eval: true` so there
is no dist/source path to resolve) with a 30s whole-run budget; the worker is `terminate()`d on
every outcome including success, because a `vm` continuation cannot be killed and a capability
may resolve and keep spinning. At most 4 async runs execute process-wide at once.

An async capability receives a third argument `host` whose only method is
`await host.complete(prompt, { model? })` — the one-shot `createCLIAIInvoker` path
(`canvas-capability-completion.ts`, `resolveDefaultModel(..., 'quickAsk')`), capped at 3 calls
per run and logged with workspace/canvas/capability/process. There is deliberately no
`host.fetch` (CoC's own API is on unauthenticated loopback) and no `CanvasHost.complete()` in
the iframe. Async capabilities and `host.complete` are gated on `features.canvasHostApis` (off
by default): with the flag off an async capability 404s from the route and errors from the
tool, while sync capabilities are untouched.

`extension_canvas` also accepts `files: [{ path, content, encoding? }]` (max 20/call) — data
written into the canvas's read-only `files/` directory that the artifact reads back with
`CanvasHost.readFile`. Passing `canvasId` + `files` with no UI fields attaches data without
re-authoring the extension. That directory is the ONLY write path in: no upload route, no write
endpoint. Reads are served by `GET /canvases/:id/files[/<path>]` behind layered path safety in
`canvas-file-sandbox.ts` (shape → resolve → `isWithinDirectory` → `realpath` re-verify) with
1 MB text / 10 MB binary caps.

### kusto_query

Runs a KQL query server-side against Azure Data Explorer using the official
`azure-kusto-data` SDK + `AzureCliCredential` (no CLI shell-out) and persists the result into a
new or existing `type: 'kusto'` canvas rendered by `KustoView` (editable query, result table,
native charts). Omit `canvasId` to create (default title `Kusto Query`), or pass it to
re-run/update; an existing target must be `type: 'kusto'`. Returns column schema, a capped row
sample (`KUSTO_QUERY_ROW_SAMPLE`), total row count, truncation state, and a `canvas://<id>`
embed link. Shares the `runKustoCanvas` execute/truncate/persist path with
`POST /canvases/:id/run`. Gated by the `kusto.enabled` config flag.

## Supporting Modules

| File | Description |
|------|-------------|
| `diff-line-mapper.ts` | Parses unified diff output and maps source-file line numbers to rendered diff-line indices. |
| `llm-tool-registry.ts` | Central user-toggleable tool list (above). |
| `index.ts` | Barrel re-exporting all factories, mapper, and registry. |

## Chat Tool Assembly

`chat-tool-builder.ts` assembles the common chat tool bundle: collect the factories applicable
to the current mode, apply `applyLlmToolPreferences()` from `prompt-builder.ts`, then filter by
the effective disabled-tools list.

Some addons emit a prompt `suffix` wrapped in a named XML-style tag via `tagGuidanceSuffix()`
from `prompt-tags.ts` (currently `<web_search_tool>` and the Memory V2 `<memory_tool>` block),
so the aggregated `toolGuidance` is self-delimiting. Most addons emit an empty suffix — the
follow-up, `ask_user`, and canvas guidance lives entirely in each tool's own `description` and
JSON schema rather than being duplicated as injected prose, keeping the system prompt smaller.
`tagGuidanceSuffix` includes the leading blank-line separator `applyLlmToolPreferences` relies
on; the standalone `tagBlock()` helper wraps non-suffix blocks such as the `<citing_rule>`
source-location directive. Disabling a tool drops its whole tagged block with it.

## Provider Parity (Copilot / Codex / Claude)

The assembled `Tool<any>[]` bundle is passed to every provider via `SendMessageOptions.tools`.
Copilot consumes it natively; Codex and Claude consume the **same already-filtered array**
through `coc-agent-sdk`'s provider-neutral MCP bridge (`CocToolRuntime` + `CocToolBridgeServer`
+ the `coc-llm-tools-mcp` stdio bridge). The runtime calls the same in-process handler
closures, so workspace/process context and `ask_user` blocking survive the bridge. Providers
opt in based on `options.tools`; no executor changes are needed. See
[sdk-wrapper.md](sdk-wrapper.md) → *CoC LLM Tools over MCP*.

## Memory Tools

`memory-v2-tools.ts` builds the two memory tools per invocation from `MemoryV2ToolDeps`:
`createMemoryStoreFactTool(deps)` → `save_memory` and `createMemoryRecallTool(deps)` →
`recall_memory`. They are wired by `buildMemoryV2Addon()` and gated per scope by
`memoryV2.enabled` (global and workspace preferences are independent). See
[memory-system.md](memory-system.md).

## Key Patterns

- **Per-invocation:** every AI call gets fresh tool instances — no shared state.
- **Pre-binding:** tools like `add_diff_comment` pre-bind workspace/commit context at creation.
- **Blocking tools:** `ask_user` returns a Promise resolved externally by the SPA. A
  needs-context response is not a skip — the result tells the AI to explain the missing context
  and re-ask if still needed.
- **Mode-invariant registration:** `ask_user` is registered for both `ask` and `autopilot`
  chats, gated only on the global `chat.askUser.enabled` config. The tool block is serialized
  before `system` and `messages`, so a per-mode difference would invalidate the whole
  conversation's prefix cache when the user toggles the mode pill on a follow-up (follow-ups
  resume the stored SDK session). `ChatBaseExecutor.buildAskUserWiring()` is the single
  construction point for ask, autopilot, and follow-up turns.
- **Interactivity, not mode:** `AskUserToolDeps.isInteractive` is evaluated at call time, so the
  schema stays constant. `FollowUpExecutor` wires it to `turnSource === undefined` — a
  machine-triggered turn (cron / wakeup / trigger) has nobody to answer, so the handler resolves
  on the same tick with `{ skipped: true, reason: 'unavailable', guidance }` per question instead
  of blocking. There is no timer fallback; Codex pins the MCP tool timeout to 365 days.
  `ExecutorRegistry.getAskUserHandles()` searches the chat, follow-up, and autopilot executors.
- **Ralph grill exception:** the grill terminal round strips `ask_user` from the already-built
  array to end the questioning phase. It is the one path that mutates the tool block mid-turn.
- **Ask-user answer routing:** resolvers live in each bridge's own `ExecutorRegistry`, but
  `pendingAskUser` is persisted in the single shared `ProcessStore`, so a foreign repo's bridge
  sees a matching batch with absent handles. `MultiRepoQueueRouter` therefore addresses the
  owning bridge directly (root from `proc.workingDirectory`, else `metadata.workspaceId` →
  workspace `rootPath`; unresolvable → `false` → 404) instead of scanning, and
  `CLITaskExecutor.ownsProcess()` refuses a batch whose working directory is provably under a
  different root. A missing bridge root or missing `proc.workingDirectory` still claims;
  subdirectories of the bridge root count as owned.
- **WebSocket broadcasting:** side-effect tools broadcast events for real-time SPA updates.
