---
status: pending
---

# 002: WikiDetail embedded mode

## Summary

Add `embedded?: boolean` and `hashPrefix?: string` props to `WikiDetail` so it can be hosted inside other views (e.g. the Repo Detail page) without its own header bar and with caller-controlled hash routing.

## Motivation

The upcoming Wiki Tab in the Repo Detail Page will render `WikiDetail` as a child panel. In that context the back-button / project-name / status-badge header is redundant (the parent page already shows repo context) and hash fragments must be scoped under the parent's routing prefix rather than `#wiki/{id}/`. Making this a small, self-contained commit keeps the surface area reviewable and lets the Repo Detail integration (later commit) simply pass two props.

## Changes

### Files to Create
- (none)

### Files to Modify

- `packages/coc/src/server/spa/client/react/wiki/WikiDetail.tsx` — Add embedded-mode props and conditional rendering
- `packages/coc/test/spa/react/WikiDetailLayout.test.ts` — Add tests for embedded mode and hashPrefix behaviour

### Files to Delete
- (none)

## Implementation Notes

### 1. Props

```ts
interface WikiDetailProps {
    wikiId: string;
    embedded?: boolean;   // hide top header bar when true
    hashPrefix?: string;  // e.g. "#repo/abc123/wiki/" — replaces "#wiki/{id}/"
}
```

Destructure with defaults: `{ wikiId, embedded = false, hashPrefix }`.

### 2. Hash builder

Introduce a local helper (or refactor `buildWikiHash`) that the component calls everywhere `location.hash` is set. The logic:

```ts
function resolveHash(tab: WikiProjectTab, componentId?: string | null, adminTab?: WikiAdminTab | null): string {
    if (hashPrefix) {
        // hashPrefix already includes trailing slash, e.g. "#repo/abc/wiki/"
        if (componentId) return hashPrefix + 'component/' + encodeURIComponent(componentId);
        if (tab === 'browse') return hashPrefix.replace(/\/$/, '');   // strip trailing slash for bare path
        if (tab === 'admin' && adminTab && adminTab !== 'generate') return hashPrefix + 'admin/' + adminTab;
        return hashPrefix + tab;
    }
    return buildWikiHash(wikiId, tab, componentId, adminTab);
}
```

Keep the existing module-level `buildWikiHash` untouched (other callers may use it). The new helper is a closure inside `WikiDetail` that captures `hashPrefix` and `wikiId` from scope.

All four `location.hash = …` sites (`handleBack`, `changeTab`, `handleAdminTabChange`, `handleSelectComponent`) switch to `resolveHash(…)`.

### 3. Header bar conditional

Lines 188-225 currently render the top bar unconditionally. Wrap in:

```tsx
{!embedded && (
    <div className="flex items-center gap-2 …">
        {/* existing back button, color dot, title, badge, tab bar */}
    </div>
)}
```

### 4. Inline tab bar for embedded mode

When `embedded` is true the four wiki sub-tabs still need to be accessible. Render a lightweight tab strip at the top of the content area:

```tsx
{embedded && (
    <div className="flex gap-0.5 px-3 py-1.5 border-b border-[#e0e0e0] dark:border-[#3c3c3c]" id="wiki-project-tabs">
        {WIKI_TABS.map(t => (
            <button key={t} className={cn(…same styles…)} data-wiki-project-tab={t} onClick={() => changeTab(t)}>
                {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
        ))}
    </div>
)}
```

This keeps the `id="wiki-project-tabs"` and `data-wiki-project-tab` attributes so existing test selectors continue to work.

### 5. handleBack in embedded mode

When `embedded` is true, `handleBack` is never called (the back button is hidden). No functional change is needed, but for safety make it a no-op when embedded:

```ts
const handleBack = useCallback(() => {
    if (embedded) return;
    dispatch({ type: 'SELECT_WIKI', wikiId: null });
    location.hash = '#wiki';
}, [dispatch, embedded]);
```

### 6. Height class tweak

The root `<div>` uses `h-[calc(100vh-48px)]` which assumes the 48px main nav. When embedded the parent controls height, so switch to `h-full`:

```tsx
<div className={cn('flex flex-col overflow-hidden', embedded ? 'h-full' : 'h-[calc(100vh-48px)]')} id="view-wiki">
```

### Key decisions
- `buildWikiHash` remains exported and unchanged — other modules (hash router, wiki list) still call it.
- `hashPrefix` is expected to include a trailing `#…/` so the component doesn't need to know the parent route structure.
- The existing `id` and `data-*` attributes on the tab bar are preserved in both modes for test compatibility.

## Tests

In `WikiDetailLayout.test.ts` (source-level pattern-matching tests):

1. **embedded mode hides header** — verify the source contains `!embedded` conditional wrapping the top bar `<div>`.
2. **embedded mode renders inline tab bar** — verify the source contains a conditional `{embedded && (` block that includes `id="wiki-project-tabs"`.
3. **hashPrefix prop declared** — verify `WikiDetailProps` contains `hashPrefix?: string`.
4. **embedded prop declared** — verify `WikiDetailProps` contains `embedded?: boolean`.
5. **resolveHash uses hashPrefix** — verify the source contains a code path referencing `hashPrefix` when computing `location.hash`.
6. **handleBack is no-op when embedded** — verify the source contains `if (embedded) return` inside `handleBack`.
7. **root div uses h-full in embedded mode** — verify the source contains `embedded ? 'h-full'` (or equivalent conditional).

## Acceptance Criteria

- [ ] `WikiDetailProps` includes `embedded?: boolean` and `hashPrefix?: string`
- [ ] When `embedded=true`, the top header bar (back button, project name, status badge) is not rendered
- [ ] When `embedded=true`, the wiki sub-tabs (Browse, Ask, Graph, Admin) render as an inline strip above the content area
- [ ] All `location.hash` assignments use `hashPrefix` when it is provided
- [ ] `handleBack` is a no-op when `embedded=true`
- [ ] Root container uses `h-full` instead of `h-[calc(100vh-48px)]` when embedded
- [ ] Existing `buildWikiHash` function is unchanged (non-breaking for other callers)
- [ ] All existing tests in `WikiDetailLayout.test.ts` continue to pass
- [ ] New tests cover embedded-mode props, header hiding, hashPrefix routing, and inline tabs
- [ ] `npm run build` succeeds

## Dependencies

- Depends on: None (parallel with commit 1)

## Assumed Prior State

None relevant — `WikiDetail.tsx` is unchanged from its current form on the working branch. Commit 1 (PATCH repoPath endpoint) touches only server-side code with no overlap.
