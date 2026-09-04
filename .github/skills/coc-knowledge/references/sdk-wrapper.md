# CoC Agent SDK (`coc-agent-sdk`)

Provider-agnostic AI agent SDK for CoC. Manages AI session lifecycle, MCP server configuration, model registry and metadata, reasoning-effort resolution, folder trust, and provider quota snapshots where the backend exposes them. Backends behind one `ISDKService` interface: **Copilot** (`@github/copilot-sdk`), **Codex** (optional `@openai/codex-sdk` plus the bundled `@openai/codex` CLI for quota/model-catalog RPCs), **Claude** (optional `@anthropic-ai/claude-agent-sdk`), and **OpenCode** (optional `@opencode-ai/sdk`).

Package: `@plusplusoneplusplus/coc-agent-sdk`
Location: `packages/coc-agent-sdk/src/`
Forge imports directly from this package.

## Files

| File | Purpose |
|------|---------|
| `copilot-sdk-service.ts` | `CopilotSDKService` facade singleton — Copilot backend |
| `codex-sdk-service.ts` | `CodexSDKService` — optional Codex backend |
| `claude-sdk-service.ts` | `ClaudeSDKService` — optional Claude backend |
| `opencode-sdk-service.ts` | `OpenCodeSDKService` — server-backed adapter starting/connecting to a local opencode HTTP server. No warm client (per-turn server requests). `softAbortSession` delegates to `abortSession`; `steerSession` returns false. |
| `sdk-service-interface.ts` | `ISDKService` provider-agnostic contract; `TransformOptions`/`TransformResult` |
| `sdk-service-registry.ts` | `SDKServiceRegistry` — named-provider registry |
| `testing/` | Shared vitest-free `ISDKService` mock (`createMockSDKService` + presets); `./testing` subpath export |
| `request-runner.ts` | `sendMessage`/`transform` execution: session creation, MCP wiring, permission handler, streaming routing |
| `stream-error-guard.ts` | `StreamErrorGuard` + `isStreamDestroyedError()`/`isConnectionDisposedError()` |
| `session-manager.ts` | Active session tracking and cancellation |
| `streaming-session.ts` | Streaming orchestrator (`StreamingSession.run()`) |
| `streaming-state-machine.ts` | Pure state machine: `Idle → Streaming → Settled \| Cancelled` |
| `session-timer-manager.ts` | Copilot session timers: delegates overall + idle to `IdleWatchdog`, owns the turn-end grace timer |
| `idle-watchdog.ts` | `IdleWatchdog` — shared idle + wall-clock timers used by every provider; `idleTimeoutErrorMessage()` is the single error text |
| `session-telemetry.ts` | Token usage accumulation, tool-call tracking |
| `sdk-client-factory.ts` | Per-request `CopilotClient` spawning: cwd validation, folder trust, `resolveCopilotCli` |
| `sdk-loader.ts` | SDK binary discovery + ESM import workaround |
| `sdk-esm-loader.ts` | Dynamic ESM import helper (webpack-safe `new Function` indirection) |
| `types.ts` | `SendMessageOptions`, MCP configs, permissions, tool contract, token usage |
| `model-registry.ts` | Single source of truth for supported (user-selectable) AI models |
| `provider-model-resolver.ts` | `resolveModelForProvider` — provider-aware override validation/coercion |
| `model-metadata-store.ts` | Runtime model metadata cache with SDK polling |
| `model-reasoning.ts` | Metadata-aware model/reasoning resolver |
| `model-context-tier.ts` | `getCopilotContextTierForModel` / `getCopilotLongContextPromptLimit` |
| `claude-model-catalog.ts` | `findClaudeCatalogModel` — maps configured Claude ids (CLI aliases, dotted, dashed, provider-default sentinels) to CLI catalog entries via exact, dashed-normalized, and family (id/name/description) matching |
| `effort-tier-defaults.ts` | Per-provider effort-tier defaults (`very-low`/`low`/`medium`/`high` → model + reasoning effort) + stored-config merge. Copilot: Luna/Terra/Opus/Sol all pinned to `xhigh`. Claude: CLI aliases `haiku`/`sonnet`/`opus`/`fable` (`high` → `fable`), no pinned effort for Haiku. |
| `mcp-config-loader.ts` | Loads/merges MCP config from `~/.copilot/mcp-config.json`, workspace `.vscode/mcp.json`, request options |
| `trusted-folder.ts` | Pre-registers working directories in `~/.copilot/config.json` |
| `image-converter.ts` | Image detection + data-URL/base64 conversion |
| `tool-call.ts` | `ToolCall`, `ToolCallStatus`, `ToolCallPermissionRequest`, serialization types |
| `model-info.ts` | `ModelInfo` (id, name, description, tier, …) |
| `logger.ts` | `initSDKLogger` / `resetSDKLogger` / `getSDKLogger` |
| `internal/` | `exec-utils.ts` (`execFileAsync`), `path-security.ts` (traversal validation), `path-utils.ts`, `workspace-execution.ts` |
| `llm-tools/coc-tool-runtime.ts` | `CocToolRuntime` — provider-neutral runtime over a per-invocation `Tool<any>[]` |
| `llm-tools/bridge-server.ts` | `CocToolBridgeServer` + `cocToolBridgeServer` singleton — loopback IPC channel |
| `llm-tools/bridge.ts` | `coc-llm-tools-mcp` — standalone stdio MCP server (child process) |
| `llm-tools/mcp-config.ts` | `buildCocLlmToolsMcpConfig()` + bridge-path resolution + name/env constants |
| `index.ts` | Public API surface |

## SDKServiceRegistry

Providers register under a string key; callers look up by key. `sdkServiceRegistry` is the module-level singleton. `CopilotSDKService.getInstance()` re-registers itself if absent from the registry.

