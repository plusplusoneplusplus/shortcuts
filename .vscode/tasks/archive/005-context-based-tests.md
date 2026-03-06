---
status: done
---

# 005: Hook & component tests (context-based)

## Summary
Replace the string-scanning tests in `spa-tasks-miller-nav.test.ts` (useQueueActivity and TaskTree sections) and `spa-pending-task-info.test.ts` with real React unit tests that exercise `useQueueActivity`, `TaskTree`, and `TaskActions` through their context providers.

## Motivation
`useQueueActivity`, `TaskTree`, and `TaskActions` depend on React context providers (`QueueContext`, `AppContext`, `TaskContext`). The existing tests only scan source/bundle strings for keywords—they verify nothing about runtime behaviour. This commit replaces those scan tests with real behavioural tests: rendering with context, simulating clicks, and asserting on DOM output. This is a separate commit because it requires the full provider-wrapping infrastructure from commit 001 and the fetch-mock patterns from commit 004, and it validates the most complex SPA interaction patterns (context → hook → component rendering).

## Changes

### Files to Create

- `packages/coc/test/spa/react/use-queue-activity.test.tsx` — Tests for the `useQueueActivity` hook rendered inside `QueueProvider` + `AppProvider`. Uses `renderHook` from `@testing-library/react` with a custom wrapper that seeds context state. Covers: mapping queue items to file paths via `extractTaskPath`, handling empty queue state, normalising backslash paths, building the `folderMap` from `fileMap`, ignoring items without matching workspace prefix. **Note:** The existing `useQueueActivity.test.ts` only tests the extracted `computeFolderMap` pure function — this new file tests the _hook itself_ with real context.

- `packages/coc/test/spa/react/task-tree.test.tsx` — Tests for the `TaskTree` component rendered inside all three providers (`AppProvider`, `QueueProvider`, `TaskProvider`). Renders `TaskTree` directly (not through `TasksPanel`) with a mock `tree` prop. Covers: initial root column renders (`miller-column-0`), folder click appends a new column (`miller-column-1`), ancestor folder click truncates deeper columns, file click sets `openFilePath` in `TaskContext`, `activeFolderKeys` state tracks highlighted folders, empty folder shows placeholder text. **Note:** `TasksPanel.test.tsx` already has extensive Miller column tests through the full `TasksPanel` wrapper — this file tests `TaskTree` in isolation to avoid the fetch mocking overhead and focus on column state logic.

- `packages/coc/test/spa/react/task-actions.test.tsx` — **Extends** the existing `TaskActions.test.tsx` with additional context-dependent tests: "Open in editor" button appears only when `openFilePath` is set, clicking it calls `fetch` with the correct `/open-file` endpoint, "Copy path" button calls `navigator.clipboard.writeText`, "Queue all" button appears only when `nonContextSelected.length > 0` and dispatches `OPEN_DIALOG`, "Context files" checkbox toggles `showContextFiles` in `TaskContext`, "Clear" button calls `onClearSelection`. **Note:** The existing file only tests the "Generate task with AI" button — these tests cover the remaining interactive elements.

- `packages/coc/test/spa/react/pending-task-info.test.tsx` — Tests for `QueueTaskDetail` (which contains `PendingTaskInfoPanel`) rendered inside `QueueProvider` + `AppProvider`. Mock `fetchApi` to return a pending task payload. Covers: renders "Task ID", "Working Directory", "Repo ID" metadata fields; renders "Cancel Task" and "Move to Top" action buttons; renders `promptContent` area for follow-prompt tasks; renders `selectedText` for ai-clarification tasks; renders `commitSha` and "Diff Type" for code-review tasks; renders hourglass icon for pending header; calls `/queue/<id>` API to fetch full task data. **Replaces** `spa-pending-task-info.test.ts` bundle scanning.

- `packages/coc/test/spa/react/repo-queue-tab.test.tsx` — Tests for `RepoQueueTab` rendered inside `QueueProvider`. Mock `fetchApi` for both `/queue?repoId=` and `/queue/history?repoId=` endpoints. Covers: calls history endpoint separately from queue endpoint on mount; renders completed tasks from history response; pause/resume buttons call correct POST endpoints; task filter works; empty state rendering. **Replaces** `spa-repo-queue-history.test.ts` bundle scanning.

### Files to Modify
(none expected — the existing `TaskActions.test.tsx` and `useQueueActivity.test.ts` stay as-is; the new files are additive)

### Files to Delete
(none — old string-scan tests in `spa-tasks-miller-nav.test.ts` and `spa-pending-task-info.test.ts` will be removed in a separate cleanup commit)

## Implementation Notes

