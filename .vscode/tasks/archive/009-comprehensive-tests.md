---
status: pending
commit: 9 of 9
feature: ChatGPT-style Conversational UI for CoC Dashboard
package: pipeline-core, coc
depends_on: 001 through 008
---

# Commit 9: Comprehensive Tests for Conversational UI Feature

## Summary

Add tests across all layers of the conversational UI feature: data types in pipeline-core, SDK session keep-alive management, REST API follow-up endpoint, executor session tracking, and SPA client chat rendering. This is the final commit and locks down all behaviour introduced in commits 1–8.

## Motivation

Commits 1–8 introduced `ConversationTurn` types, SDK session keep-alive, a `POST /api/processes/:id/message` follow-up endpoint, executor session tracking, and a chat-bubble detail UI in the SPA. This commit adds comprehensive test coverage so regressions are caught immediately across all three platforms (macOS, Linux, Windows).

## Test Conventions

- **Framework:** Vitest (`describe` / `it` / `expect`) — both `packages/pipeline-core/vitest.config.ts` and `packages/coc/vitest.config.ts` use `globals: true`, `environment: 'node'`, 30 s timeout
- **Mocking:** `vi.mock()` / `vi.fn()` from Vitest (see `queue-executor-bridge.test.ts` for `getCopilotSDKService` mock pattern)
- **Process store mocks:** In-memory `Map<string, AIProcess>` with `vi.fn()` for each method (see `createMockStore()` in `queue-executor-bridge.test.ts`)
- **HTTP tests:** Raw `http.request` helper returning `{ status, headers, body }`, `postJSON` helper (see `api-handler.test.ts`); real `FileProcessStore` with temp dirs; `createExecutionServer({ port: 0 })` for OS-assigned ports
- **SPA tests:** DOM string matching on `generateDashboardHtml()` output and esbuild-bundled `bundle.js` content (see `spa.test.ts`)
- **File-system tests:** `fs.mkdtempSync` + `os.tmpdir()` for temp dirs; clean up in `afterEach`
- **Style:** JSDoc file header, `// ====` section separators, helper factories for test data

## Files to Create

### 1. `packages/pipeline-core/test/conversation-turn-types.test.ts` (new)

Tests for the `ConversationTurn` type and its serialization round-trip through `serializeProcess` / `deserializeProcess`.

### 2. `packages/pipeline-core/test/sdk-session-keep-alive.test.ts` (new)

Tests for SDK session keep-alive lifecycle: preserving sessions, follow-up messaging, streaming follow-ups, explicit destroy, idle timeout cleanup, and error handling for expired sessions.

### 3. `packages/coc/test/server/follow-up-api.test.ts` (new)

Tests for the `POST /api/processes/:id/message` REST endpoint: success path, 404/400/409/410 error paths, and turn appending.

### 4. `packages/coc/test/server/executor-session-tracking.test.ts` (new)

Tests for session tracking in the executor bridge: `sdkSessionId` storage, initial `conversationTurns` population, follow-up turn appending, and streaming chunk forwarding.

### 5. `packages/coc/test/server/spa-conversation.test.ts` (new)

Tests for the chat rendering in the SPA: chat message HTML structure, role-based CSS classes, streaming indicator, input bar placeholder states, backward compatibility with no turns, and copy-on-hover button.

## Detailed Test Plan

### 1. ConversationTurn Types — `packages/pipeline-core/test/conversation-turn-types.test.ts`

```
describe('ConversationTurn type')
  it('should have role and content fields')
  it('should accept optional timestamp field')

describe('serializeProcess with conversationTurns')
  it('should serialize a process with empty conversationTurns array')
  it('should serialize a process with a single turn')
  it('should serialize a process with multiple turns preserving order')
  it('should round-trip through serialize then deserialize')

describe('deserializeProcess with conversationTurns')
  it('should deserialize when conversationTurns is undefined (legacy data)')
  it('should deserialize when conversationTurns is null (edge case)')
  it('should restore turn timestamps as Date objects if present')

describe('edge cases')
  it('should handle turns with empty content string')
  it('should handle turns with very long content')
```

**Approach:**
- Import `serializeProcess`, `deserializeProcess` from `../src/index`
- Build `AIProcess` objects with `conversationTurns` field populated
- Assert round-trip identity: `deserializeProcess(serializeProcess(proc))` matches original (with Date/string coercion for timestamps)
- Test `undefined` / `null` conversationTurns to verify backward compatibility with pre-conversation data

**Estimated test count:** ~10

### 2. SDK Session Keep-Alive — `packages/pipeline-core/test/sdk-session-keep-alive.test.ts`

```
describe('keepAlive session management')
  it('should preserve session when keepAlive=true (session not destroyed after sendMessage)')
  it('should destroy session normally when keepAlive is false/undefined')

describe('sendFollowUp')
  it('should find and reuse an existing session by sessionId')
  it('should send the follow-up prompt on the existing session')
  it('should return the AI response from the follow-up')
  it('should support streaming mode on follow-up')
  it('should call onStreamChunk for each chunk in streaming follow-up')

describe('destroySession')
  it('should clean up a kept-alive session by sessionId')
  it('should be a no-op for an unknown sessionId')

describe('idle timeout')
  it('should clean up session after idle timeout expires')
  it('should reset idle timer on follow-up activity')

describe('error handling')
  it('should return error for sendFollowUp on expired/destroyed session')
  it('should return error for sendFollowUp on unknown sessionId')
```

