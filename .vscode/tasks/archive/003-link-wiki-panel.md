---
status: done
---

# 003: LinkWikiPanel component

## Summary

Create the `LinkWikiPanel` React component that is displayed when a repo has no associated wiki. It presents three options: link an existing wiki from `state.wikis`, specify a wiki directory path manually, or generate a brand-new wiki.

## Motivation

This is a self-contained UI component with no overlap with the WikiDetail embedded mode (commit 2) or the routing/tab shell that will consume it later. Isolating it in its own commit keeps the diff focused on the three linking flows and their shared state interactions.

## Changes

### Files to Create

- `packages/coc/src/server/spa/client/react/repos/RepoWikiTab/LinkWikiPanel.tsx` — The panel component with three sections:

  **Props:** `{ workspaceId: string; rootPath: string; onLinked: () => void }`

  **Section A — Link existing wiki:**
  - Read `state.wikis` via `useApp()` from `context/AppContext.tsx`.
  - Filter to unlinked wikis (those whose `repoPath` does not match any other repo, or is empty/undefined).
  - Render a `<select>` dropdown of unlinked wikis (display `wiki.name || wiki.id`, value = `wiki.id`). Show placeholder "Select a wiki…" as default disabled option.
  - "Link" `<Button>` next to the dropdown.
  - On click: `PATCH {getApiBase()}/wikis/{selectedWikiId}` with `{ repoPath: rootPath }` (JSON body, `Content-Type: application/json`). On success, dispatch `UPDATE_WIKI` with the response and call `onLinked()`.

  **Section B — Specify wiki path:**
  - Text `<input>` for an arbitrary directory path (e.g. `/home/user/my-wiki`).
  - Inline validation: non-empty, display error text below input if submitted empty.
  - "Link Path" `<Button variant="secondary">`.
  - On click: derive an `id` via `slugify(basename(wikiDir))` (same slugify pattern as `AddWikiDialog`). POST `{getApiBase()}/wikis` with `{ id, wikiDir, repoPath: rootPath }`. On success, dispatch `ADD_WIKI` with response and call `onLinked()`.

  **Section C — Generate new wiki:**
  - `<Button>` with label "+ Generate Wiki" (primary variant, larger/prominent).
  - On click: POST `{getApiBase()}/wikis` with `{ id: slugify(repoBasename), name: repoBasename, repoPath: rootPath }`. On success, dispatch `ADD_WIKI`, then navigate to wiki admin tab: `dispatch({ type: 'SELECT_WIKI_WITH_TAB', wikiId: newWiki.id, tab: 'admin', adminTab: 'generate' })` and `dispatch({ type: 'SET_ACTIVE_TAB', tab: 'wikis' })`. Call `onLinked()`.

  **Layout & style:**
  - Follow the SPA empty-state visual pattern: centered content, emoji icon (📚), descriptive text, muted secondary text (`text-[#848484]`).
  - Each section wrapped in a `<Card className="p-3">` with a small heading (`text-xs font-medium`).
  - Section dividers: use "or" text between cards (`text-xs text-[#848484] text-center py-2`).
  - Error/status text: `text-xs text-[#f14c4c]` for errors, inline below the action that triggered them.
  - Loading state: pass `loading` prop to `<Button>` during API calls (shows `<Spinner size="sm" />`).

  **Imports:** `useState, useCallback` from React; `Button, Card` from `../shared`; `cn` from `../shared/cn`; `getApiBase` from `../utils/config`; `useApp` from `../context/AppContext`.

- `packages/coc/src/server/spa/client/react/repos/RepoWikiTab/LinkWikiPanel.test.tsx` — Vitest + testing-library tests.

### Files to Modify

- (none)

### Files to Delete

- (none)

## Implementation Notes

