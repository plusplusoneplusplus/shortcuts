# Use PowerShell Instead of CMD on Windows for Resume / New Chat

## Problem

When the user clicks **Resume** or **Open New Chat** in the CoC dashboard on Windows,
the feature currently launches `cmd.exe` as the interactive terminal.
Users who work in PowerShell expect the session to open in PowerShell instead.

Affected code: `packages/coc/src/server/process-resume-handler.ts`
- `launchResumeCommandInTerminal` – line 160-172 (win32 branch)
- `launchFreshChatInTerminal` – line 251-255 (win32 branch)

Both currently spawn:
```
cmd.exe /c start "" /D <workingDir> cmd.exe /k copilot --yolo [--resume <id>]
```

The goal is to spawn PowerShell instead:
```
cmd.exe /c start "" /D <workingDir> powershell.exe -NoExit -Command "copilot --yolo [--resume <id>]"
```

---

## Acceptance Criteria

1. On Windows, clicking **Resume** opens a **PowerShell** window running `copilot --yolo --resume <sessionId>` in the correct working directory.
2. On Windows, clicking **Open New Chat** opens a **PowerShell** window running `copilot --yolo` in the correct working directory.
3. The returned `terminal` field in `LaunchResumeResult` reflects `'powershell'` instead of `'cmd'`.
4. All existing unit tests for `process-resume-handler.ts` continue to pass; new tests cover the PowerShell paths.
5. macOS and Linux behaviour is **unchanged**.
6. `buildResumeCommand` / `buildFreshChatCommand` still return a correct human-readable command string for display purposes (can stay as the `cd && copilot` form or be updated to PS syntax — choose one and keep it consistent).

---

## Subtasks

### 1. Update `launchResumeCommandInTerminal` (win32 branch)
- Replace inner `cmd.exe /k <cmd>` with `powershell.exe -NoExit -Command "<cmd>"`.
- Use `start "" /D <workingDir> powershell.exe -NoExit -Command copilot --yolo --resume <sessionId>`.
- Update `terminal` return value to `'powershell'`.

### 2. Update `launchFreshChatInTerminal` (win32 branch)
- Same shell swap as above for the fresh-chat path.

### 3. (Optional) Update `buildResumeCommand` / `buildFreshChatCommand` for win32
- Optionally change the display string to use PowerShell syntax (`copilot --yolo --resume <id>`) instead of the `cd /d && ...` form, since PowerShell handles the working directory via `/D` in the `start` invocation.

### 4. Update / add unit tests
- File: `packages/coc/src/server/__tests__/process-resume-handler.test.ts` (or equivalent).
- Assert that on `win32` the spawned process is `cmd.exe` with args containing `powershell.exe -NoExit`.
- Assert `terminal === 'powershell'` in the result.

---

## Notes

- `powershell.exe` is available on all Windows versions that CoC supports; no version guard needed.
- `windowsVerbatimArguments: true` must be kept so Node.js does not double-escape the quoted path in the `start /D` argument.
- Quoting: PowerShell's `-Command` accepts a simple unquoted command string when there are no special characters; use `-Command "copilot --yolo --resume '${sessionId}'"` if session IDs can contain spaces.
- If Windows Terminal (`wt`) is desired in future, that is a separate enhancement.
- The `external-terminal-launcher.ts` utility in `pipeline-core` already has PowerShell support — it is **not** used by the resume/chat paths and does not need to change.
