# Enable AI Process Cancellation for Task Creation

## Problem Statement

The task creation AI process (in `ai-task-commands.ts`) shows a cancellable progress dialog but cancellation doesn't actually work. When a user clicks "Cancel", the code only checks `token.isCancellationRequested` **after** the AI call completes - it doesn't abort the running AI session.

## Root Cause Analysis

In `createTaskWithAI()` and `createTaskFromFeature()`:

1. `withProgress()` is called with `cancellable: true`
2. An `aiInvoker` is created and invoked synchronously
3. Only **after** the AI call returns does the code check `token.isCancellationRequested`
4. There's no mechanism to:
   - Pass the cancellation token to the AI invoker
   - Abort the SDK session when cancellation is requested
   - Listen for cancellation events during the AI call

## Proposed Solution

### Phase 1: Extend AI Invoker to Support Cancellation

**File:** `src/shortcuts/ai-service/ai-invoker-factory.ts`

- [ ] Add `cancellationToken?: vscode.CancellationToken` to `AIInvokerFactoryOptions`
- [ ] In the SDK path: use `AbortController` and wire it to the cancellation token
- [ ] Return the SDK session ID so it can be aborted externally
- [ ] Add cancellation event listener that aborts the session when token fires

### Phase 2: Update Task Commands to Use Cancellation

**File:** `src/shortcuts/tasks-viewer/ai-task-commands.ts`

- [ ] Pass the `CancellationToken` from `withProgress()` to the AI invoker
- [ ] Handle early return when cancellation is detected during the call
- [ ] Show "Cancelled" notification instead of error when user cancels

### Phase 3: SDK Service Abort Support (if not already present)

**File:** `packages/pipeline-core/src/ai/copilot-sdk-service.ts`

- [ ] Verify `abortSession(sessionId)` method exists and works
- [ ] Ensure AbortController integration in `sendMessage()`
- [ ] Test that abort properly terminates the underlying request

## Implementation Details

### AIInvokerFactoryOptions Changes

```typescript
export interface AIInvokerFactoryOptions {
    // ... existing fields ...
    
    /**
     * VSCode cancellation token for aborting the request.
     * When cancelled, the SDK session will be aborted.
     */
    cancellationToken?: vscode.CancellationToken;
}
```

### AI Invoker Implementation

```typescript
// In createAIInvoker():
if (cancellationToken) {
    // Create AbortController for SDK
    const abortController = new AbortController();
    
    // Listen for cancellation
    cancellationToken.onCancellationRequested(() => {
        abortController.abort();
        if (sessionId) {
            sdkService.abortSession(sessionId).catch(() => {});
        }
    });
    
    // Check if already cancelled before starting
    if (cancellationToken.isCancellationRequested) {
        return { success: false, error: 'Cancelled', cancelled: true };
    }
}
```

### Task Command Changes

```typescript
const aiInvoker = createAIInvoker({
    usePool: false,
    workingDirectory,
    featureName: 'Task Creation',
    clipboardFallback: false,
    approvePermissions: true,
    processManager,
    cancellationToken: token  // Pass the token from withProgress
});
```

## Test Scenarios

- [ ] Cancel during AI processing → session aborted, "Cancelled" shown
- [ ] Cancel before AI starts → no AI call made
- [ ] Complete without cancel → normal success flow unchanged
- [ ] SDK unavailable fallback to CLI → CLI should also respect cancellation
- [ ] Multiple rapid cancel/retry → no race conditions

## Files to Modify

1. `src/shortcuts/ai-service/ai-invoker-factory.ts` - Add cancellation support
2. `src/shortcuts/tasks-viewer/ai-task-commands.ts` - Pass cancellation token
3. `packages/pipeline-core/src/ai/copilot-sdk-service.ts` - Verify abort support
4. `src/test/suite/ai-task-commands.test.ts` - Add cancellation tests

## Backward Compatibility

- Cancellation token is optional; existing callers unchanged
- No breaking changes to public interfaces
- Graceful degradation if abort fails (just waits for completion)

## Notes

- The CLI backend (`invokeCopilotCLI`) spawns a child process that could also be killed on cancellation
- Consider adding `cancelled: boolean` to `AIInvokerResult` for callers to distinguish cancel from error
