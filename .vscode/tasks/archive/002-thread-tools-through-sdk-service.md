---
status: pending
---

# 002: Thread Custom Tools Through CopilotSDKService

## Summary

Thread the `tools` option from `SendMessageOptions` through to the SDK's `createSession()` call, and store it on kept-alive sessions so resumed sessions can re-register the same tools.

## Motivation

Commit 001 added the `tools?: CustomTool[]` field to the type interfaces (`SendMessageOptions`, `ISessionOptions`) and the `CustomTool` type itself. This commit wires the plumbing so the tools actually reach the SDK at runtime — both on initial session creation and when resuming a kept-alive session for multi-turn follow-up.

## Changes

### Files to Create
- None

### Files to Modify

- **`packages/pipeline-core/src/copilot-sdk-wrapper/copilot-sdk-service.ts`** — four touch-points:

  1. **`sendMessage()` — build session options (~line 531–545)**
     After the existing `excludedTools` block, add:
     ```ts
     if (options.tools) {
         sessionOptions.tools = options.tools;
     }
     ```
     This threads `SendMessageOptions.tools` into `ISessionOptions.tools`, which is passed to `client.createSession(sessionOptions)` at line 627.

  2. **`KeptAliveSession` interface (~line 81–86)**
     Add a `tools` field so tools survive across follow-ups:
     ```ts
     interface KeptAliveSession {
         session: ICopilotSession;
         createdAt: number;
         lastUsedAt: number;
         workingDirectory?: string;
         tools?: ISessionOptions['tools'];   // ← add
     }
     ```

  3. **`sendMessage()` finally block — store kept-alive session (~line 719–728)**
     When populating the `KeptAliveSession` entry, also store `tools`:
     ```ts
     this.keptAliveSessions.set(session.sessionId, {
         session,
         createdAt: now,
         lastUsedAt: now,
         workingDirectory: options.workingDirectory,
         tools: options.tools,   // ← add
     });
     ```

  4. **`IResumeSessionOptions` interface (~line 143–147)**
     Add `tools` so resumed sessions can re-register custom tools:
     ```ts
     interface IResumeSessionOptions {
         streaming?: boolean;
         onPermissionRequest?: PermissionHandler;
         mcpServers?: Record<string, MCPServerConfig>;
         tools?: ISessionOptions['tools'];   // ← add
     }
     ```

  5. **`resumeKeptAliveSession()` (~line 746–783)**
     Read stored tools from the original `KeptAliveSession` entry (via `keptAliveSessions` or caller context) and pass them in `resumeOptions`:
     ```ts
     // After building resumeOptions (line ~759):
     // We don't have the original entry here (that's the point — the
     // session expired from our map). Pass tools from SendFollowUpOptions
     // if the caller supplies them.
     ```
     **Gotcha**: `resumeKeptAliveSession` is called when the session is NOT in `keptAliveSessions` (it expired or the process restarted). The original tools are lost. Two options:
     - **(a)** Add `tools` to `SendFollowUpOptions` so the caller can re-supply them.
     - **(b)** Accept that resumed sessions lose custom tools (document this limitation).

     **Recommended: option (a)** — add `tools` to `SendFollowUpOptions` (~line 91–110) and thread it into `resumeOptions` inside `resumeKeptAliveSession()`.

  6. **`SendFollowUpOptions` interface (~line 91–110)**
     Add `tools` field:
     ```ts
     export interface SendFollowUpOptions {
         // ... existing fields ...
         /** Custom tools to re-register on resumed sessions */
         tools?: ISessionOptions['tools'];
     }
     ```

  7. **`ICopilotClient.resumeSession` interface (~line 153–156)**
     The `IResumeSessionOptions` parameter already flows through — ensure the mock interface matches.

### Files to Delete
- None

## Implementation Notes

- **`createSession` path (normal flow):** `options.tools` → `sessionOptions.tools` → `client.createSession(sessionOptions)`. The SDK's `createSession` accepts `tools` in its `SessionConfig` (from `defineTool` API). No special serialization needed — the `CustomTool` objects contain `name`, `description`, `parameters`, and a `handler` function, and the SDK handles registration.

- **`sendFollowUp` path (kept-alive, session still in map):** Tools were registered at `createSession` time and persist on the SDK session object. No re-registration needed. The stored `tools` on `KeptAliveSession` is insurance for the resume path.

- **`sendFollowUp` path (resumed, session expired from map):** The SDK's `resumeSession` may need tools re-registered. Store them on `KeptAliveSession` and also accept them in `SendFollowUpOptions` so callers of `sendFollowUp` can re-supply them when the session was evicted.

- **Session pooling (`usePool`):** The pool path (if it exists in parallel code) is outside scope for this commit. Tools are per-session, not per-pool.

- **No changes to `sendWithStreaming` or `sendWithTimeout`:** These operate on an already-created session — tools are session-level config, not message-level.

- **Type reference:** Use `ISessionOptions['tools']` (or the `CustomTool` type directly once commit 001 imports it) for the `KeptAliveSession` and `SendFollowUpOptions` fields to keep types DRY and avoid a separate import.

## Tests

- **`copilot-sdk-service.test.ts`**: Add test "passes tools to createSession" — call `sendMessage({ tools: [mockTool], ... })`, assert that `createSession` was called with `sessionOptions` containing `tools: [mockTool]`.
- **`copilot-sdk-service-keep-alive.test.ts`**: Add test "stores tools on kept-alive session" — call `sendMessage({ tools: [mockTool], keepAlive: true })`, inspect `keptAliveSessions` entry has `tools`.
- **`copilot-sdk-service-keep-alive.test.ts`**: Add test "passes tools on resumeSession" — simulate expired session, call `sendFollowUp` with `tools: [mockTool]`, assert `resumeSession` was called with options including `tools`.
- **`copilot-sdk-service-keep-alive.test.ts`**: Add test "sendFollowUp reuses tools from kept-alive session without re-registration" — call `sendMessage` with keepAlive + tools, then `sendFollowUp` without tools, verify session.sendAndWait is called (tools persist on session).

## Acceptance Criteria

- [ ] `sendMessage({ tools: [...] })` passes tools array to `client.createSession()`
- [ ] `KeptAliveSession` stores the tools from the originating `sendMessage` call
- [ ] `SendFollowUpOptions` accepts an optional `tools` field
- [ ] `resumeKeptAliveSession()` passes tools to `client.resumeSession()` when provided
- [ ] `sendFollowUp` on an already-alive session works without re-supplying tools
- [ ] All existing tests pass (no regressions)
- [ ] New tests cover all four scenarios listed above

## Dependencies

- Depends on: 001 (adds `tools?: CustomTool[]` to `SendMessageOptions`, `ISessionOptions`, and exports `CustomTool` type)

## Assumed Prior State

`SendMessageOptions` has `tools?: CustomTool[]`. `ISessionOptions` has `tools?: CustomTool[]`. `CustomTool` type is defined and exported from `packages/pipeline-core/src/copilot-sdk-wrapper/types.ts`. The barrel re-exports `CustomTool`.