```ts
COPILOT_PROVIDER  / SDK_PROVIDER_COPILOT  = 'copilot'
CODEX_PROVIDER    / SDK_PROVIDER_CODEX    = 'codex'
CLAUDE_PROVIDER   / SDK_PROVIDER_CLAUDE   = 'claude'
OPENCODE_PROVIDER / SDK_PROVIDER_OPENCODE = 'opencode'

sdkServiceRegistry.register(SDK_PROVIDER_COPILOT, new CopilotSDKService());
sdkServiceRegistry.register(SDK_PROVIDER_CODEX,   new CodexSDKService());
registerClaudeSDKService();
registerOpenCodeSDKService();

const svc = sdkServiceRegistry.getOrThrow(SDK_PROVIDER_COPILOT);
```

## CopilotSDKService Architecture

A **facade singleton**; all logic lives in collaborators: `SdkLoader` (binary discovery/loading), `createSdkClient` (client spawning), `RequestRunner` (sendMessage/transform), `SessionManager` (tracking/abort), `StreamingStateMachine`, `SessionTimerManager`, `SessionTelemetry`, `StreamErrorGuard`, `fetchModelsFromClient` (model listing).

### Per-session client isolation

Each `sendMessage()` spawns its **own `CopilotClient`** child process — no shared client, so concurrent tasks with different working directories cannot interfere.

### Copilot CLI spawn resolution

`sdk-client-factory.ts`: with no caller `connection`, `resolveCopilotCli()` locates the CLI, rewriting `app.asar` paths to `app.asar.unpacked`. Two layouts: `@github/copilot` <= 1.0.61 ships an `index.js` entry; >= 1.0.62 ships a thin `npm-loader.js` plus a native executable in `@github/copilot-<platform>-<arch>`.

- `index.js` under Electron: connection is overridden to `<node runtime> index.js` (system node preferred, else the Electron binary with `ELECTRON_RUN_AS_NODE=1`). Under plain Node the copilot-sdk default handles it.
- Native layout: the unpacked binary is spawned **directly** (`forStdio({ path: binary, args: [] })`; the SDK appends `--headless --stdio …`), under both Electron and plain Node, since the SDK's bundled-CLI default requires `index.js`.

The resolved spawn mode (`system-node | electron-node | native-binary`) is recorded and appended to `getAccountQuota` errors.

### Copilot tool telemetry

`SessionTelemetry` normalizes streaming tool events into the shared `ToolCall` / `ToolEvent` contract. `parentToolCallId` is preserved from either the start or terminal SDK event; a terminal event supplying or correcting the parent updates the stored `ToolCall`, keeping sub-agent descendants reconstructable from both live timelines and persisted `toolCalls`.

## One-shot `transform` primitive

`ISDKService.transform(input: string, options?: TransformOptions): Promise<TransformResult>` is the provider-agnostic primitive for isolated single-shot text transformations.

- **Structured result:** `{ success, text, error?, effectiveModel?, tokenUsage? }` — never throws on provider failure; callers branch on `success`.
- **Fresh & isolated:** one provider request per call. No session resume, no session cache, no caller-visible thread reuse, no continuation.
- **Safe defaults:** `loadDefaultMcpConfig` defaults to `false` (no MCP/tools) and `onPermissionRequest` to `denyAllPermissions`; both overridable.
- **No model default:** the caller passes `options.model`; omitting it uses the provider default. Model choice, prompt construction and sanitization are product policy in the calling layer.

Production callers: `TitleGenerationService` (`coc/src/server/executors/title-generator.ts`) uses `gpt-5.4-mini` (`TITLE_GENERATION_MODEL`) for `generateTitle()`/`prewarm()`, throwing on `!success` and on `effectiveModel` mismatch so a silent provider fallback never persists a title under the wrong model. PR suggestion ranking (`coc/src/server/repos/pr-suggestions.ts`) uses `gpt-4.1` with a 30s timeout and throws on `!success`. Neither model is in `MODEL_REGISTRY`.

## Strict session resume

`SendMessageOptions.sessionId` resumes the stored SDK session; on failure the adapter starts a fresh session and reports the replacement ID through `onSessionCreated`. With `strictSessionResume: true`, resume failure returns `success: false`, fires no `onSessionCreated`, and creates no session. CoC uses strict resume for stopped-chat continuations queued from `/api/processes/:id/message`, passing the cancelled turn's `sdkSessionId` via `ChatPayload.resumeSessionId`. On failure the executor records `metadata.stoppedChatResume = { resumable: false, reason: 'strict-resume-failed', ... }` and later `/message` requests reject with `409 SESSION_NOT_RESUMABLE`.

## CodexSDKService Architecture

Backed by the **optional** `@openai/codex-sdk` peer dependency. When absent, `isAvailable()` returns `{ available: false }` and `sendMessage()` returns an error result rather than throwing. No SDK module loads until the first `isAvailable()`/`sendMessage()`.

**Thread ↔ session mapping:** every CoC session ID maps to exactly one Codex thread, created on the first `sendMessage()` for the session and removed on abort or dispose.

**Authentication** is owned by the Codex SDK/CLI — CoC has no Codex auth store and no `/api/codex-auth/*` routes. Hosts may inject an optional `CodexAuthChecker` preflight gate:

```ts
registerCodexSDKService();            // SDK/CLI-owned auth
const svc = new CodexSDKService();
svc.setAuthChecker(() => ({ authenticated: true }));
sdkServiceRegistry.register(SDK_PROVIDER_CODEX, svc);
```

### CLI spawn resolution

Quota and model-catalog lookups spawn the `@openai/codex` CLI shipped as a dependency of `@openai/codex-sdk`; the bin path resolves at runtime relative to `coc-agent-sdk`, not from `PATH`, so a global Codex cannot silently change the app-server protocol version. `resolveCodexSpawn()` prefers the unpacked native binary (`resolveCodexExecutablePath()` → `app.asar.unpacked/@openai/codex-<platform>/…/bin/codex`) spawned **directly**, because in packaged desktop builds `process.execPath` is Electron and `@openai/codex/bin/codex.js` resolves inside `app.asar`. Falls back to `<node> codex.js` for normal CLI/global installs and dev-from-source.

