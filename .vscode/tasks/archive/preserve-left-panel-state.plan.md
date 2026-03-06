# Plan: Preserve Left Panel Collapse State

## Problem

The left sidebar (repos list panel) in the CoC dashboard collapses/expands via the hamburger button.
This state lives only in React context memory (`reposSidebarCollapsed` in `AppContext.tsx`), so it
resets to `false` (expanded) on every page refresh. The user wants the panel to remember its
collapsed/expanded state across refreshes and, as a nice-to-have, across browser tabs.

## Approach

Follow the same dual-layer pattern already used by the theme setting:
- **localStorage** for instant, synchronous read on app init (no flicker)
- **Server `/preferences`** (`~/.coc/preferences.json`) for cross-session/cross-device persistence

For **cross-tab sync** (nice-to-have), add a `storage` event listener so that toggling the panel
in one tab automatically updates other open tabs — no new dependencies needed (`window.onstorage`
fires in every tab except the one that wrote the value).

## Files to Change

| File | Change |
|------|--------|
| `packages/coc-server/src/preferences-handler.ts` | Add `reposSidebarCollapsed?: boolean` to `UserPreferences` interface |
| `packages/coc/src/server/spa/client/react/context/AppContext.tsx` | Read initial state from localStorage; persist on toggle; subscribe to storage events for cross-tab sync |

## Detailed Steps

### 1. Extend `UserPreferences` type
**File:** `packages/coc-server/src/preferences-handler.ts`

Add `reposSidebarCollapsed?: boolean` to the `UserPreferences` interface. No other server-side
changes are needed — the existing `PATCH /api/preferences` handler already merges partial updates.

### 2. Persist state in `AppContext.tsx`

#### 2a. Read initial value on init
Replace the hardcoded `reposSidebarCollapsed: false` initial state with a lazy initializer that
reads from localStorage:

```typescript
const SIDEBAR_KEY = 'coc-repos-sidebar-collapsed';

function getInitialSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === 'true';
  } catch {
    return false;
  }
}

// in initial state:
reposSidebarCollapsed: getInitialSidebarCollapsed(),
```

#### 2b. Persist on toggle
In the `TOGGLE_REPOS_SIDEBAR` reducer (or after dispatch), write to localStorage and fire a
`PATCH /preferences` request:

```typescript
case 'TOGGLE_REPOS_SIDEBAR': {
  const next = !state.reposSidebarCollapsed;
  try { localStorage.setItem(SIDEBAR_KEY, String(next)); } catch {}
  fetch(getApiBase() + '/preferences', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reposSidebarCollapsed: next }),
  }).catch(() => {});
  return { ...state, reposSidebarCollapsed: next };
}
```

#### 2c. Sync with server on mount (optional but recommended)
In the app-level `useEffect` that already fetches `/preferences` (or a new one), apply the server
value if present — this covers cross-device scenarios:

```typescript
useEffect(() => {
  fetch(getApiBase() + '/preferences')
    .then(r => r.json())
    .then((prefs) => {
      if (typeof prefs.reposSidebarCollapsed === 'boolean') {
        dispatch({ type: 'SET_REPOS_SIDEBAR_COLLAPSED', value: prefs.reposSidebarCollapsed });
        localStorage.setItem(SIDEBAR_KEY, String(prefs.reposSidebarCollapsed));
      }
    })
    .catch(() => {});
}, []);
```

This requires adding a `SET_REPOS_SIDEBAR_COLLAPSED` action alongside `TOGGLE_REPOS_SIDEBAR`.

### 3. Cross-tab sync (nice-to-have)

Add a `storage` event listener in the same `useEffect` block:

```typescript
const onStorage = (e: StorageEvent) => {
  if (e.key === SIDEBAR_KEY && e.newValue !== null) {
    dispatch({ type: 'SET_REPOS_SIDEBAR_COLLAPSED', value: e.newValue === 'true' });
  }
};
window.addEventListener('storage', onStorage);
return () => window.removeEventListener('storage', onStorage);
```

`StorageEvent` fires in all tabs except the writer, so this gives free cross-tab sync with zero
extra dependencies.

## Acceptance Criteria

1. Collapse the panel → refresh the page (F5) → panel remains collapsed.
2. Expand the panel → refresh → panel remains expanded.
3. Panel starts collapsed on first visit (localStorage empty) — defaults to expanded (`false`).
4. *(Nice-to-have)* Collapse in Tab A → Tab B updates automatically without refresh.

## Out of Scope

- Persisting sidebar state per-workspace (global preference is sufficient).
- Mobile drawer state (it is a separate component with different UX).