**Approach:**
- Mock the underlying Copilot SDK session creation using `vi.mock()` (same pattern as `queue-executor-bridge.test.ts` mocking `getCopilotSDKService`)
- Mock `sendMessage` to return `{ success: true, response: '...', sessionId: 'sess-1' }` and track whether sessions are destroyed
- For idle timeout tests, use `vi.useFakeTimers()` to advance time past the idle threshold
- For streaming tests, mock `sendMessage` with `streaming: true` to invoke `onStreamChunk` callback

**Estimated test count:** ~13

### 3. Follow-Up API — `packages/coc/test/server/follow-up-api.test.ts`

```
describe('POST /api/processes/:id/message')
  describe('success path')
    it('should return 200 with assistant response for valid follow-up')
    it('should append user turn and assistant turn to conversationTurns')
    it('should persist updated process in store')

  describe('error: unknown process')
    it('should return 404 when process id does not exist')

  describe('error: missing content')
    it('should return 400 when request body has no content field')
    it('should return 400 when content is empty string')

  describe('error: no session')
    it('should return 409 when process has no sdkSessionId')
    it('should return 410 when sdkSessionId references expired/destroyed session')

  describe('conversation history')
    it('should accumulate turns across multiple follow-ups')
    it('should include correct role and timestamp on each turn')
```

**Approach:**
- Use same server setup pattern as `api-handler.test.ts`: `FileProcessStore` with temp dir, `createExecutionServer({ port: 0 })`, `request()` / `postJSON()` helpers
- Seed a process via `POST /api/processes` with `sdkSessionId` set
- Mock the SDK follow-up call (via `vi.mock` of `getCopilotSDKService`) to return a canned response
- For 409/410 tests: create process without `sdkSessionId`, or with an `sdkSessionId` that the mock rejects
- Parse response JSON and assert `conversationTurns` array length and content
- Clean up temp dir and server in `afterEach`

**Estimated test count:** ~10

### 4. Executor Session Tracking — `packages/coc/test/server/executor-session-tracking.test.ts`

```
describe('executor session tracking')
  describe('initial execution')
    it('should store sdkSessionId on process after execution completes')
    it('should populate initial conversationTurns with user prompt and assistant response')
    it('should set backend field on the tracked process')

  describe('follow-up execution')
    it('should append new user turn to conversationTurns on follow-up')
    it('should append assistant response turn after follow-up completes')
    it('should preserve existing turns when appending')

  describe('streaming during follow-up')
    it('should forward streaming chunks via emitProcessOutput')
    it('should accumulate streamed content into final assistant turn')

  describe('error during follow-up')
    it('should mark process as failed if follow-up sendMessage rejects')
    it('should still append user turn even if assistant response fails')
```

**Approach:**
- Follow `queue-executor-bridge.test.ts` pattern exactly:
  - Mock `getCopilotSDKService` via `vi.mock('@plusplusoneplusplus/pipeline-core', ...)`
  - Use `createMockStore()` for the in-memory process store
  - Create `CLITaskExecutor` and execute tasks
- For session tracking: after execution, inspect `store.updateProcess` calls for `sdkSessionId` and `conversationTurns` fields
- For streaming: configure `mockSendMessage` to invoke `onStreamChunk` callback with test chunks, then verify `store.emitProcessOutput` was called for each chunk
- For follow-up: execute an initial task, then simulate a follow-up by calling the executor's follow-up method with the same session ID

**Estimated test count:** ~10

### 5. SPA Conversation Rendering — `packages/coc/test/server/spa-conversation.test.ts`

```
describe('chat message rendering')
  it('should render user message with user role class')
  it('should render assistant message with assistant role class')
  it('should render multiple turns in chronological order')
  it('should escape HTML in message content')

describe('streaming indicator')
  it('should show streaming indicator on active assistant bubble when status is running')
  it('should not show streaming indicator on completed process')

describe('input bar')
  it('should render input bar with send button')
  it('should show "Type a follow-up…" placeholder when process is completed')
  it('should show disabled state when process has no sdkSessionId')

describe('backward compatibility')
  it('should render legacy detail view when process has no conversationTurns')
  it('should render legacy detail view when conversationTurns is empty array')

describe('copy button')
  it('should include copy button element in assistant message bubble')

describe('bundled client JS')
  it('should contain renderChatMessage function in bundle')
  it('should contain chat-bubble CSS class in bundle CSS')
```

**Approach:**
- Follow `spa.test.ts` pattern: import `generateDashboardHtml` for HTML structure assertions, read `bundle.js` / `bundle.css` for client code assertions
- For chat rendering tests: search for expected CSS classes (`chat-bubble`, `chat-user`, `chat-assistant`, `chat-streaming`, `chat-input-bar`) and HTML structure patterns in the bundled output
- For backward compatibility: verify that the detail rendering code path still works when `conversationTurns` is absent (the `bundle.js` should contain the conditional logic)
- For copy button: verify `bundle.js` contains copy-to-clipboard logic bound to chat bubbles

**Estimated test count:** ~13

## Run & Verify

```bash
# pipeline-core tests
cd packages/pipeline-core && npx vitest run

# coc tests
cd packages/coc && npx vitest run
```

All new and existing tests must pass. No changes to production source files in this commit.

## Estimated Total Test Count

~56 new test cases across 5 files:

| File | Count |
|------|-------|
| `conversation-turn-types.test.ts` | ~10 |
| `sdk-session-keep-alive.test.ts` | ~13 |
| `follow-up-api.test.ts` | ~10 |
| `executor-session-tracking.test.ts` | ~10 |
| `spa-conversation.test.ts` | ~13 |

## Acceptance Criteria

- All new tests pass on macOS, Linux, and Windows
- No existing tests broken (full `npx vitest run` green in both packages)
- Coverage for happy path and error paths in every test file
- Mocking patterns consistent with existing test files (no new test dependencies)
