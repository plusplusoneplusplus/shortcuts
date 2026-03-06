# Context: Follow-Up Reuses Existing Process

## User Story
When sending a follow-up message on a completed chat in the queue tab, the system creates a new dummy entry instead of bumping the completed chat back into the active queue. The user wants follow-ups to reuse the original process entry — no duplicates.

## Goal
Fix the queue executor bridge so `chat-followup` tasks skip ghost process creation and delegate directly to `executeFollowUp()` on the original process, with proper cancellation handling.

## Commit Sequence
1. Short-circuit `execute()` for chat-followup tasks
2. Add cancellation guard for follow-up execution
3. Add tests for follow-up queue reuse path

## Key Decisions
- Fix is isolated to `execute()` in `queue-executor-bridge.ts` — `executeFollowUp()`, `api-handler.ts`, and SPA are already correct
- `executeFollowUp()` is fully self-contained (completion, streaming, cleanup) — no changes needed
- Cancellation must revert original process from `running` → `completed` since `api-handler` already set it to `running` before enqueueing
- Tests go in a dedicated file to avoid bloating the 252KB existing test file

## Conventions
- Type guards (`isChatFollowUpPayload`) for payload discrimination
- `task.processId` links queue tasks to process store entries
- `try/catch/finally` with `cleanupTempDir` for image temp dir lifecycle
- `vi.fn()` mocks backed by in-memory Maps for store testing
