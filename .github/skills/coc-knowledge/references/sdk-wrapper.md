# CoC Agent SDK (`coc-agent-sdk`)

Provider-agnostic AI agent SDK for CoC. Manages AI session lifecycle, MCP server configuration, model registry and metadata, reasoning-effort resolution, folder trust, and provider quota snapshots where the backend exposes them. Supports **Copilot** (via `@github/copilot-sdk`), **Codex** (via the optional `@openai/codex-sdk` plus the bundled `@openai/codex` CLI for quota/model catalog RPCs), and **Claude** (via the optional `@anthropic-ai/claude-agent-sdk`) backends through a common `ISDKService` interface.

Package: `@plusplusoneplusplus/coc-agent-sdk`  
Location: `packages/coc-agent-sdk/src/`

> **Forge relationship:** `packages/forge/src/copilot-sdk-wrapper/` has been removed. All forge source files import directly from `@plusplusoneplusplus/coc-agent-sdk`.

## Files

| File | Purpose |
|------|---------|
| `copilot-sdk-service.ts` | `CopilotSDKService` facade singleton — Copilot backend |
| `codex-sdk-service.ts` | `CodexSDKService` — optional Codex backend (`@openai/codex-sdk`) |
| `claude-sdk-service.ts` | `ClaudeSDKService` — optional Claude backend (`@anthropic-ai/claude-agent-sdk`) |
| `sdk-service-interface.ts` | `ISDKService` provider-agnostic contract |
| `sdk-service-registry.ts` | `SDKServiceRegistry` — named-provider registry |
| `request-runner.ts` | `sendMessage`/`transform` execution: session creation, MCP wiring, permission handler, streaming routing |
| `stream-error-guard.ts` | `StreamErrorGuard` + `isStreamDestroyedError()`/`isConnectionDisposedError()` helpers |
| `session-manager.ts` | Active session tracking and cancellation |
| `streaming-session.ts` | Streaming orchestrator (`StreamingSession.run()`) — state machine, timers, telemetry |
| `streaming-state-machine.ts` | Pure state machine: `Idle → Streaming → Settled \| Cancelled` |
| `session-timer-manager.ts` | Timer management: overall timeout, idle timeout, turn-end grace |
| `session-telemetry.ts` | Token usage accumulation, tool-call tracking |
| `sdk-client-factory.ts` | Per-request `CopilotClient` spawning: cwd validation, folder trust |
| `sdk-loader.ts` | SDK binary discovery + ESM import workaround |
| `sdk-esm-loader.ts` | Dynamic ESM import helper (webpack-safe `new Function` indirection) |
| `types.ts` | Shared types: `SendMessageOptions`, MCP configs, permissions, tools, token usage |
| `model-registry.ts` | Single source of truth for supported AI models |
| `model-metadata-store.ts` | Runtime model metadata cache with SDK polling |
| `model-reasoning.ts` | Metadata-aware model/reasoning resolver; variant IDs with `capabilities.family` sent as base model + reasoning effort |
| `mcp-config-loader.ts` | Loads/merges MCP config from `~/.copilot/mcp-config.json`, workspace `.vscode/mcp.json`, and explicit request options |
| `trusted-folder.ts` | Pre-registers working directories in `~/.copilot/config.json` |
| `image-converter.ts` | Image file → data-URL conversion |
| `tool-call.ts` | `ToolCall`, `ToolCallStatus`, `ToolCallPermissionRequest`, serialization types |
| `model-info.ts` | `ModelInfo` type (id, name, description, tier, …) |
| `logger.ts` | `initSDKLogger` / `resetSDKLogger` / `getSDKLogger` — pino logger lifecycle |
| `internal/exec-utils.ts` | Internal: async `execFileAsync` helper |
| `internal/path-security.ts` | Internal: path traversal validation |
| `internal/path-utils.ts` | Internal: path resolution utilities |
| `internal/workspace-execution.ts` | Internal: workspace execution helpers |
| `llm-tools/coc-tool-runtime.ts` | `CocToolRuntime` — provider-neutral runtime over a per-invocation `Tool<any>[]` bundle (`listTools`/`callTool`, result normalization, disposable) |
| `llm-tools/bridge-server.ts` | `CocToolBridgeServer` + `cocToolBridgeServer` singleton — loopback IPC channel hosting per-invocation runtimes for the MCP bridge |
| `llm-tools/bridge.ts` | `coc-llm-tools-mcp` — standalone hand-rolled stdio MCP server (child process) proxying `tools/list`/`tools/call` to the parent loopback endpoint |
| `llm-tools/mcp-config.ts` | `buildCocLlmToolsMcpConfig()` + bridge-path resolution + server-name/env constants |
| `index.ts` | Public API surface |

## SDKServiceRegistry

