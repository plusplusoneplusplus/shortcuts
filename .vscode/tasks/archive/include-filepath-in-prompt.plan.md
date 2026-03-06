# Include File Path in Update Document Server Prompt

## Problem

When "✨ Update Document" is clicked, a `custom` task is enqueued with:
- `payload.data.prompt` — the user-editable text (currently references only `taskName`, e.g. `"add-retry-logic"`)
- `payload.data.planFilePath` — the full absolute path (e.g. `/project/.vscode/tasks/coc/add-retry-logic.plan.md`)
- `payload.data.workingDirectory`

In `queue-executor-bridge.ts`, the `custom` task handler returns `data.prompt` verbatim — it does **not** use `planFilePath`. The AI receives only the ambiguous display name, not the actual file path, so it cannot reliably locate or update the file.

## Approach

Two-part fix:

### 1. Server: enrich `custom` prompt when `planFilePath` is present

In `queue-executor-bridge.ts`, after extracting `data.prompt` for a `custom` task, append the file path if available:

```ts
// packages/coc/src/server/queue-executor-bridge.ts  ~line 678
if (isCustomTaskPayload(task.payload)) {
    const data = task.payload.data;
    if (typeof data.prompt === 'string' && data.prompt.trim()) {
        let prompt = data.prompt;
        if (typeof data.planFilePath === 'string' && data.planFilePath.trim()) {
            prompt = `${prompt}\n\nFile: ${data.planFilePath}`;
        }
        return prompt;
    }
}
```

This is the minimal, backward-compatible change. Existing `custom` tasks without `planFilePath` are unaffected.

### 2. Client: update default prompt to reference the path (not just name)

In `UpdateDocumentDialog.tsx`, update the default prompt template to use `taskPath` instead of `taskName`. Since `planFilePath` is only available at submit time (async tasks folder fetch), also pre-compute it in a `useEffect` so the editable textarea shows the full path upfront:

```ts
// Eagerly compute planFilePath for display in prompt
const [resolvedPath, setResolvedPath] = useState(taskPath);
useEffect(() => {
    const ws = state.workspaces.find((w: any) => w.id === selectedWsId);
    const workingDirectory = ws?.rootPath || '';
    getTasksFolderPath(selectedWsId).then(tasksFolder => {
        const full = workingDirectory
            ? toForwardSlashes(workingDirectory + '/' + tasksFolder + '/' + taskPath)
            : taskPath;
        setResolvedPath(full);
    });
}, [selectedWsId, taskPath, state.workspaces]);

// Use resolvedPath in initial prompt
const [prompt, setPrompt] = useState('');
useEffect(() => {
    setPrompt(`Update the document at "${resolvedPath}" based on the current state of the codebase. Review the task file and update its status, notes, and checklist items to reflect the latest changes.`);
}, [resolvedPath]);
```

## Files to Change

| File | Change |
|------|--------|
| `packages/coc/src/server/queue-executor-bridge.ts` | Append `\nFile: {planFilePath}` to `custom` prompt when present |
| `packages/coc/src/server/spa/client/react/shared/UpdateDocumentDialog.tsx` | Pre-compute full path; use it in default prompt text |

## Tests to Update / Add

- `packages/coc/test/server/queue-executor-bridge.test.ts` — add case: `custom` task with `planFilePath` in data appends path to prompt
- `packages/coc/test/spa/react/UpdateDocumentDialog.test.tsx` — verify default prompt contains resolved path

## Notes

- Server change is the critical fix — even if the user edits the prompt, the server ensures the path is always appended.
- Client change improves UX so the user can see and verify the path before submitting.
- No changes needed to the API contract or task type.
