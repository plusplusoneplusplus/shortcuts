# Plan: Include File Path in "Update Document" Prompt for Plain MD Files

## Problem

When a user right-clicks a plain `.md` file in the CoC Tasks tab and triggers "update document", the AI receives a prompt that does **not** include the target file path. As a result, the AI cannot determine which file it is supposed to update, leading to failed or misdirected updates.

## Root Cause

There is no `updateDocumentWithAI` command registered in `ai-task-commands.ts`. The existing AI commands focus only on **creating** task documents (`createWithAI`, `createFromFeature`). No command exists that reads the selected document item from the tree, extracts its file path, and constructs an update prompt with that path included.

## Proposed Approach

Add a new `tasksViewer.updateDocumentWithAI` command that:
1. Receives the right-clicked `TaskDocumentItem` (which carries `filePath`)
2. Reads the current file content
3. Shows a user input dialog for describing the desired update
4. Builds a prompt that explicitly states the target file path and includes the current content as context
5. Queues the AI task via the existing `AIQueueService`

## Tasks

### 1. Register new command `tasksViewer.updateDocumentWithAI`

**File:** `src/shortcuts/tasks-viewer/ai-task-commands.ts`

- Add a new method `registerUpdateDocumentWithAI(context)` on the `AITaskCommands` class (or standalone registration function, following the existing pattern).
- The command handler receives `item: TaskDocumentItem`.
- Show a quick-input for the user to describe what to change (label: "Describe the update").
- Call a new `buildUpdateDocumentPrompt(filePath, fileContent, userDescription)` helper.
- Queue via the existing AI queue mechanism.

### 2. Build the update prompt (include file path + content)

**File:** `src/shortcuts/tasks-viewer/ai-task-commands.ts`

Add `buildUpdateDocumentPrompt`:

```typescript
function buildUpdateDocumentPrompt(
  filePath: string,
  fileContent: string,
  userDescription: string
): string {
  return [
    `Update the following document based on the user's request.`,
    ``,
    `**File path (you MUST save changes to this exact file):** ${filePath}`,
    ``,
    `**User's request:** ${userDescription}`,
    ``,
    `**Current file content:**`,
    "```markdown",
    fileContent,
    "```",
    ``,
    `**IMPORTANT:** Save the updated content back to: ${filePath}`,
    `Do not create a new file. Modify only this file.`,
  ].join('\n');
}
```

### 3. Add command to `package.json` context menu

**File:** `package.json`

- Register the command under `contributes.commands`:
  ```json
  {
    "command": "tasksViewer.updateDocumentWithAI",
    "title": "Update Document with AI",
    "category": "Tasks"
  }
  ```
- Add a context menu entry under `view/item/context` for `taskDocument` items:
  ```json
  {
    "command": "tasksViewer.updateDocumentWithAI",
    "when": "view == tasksView && viewItem =~ /^taskDocument/",
    "group": "ai@1"
  }
  ```

### 4. Wire command registration

**File:** `src/shortcuts/tasks-viewer/index.ts` (or wherever commands are wired up)

- Call `registerUpdateDocumentWithAI(context)` alongside existing AI command registrations.

## Acceptance Criteria

- Right-clicking any plain `.md` document in the Tasks tree shows "Update Document with AI".
- After entering a description, the queued AI prompt contains the file path and current content.
- The AI saves changes to the correct file (no new file created).
- Existing create/from-feature commands are unaffected.

## Files to Change

| File | Change |
|------|--------|
| `src/shortcuts/tasks-viewer/ai-task-commands.ts` | Add `buildUpdateDocumentPrompt`, `registerUpdateDocumentWithAI` |
| `package.json` | Register command + context menu entry for `taskDocument` items |
| `src/shortcuts/tasks-viewer/index.ts` | Wire up the new command registration |