Replaces the `CopilotSDKService.getInstance()` singleton pattern. Providers register under a string key; callers look up by key.

```ts
// Well-known keys:
COPILOT_PROVIDER / SDK_PROVIDER_COPILOT = 'copilot'
CODEX_PROVIDER   / SDK_PROVIDER_CODEX   = 'codex'

// Registration (done once during provider init):
sdkServiceRegistry.register(SDK_PROVIDER_COPILOT, new CopilotSDKService());
sdkServiceRegistry.register(SDK_PROVIDER_CODEX,   new CodexSDKService());

// Lookup:
const svc = sdkServiceRegistry.getOrThrow(SDK_PROVIDER_COPILOT);
```

`sdkServiceRegistry` is the module-level singleton. `CopilotSDKService.getInstance()` still exists for compatibility and re-registers itself if absent from the registry.

## CopilotSDKService Architecture

`CopilotSDKService` is a **facade singleton**. All logic lives in collaborators:

| Concern | Collaborator |
|---------|-------------|
| SDK binary discovery + loading | `SdkLoader` |
| Client spawning | `createSdkClient` |
| sendMessage / transform logic | `RequestRunner` |
| Session tracking / abort | `SessionManager` |
| Streaming state machine | `StreamingStateMachine` |
| Streaming timers | `SessionTimerManager` |
| Streaming telemetry | `SessionTelemetry` |
| Stream-error process guard | `StreamErrorGuard` |
| Model listing | `fetchModelsFromClient` |

### Singleton + Per-Session Client Isolation

Each `sendMessage()` call creates its **own `CopilotClient`** child process — no shared client. Concurrent tasks with different working directories cannot interfere.

## CodexSDKService Architecture

`CodexSDKService` implements `ISDKService` backed by the **optional** `@openai/codex-sdk` peer dependency. When the package is not installed, `isAvailable()` returns `{ available: false }` and `sendMessage()` returns an error result rather than throwing.

Codex quota and model catalog lookups spawn the `@openai/codex` CLI that ships as a dependency of `@openai/codex-sdk`; the bin path is resolved at runtime relative to `coc-agent-sdk`.

Codex SDK thread options do not expose Copilot's native `skillDirectories` or `disabledSkills` fields. CoC maps resolved skill directories to Codex `additionalDirectories` so external/global skill folders are available to the Codex process. For explicitly selected skills, CoC keeps prompts path-based by adding the resolved `SKILL.md` file paths to the `<selected_skills>` directive rather than inlining skill bodies.

**Thread ↔ session mapping:** Every CoC session ID maps to exactly one Codex thread. The mapping is created on the first `sendMessage()` call for a session and removed on abort or dispose.

**Authentication:** CoC does not own a Codex auth store or `/api/codex-auth/*` routes. Codex authentication is handled by the Codex SDK/CLI; hosts may still inject an optional `CodexAuthChecker` if they need a preflight gate before loading the SDK.

```ts
registerCodexSDKService();            // registers under SDK_PROVIDER_CODEX with SDK/CLI-owned auth
// Optional host preflight gate:
const svc = new CodexSDKService();
svc.setAuthChecker(() => ({ authenticated: true }));
sdkServiceRegistry.register(SDK_PROVIDER_CODEX, svc);
```

**Lazy loading:** No SDK module is loaded until the first `isAvailable()` or `sendMessage()` call.

**CoC LLM tools:** when `options.tools` is present, a per-request `Codex` client is built with `config.mcp_servers.coc_llm_tools` pointing at the stdio bridge (see *CoC LLM Tools over MCP*).

## ClaudeSDKService Architecture

`ClaudeSDKService` implements `ISDKService` backed by the **optional** `@anthropic-ai/claude-agent-sdk` peer dependency. It lazy-loads the SDK's `query` export, streams Claude messages into the common invocation result shape, and reports `{ available: false }` with install guidance when the package cannot be imported.

Claude Agent SDK does **not** expose a direct quota RPC equivalent to Copilot `account.getQuota` or Codex `account/rateLimits/read`. `ClaudeSDKService.getAccountQuota()` surfaces, in priority order:

1. The most recent structured `rate_limit_event` emitted during a Claude session (concrete per-limit usage, mapped via `mapClaudeRateLimitInfoToQuota`).
2. A synthesized "subscription active, well under all thresholds" snapshot derived from `accountInfo()` (mapped via `mapClaudeAccountInfoToQuota`, keyed by `subscriptionType` like `Claude Pro` / `Claude Max` / `team` / `enterprise`, falling back to a non-`firstParty` `apiProvider` such as `bedrock` / `vertex`, then to `subscription`). Used when no rate-limit event has fired yet (the common case for healthy users).

If neither signal is available the result is `{ quotaSnapshots: {} }`.

