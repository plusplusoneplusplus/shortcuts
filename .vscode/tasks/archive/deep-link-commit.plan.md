# Deep Link for Commit ID in Git Tab URL

## Problem

When a user selects a commit in the CoC SPA Git tab, the URL stays at
`#repos/:repoId/git` and does not encode which commit is selected. This means
users cannot share or bookmark a direct link to a specific commit, and
refreshing the page always resets to the most recent commit.

## Proposed URL Format

```
#repos/:repoId/git/:commitHash
```

Examples:
- `#repos/ws-kss6a7/git` → Git tab, auto-selects most recent commit (current behaviour)
- `#repos/ws-kss6a7/git/0651b561` → Git tab, selects commit `0651b561`

## Approach

Follow the same pattern used by pipeline and queue deep links:

1. Add a `parseGitCommitDeepLink()` helper to `Router.tsx`.
2. Extend `AppContext` with a `selectedGitCommitHash` field and a
   `SET_GIT_COMMIT_HASH` action so the Router can pass the deep-linked hash
   to `RepoGitTab`.
3. Update `Router.tsx` hash-change handler to dispatch the new action when
   `parts[2] === 'git'` and a commit hash segment is present.
4. Update `RepoGitTab.tsx` to:
   - Read `selectedGitCommitHash` from context on initial load.
   - Prefer the deep-linked hash over `loaded[0]` when available.
   - Call `location.hash` and dispatch `SET_GIT_COMMIT_HASH` whenever the
     user clicks a commit row (`handleSelect`).
5. Update `RepoDetail.tsx` `switchSubTab` to clear the commit hash from the
   URL (i.e. set `#repos/:id/git` without a hash suffix) when switching away
   from the git tab.
6. Add `'git'` to `VALID_REPO_SUB_TABS` in `Router.tsx` (currently missing,
   which prevents `#repos/:id/git` from setting the sub-tab on navigation).

## Files to Change

| File | Change |
|------|--------|
| `packages/coc/src/server/spa/client/react/layout/Router.tsx` | Add `'git'` to `VALID_REPO_SUB_TABS`; add `parseGitCommitDeepLink()`; dispatch `SET_GIT_COMMIT_HASH` in hash handler |
| `packages/coc/src/server/spa/client/react/context/AppContext.tsx` | Add `selectedGitCommitHash: string \| null` to state; add `SET_GIT_COMMIT_HASH` action & reducer case |
| `packages/coc/src/server/spa/client/react/repos/RepoGitTab.tsx` | Read `selectedGitCommitHash` from context; honour it on initial load; update `handleSelect` to write the hash to the URL and dispatch `SET_GIT_COMMIT_HASH` |
| `packages/coc/src/server/spa/client/react/repos/RepoDetail.tsx` | Clear commit hash segment from URL when switching away from the git sub-tab |

## Detailed Changes

### 1. `Router.tsx`

```typescript
// Add 'git' to the valid set so #repos/:id/git sets the sub-tab
export const VALID_REPO_SUB_TABS: Set<string> = new Set([
    'info', 'git', 'pipelines', 'tasks', 'queue', 'schedules', 'chat'
]);

// New helper
export function parseGitCommitDeepLink(hash: string): string | null {
    const cleaned = hash.replace(/^#/, '');
    const parts = cleaned.split('/');
    if (parts[0] === 'repos' && parts[1] && parts[2] === 'git' && parts[3]) {
        return decodeURIComponent(parts[3]);
    }
    return null;
}

// In the handleHash effect, inside the `tab === 'repos'` block:
if (parts[2] === 'git' && parts[3]) {
    dispatch({ type: 'SET_GIT_COMMIT_HASH', hash: decodeURIComponent(parts[3]) });
} else if (parts[2] === 'git') {
    dispatch({ type: 'SET_GIT_COMMIT_HASH', hash: null });
}
```

### 2. `AppContext.tsx`

```typescript
// State
selectedGitCommitHash: string | null;   // initialise to null

// Action union
| { type: 'SET_GIT_COMMIT_HASH'; hash: string | null }

// Reducer
case 'SET_GIT_COMMIT_HASH':
    return { ...state, selectedGitCommitHash: action.hash };
```

### 3. `RepoGitTab.tsx`

```typescript
// Read from context
const { state, dispatch } = useApp();
const initialCommitHash = state.selectedGitCommitHash;

// In the initial load effect, prefer the deep-linked hash
.then(([loaded]) => {
    const target = initialCommitHash
        ? loaded.find((c: GitCommitItem) => c.hash.startsWith(initialCommitHash))
        : null;
    const first = target ?? (loaded.length > 0 ? loaded[0] : null);
    setRightPanelView(first ? { type: 'commit', commit: first } : null);
})

// In handleSelect, update the URL and context
const handleSelect = useCallback((commit: GitCommitItem) => {
    setRightPanelView({ type: 'commit', commit });
    location.hash = '#repos/' + encodeURIComponent(workspaceId) + '/git/' + commit.hash;
    dispatch({ type: 'SET_GIT_COMMIT_HASH', hash: commit.hash });
}, [workspaceId, dispatch]);
```

### 4. `RepoDetail.tsx`

```typescript
// In switchSubTab, clear the commit segment when leaving git
const switchSubTab = (tab: RepoSubTab) => {
    dispatch({ type: 'SET_REPO_SUB_TAB', tab });
    if (tab !== 'git') {
        dispatch({ type: 'SET_GIT_COMMIT_HASH', hash: null });
    }
    const suffix = tab !== 'info' ? '/' + tab : '';
    location.hash = '#repos/' + encodeURIComponent(ws.id) + suffix;
};
```

## Behaviour Summary

| Scenario | Result |
|----------|--------|
| User clicks commit row | URL updates to `#repos/:id/git/:hash` |
| User refreshes page with commit URL | Correct commit is auto-selected |
| User navigates to `#repos/:id/git` | Most recent commit selected (current default) |
| User switches from Git to another tab | URL drops commit hash segment |
| Short hash in URL matches full hash prefix | Match succeeds via `startsWith` |
| Hash not found in loaded commits (e.g. pruned) | Falls back to most recent commit |

## Notes

- No backend changes required — the commit hash is purely a client-side
  routing concern.
- `commit.hash` in `GitCommitItem` is the full 40-char SHA; the URL stores the
  full hash to avoid ambiguity. The `startsWith` match gracefully handles cases
  where an 8-char short hash is pasted into the URL manually.
- The `SET_GIT_COMMIT_HASH` dispatch in `handleSelect` keeps the context in
  sync so that if the URL is updated externally (e.g. `hashchange`), the
  component still reflects the correct selection.
