---
status: done
---

# 004: Hook unit tests (fetch-based)

## Summary
Extend `useFileActions` tests to cover all seven actions and add `renderHook`-based tests for the `useTaskTree` hook, replacing string-scanning tests in `spa-file-context-menu.test.ts` and `spa-tasks-copy-path.test.ts` with real fetch-mocking assertions.

## Motivation
`useFileActions` and `useTaskTree` perform API calls via `fetch`. Testing them with mocked fetch validates real behaviour (correct HTTP method/URL/body, loading states, error handling, data transformation) instead of merely asserting that function names appear in source strings. This is commit 4 because it depends on the jsdom/vitest test infra from commit 001, and logically follows the pure-function tests (002) and props-only component tests (003).

## Changes

### Files to Modify

- `packages/coc/test/spa/react/useFileActions.test.ts` — extend with missing action tests (archiveFile, unarchiveFile, deleteFile) and broader error coverage. **Note:** This file already exists and covers moveFile, moveFileToWorkspace, renameFile, updateStatus, and URL encoding via direct `vi.stubGlobal('fetch', ...)` mocking. It does **not** need `renderHook` because `useFileActions` is not a true React hook (it uses no React primitives). Keep the `.ts` extension.

- `packages/coc/test/spa/react/useTaskTree.test.ts` — add a **new `describe` block** (or a companion file — see below) for `renderHook`-based tests of the `useTaskTree` hook itself. The existing file only tests pure exports (type guards, `folderToNodes`, `filterGitMetadataFolders`, `rebuildColumnsFromKeys`).

### Files to Create (preferred approach)

If extending the existing files would make them too large (>400 lines), create companion files instead:

- `packages/coc/test/spa/react/useTaskTree.hook.test.ts` — `renderHook`-based tests for the `useTaskTree` hook: fetch on mount, loading/error states, refresh, WebSocket event handling. Keeps the pure-function tests in the existing `useTaskTree.test.ts` untouched.

### Files to Delete
(none — old string-scanning tests in `test/server/` will be removed in a later commit)

## Implementation Notes

### useFileActions — what's already covered vs. what's missing

The existing `useFileActions.test.ts` already:
- Mocks `getApiBase` via `vi.mock(…/config)` returning `'/api'`
- Stubs global `fetch` with `vi.stubGlobal('fetch', fetchMock)` + restores in afterEach
- Tests: `moveFile`, `moveFileToWorkspace` (3 cases), `renameFile`, `updateStatus`, URL encoding

Still needed:
| Action | HTTP method | URL suffix | Body shape |
|---|---|---|---|
| `archiveFile` | POST | `/archive` | `{ path, action: 'archive' }` |
| `unarchiveFile` | POST | `/archive` | `{ path, action: 'unarchive' }` |
| `deleteFile` | DELETE | (base) | `{ path }` |

Also add:
- Error test for each: mock `{ ok: false, status: 500, text: … }` → assert `rejects.toThrow('500')`
- Content-Type header assertion (at least one test verifying `headers['Content-Type'] === 'application/json'`)

### useTaskTree hook — pattern to follow

Follow the established pattern from `useTaskComments.test.tsx` and `usePreferences.test.tsx`:

```ts
import { renderHook, waitFor, act } from '@testing-library/react';

vi.mock('…/useApi', () => ({
    fetchApi: vi.fn(),
}));
```

Key points:
- `useTaskTree` calls `fetchApi` (from `./useApi`), **not** `fetch` directly. Mock the `fetchApi` named export.
- `fetchApi(path)` is a thin wrapper: calls `fetch(getApiBase() + path)`, throws on non-ok, returns `res.json()`. Mocking at the `fetchApi` level is cleaner than double-mocking fetch+config.
- The hook fires `Promise.all([fetchApi(tasks), fetchApi(comment-counts)])` on mount. The comment-counts call has `.catch(() => null)` so it's fault-tolerant.
- The hook applies `filterGitMetadataFolders` to the tasks response before storing in state.
- `loading` starts `true`, set to `false` after either resolve or reject.
- `hasLoadedOnce` ref prevents setting `loading=true` on subsequent refreshes.
- WebSocket: the hook listens for `window.dispatchEvent(new CustomEvent('tasks-changed', { detail: { wsId } }))`. Test by dispatching this event inside `act()`.