- **`fetchApi` vs raw `fetch`:** Use raw `fetch` (not the `fetchApi` hook) for POST/PATCH because `fetchApi` is GET-only and read-only. This matches the pattern in `WikiAdmin.tsx` (line 190, 512, 541) and `AddWikiDialog.tsx` (line 36) which all use `fetch(getApiBase() + path, { method, headers, body })` directly.
- **`slugify` helper:** Reuse the same logic as `AddWikiDialog.tsx` (line 11-13): `name.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')` with fallback `'wiki-' + Date.now()`. Define it locally (or extract to a shared util in a future commit) — keep this commit self-contained.
- **Unlinked wikis filter:** A wiki is "unlinked" if it has no `repoPath`, or its `repoPath` matches the _current_ repo's `rootPath` (already linked to this repo — but that means the panel shouldn't show at all). Safest: filter to wikis where `!wiki.repoPath`.
- **Dispatch patterns:** `UPDATE_WIKI` replaces the wiki in `state.wikis` by matching `wiki.id` (AppContext line 166-172). `ADD_WIKI` appends (line 165). Both are already defined.
- **Navigation for generate flow:** After creating the wiki via POST, dispatch `SELECT_WIKI_WITH_TAB` to navigate to the wiki detail admin generate tab. The caller (`RepoWikiTab` in a later commit) will also react to `onLinked()` to refresh its own state.
- **No new shared components needed:** The select dropdown uses a plain `<select>` with standard SPA styling (matches `WikiAdmin.tsx` line 299-308: `text-xs px-2 py-1 rounded border …`). The text input uses the same classes as `AddWikiDialog.tsx` (line 76, 86).
- **Test IDs:** Add `data-testid` attributes for test targeting: `link-wiki-panel`, `link-existing-select`, `link-existing-btn`, `link-path-input`, `link-path-btn`, `generate-wiki-btn`.

## Tests

- Renders three sections (link existing, specify path, generate) with correct headings
- Section A: populates dropdown with unlinked wikis from `state.wikis`, disables "Link" button when no wiki selected
- Section A: calls PATCH `/api/wikis/{id}` with `{ repoPath }` on "Link" click, dispatches `UPDATE_WIKI`, and calls `onLinked`
- Section B: shows validation error when submitting with empty path input
- Section B: calls POST `/api/wikis` with `{ id, wikiDir, repoPath }` on "Link Path" click, dispatches `ADD_WIKI`, and calls `onLinked`
- Section C: calls POST `/api/wikis` on "+ Generate Wiki" click, dispatches `ADD_WIKI` + `SELECT_WIKI_WITH_TAB`, and calls `onLinked`
- Shows loading spinner on buttons during API calls
- Shows inline error message when API call fails (non-ok response)
- Filters out wikis that already have a `repoPath` from the dropdown

## Acceptance Criteria

- [ ] `LinkWikiPanel` renders three clearly separated sections for linking an existing wiki, specifying a path, and generating a new wiki
- [ ] Dropdown in Section A lists only wikis from `state.wikis` that have no existing `repoPath`
- [ ] PATCH request to `/api/wikis/:id` is sent with correct `{ repoPath }` payload when linking an existing wiki
- [ ] POST request to `/api/wikis` is sent with correct payload when specifying a wiki path or generating
- [ ] `onLinked()` callback is invoked on every successful link/create action
- [ ] `ADD_WIKI` or `UPDATE_WIKI` is dispatched to keep `state.wikis` in sync without a full refetch
- [ ] Generate flow navigates to wiki admin generate tab via `SELECT_WIKI_WITH_TAB` dispatch
- [ ] Loading states shown on buttons during API calls; error messages shown inline on failure
- [ ] Empty path input in Section B shows validation error without making an API call
- [ ] Visual style matches existing SPA empty-state patterns (centered layout, muted text, Card wrappers)
- [ ] All tests pass

## Dependencies

- Depends on: 001 (PATCH `/api/wikis/:wikiId` accepts `repoPath`)

## Assumed Prior State

PATCH `/api/wikis/:wikiId` accepts `repoPath` in request body (from commit 1). The `state.wikis` array is populated by the existing wiki-loading logic in the SPA. `ADD_WIKI`, `UPDATE_WIKI`, and `SELECT_WIKI_WITH_TAB` actions are already defined in `AppContext.tsx`.