### Quota

`getAccountQuota()` starts `codex app-server --listen stdio://` directly and issues `account/rateLimits/read` over that child's stdio (handshake `initialize` → `initialized` → read on `id: 2`, 10s timeout), capturing stderr so an early exit reports its real reason. It avoids `app-server daemon start` / `proxy`, which require the installer-managed standalone path under `~/.codex/packages/standalone/current/codex`.

`mapCodexRateLimitsToQuota` surfaces **both** rolling windows per limit entry: `primary` (~5h) and `secondary` (weekly) become snapshots keyed `five_hour` / `seven_day`, matching Claude's keys so the dashboard renders the same "5h"/"Weekly" labels. A window is skipped when absent or carrying a non-numeric `usedPercent`. With >1 entry in `rateLimitsByLimitId`, keys are prefixed by limit id (e.g. `codex-pro_five_hour`).

### Model catalog and reasoning levels

`mapCatalogModel` keeps only `visibility: 'list'` models and normalizes `supported_reasoning_levels` against `REASONING_LEVEL_ORDER` — a hardcoded low→high list mirroring `ModelReasoningEffort` in `@openai/codex-sdk`'s `index.d.ts` (`minimal`, `low`, `medium`, `high`, `xhigh`, `max`, `ultra`, `persistent`). The intersection both sorts the catalog's arbitrary order and drops unknown levels, so a level the SDK adds is invisible in the UI until the list is extended — check it on every `@openai/codex-sdk` bump. `default_reasoning_level` is advertised only when it survives that filter.

### Compaction

`compactSession()` compacts a thread in place over the same app-server stdio channel (shared `runAppServerRpc` helper). After the handshake it issues `thread/resume` (id 1) — **not** `thread/read`, which fails "thread not found" on a thread this app-server process never resumed — then `thread/compact/start` (id 2, `{ threadId }`), which rewrites the rollout JSONL under the same thread id and summarizes asynchronously.

Completion is awaited method-based, not id-based: a `thread/compacted` notification or a forward-compatible `context_compaction` `item/completed` for the thread. `thread/tokenUsage/updated` frames are tracked via `tokenUsage.total.totalTokens`; the first total (emitted by resume) is the baseline, the last the reduced total. `tokensRemoved = max(0, first − last)`; `messagesRemoved` is always 0. The surviving thread id means `resumeThread(sessionId)` follow-ups carry compacted history with no session-id remap. Timeout `CODEX_COMPACT_TIMEOUT_MS` (120s, `COC_CODEX_COMPACT_TIMEOUT_MS` override). `customInstructions` is **ignored** (`ThreadCompactStartParams` carries only `threadId`) and warn-logged. A `-32601` on `thread/compact/start` throws `CompactUnsupportedError`.

### CompactResult.contextUsage

`CompactResult` carries an optional `contextUsage: Partial<TokenUsage>` — context usage measured AFTER the rewrite — persisted by the compact route so the SPA meter drops immediately. Per provider: Copilot maps `HistoryCompactResult.contextWindow` (`@experimental`) onto all five token fields; Claude probes `handle.getContextUsage()` **before** `inputGate.close()` (closing the gate rejects in-flight control requests) and falls back to `{ currentTokens: boundary.post_tokens }`; Codex reports `{ currentTokens: <last tokenUsage frame total> }`. Omitted when nothing was measured, routing the caller onto its subtraction fallback.

### Skills and directories

Codex thread options expose no `skillDirectories`/`disabledSkills`. CoC maps resolved skill directories and caller `additionalDirectories` to Codex `additionalDirectories`, always appending `~/.coc` (only when not already present, compared case-insensitively on Windows); caller paths are preserved verbatim. Selected skills stay path-based: resolved `SKILL.md` paths go into the `<selected_skills>` directive rather than inlined bodies.

### Permissions

Every SDK agent mode maps to `approvalPolicy: 'never'` and `sandboxMode: 'danger-full-access'` with network enabled, so Codex can read skill files and other allowed roots on hosts where the restricted workspace-write sandbox cannot initialize. Ask-mode write constraints are enforced by the `<coc-read-only-mode>` directive CoC prepends to each ask-mode user turn (plan file, attached note, `.goal.md` specs are the exceptions). The server normalizes chat `mode='plan'` to Ask before calling the SDK.

### Attachments

When `SendMessageOptions.attachments` includes files with supported raster extensions (`png`, `jpg`/`jpeg`, `gif`, `webp`), the adapter sends an input array of the prompt text plus `{ type: 'local_image', path }` entries in attachment order. Directories, non-images, and SVGs are ignored.

### Token usage

Mapped from `turn.completed.usage` into the shared `TokenUsage` shape: `inputTokens`, `outputTokens`, `cacheReadTokens` from `cached_input_tokens`, `cacheWriteTokens: 0`, `totalTokens`, `turnCount`. Codex has no native USD field; Forge estimates USD from the shared Copilot pricing table and populates native-first display cost fields.

Context-window fields are two-source. `addCodexUsage` seeds a fallback from the static `MODEL_REGISTRY` context window (`tokenLimit`) plus a per-turn `input_tokens + output_tokens` snapshot (`currentTokens`); after the stream settles, `enrichCodexContextUsage` overwrites both from the rollout `token_count` event (`codex-rollout-usage.ts`: `readCodexRolloutContextUsage` tail-reads the last ≤64 KB of `~/.codex/sessions/YYYY/MM/DD/rollout-*-<threadId>.jsonl`, mapping `last_token_usage.total_tokens` → `currentTokens`, `model_context_window` → `tokenLimit`). Registry values survive only when the rollout read yields nothing; registry-unknown model + no rollout leaves both absent so the meter hides. Sessions root overridable via `COC_CODEX_SESSIONS_DIR`; paths cached per thread in `rolloutPathByThread`. Display metadata only. Breakdown fields (`systemTokens`, `toolDefinitionsTokens`, `conversationTokens`) stay absent.

