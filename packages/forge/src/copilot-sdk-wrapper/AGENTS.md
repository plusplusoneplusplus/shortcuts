# Copilot SDK Wrapper — AGENTS.md

Pure Node.js integration layer for `@github/copilot-sdk`. Manages AI session lifecycle, MCP server configuration, model registry and metadata, reasoning-effort resolution, and folder trust.

## Files

| File | Purpose |
|------|---------|
| `copilot-sdk-service.ts` | **Facade only** (<=200 lines): singleton lifecycle + single-delegation public stubs |
| `request-runner.ts` | `sendMessage` / `transform` execution logic; session creation, MCP wiring, permission handler, streaming vs non-streaming routing |
| `stream-error-guard.ts` | `StreamErrorGuard` class + `isStreamDestroyedError()` / `isConnectionDisposedError()` helpers |
| `session-manager.ts` | Active session tracking and cancellation (`SessionManager` class) |
| `streaming-session.ts` | Streaming orchestrator (`StreamingSession.run()`) — wires state machine, timers, and telemetry |
| `streaming-state-machine.ts` | Pure state machine: `Idle → Streaming → Settled \| Cancelled` transitions with guards |
| `session-timer-manager.ts` | Timer management: overall timeout, idle timeout, turn-end grace (callback-based API) |
| `session-telemetry.ts` | Token usage accumulation, tool-call tracking, response accumulation (pure data, no async) |
| `sdk-client-factory.ts` | Per-request `CopilotClient` spawning: cwd validation, folder trust, `new CopilotClient()` |
| `sdk-loader.ts` | SDK binary discovery (`findSdkBinaryPath`) and ESM import workaround (`loadSdk`) |
| `types.ts` | All shared types: `SendMessageOptions`, MCP configs, permissions, tools, token usage |
| `model-registry.ts` | Single source of truth for supported AI models (add models here only) |
| `model-metadata-store.ts` | Runtime model metadata cache with SDK polling |
| `model-reasoning.ts` | Metadata-aware model/reasoning resolver; raw `capabilities.supports.reasoning_effort` values override top-level SDK contract fields when present, and variant IDs with a `capabilities.family` base are sent to the SDK as the base model plus resolved reasoning effort |
| `mcp-config-loader.ts` | Loads/merges MCP server config from `~/.copilot/mcp-config.json` |
| `trusted-folder.ts` | Pre-registers working directories in `~/.copilot/config.json` to skip trust dialog |
| `image-converter.ts` | Image file -> data-URL conversion for inline dashboard rendering |
| `index.ts` | Public API surface — all consumer imports go through here |

## CopilotSDKService — Architecture

`CopilotSDKService` is a **facade singleton**. All business logic lives in collaborators:

| Concern | Collaborator |
|---------|-------------|
| SDK binary discovery + loading | `SdkLoader` (`sdk-loader.ts`) |
| Client spawning | `createSdkClient` (`sdk-client-factory.ts`) |
| sendMessage / transform logic | `RequestRunner` (`request-runner.ts`) |
| Session tracking / abort | `SessionManager` (`session-manager.ts`) |
| Streaming state machine | `StreamingStateMachine` (`streaming-state-machine.ts`) |
| Streaming timers | `SessionTimerManager` (`session-timer-manager.ts`) |
| Streaming telemetry | `SessionTelemetry` (`session-telemetry.ts`) |
| Stream-error process guard | `StreamErrorGuard` (`stream-error-guard.ts`) |
| Model listing | `fetchModelsFromClient` (`model-registry.ts`) |

### Singleton + Per-Session Client Isolation

Each `sendMessage()` call creates its **own `CopilotClient`** child process — there is no shared client. This ensures concurrent tasks with different working directories cannot interfere with each other.

### State Fields (Facade)

| Field | Type | Purpose |
|-------|------|---------|
| `sdkModule` | cached SDK module | ESM-loaded `@github/copilot-sdk` (lazy, loaded once) |
| `availabilityCache` | `SDKAvailabilityResult` | Cached SDK availability check |
| `sessionManager` | `SessionManager` | Delegates active session tracking and cancellation |
| `streamErrorGuard` | `StreamErrorGuard` | Manages process-level ERR_STREAM_DESTROYED handlers |
| `requestRunner` | `RequestRunner` | Executes sendMessage / transform |
| `disposed` | boolean | Guard preventing calls after `dispose()` |

## RequestRunner — sendMessage() Flow

Each `sendMessage()` call in `RequestRunner.send()`:

```
1. isAvailable() -> check SDK exists
2. createClient(cwd) -> spawn fresh child process
3. Build ISessionOptions (model, streaming, tools, MCP config, permissions)
4. Session creation or resume (falls back to create on resume failure)
5. For model + reasoning-effort requests, call `session.setModel(model, { reasoningEffort })` after session creation/resume instead of passing both fields to `createSession`
6. onSessionCreated callback fires
7. Attach optional `AbortSignal` listener that aborts/destroys the session on cancellation
8. sessionManager.track(session)
9. Route: streaming (timeoutMs>120s or onStreamingChunk) vs sendAndWait
10. Empty-response handling (turnCount>0 = success)
11. FINALLY: remove abort listener, sessionManager.untrack + session.destroy + client.stop
```

## Streaming Internals (`StreamingSession.run()`)

Dual timeout: `timeoutMs` (wall clock) and `idleTimeoutMs` (inactivity). Whichever fires first kills the session.

Completion detection: `session.idle` > `turn_end` 2s grace timer. Multi-turn MCP loops: `turn_start` cancels grace timer.

## Stream Error Guard (`StreamErrorGuard`)

Installed once when SDK module loads. Absorbs `ERR_STREAM_DESTROYED` errors via both `uncaughtException` and `unhandledRejection` process listeners. `dispose()` removes guard **synchronously** to prevent listener accumulation across singleton resets.

## MCP Configuration

```
~/.copilot/mcp-config.json  ->  loadDefaultMcpConfig()
SendMessageOptions.mcpServers  ->  explicit config
mergeMcpConfigs: explicit wins; {} disables all MCP
```

`loadDefaultMcpConfig: false` skips loading the file entirely.

## `transform<T>()` Utility

One-shot prompt helper in `RequestRunner.transform()`. Uses injected `sendFn` (service's `sendMessage.bind(this)`) so tests can spy on the public method. Default model: `gpt-4.1`.

## Cleanup

`cleanup()` (async): aborts all sessions, removes stream error guard, nulls sdkModule and availabilityCache.
`dispose()`: sets `disposed = true`, removes guard synchronously, fires `cleanup()` fire-and-forget.

## Testing Notes

- `resetCopilotSDKService()` — disposes and nulls the singleton. Call in `afterEach`.
- Mock helpers in `test/helpers/mock-sdk.ts`.
- Set `serviceAny.sdkModule` and `serviceAny.availabilityCache` to bypass real SDK.
- Stream error guard: `serviceAny.streamErrorGuard.install()`, `.remove()`, `.handler`, `.rejectionHandler`.
- Idle-timeout tests: `serviceAny.requestRunner.sendWithStreaming(session, prompt, timeoutMs, ...)`.
- Unit tests: `session-manager`, `streaming-session`, `sdk-loader`, `sdk-client-factory`, `stream-error-guard`, `request-runner`.
