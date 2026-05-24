# CoC Agent SDK (`coc-agent-sdk`)

Provider-agnostic AI agent SDK for CoC. Manages AI session lifecycle, MCP server configuration, model registry and metadata, reasoning-effort resolution, and folder trust. Supports **Copilot** (via `@github/copilot-sdk`) and **Codex** (via the optional `@openai/codex-sdk`) backends through a common `ISDKService` interface.

Package: `@plusplusoneplusplus/coc-agent-sdk`  
Location: `packages/coc-agent-sdk/src/`

> **Forge relationship:** `packages/forge/src/copilot-sdk-wrapper/` has been removed. All forge source files import directly from `@plusplusoneplusplus/coc-agent-sdk`.

## Files

| File | Purpose |
|------|---------|
| `copilot-sdk-service.ts` | `CopilotSDKService` facade singleton — Copilot backend |
| `codex-sdk-service.ts` | `CodexSDKService` — optional Codex backend (`@openai/codex-sdk`) |
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

**Thread ↔ session mapping:** Every CoC session ID maps to exactly one Codex thread. The mapping is created on the first `sendMessage()` call for a session and removed on abort or dispose.

**Auth checker injection:** An optional `CodexAuthChecker` callback can be injected to gate requests. When not authenticated, `sendMessage()` returns an error with `authUrl` so callers can surface a sign-in link.

```ts
registerCodexSDKService();            // registers under SDK_PROVIDER_CODEX
// or:
const svc = new CodexSDKService();
svc.setAuthChecker(() => ({ authenticated: true }));
sdkServiceRegistry.register(SDK_PROVIDER_CODEX, svc);
```

**Lazy loading:** No SDK module is loaded until the first `isAvailable()` or `sendMessage()` call.

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