### Tool-call normalization

Stream items are normalized into the shared `ToolCall` shape before reaching CoC process storage: `command_execution`/`commandExecution` → `shell`; `file_change`/`fileChange` → `apply_patch`; `mcp_tool_call`/`mcpToolCall` → the MCP tool name; `web_search`/`webSearch` → `web_search`; `dynamicToolCall` keeps the dynamic tool name unless it is an agent start/wait; `collabAgentToolCall` maps onto the dashboard's `task` / `read_agent` vocabulary. `item.started`, `item.updated`, and `item.completed` are all handled; a terminal update completes a stored call even without a distinct completion event.

For file changes the adapter snapshots dirty worktree files before the turn and enriches completed parameters with a best-effort unified `diff` when a workspace git root exists: clean files diff against `HEAD`, pre-dirty paths against their pre-turn snapshot, later changes against the previous snapshot. Paths may be repo-relative or absolute under the git root; absolute paths outside it are ignored. Display metadata only; failures fall back to `{ changes }`.

## ClaudeSDKService Architecture

Backed by the **optional** `@anthropic-ai/claude-agent-sdk` peer dependency. It lazy-loads the SDK's `query` export, streams Claude messages into the common invocation result shape, and reports `{ available: false }` with install guidance when the import fails.

### Streaming-input mode and background drain

Every turn runs in streaming-input mode: `buildClaudeInputChannel` builds an `AsyncIterable` prompt yielding one initial user message (plain string for text, base64 image blocks with attachments) and staying open until an explicit `close()` EOFs it. A single-shot string prompt EOFs stdin immediately, so the SDK applies a ~5s end-of-session grace and kills longer background work; holding stdin open lets Bash `run_in_background`, native `Agent`/`Task` subagents, and `backgroundTasks()` finish and the SDK re-invoke the model.

`applyClaudeTaskInflight` tracks in-flight background tasks from the `type:'system'` stream: increment on `task_started`, decrement on terminal `task_notification` keyed by `task_id`; `task_updated`/`task_progress` are informational. After each `result` the turn settles only when the set is empty; otherwise stdin stays open and iteration continues, accumulating re-invocation text and summing token usage into one combined `IInvocationResult`.

Settlement is gated on a **terminal signal** — a terminal assistant frame (nested `message.stop_reason: 'end_turn'`) or a `result` that deferred settle. The signal is held until the in-flight set is empty (re-checked after each `task_notification`/`task_updated` drain), so an early terminal frame never cuts off background work, and `tool_use`/`max_tokens`/refusal stop reasons are never terminal-success. `end_turn` settles immediately; a `result` is final only for its own turn, so the drain arms a quiet window (`CLAUDE_POST_DRAIN_SETTLE_GRACE_MS`, 30s) that any further frame cancels — only silence settles. This prevents a hang when the last task drains after a `result` with no re-invocation and no `session_state_changed: idle`.

A wall-clock drain cap (`CLAUDE_BACKGROUND_DRAIN_TIMEOUT_MS`, 60 min, `COC_CLAUDE_BACKGROUND_DRAIN_TIMEOUT_MS` override, lowered by a smaller caller `timeoutMs`) is armed **only** while stdin is held for drain, so a no-background turn closes at its first `result` and arms no timer; a wedged task is bounded by the cap, which closes stdin and aborts. It stays well under `StaleTaskDetector`'s ~6h05m force-fail. Any abort (caller signal, `abortSession()`, or the cap) closes the input channel.

### System prompt

