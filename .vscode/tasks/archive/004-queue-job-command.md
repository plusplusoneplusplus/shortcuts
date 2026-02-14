---
status: pending
---

# Register Queue AI Job Command and Tree View Button

Add the command and UI entry point for queuing AI jobs.

## Changes Required

### `src/shortcuts/ai-service/ai-queue-commands.ts`
- Add new command `shortcuts.queue.addJob`:
  1. Instantiate `QueueJobDialogService` and call `showDialog()`
  2. On submit:
     - **Prompt mode**: Write freeform prompt to a temp `.prompt.md` file, queue as `follow-prompt` via `AIQueueService.queueTask()`
     - **Skill mode**: Use the selected skill's `.prompt.md` path, queue as `follow-prompt` with `additionalContext`
  3. On cancel: do nothing
  4. Show info notification on successful queue with task position

### `package.json`
- Register command: `shortcuts.queue.addJob` with title "Queue AI Job"
- Add inline action to `clarificationProcessesView/title` navigation group with `$(add)` icon
- Set `when` clause: `workspaceShortcuts.aiService.enabled`

### `src/extension.ts`
- Wire up dialog service if needed (check if command registration is self-contained in ai-queue-commands)

## Dependencies

- Depends on: queue-dialog-service, queue-dialog-html, skill-discovery