### getApiBase mocking

Both hooks depend on `getApiBase()` from `../utils/config`. The config reads `window.__DASHBOARD_CONFIG__` (falls back to `{ apiBasePath: '/api' }`). For `useTaskTree`, mock at the `fetchApi` level to avoid this entirely. For `useFileActions`, the existing `vi.mock` of config is sufficient.

### No renderHook needed for useFileActions

`useFileActions(wsId)` contains zero React hooks — no `useState`, `useEffect`, `useCallback`. It's a plain factory function returning action methods. Direct invocation in tests is correct and simpler than `renderHook`. Keep the existing direct-call pattern.

## Tests

### useFileActions — new test cases to add

- `archiveFile — calls POST /workspaces/{wsId}/tasks/archive with action:'archive'`
- `unarchiveFile — calls POST /workspaces/{wsId}/tasks/archive with action:'unarchive'`
- `deleteFile — calls DELETE /workspaces/{wsId}/tasks with { path }`
- `archiveFile — throws on server error (500)`
- `unarchiveFile — throws on server error (500)`
- `deleteFile — throws on server error (404)`
- `all actions — include Content-Type: application/json header`

### useTaskTree hook — test cases

- `loads tree and comment counts on mount` — mock fetchApi to return a TaskFolder + counts object, assert `loading: false`, `tree` matches, `commentCounts` matches
- `sets loading=true initially then false after load` — check initial render has `loading: true`
- `sets error when fetchApi rejects` — mock fetchApi to throw, assert `error` is set, `loading: false`
- `filters .git metadata folders from API response` — return tree with `.git` child, assert it's removed in `result.current.tree`
- `comment-counts failure does not block tree load` — mock tasks to succeed, counts to reject, assert tree loads, commentCounts stays `{}`
- `refresh() re-fetches data` — call `act(() => result.current.refresh())`, assert fetchApi called again
- `does not set loading=true on subsequent refresh` — after initial load, call refresh, verify `loading` stays false
- `responds to tasks-changed CustomEvent for matching wsId` — dispatch event, assert fetchApi called again
- `ignores tasks-changed event for different wsId` — dispatch event with wrong wsId, assert no extra fetchApi call
- `returns null tree when API returns non-object` — mock fetchApi returning null/string, assert tree is null
- `handles empty wsId gracefully` — render with `''`, assert refresh short-circuits (no fetchApi call)

## Acceptance Criteria

- [ ] useFileActions: every action (rename, archive, unarchive, delete, move, moveToWorkspace, updateStatus) has at least one success test asserting correct HTTP method, URL, and body
- [ ] useFileActions: at least 3 actions have error-path tests (rejects.toThrow with status code)
- [ ] useFileActions: Content-Type header is verified in at least one test
- [ ] useTaskTree hook: loads tree from API on mount with `renderHook` + `waitFor`
- [ ] useTaskTree hook: `filterGitMetadataFolders` is applied to API response (`.git` stripped)
- [ ] useTaskTree hook: handles loading and error states correctly
- [ ] useTaskTree hook: `refresh()` triggers re-fetch without setting loading=true after first load
- [ ] useTaskTree hook: responds to `tasks-changed` CustomEvent
- [ ] useTaskTree hook: comment-counts failure is non-fatal
- [ ] All new tests pass: `cd packages/coc && npx vitest run test/spa/react/useFileActions test/spa/react/useTaskTree`

## Dependencies

- Depends on: 001 (test infra — vitest jsdom env, `@testing-library/react` available)

## Assumed Prior State

Commit 001 provides test infrastructure: vitest config with jsdom, `@testing-library/react` (including `renderHook`, `waitFor`, `act`), and `jest-dom` matchers. Commits 002–003 are not direct dependencies. The existing `useFileActions.test.ts` (7 test cases) and `useTaskTree.test.ts` (28 test cases covering pure functions) are already present and passing — this commit extends them, not replaces them.