`SendMessageOptions.systemMessage` is delivered through the SDK's unified `systemPrompt` query option (the >= 0.1 surface; the option names `appendSystemPrompt`/`customSystemPrompt` are silently ignored by `query()` and must not be used). `mode: "append"` → `systemPrompt: { type: 'preset', preset: 'claude_code', append: content }`; `mode: "replace"` → `systemPrompt: content`; blank/absent content omits the field entirely. The system prompt is **session-invariant**: it is re-sent on every turn and sits at the front of the prefix, so any byte that varies by mode or by turn invalidates the whole conversation's cached prefix. Session-invariant executor content (admin global prompt, the shared `.github/coc/instructions.md`, Memory snapshot/tool guidance, note permissions, save-location directives) stays in this channel. Anything that varies with the mode pill rides the outgoing user turn instead: the `<coc-chat-mode>` directive carries the ask-mode read-only instructions, the mode-specific `.github/coc/instructions-<mode>.md`, and an explicit transition note on the first turn after a switch out of ask (`packages/coc/src/server/executors/chat-mode-directive.ts`). Because it rides the user message, the directive is also prepended to the *stored* user turn, so the transcript renders what the model was told (the mode prose only — the repo's mode instructions are left out, and `promptPreview`/`fullPrompt`/title generation strip or skip the injected blocks). Resumed follow-ups pass the persisted transcript ID via `options.resume` while still sending the current turn's system prompt.

### Provider option contracts

Provider SDK option mappings are contracts, not internal adapter transforms. For prompt delivery, permissions, MCP wiring, resume/session IDs, model selection, and reasoning effort, confirm the installed SDK's accepted option surface and anchor coverage at the SDK boundary (delivered query options, initialized request/transcript shape, stream events, sanitized diagnostics). Wrapper-only argument assertions are insufficient: unsupported keys are ignored without a CoC-side error.

### Logging and diagnostics

Unsuccessful `result` messages warn-log through the SDK logger before returning failure; thrown SDK exceptions error-log before returning the same user-facing string. Diagnostics are allowlisted: result subtype/error flags, provider session ID, timing/turn metadata, terminal/API reason fields, exception name/message/safe stack/cause summary, requested/effective model, cwd, permission mode, MCP configured state and server names, latest in-call rate-limit status/type/utilization/reset/overage. Prompt and system-prompt text, credentials, image payloads, tool results, and transcript content are never logged.

### Token usage

Mapped from successful `result.usage`: `inputTokens`, `outputTokens`, `cacheReadTokens` from `cache_read_input_tokens`, `cacheWriteTokens` from `cache_creation_input_tokens`, `totalTokens`, native `actualUsdCost` from `total_cost_usd`, `duration`, `turnCount`. The `cost` field is reserved for provider-reported non-USD units such as Copilot premium request units and must not be displayed as USD. Forge's cost layer resolves displayed USD as `actualUsdCost ?? estimatedUsdCost` and records `displayedUsdCost` plus its source; its pricing lookup normalizes Claude CLI hyphenated/datetime/reasoning-suffixed IDs and Codex dated/suffixed IDs onto Copilot pricing-table entries before declaring pricing unavailable.

When the query handle exposes `getContextUsage()`, `TokenUsage` gains `tokenLimit` (from the effective `maxTokens`, never `rawMaxTokens`), `currentTokens`, and breakdown fields (`systemTokens`, `toolDefinitionsTokens`, `conversationTokens`) — even when Claude reports only a context snapshot and no per-turn totals. It is fetched once per turn at each settle point (`result` with no background work, `session_state_changed: idle`, or a released held terminal signal) **before** the streaming-input gate closes, while the subprocess can still answer control requests; fetching after the message loop races teardown. `CLAUDE_CONTEXT_USAGE_TIMEOUT_MS` (5s, `COC_CLAUDE_CONTEXT_USAGE_TIMEOUT_MS` override) guards a hung request; failures warn-log and degrade to result-level totals.

### Quota

The Claude Agent SDK exposes no direct quota RPC. On **every platform**, `getAccountQuota()` reads OAuth credentials fresh per call and hits `https://api.anthropic.com/api/oauth/usage`, so dashboard refreshes use fresh data rather than cached SDK events. `resolveClaudeCredentialsRaw` priority:

1. `$CLAUDE_CREDENTIALS_FILE` when set — used exclusively; the Keychain is not consulted.
2. `~/.claude/.credentials.json` (resolved via `path.join(os.homedir(), …)`, so Windows works).
3. macOS only: the Keychain via `readKeychainCredentials`, running `security find-generic-password -s "Claude Code-credentials" -w` with an argument array (no shell interpolation), returning `undefined` on any failure. Its `execFileSync` dependency is injectable so tests never invoke the real binary.

`extractClaudeAccessToken` prefers the CLI nested shape (`claudeAiOauth.accessToken`, written by `claude login`) and falls back to the flat `access_token` used by `@anthropic-ai/sdk`. The response maps `five_hour` and `seven_day` utilization windows into snapshots; missing/expired credentials, failed or non-2xx calls, and malformed JSON return `{ quotaSnapshots: {} }`. CoC never refreshes or writes credentials back.

Linux and macOS return the OAuth result unconditionally. **Windows** tries OAuth first and, if it yields no snapshots (the token may live only in Windows Credential Manager, which has no reader here), falls through to cached SDK signals: (1) the most recent structured `rate_limit_event` from a session (`mapClaudeRateLimitInfoToQuota`); (2) a synthesized "subscription active, well under all thresholds" snapshot from `accountInfo()` (`mapClaudeAccountInfoToQuota`, keyed by `subscriptionType` such as `Claude Pro`/`Claude Max`/`team`/`enterprise`, falling back to a non-`firstParty` `apiProvider` like `bedrock`/`vertex`, then `subscription`). With neither, `{ quotaSnapshots: {} }`.

`accountInfo()` is cached as a side effect of every real `sendMessage()`: after obtaining the query handle the service fires `handle.accountInfo?.()` fire-and-forget, writing `lastAccountInfo` on resolution. No probe subprocess is spawned.

### Session persistence

Persistence uses the Claude Code SDK transcript session ID. New `sendMessage()` calls pass a generated UUID as `options.sessionId` and persist any `session_id` emitted by the stream; follow-ups pass the stored ID as `options.resume`. `forkSession()` delegates to the SDK's `forkSession` export and returns the forked session ID.

### Permissions

SDK `autopilot` → `permissionMode: 'bypassPermissions'` plus `allowDangerouslySkipPermissions: true`; SDK `plan` → `permissionMode: 'plan'`; all other modes (interactive/ask/undefined) → `permissionMode: 'acceptEdits'`. The CoC server normalizes chat `mode='plan'` to Ask before calling the SDK, so regular chat runs interactive/ask semantics and can create directories and write files in allowed working directories without prompting.

`acceptEdits` only auto-accepts file edits, so ask-mode turns append `ASK_MODE_AUTO_APPROVED_TOOLS` (`Bash`, `WebFetch`, `WebSearch`) to `allowedTools` as bare tool names (matching every use); otherwise those tools hit a permission prompt nothing can answer (headless, no `canUseTool`) and fail the turn. Autopilot skips the list — `bypassPermissions` covers it. The SDK's `system`/`permission_denied` frame warn-logs as `event: 'claude_tool_permission_denied'` with `toolName`, `toolUseId`, `permissionMode`, and decision reason (never `tool_input` or the rejection body); observational only, never failing the turn. The deliberate `AskUserQuestion` deny-rule denial logs at `debug`.

### Image attachments

Detection is content-based: `evaluateClaudeImageFile` sniffs magic numbers, so any readable PNG/JPEG/GIF/WebP is forwarded even with a wrong or missing extension (extension is a fallback only when bytes are unrecognized). With at least one qualifying image the initial streaming user message carries a block array of prompt text plus base64 image blocks; text-only turns use plain-string `content`. Recognizable but unsupported formats (HEIC/HEIF, AVIF, BMP, TIFF, ICO) are skipped with a sanitized `unsupported-format` diagnostic; SVGs, non-images, directories, missing files, and files over the shared conversion limit are ignored. Upstream, `attachment-utils.saveAttachmentsToTempFiles` normalizes each image temp file's extension to its decoded MIME type for extension-based consumers such as Codex.

### Additional directories

`resolveAdditionalDirectories` widens filesystem scope via the SDK's `additionalDirectories` option, always granting `~/.coc` and `os.tmpdir()` so out-of-repo skill files and temp artifacts stay readable beyond the per-request `workingDirectory`/`cwd`. Caller-supplied `SendMessageOptions.additionalDirectories` are merged; all entries are resolved absolute and de-duplicated (case-insensitively on Windows).

### AskUserQuestion suppression

When CoC's `ask_user` is present, `resolveClaudeDisallowedTools` (exported) adds the built-in `AskUserQuestion` to `options.disallowedTools`. It reads only `options.tools`, so CoC registering `ask_user` in every chat mode keeps the emitted array constant across a mid-chat mode switch. `ask_user` replaces it under a different name, so the SDK's `overridesBuiltInTool` flag (same-named built-ins only) cannot suppress it, and CoC wires none of the host callbacks (`onUserDialog`/`onElicitation`/`canUseTool`) it needs — an `AskUserQuestion` call would auto-fail before the user could answer.

### Tool-call capture

Assistant `tool_use` blocks are start events; user `tool_result` / `tool_use_result` payloads are terminal. Stored calls keep the original input in `args` and the actual output in `result`/`error` — never synthesized from input JSON. Built-in sub-agent starts (`Agent`/`Task`) normalize to CoC's `task` shape with `subagent_type` → `agent_type` and terminal metadata (`agentId`, `agentType`, status, output file, prompt/description) merged into `args`. Waits (`TaskOutput`) normalize to `read_agent` with `agent_id`, `wait`, timeout metadata. Assistant messages from inside a sub-agent preserve `parent_tool_use_id` as `parentToolCallId` for nested timeline rendering.

## Provider-Aware Model Resolution

`resolveModelForProvider(provider, requestedModel)` is the shared boundary helper for provider-bound chat flows. It keeps overrides only when valid for the selected provider (`gpt-*` for Codex, Claude IDs/family aliases for Claude, Copilot-compatible IDs for Copilot). Provider-default aliases (`default`, `provider-default`, `codex-default`, `claude-provider-default`) resolve to `undefined` = "let the provider choose". Invalid cross-provider overrides coerce to `undefined` and the server logs a warning before persisting turns or process metadata.

All `sendMessage()` implementations return `effectiveModel?: string` in `IInvocationResult` / `SDKInvocationResult`. CoC records it on assistant turns and reconciles `metadata.model` to it; omission means the provider default was used. This prevents dashboard records showing a selected model the provider did not run.

### Per-request model order

1. Explicit `task.config.model`
2. `PerRepoPreferences.defaultModels[mode]` (per-mode override)
3. `PerRepoPreferences.defaultModel` (repo-wide default)
4. CLI default (`undefined`)

Variant models with a `capabilities.family` base are sent to the SDK as base model + resolved reasoning effort (`model-reasoning.ts`).

### Claude reasoning effort

`ClaudeSDKService` forwards `SendMessageOptions.reasoningEffort` to the query's `effort` option (`normalizeClaudeEffort`). CoC's `ReasoningEffort` (`low`/`medium`/`high`/`xhigh`) is a subset of the SDK's `EffortLevel`, so recognized values pass through case-insensitively and the SDK silently downgrades unsupported levels. Unrecognized or absent values — including `max`, which CoC does not surface — omit `effort` so Claude's adaptive thinking decides.

### Claude model catalog discovery

Discovery spawns the Claude Code CLI in `stream-json` protocol mode, sends one `control_request` initialize message, and maps `response.response.models` into `IModelInfo`. The CLI advertises short alias ids (`default`, `opus`, `haiku`). `supportedEffortLevels` is filtered to CoC's vocabulary (`low`/`medium`/`high`/`xhigh`; `max` dropped) and surfaced as `IModelInfo.supportedReasoningEfforts`, driving the admin catalog REASONING column and effort-tier dropdowns; a model with no advertised levels (e.g. Haiku) omits the field. The CLI `description` maps to `IModelInfo.description` so `findClaudeCatalogModel` can family-match non-exact ids. The resolver prefers the native binary bundled beside `@anthropic-ai/claude-agent-sdk`, else `claude` on `PATH`, and passes `--setting-sources=` and `--tools ''` to skip user/project/local settings and tools. Malformed output, spawn errors, timeouts, or protocol changes fall back to the curated model list, whose Sonnet/Opus entries advertise conservative `supportedReasoningEfforts` so effort-tier validation resolves offline.

Executor-side validation (`chat-base-executor.getModelMetadataForReasoning`) resolves non-Copilot model metadata from the provider's own `listModels()` catalog (cached per provider). For Claude it matches via `findClaudeCatalogModel`, so tier models (`haiku`/`sonnet`/`opus`), dashed/dotted ids, and provider-default turns (no model → the catalog's `default` entry) all resolve supported efforts instead of failing with `Unsupported reasoning effort … Supported efforts: unknown`.

