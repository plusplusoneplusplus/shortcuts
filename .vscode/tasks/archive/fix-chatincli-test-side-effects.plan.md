# Fix: chatInCLI test spawns real Windows Terminal

## Problem

Commit `f09a7e85` added `chatInCLI` tests in `editor-message-router.test.ts` that call
`router.dispatch({ type: 'chatInCLI' }, ctx)`. This invokes `handleChatInCLI()` which calls
`getInteractiveSessionManager()` — a **real singleton** — which creates a real
`ExternalTerminalLauncher` and actually spawns `wt.exe` on Windows, producing error
`0x8007010b` when the temp file path contains an 8.3 short name.

The `sendToCLIInteractive` handler has the same problem but has no tests yet.

## Approach

Mock the `InteractiveSessionManager` singleton before the `chatInCLI` tests run so no real
terminal process is spawned. Use the existing `resetInteractiveSessionManager()` in teardown
for cleanup.

Since the singleton getter `getInteractiveSessionManager()` creates a real manager if none
exists, we need to either:

- **(A) Pre-set the singleton** with a mock before the test runs (requires a setter or
  direct module-level injection), OR
- **(B) Reset + stub** — import the module and replace the default manager with a mock.

Option (A) is cleanest. A `setInteractiveSessionManager(mock)` utility (analogous to
`resetInteractiveSessionManager`) keeps the pattern consistent.

## Todos

1. [x] **Add `setInteractiveSessionManager()` export** in
   `src/shortcuts/ai-service/interactive-session-manager.ts` — a one-liner that sets
   `defaultManager` to a provided instance. Re-export from the barrel `index.ts`.

2. [x] **Update `editor-message-router.test.ts`** — in the `setup()` hook (or a nested suite),
   inject a mock `InteractiveSessionManager` (constructed with a mock launcher like the
   pattern in `interactive-session-manager.test.ts`). In `teardown()`, call
   `resetInteractiveSessionManager()` to clean up.

3. [x] **Verify** — run `npm run test` and confirm the `chatInCLI` tests pass without spawning
   a real terminal.
