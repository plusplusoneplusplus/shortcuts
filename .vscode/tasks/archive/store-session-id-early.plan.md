# Store SDK Session ID Early in Process Store

## Problem
When a CoC AI task runs, the `sdkSessionId` is only written to the process store **after the entire task completes** (`queue-executor-bridge.ts` ~L289). This means running processes have no session ID info, making it impossible to correlate a running process with its Copilot session.

## Approach
Add an `onSessionCreated` callback to `SendMessageOptions` so callers can react the moment a session is created. The bridge will use this callback to immediately persist the session ID to the process store.

## Changes

### 1. Add `onSessionCreated` callback to `SendMessageOptions`
- **File:** `packages/pipeline-core/src/copilot-sdk-wrapper/types.ts`
- Add `onSessionCreated?: (sessionId: string) => void` to `SendMessageOptions`

### 2. Invoke the callback in `CopilotSDKService.sendMessage()`
- **File:** `packages/pipeline-core/src/copilot-sdk-wrapper/copilot-sdk-service.ts`
- After `session = await client.createSession(sessionOptions)` (~L642), call `options.onSessionCreated?.(session.sessionId)`

### 3. Pass the callback from `executeWithAI()`
- **File:** `packages/coc/src/server/queue-executor-bridge.ts`
- In `executeWithAI()`, pass `onSessionCreated` to `sendMessage()` that calls `this.store.updateProcess(processId, { sdkSessionId: sessionId })`
- The `processId` is already available in scope (created at the top of `execute()`)
- Need to thread `processId` into `executeWithAI()` if not already available there

### 4. Tests
- Add a unit test in `copilot-sdk-service.test.ts` verifying `onSessionCreated` is called with the session ID
- Add a unit test in `queue-executor-bridge.test.ts` verifying `sdkSessionId` is written to the store before the task completes
