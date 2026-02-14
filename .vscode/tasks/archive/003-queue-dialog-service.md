---
status: pending
---

# Queue Job Dialog Service

Create `src/shortcuts/ai-service/queue-job-dialog-service.ts` — a webview dialog service modeled after the existing `AITaskDialogService` pattern.

## Requirements

- Promise-based API: `showDialog()` returns `Promise<QueueJobDialogResult>`
- Single panel management (only one dialog open at a time)
- Two tabs: **Prompt** (freeform) and **Skill** (pick from discovered skills)
- Communicates via `postMessage` pattern (submit/cancel)
- Returns result object with: `mode`, `prompt`, `skillPath`, `additionalContext`, `model`, `priority`, `workingDirectory`
- Populates skill dropdown from workspace `.prompt.md` file discovery
- Populates model dropdown from extension settings

## Dependencies

- Needs `queue-job-dialog.ts` for HTML generation (queue-dialog-html task)
- Reuse existing `getPromptFiles()` and `getSkills()` from `src/shortcuts/shared/` (already exists, no new code needed)