`accountInfo()` is cached as a side-effect of every real `sendMessage()` call: after obtaining the query handle, `ClaudeSDKService` fires `handle.accountInfo?.()` as a fire-and-forget promise that writes to `lastAccountInfo` on resolution. No separate probe subprocess is spawned.

Claude session persistence uses the Claude Code SDK transcript session ID. New `sendMessage()` calls pass a generated UUID as `options.sessionId`, persist any `session_id` emitted by the SDK stream, and follow-up calls pass the stored ID as `options.resume` so Claude Code reloads the prior transcript. `forkSession()` delegates to the SDK's `forkSession` export and returns the forked session ID.

Claude Code expects hyphenated model IDs for version aliases (for example, `claude-sonnet-4-6`). `ClaudeSDKService` normalizes CoC's shared dotted Claude registry IDs (`claude-sonnet-4.6`, `claude-haiku-4.5`, `claude-opus-4.6`) to that Claude Code form before passing `options.model` to the SDK. Non-Claude model IDs and `claude-provider-default` are omitted so Claude Code can use its configured default.

Claude Code permission mode is mapped at the provider boundary: CoC `autopilot` sends `permissionMode: 'bypassPermissions'` plus `allowDangerouslySkipPermissions: true`, while CoC `plan` sends `permissionMode: 'plan'`. Interactive/ask mode leaves Claude Code's default permission behavior in place.

`ClaudeSDKService` wires CoC LLM tools and any caller-provided `mcpServers` into `query({ options: { mcpServers } })`; CoC tools ride a stdio bridge entry (`coc_llm_tools`, `alwaysLoad: true`), are pre-approved via `options.allowedTools` (`mcp__coc_llm_tools__<tool>`) so Claude Code never prompts for them, and bridged `tool_use` names are de-namespaced (see *CoC LLM Tools over MCP*).

Claude tool-call capture treats assistant `tool_use` blocks as start events and user `tool_result` / `tool_use_result` payloads as terminal events. Stored tool calls keep the original input parameters in `args` and preserve the actual tool output in `result` or `error`; the adapter does not synthesize completion results from tool input JSON.

## RequestRunner — sendMessage() Flow (Copilot)

```
1. isAvailable() → check SDK exists
2. createClient(cwd) → spawn fresh child process
3. Build ISessionOptions (model, streaming, tools, MCP config, permissions)
4. Session creation or resume (falls back to create on resume failure)
5. session.setModel(model, { reasoningEffort }) after session creation
6. onSessionCreated callback fires
7. Attach AbortSignal listener for cancellation
8. sessionManager.track(session)
9. Route: streaming (timeoutMs>120s or onStreamingChunk) vs sendAndWait
10. Empty-response handling (turnCount>0 = success)
11. FINALLY: remove abort listener, untrack + session.destroy + client.stop
```

## Streaming Internals

`StreamingSession.run()` manages:
- **Dual timeout:** `timeoutMs` (wall clock) and `idleTimeoutMs` (inactivity) — first to fire kills session
- **Completion detection:** `session.idle` → `turn_end` → 2s grace timer
- **Multi-turn MCP loops:** `turn_start` cancels grace timer for continued processing
- **Background tasks:** Settlement deferred until `backgroundTasks` field drains to zero

State machine transitions: `Idle → Streaming → Settled | Cancelled`

## Stream Error Guard

Installed once when SDK module loads. Absorbs `ERR_STREAM_DESTROYED` errors via `uncaughtException` and `unhandledRejection` process listeners. `dispose()` removes guard synchronously.

## MCP Configuration

```
~/.copilot/mcp-config.json               →  loadDefaultMcpConfig()
<workingDirectory>/.vscode/mcp.json      →  loadWorkspaceMcpConfig()
SendMessageOptions.mcpServers            →  explicit config
loadEffectiveMcpConfig: global < workspace < explicit; {} disables all MCP
loadDefaultMcpConfig: false              →  skips global/workspace files
forceReload: true                        →  bypasses the path-keyed config cache
```

Workspace MCP loading is resolved from the per-request `workingDirectory`, not
the process current directory, so concurrent repos do not share MCP state. VS
Code workspace config uses a top-level `servers` map, which is normalized into
the `mcpServers` shape before passing configuration to the SDK.
Config load results include source-scoped `success`/`error` metadata so callers
can continue with valid sources when another source is malformed.

## CoC LLM Tools over MCP (provider parity)

CoC LLM tools are assembled in the coc package as `Tool<any>[]`
(via `buildChatToolBundle()` / `applyLlmToolPreferences()`) and passed to every
provider through `SendMessageOptions.tools`. Copilot consumes them natively; Codex
and Claude consume the **same already-filtered array** through a provider-neutral
MCP bridge so features like `ask_user`, conversation search, work-item/bug
creation, wakeups/loops, Tavily, comments, and memory tools work uniformly.

