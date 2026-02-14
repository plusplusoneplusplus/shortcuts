# Plan: Allow Cancelling Task Creation AI Process

## Problem Statement

When using "Create Task with AI" or "Create Task from Feature" commands, the progress dialog shows a cancel button (`cancellable: true`), but clicking it has no effect. The AI process continues running until completion.

**Current Behavior:**
- `vscode.window.withProgress({ cancellable: true })` is used
- `token.isCancellationRequested` is checked **after** `aiInvoker(prompt)` completes
- The AI invoker doesn't receive the cancellation token, so there's no way to abort mid-execution

**Root Cause:**
The `createAIInvoker` function in `ai-invoker-factory.ts` doesn't support passing a `CancellationToken` to abort the underlying SDK session.

## Solution Overview

Enable cancellation by:
1. Extending `AIInvokerFactoryOptions` to accept a `CancellationToken`
2. Using the SDK's `abortSession()` method when cancellation is requested
3. Registering a cancellation listener that aborts the session mid-execution

## Implementation Tasks

### ~~Task 1: Extend `AIInvokerFactoryOptions` Interface~~ ✅
**File:** `src/shortcuts/ai-service/ai-invoker-factory.ts`

### ~~Task 2: Implement Cancellation Logic in `createAIInvoker`~~ ✅
**File:** `src/shortcuts/ai-service/ai-invoker-factory.ts`

### ~~Task 3: Update `ai-task-commands.ts` to Pass Cancellation Token~~ ✅
**File:** `src/shortcuts/tasks-viewer/ai-task-commands.ts`

### ~~Task 4: Handle Cancellation Result Gracefully~~ ✅
**File:** `src/shortcuts/tasks-viewer/ai-task-commands.ts`

### ~~Task 5: Update Process Manager on Cancellation~~ ✅
**File:** `src/shortcuts/ai-service/ai-invoker-factory.ts`

## Commits
- `a65df6fd` - feat(ai-service): add cancellation support for AI task creation
- `c6bd8734` - test(ai-invoker): add comprehensive cancellation token tests

## Testing

### Unit Tests (14 new tests in `ai-invoker-factory.test.ts`)
- CancellationToken option acceptance in factory options
- Invoker creation with cancellation token
- Backward compatibility without cancellation token
- Token state (initial, after cancel)
- Cancellation callback invocation
- Process manager cancelProcess behavior
- Process counts tracking cancelled processes
- Multiple listener handling
- Listener disposal preventing callbacks

### Manual Testing
1. Start "Create Task with AI" command
2. While AI is processing, click Cancel button
3. Verify:
   - AI process stops immediately
   - "Task creation cancelled" message appears
   - No task file is created
   - Process shows "cancelled" status in AI Processes panel

## Files Modified

1. `src/shortcuts/ai-service/ai-invoker-factory.ts` - Add cancellation support
2. `src/shortcuts/tasks-viewer/ai-task-commands.ts` - Pass token to invoker
3. `src/test/suite/ai-invoker-factory.test.ts` - Add cancellation tests

## Risk Assessment

**Low Risk:**
- Changes are additive (new optional parameter)
- Existing behavior unchanged when no token provided
- SDK already has `abortSession` support

**Edge Cases Handled:**
- ✅ Token cancelled before session ID is available (early return)
- ✅ Session may complete before abort is processed (graceful handling)
- ⚠️ CLI backend doesn't support cancellation (documented limitation)

## Estimated Effort

- Implementation: 1-2 hours
- Testing: 30 minutes
- Total: ~2 hours

## Dependencies

- `@plusplusoneplusplus/pipeline-core` already exports `getCopilotSDKService` and `abortSession` method
- VS Code `CancellationToken` API
