# Fix: Prevent Real Copilot SDK Invocations in Tests

## Problem

Multiple test files under `packages/coc/test/server/` call `createExecutionServer()` **without** injecting a mock `aiService`. This causes `CLITaskExecutor` to fall back to `getCopilotSDKService()` — the **real** Copilot SDK — which sends actual prompts (e.g., `"test prompt"`) to the live API.

Additionally, 3 route handlers call `getCopilotSDKService()` directly, bypassing any injected mock entirely.

**Evidence:** The string `"test prompt"` was found in `copilot --resume` session history, confirming real API calls.

---

## Root Causes

### RC1: Missing `aiService` injection in tests
`createExecutionServer()` accepts an optional `aiService` parameter. When omitted, the internal `CLITaskExecutor` falls back to the real SDK:
```typescript
// queue-executor-bridge.ts:118
this.aiService = options.aiService ?? getCopilotSDKService();
```

### RC2: Route handlers bypass DI
Three handler files call `getCopilotSDKService()` directly instead of using the injected service:
- `task-generation-handler.ts:153,242`
- `pipelines-handler.ts:411`

### RC3: No global safety net
No vitest `setupFiles` mock exists to catch accidental real SDK calls.

---

## Fix Strategy (3 layers of defense)

### Layer 1: Global Safety Net (vitest setup file)
Create a vitest setup file that auto-mocks `getCopilotSDKService()` globally for ALL coc tests. This ensures any missed injection points throw instead of calling the real API.

### Layer 2: Route Handler DI Refactor
Refactor the 3 leaking route handlers to accept `aiService` via their options/context instead of calling `getCopilotSDKService()` directly.

### Layer 3: Test File Fixes
Inject mock `aiService` into the test files that create real servers with queue execution.

---

## Todos

### 1. Add vitest global setup to mock SDK (`global-sdk-mock`)
- Create `packages/coc/test/setup.ts`
- Mock `getCopilotSDKService` from `@plusplusoneplusplus/pipeline-core` to return a stub that **throws** if `sendMessage` is called
- Register in `packages/coc/vitest.config.ts` as `setupFiles`
- This is the safety net — any test that accidentally calls the real SDK will fail loudly

### 2. Refactor `task-generation-handler.ts` to accept injected `aiService` (`refactor-task-gen-handler`)
- Modify `registerTaskGenerationRoutes()` to accept `aiService` in its options
- Replace direct `getCopilotSDKService()` calls (lines 153, 242) with the injected service
- Update `createExecutionServer()` in `index.ts` to pass `aiService` to this handler

### 3. Refactor `pipelines-handler.ts` to accept injected `aiService` (`refactor-pipelines-handler`)
- Modify `registerPipelineWriteRoutes()` to accept `aiService` in its options
- Replace direct `getCopilotSDKService()` call (line 411) with the injected service
- Update `createExecutionServer()` in `index.ts` to pass `aiService` to this handler

### 4. Fix `per-repo-queue-integration.test.ts` (`fix-per-repo-integration`)
- Import `createMockSDKService` from test helpers
- Pass `aiService: mockService.service` to all 3 `createExecutionServer()` calls (lines 142, 415, 1061)
- Depends on: `global-sdk-mock`

### 5. Fix `integration.test.ts` (`fix-integration-test`)
- Import `createMockSDKService` from test helpers
- Pass `aiService: mockService.service` to all `createExecutionServer()` calls (lines 111, 116, 714, 751, 766, 784)
- Depends on: `global-sdk-mock`

### 6. Audit & fix remaining server tests (`fix-remaining-server-tests`)
- These tests don't execute queue tasks, but should still pass `aiService` for safety:
  - `admin-handler.test.ts`
  - `bulk-queue.test.ts`
  - `file-preview-api.test.ts`
  - `per-repo-pause-integration.test.ts`
  - `per-repo-websocket.test.ts`
  - `pipelines-generate-handler.test.ts`
  - `pipelines-handler.test.ts`
  - `preferences-handler.test.ts`
  - `prompt-handler.test.ts`
  - `queue-handler.test.ts`
  - `queue-resolved-prompt.test.ts`
  - `schedule-handler.test.ts`
  - `task-comments-*.test.ts`
  - `task-generation-handler.test.ts`
  - `task-generation-queue.test.ts`
  - `tasks-handler*.test.ts`
  - `websocket.test.ts`
- For each: add `aiService` to `createExecutionServer()` call
- Depends on: `global-sdk-mock`

### 7. Verify all tests pass (`verify-tests`)
- Run `cd packages/coc && npm run test:run` to verify no regressions
- Depends on: all above todos

---

## Priority Order

1. **Todo 1** (global mock) — immediate safety net, catches all future regressions
2. **Todos 4-5** (critical integration tests) — stops the active real SDK calls
3. **Todos 2-3** (handler refactor) — closes the DI gap in production code
4. **Todo 6** (remaining tests) — defense in depth
5. **Todo 7** (verify) — final validation

---

## Notes

- The E2E tests (Playwright) are already safe — `server-fixture.ts` injects mock AI
- `api-handler.test.ts` already passes `aiService` — use it as a reference pattern
- The global mock should **throw** on `sendMessage`, not silently succeed, so leaked calls are immediately caught
- `packages/coc/test/helpers/mock-sdk-service.ts` already has `createMockSDKService()` — reuse it
