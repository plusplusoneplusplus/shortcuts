# Copilot SDK Wrapper — AGENTS.md

Pure Node.js integration layer for `@github/copilot-sdk`. Manages AI session lifecycle, MCP server configuration, model registry, and folder trust.

## Files

| File | Purpose |
|------|---------|
| `copilot-sdk-service.ts` | Core service: client/session lifecycle, streaming, error recovery |
| `types.ts` | All shared types: `SendMessageOptions`, MCP configs, permissions, tools, token usage |
| `model-registry.ts` | Single source of truth for supported AI models (add models here only) |
| `mcp-config-loader.ts` | Loads/merges MCP server config from `~/.copilot/mcp-config.json` |
| `trusted-folder.ts` | Pre-registers working directories in `~/.copilot/config.json` to skip trust dialog |
| `index.ts` | Public API surface — all consumer imports go through here |

## CopilotSDKService — Architecture

### Singleton + Per-Session Client Isolation

`CopilotSDKService` is a **singleton** (`getInstance()` / `getCopilotSDKService()`). However, each `sendMessage()` call creates its **own `CopilotClient`** child process — there is no shared client. This ensures concurrent tasks with different working directories cannot interfere with each other.

```
sendMessage(cwd="/project-a")  →  CopilotClient(cwd="/project-a")  →  Session A
sendMessage(cwd="/project-b")  →  CopilotClient(cwd="/project-b")  →  Session B
                                  (fully isolated — A and B cannot affect each other)
```

**Why per-session?** `CopilotClient` spawns a CLI child process via `connectViaStdio`, and `cwd` is set at process spawn time. Reusing a single client required stop+restart on cwd changes, which killed all other active sessions on that client.

### State Fields

| Field | Type | Purpose |
|-------|------|---------|
| `sdkModule` | cached SDK module | ESM-loaded `@github/copilot-sdk` (lazy, loaded once) |
| `availabilityCache` | `SDKAvailabilityResult` | Cached SDK availability check |
| `activeSessions` | `Map<string, ICopilotSession>` | In-flight sessions tracked for cancellation |
| `streamErrorGuardHandler` | `uncaughtException` listener | Absorbs `ERR_STREAM_DESTROYED` from SDK stdio |
| `disposed` | boolean | Guard preventing calls after `dispose()` |

## Session Lifecycle

### `sendMessage()` Flow (Session-Per-Request or Session-Resume)

Each `sendMessage()` call creates a fresh client. If `options.sessionId` is provided, it resumes the existing server-side session (retaining full conversation history); otherwise it creates a new session. Both paths converge to the same execution and cleanup flow.

```
1. isAvailable() → check SDK exists
2. createClient(cwd) → spawn fresh child process
3. Build ISessionOptions:
   - model, streaming, tools, availableTools, excludedTools
   - MCP config: loadDefaultMcpConfig() → merge with explicit config
   - Wrap onPermissionRequest with logging + ToolCall capture
4. Session creation:
   - IF options.sessionId AND client.resumeSession exists
     → client.resumeSession(sessionId, sessionOptions)
     → on failure: fall back to client.createSession(sessionOptions) + warn
   - ELSE
     → client.createSession(sessionOptions)
5. onSessionCreated callback fires with session.sessionId
6. trackSession(session) → register in activeSessions
7. Route to execution path:
   - IF streaming || onStreamingChunk || timeoutMs > 120000
     → sendWithStreaming()
   - ELSE
     → sendWithTimeout() → session.sendAndWait (SDK 120s internal cap)
8. Empty-response handling:
   - turnCount > 0 + empty text → SUCCESS (tool-based execution, no summary)
   - turnCount == 0 + empty text → failure
9. FINALLY (always):
   - untrackSession
   - session.destroy() + client.stop()
```

### Active Session Tracking (Cancellation)

- `trackSession(session)` / `untrackSession(sessionId)` — add/remove from `activeSessions` map.
- `abortSession(sessionId)` — calls `session.destroy()`, returns boolean.
- `hasActiveSession()` / `getActiveSessionCount()` — read-only inspection.

## Streaming Internals (`sendWithStreaming`)

### Dual Timeout Model

| Timer | Default | Behavior |
|-------|---------|----------|
| `timeoutMs` | `DEFAULT_AI_TIMEOUT_MS` (4 hours) | Hard wall-clock limit. Force-destroys session on fire. |
| `idleTimeoutMs` | `DEFAULT_AI_IDLE_TIMEOUT_MS` (1 hour) | Resets on every chunk/message/tool event. Force-destroys on inactivity. |

Whichever fires first kills the session.

### Completion Detection (priority order)

1. **`session.idle`** → settle immediately (most reliable signal)
2. **`assistant.turn_end`** → start a **2-second grace timer**
   - If `assistant.turn_start` fires before grace expires → cancel timer (multi-turn MCP tool loop continues)
   - If nothing fires within 2s → settle with accumulated content

### Multi-Turn Message Accumulation

`allMessages[]` collects all `assistant.message` content across turns. On settle, joined with `\n\n`. Delta chunks (`response` string) are a fallback if no `assistant.message` events arrive.

### SDK Event Types Handled

