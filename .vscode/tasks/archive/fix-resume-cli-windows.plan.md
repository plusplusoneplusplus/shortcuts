# Fix "Resume CLI" Button Not Working on Windows

## Problem

The "Resume CLI" button in the CoC dashboard (Queue and Processes views) silently fails on Windows. Clicking it reports "success" but the new terminal window either doesn't open or opens with only a `cd /d` — the `copilot --yolo --resume` part never executes.

## Root Cause

In `packages/coc/src/server/process-resume-handler.ts`, the Windows branch at line 161 spawns:

```js
spawnDetached('cmd.exe', ['/c', 'start', '', 'cmd.exe', '/k', command]);
```

Where `command` = `cd /d "workDir" && copilot --yolo --resume "sessionId"`.

**Two compounding issues:**

1. **`&&` parsed at wrong level** — The outer `cmd.exe /c` interprets `&&` as its own command separator. So `start` only receives `cmd.exe /k cd /d "workDir"`, while `copilot --yolo --resume "sessionId"` silently runs (and fails) in the invisible parent process.

2. **Node.js argument escaping** — `spawn()` uses C-runtime escaping (`\"`) for arguments, but `cmd.exe` expects `""` for embedded quotes. This corrupts quoted paths/session IDs.

**Verified reproduction**: A test confirms the output file written by the `&&`-chained command never appears in the inner terminal, confirming the `&&` split at the outer cmd.exe level.

**Verified fix**: Using `start /D` to set the working directory (eliminating `&&`) plus `windowsVerbatimArguments: true` (preventing Node.js escaping) produces the correct command line and the inner terminal receives the full command.

## Approach

Refactor the Windows path in `launchResumeCommandInTerminal` to:
- Use `start "" /D "workDir" cmd.exe /k copilot --yolo --resume "sessionId"` — avoids `&&` entirely
- Pass `windowsVerbatimArguments: true` to `spawn()` — prevents Node.js from mangling quotes

Single-file change in `process-resume-handler.ts`. The `spawnDetached` helper needs an optional options parameter to pass through `windowsVerbatimArguments`.

## Todos

### 1. Update `spawnDetached` to accept extra spawn options
- **File**: `packages/coc/src/server/process-resume-handler.ts`
- Add optional `extraOptions` parameter to `spawnDetached()` that merges into spawn options
- This allows passing `windowsVerbatimArguments: true` for the Windows case

### 2. Fix Windows launch in `launchResumeCommandInTerminal`
- **File**: `packages/coc/src/server/process-resume-handler.ts`
- Replace the current `spawnDetached('cmd.exe', ['/c', 'start', '', 'cmd.exe', '/k', command])` with:
  ```js
  const resumeCmd = `copilot --yolo --resume ${quoteWindows(sessionId)}`;
  const startLine = `/c start "" /D ${quoteWindows(workingDirectory)} cmd.exe /k ${resumeCmd}`;
  await spawnDetached('cmd.exe', [startLine], { windowsVerbatimArguments: true });
  ```
- Keep the returned `command` string unchanged (it's for display, not execution)

### 3. Add Windows-specific unit test
- **File**: `packages/coc/test/server/process-resume-handler.test.ts`
- Add a test that verifies the Windows spawn path constructs the correct `start /D` command line
- May require exporting `buildResumeCommand` or testing via the launcher mock

### 4. Verify existing tests pass
- Run `npm run test:run` in `packages/coc/` to ensure no regressions

## Files Changed

| File | Change |
|------|--------|
| `packages/coc/src/server/process-resume-handler.ts` | Fix `spawnDetached` + Windows launch path |
| `packages/coc/test/server/process-resume-handler.test.ts` | Add Windows-specific test |