### Claude model ID normalization

Claude Code expects hyphenated IDs for version aliases (e.g. `claude-sonnet-4-6`). `ClaudeSDKService` normalizes CoC's dotted registry IDs (`claude-sonnet-4.6`, `claude-haiku-4.5`, `claude-opus-4.6`) before passing `options.model`. Non-Claude IDs and `claude-provider-default` are omitted so Claude Code uses its configured default.

## RequestRunner — sendMessage() Flow (Copilot)

```
1. isAvailable() → check SDK exists
2. createClient(cwd) → spawn fresh child process
3. Build ISessionOptions (model, streaming, tools, contextTier, MCP config, permissions)
4. Session creation or resume (falls back to create on resume failure)
5. session.setModel(model, { reasoningEffort, contextTier })
6. onSessionCreated callback fires
7. Attach AbortSignal listener for cancellation
8. sessionManager.track(session)
9. Route: streaming (timeoutMs>120s or onStreamingChunk) vs race-safe non-streaming send+idle wait
10. Empty-response handling (turnCount>0 = success)
11. FINALLY: remove abort listener, untrack + session.disconnect + client.stop
```

Step 9 avoids the SDK's `sendAndWait`, whose `session.error` handler can reject its internal promise before a catch is attached (unhandled rejection on slow hosts); `sendAndWait` is used only for sessions lacking `on`/`send`.

