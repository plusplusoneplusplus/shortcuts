# Bug Fix: Resolve Comment Overwrites Task File With AI Response Text

## Problem

When using the CoCo SPA (web dashboard) to resolve markdown comments on a task `.md` file, the entire file content is replaced with the AI's conversational summary response. The surgical edits the AI made via its `view`/`edit` tools are overwritten by this final text response.

**Example:** After resolving a comment on `type-color-and-hover.plan.md`, the file ends up containing only:
> "Updated the plan to replace the static color map with a deterministic hash-based algorithm..."

Instead of the properly revised plan document.

## Root Cause

### Flow (CoCo SPA path — queue-executor-bridge.ts)

1. User clicks "Resolve Comments" in the SPA markdown review UI
2. SPA POSTs to AI queue → `executeResolveComments()` in `packages/coc/src/server/queue-executor-bridge.ts` is called
3. `executeResolveComments` calls `executeWithAI(task, aiPrompt)` — this runs an AI session that uses `view`/`edit` tools to surgically update the task file
4. The **raw AI text response** (the final summary message, e.g. "Updated the plan to...") is returned as `{ revisedContent: response }`
5. SPA client (`useTaskComments.ts`) receives `revisedContent` and does:
   ```
   PATCH /workspaces/:id/tasks/content { path, content: revisedContent }
   ```
6. Server handler (`tasks-handler.ts`) calls `fs.promises.writeFile(resolvedPath, content)` — **full overwrite with the AI summary text**

### Why It's Wrong

The AI session in step 3 already made the correct edits to the file via its tools. The `response` field from `executeWithAI` is the AI's final *conversational reply* (a summary), not the full revised document content. Writing this summary text back to the file destroys the proper edits.

## Affected Files

| File | Role |
|---|---|
| `packages/coc/src/server/queue-executor-bridge.ts` | `executeResolveComments` — returns raw AI response as `revisedContent` |
| `packages/coc-server/src/...useTaskComments.ts` (SPA) | Polls result and PATCHes file with `revisedContent` |
| `packages/coc-server/src/.../tasks-handler.ts` | PATCH handler that does `fs.writeFile` |

## Proposed Fix

### Option A (Recommended): Remove the file-write step from SPA

Since the AI session already edits the file via tools, the SPA client should **not** write `revisedContent` back to the file.

In `queue-executor-bridge.ts`, change `executeResolveComments` to NOT return `revisedContent` (or return `null`/empty):
```ts
// Before
return {
    revisedContent: response,   // ← AI summary text, NOT file content
    commentIds: payload.commentIds,
};

// After
return {
    commentIds: payload.commentIds,  // no revisedContent
};
```

In the SPA `useTaskComments.ts`, guard the PATCH call:
```ts
// Only write if revisedContent is explicitly provided and non-empty
if (result.revisedContent) {
    await fetch(/* PATCH tasks/content */);
}
```

### Option B: Change prompt to return full document

Change the AI prompt in `executeResolveComments` to instruct the AI to return the **complete revised file content** (not a summary). This approach is less safe as it risks AI truncating large files.

### Option C: Read file after AI session completes

After `executeWithAI` finishes, read the actual current file content from disk (since the AI already modified it) and return that as `revisedContent`. This is redundant but safe.

## Recommended Approach

**Option A** — simply don't write the AI summary text to the file. The AI tool-based edits are already applied. The SPA should reload the file content from disk after the session completes (via a re-fetch of `/tasks/content`) rather than using the AI's conversational response text.

## Tasks

1. **`update-bridge`** — In `queue-executor-bridge.ts`, remove `revisedContent` from `executeResolveComments` return value
2. **`update-spa-client`** — In SPA `useTaskComments.ts`, guard PATCH: only write if `revisedContent` is present AND non-empty; after AI session, re-fetch file content from disk to refresh the editor
3. **`verify-tests`** — Run `npm run test:run` in `packages/coc`, verify resolving comments no longer overwrites the task file

## Notes

- The VSCode extension path (`handleSendToCLIBackground`) does NOT have this bug — it never writes the AI response to the file
- The interactive terminal path also does NOT have this bug — the AI edits the file directly and no post-processing write occurs
- This bug is specific to the **CoCo SPA background queue** execution path