### useQueueActivity hook testing strategy
- The hook calls `useQueue()` and `useApp()` internally, which throw if not inside their providers.
- Use `renderHook(…, { wrapper })` where the wrapper includes `<AppProvider><QueueProvider>…</QueueProvider></AppProvider>`.
- To seed state, the wrapper must dispatch actions _before_ the hook runs. Two strategies:
  1. **Preferred:** Create a small inner component that dispatches `SEED_QUEUE` and `WORKSPACES_LOADED` in a `useEffect`, then renders `children`. This avoids needing to export the internal dispatch.
  2. **Alternative:** Import `queueReducer`/`appReducer` and build a custom context provider with pre-set state (bypass `QueueProvider`/`AppProvider`). This gives full control but couples to the internal state shape.
- The hook reads `appState.workspaces` to find the workspace `rootPath` by `wsId`. Seed at least one workspace: `{ id: 'ws1', rootPath: '/home/user/project' }`.
- The hook reads `queueState.queued` and `queueState.running`. Seed items with payloads containing `planFilePath`, `data.originalTaskPath`, or `filePath`.
- `extractTaskPath` strips the `wsRootPath + '/' + tasksFolder + '/'` prefix. Ensure test payloads use full absolute paths matching this prefix.
- `normalizePath` converts `\` → `/` and strips trailing `/`. Test with Windows-style paths.

### TaskTree component testing strategy
- `TaskTree` calls `useTaskPanel()` (from `TaskContext`) and `useQueueActivity(wsId)` (from `QueueContext`+`AppContext`).
- Render with `<AppProvider><QueueProvider><TaskProvider><TaskTree … /></TaskProvider></QueueProvider></AppProvider>`.
- Provide a mock `tree` prop matching the `TaskFolder` interface. Reuse the `mockTree` pattern from `TasksPanel.test.tsx` (lines 31–58).
- For the folder click test: `fireEvent.click(screen.getByTestId('task-tree-item-<folderName>'))` then `waitFor(() => screen.getByTestId('miller-column-1'))`.
- For column truncation: click folder A (column 1 appears), click subfolder B (column 2 appears), click folder A again → column 2 disappears.
- For file click: click a document item, then verify the `openFilePath` in `TaskContext` via a helper component that reads `useTaskPanel().openFilePath` and renders it as text.
- `TaskTree` also calls `history.replaceState` — mock or stub `window.history.replaceState` to avoid errors.
- The `useQueueActivity` hook inside TaskTree will return empty maps by default (no queue items seeded), which is fine for column navigation tests.

### TaskActions extended tests
- The existing `TaskActions.test.tsx` uses a `Wrap` component with all four providers. Reuse this pattern.
- "Open in editor" test: render with `openFilePath="feature1/task.md"`, mock `global.fetch`, click "Open in editor" button, assert `fetch` was called with URL containing `/open-file` and body `{ path: 'feature1/task.md' }`.
- "Copy path" test: mock `navigator.clipboard = { writeText: vi.fn() }`, render with `openFilePath`, click "Copy path", assert `clipboard.writeText` called with path.
- "Queue all" test: render with `selectedFilePaths={['task.md']}`, verify "Queue all" button appears, click it, verify the queue `OPEN_DIALOG` dispatch (can be verified indirectly by checking `showDialog` state or by spying on dispatch).
- "Context files" checkbox: render, find checkbox, `fireEvent.click`, verify `showContextFiles` toggles (use a helper component to read context state).
- `getApiBase()` returns `/api` by default (no `window.__DASHBOARD_CONFIG__` set), so fetch URLs will be `/api/workspaces/…/open-file`.

### Shared patterns
- All test files should import from `@testing-library/react` (`render`, `screen`, `fireEvent`, `waitFor`, `renderHook`).
- If commit 001 provides `renderWithProviders`, prefer it over ad-hoc `Wrap` components.
- Use `vi.fn()` for callback props, `vi.spyOn` for `fetch`/`clipboard` APIs.
- Add `/* @vitest-environment jsdom */` at the top of each file if the vitest config doesn't default to jsdom for `.tsx` files.

### ToastContext note
- `TaskActions` does not directly use `ToastContext`, but `QueueProvider` and other deep components may. The existing `Wrap` in `TaskActions.test.tsx` includes `ToastProvider` for safety — follow this pattern.

## Tests

### use-queue-activity.test.tsx
- `useQueueActivity` returns empty `fileMap` and `folderMap` when queue is empty
- `useQueueActivity` maps `planFilePath` to relative task path
- `useQueueActivity` maps `data.originalTaskPath` to relative task path
- `useQueueActivity` maps `filePath` to relative task path
- `useQueueActivity` ignores items with no matching workspace prefix
- `useQueueActivity` normalises Windows backslash paths
- `useQueueActivity` counts multiple items for the same file path
- `useQueueActivity` builds `folderMap` with ancestor folder counts
- `useQueueActivity` combines queued and running items
- `useQueueActivity` returns empty maps when workspace is not found

### task-tree.test.tsx
- TaskTree renders initial root column (`miller-column-0`) with correct items
- TaskTree appends column on folder click (`miller-column-1` appears)
- TaskTree truncates columns on ancestor folder click (click folder A, subfolder B, then folder A again — column 2 gone)
- TaskTree sets `openFilePath` on file click
- TaskTree clears `openFilePath` on folder click (sets to null)
- TaskTree renders "Empty folder" placeholder for empty folder children
- TaskTree initialises to `initialFolderPath` when provided
- TaskTree initialises to `initialFilePath` when provided
- TaskTree rebuilds columns from `activeFolderKeys` on tree update

### task-actions.test.tsx
- TaskActions shows "Open in editor" and "Copy path" when `openFilePath` is set
- TaskActions hides "Open in editor" and "Copy path" when `openFilePath` is null
- "Open in editor" calls `fetch` with correct endpoint and payload
- "Copy path" calls `navigator.clipboard.writeText` with the path
- "Queue all" button appears when non-context files are selected
- "Queue all" button is hidden when no files are selected
- "Queue all" click dispatches `OPEN_DIALOG` to QueueContext
- "Context files" checkbox toggles `showContextFiles` in TaskContext
- "Clear" button calls `onClearSelection` callback
- n-count badge shows correct number of selected non-context files

### pending-task-info.test.tsx
- Renders "Task ID", "Working Directory", "Repo ID" metadata fields
- Renders "Cancel Task" and "Move to Top" action buttons
- Renders promptContent area for follow-prompt task type
- Renders selectedText for ai-clarification task type
- Renders commitSha and "Diff Type" for code-review task type
- Calls `/queue/<id>` API on mount to fetch full task data
- Shows loading state while fetching task data
- Renders hourglass icon in pending task header

### repo-queue-tab.test.tsx
- Calls `/queue/history?repoId=` separately from `/queue?repoId=` on mount
- Renders completed tasks from history response
- Pause button calls correct POST endpoint
- Resume button calls correct POST endpoint
- Task type filter filters displayed tasks
- Empty state renders when no tasks exist

## Acceptance Criteria
- [ ] useQueueActivity correctly maps queue items to task file paths when rendered in context
- [ ] useQueueActivity handles empty queue state
- [ ] useQueueActivity normalises Windows backslash paths
- [ ] useQueueActivity builds folderMap from fileMap
- [ ] TaskTree renders initial root column
- [ ] TaskTree appends column on folder click
- [ ] TaskTree truncates columns on ancestor folder click
- [ ] TaskTree sets openFilePath on file click
- [ ] TaskActions shows/hides conditional buttons based on openFilePath
- [ ] TaskActions "Open in editor" calls correct API endpoint
- [ ] TaskActions "Queue all" dispatches OPEN_DIALOG
- [ ] TaskActions "Context files" checkbox toggles context state
- [ ] PendingTaskInfoPanel renders metadata fields (Task ID, Working Directory, Repo ID)
- [ ] PendingTaskInfoPanel renders action buttons (Cancel Task, Move to Top)
- [ ] PendingTaskInfoPanel renders task-type-specific payload fields
- [ ] PendingTaskInfoPanel calls `/queue/<id>` API on mount
- [ ] RepoQueueTab calls `/queue/history?repoId=` separately from `/queue?repoId=`
- [ ] RepoQueueTab renders completed tasks from history
- [ ] RepoQueueTab pause/resume buttons call correct endpoints
- [ ] All tests use provider wrappers (renderWithProviders or equivalent Wrap)
- [ ] All tests pass with `npm run test` in `packages/coc/`

## Dependencies
- Depends on: 001 (test infra — vitest config, jest-dom, renderWithProviders, context mock factories), 003 (TaskTreeItem rendering validated), 004 (fetch mocking patterns established)

## Assumed Prior State
Commit 001 provides `renderWithProviders`, context mock factories, and `createMockFetch`. Commit 003 validates `TaskTreeItem` rendering in isolation (pure props). Commit 004 validates fetch mocking patterns for hooks like `useFileActions` and `useTaskTree`. All pure helpers (`isContextFile`, `getFolderKey`, `rebuildColumnsFromKeys`, `folderToNodes`, etc.) are tested in 002. The existing `useQueueActivity.test.ts` (folderMap-only) and `TaskActions.test.tsx` (generate-button-only) remain untouched — new files are additive.
