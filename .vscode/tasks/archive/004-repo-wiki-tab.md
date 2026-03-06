---
status: pending
---

# 004: RepoWikiTab wrapper component + types

## Summary

Create the `RepoWikiTab` component that resolves a wiki for a given workspace root path from `state.wikis`, rendering either `WikiDetail` in embedded mode when a wiki is found or `LinkWikiPanel` when none exists. Also extend the `RepoSubTab` type to include `'wiki'`.

## Motivation

This commit is isolated because it introduces the resolution logic (matching a wiki to a repo by path) and the wrapper component, without yet wiring it into the `RepoDetail` tab bar (commit 5). Keeping resolution logic separate makes it independently testable and reviewable.

## Changes

### Files to Create

- `packages/coc/src/server/spa/client/react/repos/RepoWikiTab/RepoWikiTab.tsx` — Wrapper component with wiki-resolution logic. Props: `{ workspaceId: string; rootPath: string }`. Uses `useApp()` to read `state.wikis` and performs a two-pass search:
  1. **Exact match:** Find a wiki whose `repoPath`, after normalization, equals the normalized `rootPath`.
  2. **Subfolder match:** If no exact match, find a wiki whose `wikiDir`, after normalization, starts with the normalized `rootPath` + `/` (subfolder detection).
  3. If no match → render `<LinkWikiPanel workspaceId={workspaceId} rootPath={rootPath} onLinked={handleLinked} />` where `handleLinked` triggers a re-search by bumping a local counter or re-reading state.
  4. If match found → render `<WikiDetail wikiId={wiki.id} embedded hashPrefix={'#repos/' + workspaceId + '/wiki'} />`.

  Includes a `normalizePath(p: string): string` helper (exported for testing):
  - Replace all backslashes with forward slashes.
  - Lowercase the entire path (Windows case-insensitivity).
  - Strip trailing slash.

- `packages/coc/src/server/spa/client/react/repos/RepoWikiTab/index.ts` — Barrel export: `export { RepoWikiTab } from './RepoWikiTab';`

- `packages/coc/src/server/spa/client/react/repos/RepoWikiTab/RepoWikiTab.test.tsx` — Unit tests for wiki resolution and rendering.

### Files to Modify

- `packages/coc/src/server/spa/client/react/types/dashboard.ts` — Add `'wiki'` to the `RepoSubTab` union type:
  ```typescript
  // Before
  export type RepoSubTab = 'info' | 'pipelines' | 'tasks' | 'queue' | 'schedules' | 'chat';
  // After
  export type RepoSubTab = 'info' | 'pipelines' | 'tasks' | 'queue' | 'schedules' | 'chat' | 'wiki';
  ```
  This is a pure type-level change; no runtime code references `RepoSubTab` exhaustively except the `SUB_TABS` array in `RepoDetail.tsx` (modified in commit 5).

### Files to Delete

- (none)

## Implementation Notes

### Path normalization

Wiki objects store paths as they were provided by the server, which may use backslashes on Windows or differ in casing. The `normalizePath` utility is critical for cross-platform matching:

```typescript
export function normalizePath(p: string): string {
    return p.replace(/\\/g, '/').toLowerCase().replace(/\/$/, '');
}
```

### Resolution strategy

The two-pass approach (exact `repoPath` match, then `wikiDir` subfolder containment) handles:
- Wikis explicitly linked to a repo via PATCH (commit 1 stores `repoPath`).
- Legacy wikis that were generated inside a repo's subtree (e.g. `rootPath = /projects/myrepo`, `wikiDir = /projects/myrepo/.wiki`).

### WikiDetail embedded mode

WikiDetail receives `embedded` and `hashPrefix` props (commit 2). When `embedded` is true:
- The back button and top header bar are hidden (WikiDetail manages this internally).
- Hash navigation uses `hashPrefix` instead of the default `#wiki/<id>`, so that browser back/forward within the repo wiki tab stays under `#repos/<wsId>/wiki/...`.

### onLinked callback

When `LinkWikiPanel` successfully links or creates a wiki, the `onLinked` callback should dispatch `UPDATE_WIKI` or `ADD_WIKI` to refresh `state.wikis`, which causes `RepoWikiTab` to re-resolve and switch from `LinkWikiPanel` to `WikiDetail` reactively (no manual state toggle needed since the component re-derives from `state.wikis` on every render via `useMemo`).

### Component structure

```
RepoWikiTab/
├── RepoWikiTab.tsx      # Main component + normalizePath
├── RepoWikiTab.test.tsx # Tests
└── index.ts             # Barrel export
```

This follows the same folder-per-component pattern used by other repo sub-tab components but uses a directory because this component has its own child (`LinkWikiPanel` from commit 3 lives here too).

## Tests

- **normalizePath** — backslash conversion, lowercasing, trailing slash stripping, no-op on already-normalized paths.
- **Exact repoPath match** — renders `WikiDetail` when a wiki's `repoPath` matches `rootPath` (including case/slash differences).
- **Subfolder wikiDir match** — renders `WikiDetail` when a wiki's `wikiDir` is under `rootPath`.
- **No match** — renders `LinkWikiPanel` when no wiki matches the workspace.
- **Props forwarded correctly** — `WikiDetail` receives `embedded={true}` and correct `hashPrefix`; `LinkWikiPanel` receives `workspaceId` and `rootPath`.
- **Reactive update** — after `state.wikis` changes (simulated dispatch), component switches from `LinkWikiPanel` to `WikiDetail`.

## Acceptance Criteria

- [ ] `RepoSubTab` type includes `'wiki'` in `dashboard.ts`
- [ ] `RepoWikiTab` component exists and exports from barrel
- [ ] Wiki resolution finds exact `repoPath` match (case-insensitive, slash-normalized)
- [ ] Wiki resolution falls back to `wikiDir` subfolder containment
- [ ] Renders `LinkWikiPanel` when no wiki is associated
- [ ] Renders `WikiDetail` with `embedded` and `hashPrefix` when wiki is found
- [ ] `normalizePath` is exported and tested
- [ ] All tests pass
- [ ] TypeScript compiles without errors

## Dependencies

- Depends on: 002, 003

## Assumed Prior State

- WikiDetail accepts `embedded?: boolean` and `hashPrefix?: string` props (commit 2)
- LinkWikiPanel component exists at `repos/RepoWikiTab/LinkWikiPanel.tsx` (commit 3)
- PATCH /api/wikis/:wikiId accepts `repoPath` (commit 1)
