# Stop jumping to queue tab after generate task is queued

## Problem

When a user submits a "Generate" task from the SPA dashboard, the UI automatically navigates to the Queue tab after the task is successfully queued. This is disruptive — the user may want to stay on their current tab (e.g., the wiki tab or overview) and not be forced into the queue view.

## Root Cause

In `GenerateTaskDialog.tsx` (line 115), a `useEffect` fires when `status` becomes `'queued'` and dispatches:

```ts
appDispatch({ type: 'SET_REPO_SUB_TAB', tab: 'queue' });
```

This forcibly switches the active sub-tab to `'queue'` in the global `AppContext` state, causing `RepoDetail.tsx` to render `<RepoQueueTab>` instead of whatever tab the user was viewing.

## Proposed Fix

Remove the `SET_REPO_SUB_TAB` dispatch from the queued effect in `GenerateTaskDialog.tsx`. The toast notification already informs the user that the task was queued — the user can navigate to the Queue tab manually if they want to monitor it.

## Files to Change

| File | Change |
|------|--------|
| `packages/coc/src/server/spa/client/react/tasks/GenerateTaskDialog.tsx` | Remove line 115: `appDispatch({ type: 'SET_REPO_SUB_TAB', tab: 'queue' });` |

## Todos

1. ~~**remove-queue-tab-jump** — Remove the `SET_REPO_SUB_TAB` dispatch from the `useEffect` in `GenerateTaskDialog.tsx` that fires when `status === 'queued'`~~
2. ~~**verify-build** — Run `npm run build` and existing tests to confirm no regressions~~
