---
status: pending
---

# 005: SPA — Wire Copilot Tab into RepoDetail

## Summary

Add a "Copilot" sub-tab to the `RepoDetail` component by:
1. Extending the `RepoSubTab` union type with `'copilot'`.
2. Appending `{ key: 'copilot', label: 'Copilot' }` to `SUB_TABS`.
3. Importing and conditionally rendering `RepoCopilotTab` in the tab-content area.
4. Registering `'copilot'` in `VALID_REPO_SUB_TABS` so the hash-router deep-links work.

## Motivation

Commits 001–004 created the types, backend endpoints, and the `RepoCopilotTab` React component, but nothing surfaces them in the UI yet. This commit is the last wiring step that makes the tab visible and navigable.

## Changes

### Files to Create

_(none)_

### Files to Modify

#### 1. `packages/coc/src/server/spa/client/react/types/dashboard.ts`

**Line 6** — extend `RepoSubTab` with `'copilot'`:

```ts
// before
export type RepoSubTab = 'info' | 'pipelines' | 'tasks' | 'queue' | 'schedules' | 'chat' | 'git' | 'wiki';

// after
export type RepoSubTab = 'info' | 'pipelines' | 'tasks' | 'queue' | 'schedules' | 'chat' | 'git' | 'wiki' | 'copilot';
```

---

#### 2. `packages/coc/src/server/spa/client/react/repos/RepoDetail.tsx`

**a) Add import** (after the existing `RepoWikiTab` import, ~line 18):

```tsx
import { RepoWikiTab } from './RepoWikiTab';
import { RepoCopilotTab } from './RepoCopilotTab';   // ← add
```

**b) Append entry to `SUB_TABS`** (lines 35–44 — insert after the `wiki` entry):

```tsx
// before
export const SUB_TABS: { key: RepoSubTab; label: string }[] = [
    { key: 'info',      label: 'Info' },
    { key: 'git',       label: 'Git' },
    { key: 'pipelines', label: 'Pipelines' },
    { key: 'tasks',     label: 'Tasks' },
    { key: 'queue',     label: 'Queue' },
    { key: 'schedules', label: 'Schedules' },
    { key: 'chat',      label: 'Chat' },
    { key: 'wiki',      label: 'Wiki' },
];

// after
export const SUB_TABS: { key: RepoSubTab; label: string }[] = [
    { key: 'info',      label: 'Info' },
    { key: 'git',       label: 'Git' },
    { key: 'pipelines', label: 'Pipelines' },
    { key: 'tasks',     label: 'Tasks' },
    { key: 'queue',     label: 'Queue' },
    { key: 'schedules', label: 'Schedules' },
    { key: 'chat',      label: 'Chat' },
    { key: 'wiki',      label: 'Wiki' },
    { key: 'copilot',   label: 'Copilot' },   // ← add
];
```

**c) Render `RepoCopilotTab` in the content area** (inside the `<div className="h-full overflow-y-auto …">` block, ~line 476 — add after the `wiki` line):

```tsx
// before (last line in the inner div)
{activeSubTab === 'wiki' && <RepoWikiTab … />}

// after
{activeSubTab === 'wiki'    && <RepoWikiTab workspaceId={ws.id} workspacePath={ws.rootPath} initialWikiId={state.selectedRepoWikiId} initialTab={state.repoWikiInitialTab} initialAdminTab={state.repoWikiInitialAdminTab} initialComponentId={state.repoWikiInitialComponentId} />}
{activeSubTab === 'copilot' && <RepoCopilotTab workspaceId={ws.id} />}
```

---

#### 3. `packages/coc/src/server/spa/client/react/layout/Router.tsx`

**Line 114** — add `'copilot'` to `VALID_REPO_SUB_TABS`:

```ts
// before
export const VALID_REPO_SUB_TABS: Set<string> = new Set(['info', 'git', 'pipelines', 'tasks', 'queue', 'schedules', 'chat', 'wiki']);

// after
export const VALID_REPO_SUB_TABS: Set<string> = new Set(['info', 'git', 'pipelines', 'tasks', 'queue', 'schedules', 'chat', 'wiki', 'copilot']);
```

No additional deep-link parsing block is needed for `copilot` — the existing generic branch at lines 162–167 already handles any `VALID_REPO_SUB_TABS` entry by dispatching `SET_REPO_SUB_TAB`. The hash pattern `#repos/<id>/copilot` will work automatically once `'copilot'` is in the set.

### Files to Delete

_(none)_

## Implementation Notes

- **Placement in tab strip:** `'copilot'` is appended last in `SUB_TABS` (after `wiki`). This matches the visual order requested and avoids renumbering existing integration tests that check tab order by index.
- **No badge needed** for the Copilot tab (unlike `queue`, `chat`, `wiki`). If future commits need one, add it alongside the other badge snippets in the `SUB_TABS.map(…)` block (~lines 420–441).
- **`RepoCopilotTab` props contract:** The component receives at minimum `workspaceId: string`. Check its actual prop interface in `repos/RepoCopilotTab.tsx` (created in commit 004) and adjust the JSX in step **c** if it requires additional props.
- **`MobileTabBar`** already receives `tabs={SUB_TABS}` (line 456 of `RepoDetail.tsx`), so the new tab will appear on mobile automatically with no extra changes.
- **TypeScript:** Adding `'copilot'` to `RepoSubTab` means the compiler will enforce exhaustiveness everywhere the type is switch-dispatched. Verify no existing `switch (activeRepoSubTab)` blocks in `AppContext` reducer or elsewhere need a `case 'copilot':` arm.

## Tests

- Verify that clicking the "Copilot" tab button in the desktop tab strip renders the `RepoCopilotTab` component.
- Verify `#repos/<id>/copilot` as the initial hash navigates directly to the Copilot tab.
- Verify that changing to another tab and back preserves the hash correctly.
- Confirm the "Copilot" tab appears in `MobileTabBar` on narrow viewports.
- Run existing SPA Vitest / component tests (`npm run test:run` in `packages/coc`) and ensure no regressions.

## Acceptance Criteria

- [ ] A "Copilot" tab button is visible in `RepoDetail` after "Wiki" in the tab strip.
- [ ] Clicking it renders `RepoCopilotTab` without a console error.
- [ ] Navigating to `#repos/<id>/copilot` deep-links directly to the tab.
- [ ] `RepoSubTab` TypeScript type includes `'copilot'` — no TS errors after build.
- [ ] `VALID_REPO_SUB_TABS` includes `'copilot'` — hash router recognises the key.
- [ ] All pre-existing tests continue to pass.

## Dependencies

- **Commit 004** must be applied first: `RepoCopilotTab` component must exist at `repos/RepoCopilotTab.tsx`.
- **Commits 001–003** must be applied: backend API endpoints and shared types referenced by `RepoCopilotTab`.

## Assumed Prior State

- `RepoSubTab` is `'info' | 'pipelines' | 'tasks' | 'queue' | 'schedules' | 'chat' | 'git' | 'wiki'` (8 members).
- `SUB_TABS` has exactly 8 entries ending with `{ key: 'wiki', label: 'Wiki' }`.
- `VALID_REPO_SUB_TABS` is a `Set` of those same 8 strings.
- `RepoCopilotTab` exists and exports a default or named export accepting at least `{ workspaceId: string }`.
