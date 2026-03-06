# Context: Chat Conversation Streaming Test Coverage

## User Story
The chat conversation streaming had no end-to-end or edge-case test coverage for recovery scenarios: what happens when a user refreshes the page while a chat is streaming, or jumps between active chat sessions. The ask was to draft a detailed implementation plan to fix all identified gaps, using mock AI throughout (no real AI calls in tests), and to run tests multiple times before each commit to reduce flakiness.

## Goal
Add comprehensive test coverage for the SSE streaming layer and conversation session management, covering client disconnect cleanup, reconnect-after-refresh snapshot replay, concurrent chat session isolation, and mock-AI cold resume edge cases.

## Commit Sequence
1. ConversationSessionManager – streaming chunks delivery & timer safety
2. SSE handler – mid-stream client disconnect cleanup
3. SSE handler – process-not-found edge case
4. coc SSE replay – parity with coc-server (port tests 7–10)
5. SSE reconnect-after-refresh integration tests
6. SSE concurrent sessions & chat-switch isolation
7. resume-chat – mock-AI cold resume & concurrent resume edge cases

## Key Decisions
- All tests use mock AI: `vi.fn().mockImplementation` for `AskAIFunction`; `MockProcessStore` with captured callbacks for SSE tests; `createMockSDKService` for executor-layer tests. No real AI calls, no `FileProcessStore` in new tests.
- `vi.waitFor()` replaces all `setTimeout` delays — deterministic async without wall-clock dependency.
- `req.emit('close')` simulates client disconnect; `outputCallback` is set to `undefined` by the unsubscribe return function, making post-close calls safely no-op via optional chaining.
- Two-store isolation for concurrent session tests (one `MockProcessStore` per process) to avoid `onProcessOutput` override conflicts.
- Each commit's test file must be run 3 consecutive times before merging to catch non-determinism.
- If `vi.mock` at module level conflicts in `resume-chat.test.ts`, add a new `resume-chat-mock.test.ts` file instead of modifying the existing one.

## Conventions
- Test files in `packages/coc-server/test/` import from `../src/` (local source); test files in `packages/coc/test/` import from `@plusplusoneplusplus/coc-server` (published package)
- Helpers shared: `createMockReq`, `createMockRes`, `makeTurn`, `parseSSEFrames` — defined locally in each new test file, copied from `sse-replay.test.ts` pattern
- Process IDs in new tests use unique prefixes (`p-refresh`, `chat-A`, `seq-A`) to avoid map collisions across tests
- Plan files: `.vscode/tasks/streaming-test-coverage/chat-streaming-coverage/NNN-<slug>.md`
