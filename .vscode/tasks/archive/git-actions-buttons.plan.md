# Plan: Add Fetch / Pull --rebase / Push Buttons to CoC Git Page

## Problem

The Git tab header (shown in the screenshot) has an empty area between the branch/ahead badge and the refresh button. The user wants **Fetch**, **Pull (--rebase)**, and **Push** action buttons placed in that area to allow common git operations directly from the dashboard.

## Current State

### Frontend
- `packages/coc/src/server/spa/client/react/repos/GitPanelHeader.tsx`  
  Renders: branch pill · ahead/behind badge · **[empty space]** · refresh button  
- `packages/coc/src/server/spa/client/react/repos/RepoGitTab.tsx`  
  Parent that owns `refreshAll()` and passes callbacks to the header.

### Backend (all endpoints already exist in `packages/coc-server/src/api-handler.ts`)
| Method | Endpoint | Notes |
|--------|----------|-------|
| `POST` | `/api/workspaces/:id/git/fetch` | Optional `{ remote }` body |
| `POST` | `/api/workspaces/:id/git/pull`  | `{ rebase: true }` body for `--rebase` |
| `POST` | `/api/workspaces/:id/git/push`  | `{ setUpstream?: bool }` body |

No backend changes are needed.

## Proposed Approach

Add three icon/text buttons inside `GitPanelHeader` (in the empty highlighted area). Each button:
1. Calls the corresponding API via `fetchApi()` using a `POST` request.
2. Shows a spinner/disabled state while the operation is in flight.
3. On success → triggers `onRefresh` to reload git data.
4. On failure → shows an inline error tooltip or passes the error up to the parent.

### Button Designs
- **Fetch** – cloud-download icon + "Fetch" label  
- **Pull** – arrow-down icon + "Pull" label (always uses `{ rebase: true }`)  
- **Push** – arrow-up icon + "Push" label  

All three follow the same visual style as the existing refresh button (small, icon-only or icon+text, same hover/disabled classes).

## Files to Change

| File | Change |
|------|--------|
| `packages/coc/src/server/spa/client/react/repos/GitPanelHeader.tsx` | Add `onFetch`, `onPull`, `onPush` prop callbacks + render three buttons in the empty area |
| `packages/coc/src/server/spa/client/react/repos/RepoGitTab.tsx` | Implement `handleFetch`, `handlePull`, `handlePush` async functions that call the API and then call `refreshAll()`; pass them as props to `GitPanelHeader` |

## Todos

1. **Update `GitPanelHeader` props interface** — ✅ add `onFetch`, `onPull`, `onPush` (async `() => void`) and corresponding `fetching`, `pulling`, `pushing` boolean loading flags.
2. **Add buttons to `GitPanelHeader` JSX** — ✅ place three buttons in the empty space between the ahead/behind badge and the refresh button; reuse existing button/icon CSS classes.
3. **Implement handlers in `RepoGitTab`** — ✅ `handleFetch`, `handlePull` (`rebase: true`), `handlePush` each POST to the respective endpoint, then call `refreshAll()`.
4. **Error handling** — ✅ surface errors (use the existing `refreshError` pattern or a separate `actionError` state).
5. **Build & verify** — ✅ run `npm run build` and manually confirm buttons appear and work.

## Notes / Considerations

- Pull is always `--rebase` (no toggle needed per the user's request).
- Push may fail if no upstream is set; consider passing `setUpstream: false` initially and showing the error message if the API returns an error (avoid auto-setting upstream silently).
- No backend changes required — all three endpoints are already implemented.
- Keep button labels short to avoid layout overflow on narrow screens; icon-only with a tooltip is acceptable.
