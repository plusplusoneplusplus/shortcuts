# Copilot SDK Wrapper

Pure Node.js integration layer for `@github/copilot-sdk`. Manages AI session lifecycle, MCP server configuration, model registry and metadata, reasoning-effort resolution, and folder trust.

Location: `packages/forge/src/copilot-sdk-wrapper/`

## Files

| File | Purpose |
|------|---------|
| `copilot-sdk-service.ts` | Facade singleton (≤200 lines): lifecycle + single-delegation stubs |
| `request-runner.ts` | `sendMessage`/`transform` execution: session creation, MCP wiring, permission handler, streaming routing |
| `stream-error-guard.ts` | `StreamErrorGuard` + `isStreamDestroyedError()`/`isConnectionDisposedError()` helpers |
| `session-manager.ts` | Active session tracking and cancellation |
| `streaming-session.ts` | Streaming orchestrator (`StreamingSession.run()`) — state machine, timers, telemetry |
| `streaming-state-machine.ts` | Pure state machine: `Idle → Streaming → Settled | Cancelled` |
| `session-timer-manager.ts` | Timer management: overall timeout, idle timeout, turn-end grace |
| `session-telemetry.ts` | Token usage accumulation, tool-call tracking |
| `sdk-client-factory.ts` | Per-request `CopilotClient` spawning: cwd validation, folder trust |
| `sdk-loader.ts` | SDK binary discovery + ESM import workaround |
| `types.ts` | Shared types: `SendMessageOptions`, MCP configs, permissions, tools, token usage |
| `model-registry.ts` | Single source of truth for supported AI models |
| `model-metadata-store.ts` | Runtime model metadata cache with SDK polling |
| `model-reasoning.ts` | Metadata-aware model/reasoning resolver; variant IDs with `capabilities.family` sent as base model + reasoning effort |
| `mcp-config-loader.ts` | Loads/merges MCP config from `~/.copilot/mcp-config.json`, workspace `.vscode/mcp.json`, and explicit request options |
| `trusted-folder.ts` | Pre-registers working directories in `~/.copilot/config.json` |
| `image-converter.ts` | Image file → data-URL conversion |
| `index.ts` | Public API surface |

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

## RequestRunner — sendMessage() Flow

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
Forge's existing `mcpServers` shape before passing configuration to the SDK.
Config load results include source-scoped `success`/`error` metadata so callers
can continue with valid sources when another source is malformed.

## Model Resolution

Resolution order for per-request model:
1. Explicit `task.config.model`
2. `PerRepoPreferences.defaultModels[mode]` (per-mode override)
3. `PerRepoPreferences.defaultModel` (repo-wide default)
4. CLI default (`undefined`)

Variant models with `capabilities.family` base are sent to SDK as base model + resolved reasoning effort.

## Cleanup

- `cleanup()` (async): aborts all sessions, removes stream error guard, nulls sdkModule
- `dispose()`: sets `disposed = true`, removes guard synchronously, fires `cleanup()` fire-and-forget
- `resetCopilotSDKService()`: disposes and nulls singleton (test helper)

## Testing Notes

- Mock helpers in `test/helpers/mock-sdk.ts`
- Set `serviceAny.sdkModule` and `serviceAny.availabilityCache` to bypass real SDK
- Unit tests for: session-manager, streaming-session, sdk-loader, sdk-client-factory, stream-error-guard, request-runner