### Context tier

`SendMessageOptions.contextTier` (`"default" | "long_context"`) selects the Copilot context-window tier. It rides the session-options object on create and resume; in the delayed model-switch path (model + reasoningEffort both present) it moves to `session.setModel(model, { reasoningEffort, contextTier })`. Set it only for models whose catalog metadata advertises a long-context tier — `getCopilotContextTierForModel` (`model-context-tier.ts`) derives it strictly from `billing.tokenPrices.longContext.contextMax` (camelCase or snake_case), never from model names or `max_context_window_tokens`. Passing `long_context` without metadata support can leave the session on normal limits while reporting long-context.

## Idle Timeout (all providers)

`idle-watchdog.ts` implements `idleTimeoutMs` once for every provider: `reset()` is the first
statement of each service's stream loop, so **any** provider frame is activity. On expiry with
work in flight the watchdog reschedules instead of firing — suppression is tool calls in flight
for Copilot/Codex/OpenCode, plus pending background tasks for Claude (a draining session is
quiet on purpose). `0`/undefined disables it. On fire the turn aborts its `AbortController` and
settles as a **failure** with `Request idle-timed out after <ms>ms with no activity`; the
services keep an `idleTimedOut` flag so an idle kill is not reported as a user cancel.

Per provider: Copilot via `SessionTimerManager` (also arms the wall-clock cap); Codex arms both
idle and `timeoutMs`; Claude arms idle only (`timeoutMs` stays with the background-drain cap);
OpenCode arms idle only on the streaming path (a non-streaming request emits no events, so the
wall-clock timer covers it) and races `session.prompt` against the controller plus a server-side
`session.abort`, since the prompt call carries no signal.

## Streaming Internals

`StreamingSession.run()` manages:
- **Dual timeout:** `timeoutMs` (wall clock) and `idleTimeoutMs` (inactivity) — first to fire kills the session
- **Completion detection:** `session.idle` → `turn_end` → 2s grace timer
- **Multi-turn MCP loops:** `turn_start` cancels the grace timer
- **Background tasks:** settlement deferred until `backgroundTasks` drains to zero

State machine: `Idle → Streaming → Settled | Cancelled`.

## Stream Error Guard

Installed once when the SDK module loads. Absorbs `ERR_STREAM_DESTROYED` via `uncaughtException` and `unhandledRejection` process listeners. `dispose()` removes the guard synchronously.

## MCP Configuration

```
~/.copilot/mcp-config.json               →  loadDefaultMcpConfig()
<workingDirectory>/.vscode/mcp.json      →  loadWorkspaceMcpConfig()
SendMessageOptions.mcpServers            →  explicit config
loadEffectiveMcpConfig: global < workspace < explicit; {} disables all MCP
loadDefaultMcpConfig: false              →  skips global/workspace files
forceReload: true                        →  bypasses the path-keyed config cache
```

Workspace MCP loading resolves from the per-request `workingDirectory`, not the process cwd, so concurrent repos do not share MCP state. VS Code workspace config uses a top-level `servers` map, normalized into `mcpServers` before reaching the SDK. Load results carry source-scoped `success`/`error` metadata so callers can continue with valid sources when another is malformed.

## CoC LLM Tools over MCP (provider parity)

CoC LLM tools are assembled in the coc package as `Tool<any>[]` (`buildChatToolBundle()` / `applyLlmToolPreferences()`) and passed to every provider via `SendMessageOptions.tools`. Copilot consumes them natively; Codex and Claude consume the **same already-filtered array** through a provider-neutral MCP bridge, so `ask_user`, conversation search, work-item/bug creation, wakeups/crons, Tavily, comments, and memory tools work uniformly.

The tool contract (`Tool`, `ToolHandler`, `ToolInvocation`, `ToolResultObject`, `ZodSchema`) is owned natively by `coc-agent-sdk/src/types.ts`, keeping runtime + bridge free of a compile-time dependency on `@github/copilot-sdk`. `defineTool()` is a local pure data-merge. A compile-time guard in `types.ts` asserts the native contract stays structurally interchangeable with the Copilot SDK's, since the Copilot path assigns the same bundle to `SessionConfig.tools` (`request-runner.ts`). Matching the SDK (>= 1.0.0), `Tool.handler` is optional (declaration-only tools); `CocToolRuntime.callTool` returns an error result for a handler-less tool instead of throwing, while local `defineTool()` still requires one.

### Pipeline (`coc-agent-sdk/src/llm-tools/`)

