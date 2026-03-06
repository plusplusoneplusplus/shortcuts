# Plan: Always Show "+ Queue Task" Button Regardless of Active Tab

## Problem

In the `RepoDetail` header, the `+ Queue Task` button is wrapped in a conditional:

```tsx
{activeSubTab === 'queue' && (
    <Button ...>+ Queue Task</Button>
)}
```

This means the button is invisible on all tabs except "Queue", even though queueing a new task is a globally useful action.

## Goal

Remove the `activeSubTab === 'queue'` guard so the `+ Queue Task` button is always visible in the repo header, regardless of which sub-tab is active.

## Affected File

`packages/coc/src/server/spa/client/react/repos/RepoDetail.tsx`

- **Line 126** — remove the `{activeSubTab === 'queue' && ...}` wrapper around the Queue Task button.
- Keep the button's `onClick`, `title`, `variant`, `size`, and `data-testid` exactly as-is.
- Do **not** change the "Resume Queue" button on line 115; that one is intentionally queue-tab-only.

## Change

```diff
- {activeSubTab === 'queue' && (
-     <Button
-         variant="primary"
-         size="sm"
-         onClick={() => queueDispatch({ type: 'OPEN_DIALOG', workspaceId: ws.id })}
-         title="Queue a new task"
-         data-testid="repo-queue-task-btn"
-     >
-         + Queue Task
-     </Button>
- )}
+ <Button
+     variant="primary"
+     size="sm"
+     onClick={() => queueDispatch({ type: 'OPEN_DIALOG', workspaceId: ws.id })}
+     title="Queue a new task"
+     data-testid="repo-queue-task-btn"
+ >
+     + Queue Task
+ </Button>
```

## Notes

- The empty-state button inside `RepoQueueTab.tsx` (shown when the queue is empty) is unrelated and should remain untouched.
- No logic changes are needed beyond removing the conditional wrapper.
- After the change, rebuild the SPA (`npm run build` or `npm run watch`) and verify the button appears on all sub-tabs (Processes, Queue, Wiki, etc.).