The tool contract (`Tool`, `ToolHandler`, `ToolInvocation`, `ToolResultObject`,
`ZodSchema`) is owned natively by `coc-agent-sdk/src/types.ts`, not aliased from a
provider SDK — keeping the runtime + bridge free of any compile-time dependency on
`@github/copilot-sdk`. `defineTool()` is a local pure data-merge. A compile-time
guard in `types.ts` asserts the native contract stays structurally interchangeable
with the Copilot SDK's, since the Copilot path assigns the same bundle to the SDK's
`SessionConfig.tools` (`request-runner.ts`).

Pipeline (all in `coc-agent-sdk/src/llm-tools/`):
1. `CocToolRuntime` wraps the per-invocation `Tool<any>[]` → `listTools()` (JSON-schema
   descriptors) + `callTool()` (invokes the original in-process handler, normalizes
   results to MCP `CallToolResult`). Exposes exactly the tools it is given, so
   per-repo preference filtering upstream means only enabled tools surface.
2. `CocToolBridgeServer` (`cocToolBridgeServer` singleton) registers each runtime
   under a random bearer token on a lazily-started `127.0.0.1` HTTP server and
   serves `POST /list` / `POST /call`. `/call` awaits `callTool` with no server-side
   timeout, so blocking tools (`ask_user`) keep the request open until the SPA
   answers — preserving blocking/resume across the process boundary. Reference-
   counted: torn down when the last runtime unregisters (no idle server, no caching).
3. `bridge.ts` (`coc-llm-tools-mcp`) is a dependency-free hand-rolled MCP **stdio**
   server spawned as a child by the provider's MCP client. It reads
   `COC_LLM_TOOLS_ENDPOINT` / `COC_LLM_TOOLS_TOKEN` from env and proxies
   `initialize`/`tools/list`/`tools/call` to the loopback endpoint.
4. `buildCocLlmToolsMcpConfig()` emits the `{ command, args, env }` stdio spec; bridge
   path resolves to the dist-adjacent `bridge.js`, overridable via
   `setCocLlmToolsBridgePath()` / `COC_LLM_TOOLS_BRIDGE_PATH` for bundled hosts.

Provider wiring (per request, only when `options.tools` is non-empty; disposed in
`finally`):
- **Copilot:** native `SendMessageOptions.tools` (unchanged; no bridge).
- **Codex:** a fresh `Codex` client is built with
  `config.mcp_servers.coc_llm_tools = { command, args, env, enabled_tools }`, where
  `enabled_tools` is the de-duplicated set of CoC LLM tool names passed into the
  current request. Bridged calls arrive as `mcp_tool_call` items and report bare
  tool names via existing normalization.
- **Claude:** the stdio bridge entry is injected into `query({ options: { mcpServers } })`
  under `coc_llm_tools` with `alwaysLoad: true`; caller-provided `mcpServers` are
  also forwarded (normalized to Claude's shape). Each bridged tool is added to
  `options.allowedTools` as `mcp__coc_llm_tools__<tool>` so Claude Code does not
  prompt for (or block) CoC's own first-party tools — parity with Copilot, which
  runs the same bundle without permission prompts. `tool_use` blocks named
  `mcp__coc_llm_tools__<tool>` are de-namespaced to `<tool>` so `onToolEvent` /
  tool-call capture / the timeline see the bare CoC tool name.

## Model Resolution

Resolution order for per-request model:
1. Explicit `task.config.model`
2. `PerRepoPreferences.defaultModels[mode]` (per-mode override)
3. `PerRepoPreferences.defaultModel` (repo-wide default)
4. CLI default (`undefined`)

Variant models with `capabilities.family` base are sent to SDK as base model + resolved reasoning effort.

## Logger Lifecycle

`coc-agent-sdk` uses a pino logger injected by the host application:

```ts
import { initSDKLogger, resetSDKLogger } from '@plusplusoneplusplus/coc-agent-sdk';
initSDKLogger(pinoInstance);   // call once at startup
resetSDKLogger();              // call in tests to restore no-op logger
```

Without a call to `initSDKLogger`, all internal SDK log statements are silently discarded.

## Cleanup

- `cleanup()` (async): aborts all sessions, removes stream error guard, nulls sdkModule
- `dispose()`: sets `disposed = true`, removes guard synchronously, fires `cleanup()` fire-and-forget
- `resetCopilotSDKService()`: disposes and nulls singleton (test helper)

## Testing Notes

- Mock helpers in `packages/coc-agent-sdk/test/helpers/mock-sdk.ts`
- 306 tests in `packages/coc-agent-sdk/test/`
- Set `serviceAny.sdkModule` and `serviceAny.availabilityCache` to bypass real SDK
- Unit tests cover: session-manager, streaming-session, sdk-loader, sdk-client-factory, stream-error-guard, request-runner, logger, codex-sdk-service