| Event | Action |
|-------|--------|
| `assistant.message_delta` | Accumulate delta, invoke `onStreamingChunk`, reset idle timer |
| `assistant.message` | Push to `allMessages[]`, log tool requests if present |
| `assistant.turn_start` | Cancel turn_end grace timer (new turn starting) |
| `assistant.turn_end` | Increment `turnCount`, start 2s grace timer |
| `session.idle` | Settle with result |
| `session.error` | Settle with error |
| `assistant.usage` | Accumulate per-turn token usage |
| `session.usage_info` | Store session-level quota (tokenLimit, currentTokens) |
| `tool.execution_start` | Track in `activeToolCalls`, build `ToolCall` object, emit `onToolEvent('tool-start')` |
| `tool.execution_complete` | Remove from active, update `ToolCall` status/result, emit `onToolEvent('tool-complete'/'tool-failed')` |
| `tool.execution_progress` | Log progress, store latest `progressMessage` on `ToolCall` |
| `assistant.intent` | Log only |
| `session.info` | Log only |
| `abort` | Log only |

### Image Data URL Conversion

When the `view` tool completes on an image file (`png/jpg/gif/webp/svg`, ≤10MB), `tryConvertImageFileToDataUrl()` replaces the text result with a `data:image/<mime>;base64,…` URL for inline rendering in the dashboard.

## Stream Error Guard

Installed once when the SDK module is first loaded. Attaches `process.on('uncaughtException')` that swallows errors matching `STREAM_DESTROYED_PATTERNS`:

- `'stream was destroyed'`, `'ERR_STREAM_DESTROYED'`, `'cannot call write after a stream was destroyed'`, `'EPIPE'`, `'ECONNRESET'`

**Why needed**: The SDK's `connectViaStdio()` installs a stdin error listener that re-throws `ERR_STREAM_DESTROYED` when the CLI process exits unexpectedly. This would crash the host process as an uncaught exception. The guard absorbs these so the normal error-return path handles them gracefully.

Non-matching exceptions are re-thrown to preserve default behavior. Removed during `cleanup()`.

## MCP Configuration

### Load + Merge Strategy

```
~/.copilot/mcp-config.json  →  loadDefaultMcpConfig()  →  defaultConfig
SendMessageOptions.mcpServers  →  explicitConfig

mergeMcpConfigs(defaultConfig, explicitConfig):
  - explicitConfig undefined → return defaultConfig copy
  - explicitConfig = {} → return {} (disable all MCP — intentional escape hatch)
  - otherwise → { ...defaultConfig, ...explicitConfig } (explicit wins per key)
```

`loadDefaultMcpConfig: false` in `SendMessageOptions` skips loading `~/.copilot/mcp-config.json` entirely.

Results are cached; use `clearMcpConfigCache()` to force re-read.

## Model Registry

Single source of truth in `model-registry.ts`. First entry is the default/recommended model.

**To add a model**: Add entry to `MODEL_DEFINITIONS` array → all types, constants, and helpers auto-derive.

Key exports: `AIModel` (union type), `VALID_MODELS` (tuple), `DEFAULT_MODEL_ID`, `MODEL_REGISTRY` (Map for O(1) lookup), helper functions (`getModelLabel`, `isValidModelId`, `getModelsByTier`, etc.).

## Trusted Folders

Before creating a client, `createClient(cwd)` calls `ensureFolderTrusted(cwd)` to add the directory to `~/.copilot/config.json`'s `trusted_folders[]` array. This prevents the Copilot CLI from showing an interactive folder trust confirmation dialog. The operation is non-fatal — if it fails, the dialog appears as fallback.

Config location respects `XDG_CONFIG_HOME` env var, defaulting to `~/.copilot/config.json`.

## Key Design Decisions

1. **One client per session** — `cwd` is baked into the child process at spawn time; no client reuse across different working directories. Concurrency is bounded by the queue's limiter (exclusive=1, shared=5), not by the SDK layer.
2. **Session resume for multi-turn chat** — `sendMessage({ sessionId })` calls `client.resumeSession()`, letting the SDK server provide full conversation history natively. Falls back to `createSession()` if resume fails (session expired). `session.destroy()` is local cleanup only — the server persists the session.
3. **Streaming is the default path** — any `timeoutMs > 120000` or `onStreamingChunk` callback automatically uses the streaming event API (SDK's `sendAndWait` has a hardcoded 120s `session.idle` timeout).
3. **Empty text + turns > 0 = success** — tool-heavy agents (e.g., `impl` skill) may produce no text summary but have done work via tool calls (file edits, shell commands).
4. **Multi-turn grace timer** — `turn_end` → 2s timer → `turn_start` cancels. Correctly handles multi-step MCP tool loops without settling prematurely.
5. **MCP `{}` escape hatch** — passing `mcpServers: {}` explicitly disables all MCP servers regardless of the user's config file.
6. **Permission default is deny** — without `onPermissionRequest`, all tool permission requests are denied. Use `approveAllPermissions` only in trusted environments.

## `transform<T>()` Utility

One-shot prompt helper. Calls `sendMessage` with `gpt-4.1` (default). Throws on failure. Optional `parse` callback maps raw string to `T`.

## Cleanup

`cleanup()` (async): aborts all `activeSessions`, removes stream error guard, nulls sdkModule and availabilityCache.

`dispose()`: sets `disposed = true`, fires `cleanup()` fire-and-forget.

## Testing Notes

- `resetCopilotSDKService()` / `CopilotSDKService.resetInstance()` — disposes and nulls the singleton. Call in `afterEach`.
- Mock helpers in `test/helpers/mock-sdk.ts`: `createMockSession`, `createStreamingMockSession`, `createMockSDKModule`, `createStreamingMockSDKModule`, `setupService`.
- Set `serviceAny.sdkModule` and `serviceAny.availabilityCache` to wire up mocks without real SDK.
- Tests for: client initialization, streaming events, transform, tools, attachments, session isolation.