1. `CocToolRuntime` wraps the per-invocation `Tool<any>[]` → `listTools()` (JSON-schema descriptors) + `callTool()` (invokes the original in-process handler, normalizes results to MCP `CallToolResult`). It exposes exactly the tools given, so upstream per-repo filtering means only enabled tools surface.
2. `CocToolBridgeServer` (`cocToolBridgeServer` singleton) registers each runtime under a random bearer token on a lazily-started `127.0.0.1` HTTP server serving `POST /list` / `POST /call`. `/call` awaits `callTool` with no server-side timeout, so blocking tools (`ask_user`) keep the request open until the SPA answers. Reference-counted: torn down when the last runtime unregisters.
3. `bridge.ts` (`coc-llm-tools-mcp`) is a dependency-free hand-rolled MCP **stdio** server spawned as a child by the provider's MCP client. It reads `COC_LLM_TOOLS_ENDPOINT` / `COC_LLM_TOOLS_TOKEN` from env and proxies `initialize`/`tools/list`/`tools/call` to the loopback endpoint.
4. `buildCocLlmToolsMcpConfig()` emits the `{ command, args, env }` stdio spec. The bridge path resolves to the dist-adjacent `bridge.js`, overridable via `setCocLlmToolsBridgePath()` / `COC_LLM_TOOLS_BRIDGE_PATH`; `command` defaults to `process.execPath`. When the host runs on an Electron binary (`process.versions.electron` set — the desktop server is forked as Electron's Node via `ELECTRON_RUN_AS_NODE=1`) and the launcher is that binary, the emitted `env` also carries `ELECTRON_RUN_AS_NODE=1`; without it the bridge child boots Electron's GUI runtime, never answers the stdio handshake, and the provider silently drops all CoC tools. It must be an explicit `env` entry because Codex sanitizes inherited env for MCP children; plain-Node hosts are unaffected.

### Provider wiring

Per request, only when `options.tools` is non-empty; disposed in `finally`.

- **Copilot:** native `SendMessageOptions.tools`; no bridge.
- **Codex:** a fresh `Codex` client is built with `config.mcp_servers.coc_llm_tools = { command, args, env, enabled_tools }`, `enabled_tools` being the de-duplicated set of CoC tool names in the request. Bridged calls arrive as `mcp_tool_call` items reporting bare tool names. First-party calls store the actual tool input directly in `args` (e.g. `args.questions` for `ask_user`) to match the Copilot/Claude display contract; external MCP calls retain `{ server, arguments }`. Sub-agent spawns store `task` args with `agent_type: "codex"`, `agent_id`/`agent_ids`, prompt/model metadata and agent state; waits store `read_agent` args with `agent_id`, `wait: true`, and latest agent state.
- **Claude:** the stdio bridge entry is injected into `query({ options: { mcpServers } })` under `coc_llm_tools` with `alwaysLoad: true`; caller `mcpServers` are forwarded normalized to Claude's shape. Each bridged tool is added to `options.allowedTools` as `mcp__coc_llm_tools__<tool>` so Claude Code never prompts for CoC's first-party tools. `tool_use` blocks with that name are de-namespaced to `<tool>` so `onToolEvent`, tool-call capture, and the timeline see the bare name.

## Logger Lifecycle

```ts
import { initSDKLogger, resetSDKLogger } from '@plusplusoneplusplus/coc-agent-sdk';
initSDKLogger(pinoInstance);   // once at startup
resetSDKLogger();              // in tests, restores the no-op logger
```

Without `initSDKLogger`, all internal SDK log statements are silently discarded.

## Warm-client registry (session prewarming)

`WarmClientRegistry` (`warm-client-registry.ts`) keeps a provider client process alive between turns, keyed by `makeWarmKey(provider, warmKey)`, for an idle TTL (`COC_WARM_CLIENT_TTL_MS`; `<= 0` disables warming). CoC passes the conversation process id as `warmKey`; `workingDirectory` is construction / per-turn execution context and is **not** part of the key. Status: `cold` (absent) → `warming` (factory in flight) → `warm` (parked, TTL ticking) → `active` (≥1 turn in flight). Copilot and Codex route warm-scoped `sendMessage`/`prewarm` through it; Claude never enters it. `keepWarm: true` without `warmKey` logs a warning and runs the turn cold.

Status surfaces two ways, both off the same canonical `currentStatus(key)` calc:
- **Push:** `onStateChange` → `WarmStatusBroadcaster` → `ISDKService.onWarmStatusChange(listener)` (CoC's `WarmStatusBridge` subscribes and fans transitions onto process SSE streams).
- **Read:** `WarmClientRegistry.getStatus(key)` → `ISDKService.getWarmStatus(options)`. Copilot/Codex compute their `makeWarmKey(...)` and return `getStatus`; Claude omits the method. CoC's warm-only SSE stream calls this to send an initial `warm_status` frame on connect.

`prewarm({ warmKey, workingDirectory })` warms without creating a session (idempotent, no-op while active or warming-disabled, best-effort); a real send with the same `warmKey` mid-warm attaches to the in-flight warming. SDK sessions are still created/resumed/disconnected per turn via the `sdkSessionId` flow — no provider session objects are cached. `cleanup()`/`dispose()` evict every warm client.

## Cleanup

- `cleanup()` (async): aborts all sessions, removes the stream error guard, nulls `sdkModule`
- `dispose()`: sets `disposed = true`, removes the guard synchronously, fires `cleanup()` fire-and-forget
- `resetCopilotSDKService()`: disposes and nulls the singleton (test helper)

## Testing Notes

- **Shared `ISDKService` mock** in `packages/coc-agent-sdk/src/testing/` — vitest-free, exposed via the `@plusplusoneplusplus/coc-agent-sdk/testing` subpath. Factories: `createMockSDKService`, `createUnavailableMock`, `createStreamingMock`, `createFailingMock`, `createMockBridge`, `createExpiredSessionBridge`. Accepts an injectable mock-fn factory (`fn`); consumers pass `vi.fn` for spy assertions.
- `packages/coc/test/helpers/mock-sdk-service.ts` is a thin wrapper binding `vi.fn` and re-exporting the shared mock.
- Lower-level mock helpers in `packages/coc-agent-sdk/test/helpers/mock-sdk.ts` (`MockCopilotClient` — a different layer).
- 580+ tests in `packages/coc-agent-sdk/test/`, covering session-manager, streaming-session, sdk-loader, sdk-client-factory, stream-error-guard, request-runner, logger, codex-sdk-service.
- Set `serviceAny.sdkModule` and `serviceAny.availabilityCache` to bypass the real SDK.
- Test provider SDK option mappings at the provider boundary: SDK module fakes, protocol fixtures, transcript/request assertions, stream-event assertions, or sanitized log assertions. Do not rely only on wrapper/adapter argument assertions for provider-owned option names.
