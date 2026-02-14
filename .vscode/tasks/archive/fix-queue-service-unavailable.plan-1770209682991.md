# Fix "Queue service not available" Error in Markdown Review Editor

## Description
When using the "Follow Prompt" action with "Queue Mode" in the Markdown Review Editor, the user receives a "Queue service not available" error message. Investigation reveals that the `AIQueueService` is not being initialized during the extension activation process, leading `getAIQueueService()` to return `undefined`.

## Root Cause Analysis
The `AIQueueService` singleton relies on `initializeAIQueueService()` being called to instantiate the service. Currently, this initialization function (along with command registration and status bar creation) is missing from `src/extension.ts`, meaning the queue system is never started.

## Acceptance Criteria
- [x] The "Queue service not available" error no longer occurs when invoking AI actions in Queue Mode.
- [x] `AIQueueService` is successfully initialized upon extension activation.
- [x] Queue-related commands (e.g., viewing the queue, clearing the queue) are registered and available in the command palette.
- [x] The AI Queue status bar item is created and visible when appropriate.
- [x] All new components are properly disposed of when the extension is deactivated.

## Implementation Plan

### 1. Update Extension Activation
- [x] Modify `src/extension.ts` to import:
  - `initializeAIQueueService`
  - `registerQueueCommands`
  - `createQueueStatusBarItem`
  - From `./shortcuts/ai-service`
- [x] In the `activate` function:
  - Initialize the queue service using the existing `AIProcessManager`.
  - Register the queue commands.
  - Create the queue status bar item.
  - Add all created disposables to `context.subscriptions`.

### 2. Verification
- [x] Verify "Follow Prompt" in "Queue Mode" works without error.
- [x] Verify "Queue service not available" message is gone.
- [x] Check that queue commands appear in the command palette.
- [x] Verify the status bar item appears.

## Notes
- The `AIQueueService` depends on `AIProcessManager`, so it must be initialized *after* `AIProcessManager` is created.
- Ensure that the service is properly disposed of to prevent memory leaks or hanging processes.
