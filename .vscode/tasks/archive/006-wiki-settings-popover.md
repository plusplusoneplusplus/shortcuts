---
status: pending
---

# 006: Wiki Settings Popover

## Summary

Add a ⚙ gear icon button to the wiki tab that opens a portal-rendered popover with three actions: Change Wiki (shows LinkWikiPanel as a modal), Unlink (PATCH `repoPath: null`), and Open in Wiki Section (navigate to `#wiki/{wikiId}`). The popover closes on click-outside and Escape.

## Motivation

Once a wiki is linked to a repo, users need a way to manage that association — change it, remove it, or jump to the standalone wiki view. This is a small, self-contained UI addition that layers cleanly on top of the fully-functional wiki tab (commits 1–5) without modifying any data flow or resolution logic. Isolating it as the final commit keeps the core wiki-tab integration reviewable on its own.

## Changes

### Files to Create

- **`packages/coc/src/server/spa/client/react/repos/RepoWikiTab/WikiSettingsPopover.tsx`**
  - Props: `{ wikiId: string; wikiName: string; wikiDir: string; onUnlink: () => void; onChangeWiki: () => void }`
  - Renders a small gear button (⚙) that toggles a `ReactDOM.createPortal`-rendered popover, following the exact same pattern as `AIActionsDropdown.tsx`:
    - `triggerRef` / `menuRef` refs for positioning and click-outside detection.
    - `handleToggle` computes position from `triggerRef.current.getBoundingClientRect()`, sets `menuPos`, toggles `open`.
    - `useEffect` for overflow correction after render (identical to `AIActionsDropdown` lines 45–62).
    - `useEffect` for click-outside close: `document.addEventListener('mousedown', handler)` with `requestAnimationFrame` deferral (identical to `AIActionsDropdown` lines 65–80).
    - `useEffect` for Escape close (identical to `AIActionsDropdown` lines 83–90).
  - Trigger button styling: `cn('flex-shrink-0 w-6 h-6 flex items-center justify-center rounded text-xs', 'hover:bg-black/[0.06] dark:hover:bg-white/[0.06] transition-colors', 'text-[#848484] dark:text-[#999]', open && 'bg-black/[0.06] dark:bg-white/[0.06]')`. Uses `data-testid="wiki-settings-trigger"`.
  - Popover menu container: same classes as `AIActionsDropdown` menu — `fixed z-50 min-w-[220px] rounded-md border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#252526] shadow-lg py-1`. Uses `data-testid="wiki-settings-menu"`.
  - Popover contents (top to bottom):
    1. **Header row** — `px-3 py-2 border-b border-[#e0e0e0] dark:border-[#3c3c3c]`:
       - `"Current: {wikiName}"` in `text-xs font-medium text-[#1e1e1e] dark:text-[#cccccc]`.
       - `"{wikiDir}"` on a second line in `text-[10px] text-[#848484] dark:text-[#666] truncate max-w-[240px]`.
    2. **"Change Wiki…"** button — full-width menu item: `w-full text-left flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-black/[0.04] dark:hover:bg-white/[0.04]`. Icon: `🔄`. Calls `onChangeWiki()` then closes the popover. Uses `data-testid="wiki-change-btn"`.
    3. **"Unlink"** button — same menu item styling. Icon: `🔗` (with strikethrough text or just the label). On click:
       - Sets a local `unlinking` state to `true` (disables button, shows "Unlinking…").
       - Calls `fetch(getApiBase() + '/wikis/' + encodeURIComponent(wikiId), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ repoPath: null }) })`.
       - On success: calls `onUnlink()`, closes the popover.
       - On error: shows inline error text below the button in `text-[10px] text-[#f14c4c]`.
       - Uses `data-testid="wiki-unlink-btn"`.
    4. **Divider** — `border-t border-[#e0e0e0] dark:border-[#3c3c3c] my-1`.
    5. **"Open in Wiki Section →"** link — same menu item styling but uses an `<a>` or `<button>` that sets `location.hash = '#wiki/' + wikiId`. Uses `text-[#0078d4] dark:text-[#3794ff]` for the text color to indicate navigation. Uses `data-testid="wiki-open-standalone"`.
  - Imports: `useState, useRef, useEffect, useCallback` from `react`; `ReactDOM` from `react-dom`; `cn` from `../../shared/cn`; `getApiBase` from `../../utils/config`.

- **`packages/coc/test/spa/react/repos/WikiSettingsPopover.test.tsx`** (new)
  - Test suite for the popover component in isolation.

### Files to Modify

- **`packages/coc/src/server/spa/client/react/repos/RepoWikiTab/RepoWikiTab.tsx`**
  - Import `WikiSettingsPopover`.
  - Import `Dialog` from `../../shared` (for the "Change Wiki" modal wrapper).
  - Add state: `const [changeWikiOpen, setChangeWikiOpen] = useState(false)`.
  - When a wiki is resolved and `WikiDetail` is rendered, render `WikiSettingsPopover` in the top-right of the wiki tab content area. Position it using a flex container or absolute positioning within a `relative` wrapper:
    ```tsx
    <div className="relative flex-1 min-h-0 flex flex-col">
      <div className="absolute top-2 right-2 z-10">
        <WikiSettingsPopover
          wikiId={wiki.id}
          wikiName={wiki.name}
          wikiDir={wiki.wikiDir}
          onUnlink={handleUnlink}
          onChangeWiki={() => setChangeWikiOpen(true)}
        />
      </div>
      <WikiDetail ... />
    </div>
    ```
  - Implement `handleUnlink`:
    - Clears the resolved wiki state (sets it to `null` or triggers re-resolution).
    - This causes the component to fall back to `LinkWikiPanel` (the "no wiki" state).
  - Render "Change Wiki" modal when `changeWikiOpen` is true:
    ```tsx
    <Dialog open={changeWikiOpen} onClose={() => setChangeWikiOpen(false)} title="Change Wiki">
      <LinkWikiPanel
        workspaceId={workspaceId}
        rootPath={rootPath}
        onLinked={() => { setChangeWikiOpen(false); /* re-resolve */ }}
      />
    </Dialog>
    ```
    This reuses the existing `LinkWikiPanel` inside a `Dialog` portal — no new linking UI needed.

### Files to Delete

(none)

## Implementation Notes

### Portal-Rendered Popover (Not Inline)

Follow the `AIActionsDropdown` pattern exactly: `ReactDOM.createPortal` with fixed positioning computed from `getBoundingClientRect()`. This avoids overflow clipping issues since the popover renders inside a scrollable wiki content area. The `AIActionsDropdown` already handles:
- Overflow correction (menu repositions if it would go off-screen).
- Click-outside via `mousedown` listener with `requestAnimationFrame` deferral (prevents the opening click from immediately closing).
- Escape key close.

All three behaviors should be copied verbatim — the logic is proven and tested.

### Unlink Is a Direct PATCH, Not a Callback

The `onUnlink` callback tells the parent to clear its resolved wiki state, but the actual PATCH call lives inside `WikiSettingsPopover` itself. This keeps the parent simple (it just needs to "forget" the wiki) and lets the popover manage its own loading/error state for the unlink operation. This mirrors how `AddRepoDialog` makes its own fetch calls and only calls `onSuccess`/`onClose` on the parent.

### Change Wiki Modal Reuses LinkWikiPanel

Rather than building a new wiki-picker UI, wrap the existing `LinkWikiPanel` inside a `Dialog` component. The `Dialog` (from `shared/Dialog.tsx`) already handles:
- Portal rendering to `document.body`.
- Backdrop click to close.
- Escape key to close.
- VS Code-consistent dark/light styling.

`LinkWikiPanel` already has all three linking options (select existing, specify path, generate). When used as a "change" modal, it behaves identically — the newly linked wiki replaces the current association.

### getApiBase() for PATCH Call

Use `getApiBase()` from `../../utils/config` (not `fetchApi` from `useApi.ts`) because `fetchApi` only supports GET requests. The PATCH call follows the same pattern as `AddRepoDialog` lines 150–154: `fetch(getApiBase() + '/wikis/...' , { method: 'PATCH', ... })`.

### Gear Icon Visibility

The `WikiSettingsPopover` is only rendered when a wiki is resolved (i.e., `WikiDetail` is visible). When no wiki is linked, the `LinkWikiPanel` renders instead and there is no gear icon — there's nothing to configure.

## Tests

- **Renders gear button** — When the component mounts, a button with `data-testid="wiki-settings-trigger"` containing "⚙" is visible.
- **Popover toggles on click** — Clicking the gear button shows the popover (`data-testid="wiki-settings-menu"`); clicking again hides it.
- **Shows wiki info** — Popover displays the `wikiName` and `wikiDir` in the header section.
- **Change Wiki calls onChangeWiki** — Clicking "Change Wiki…" (`data-testid="wiki-change-btn"`) calls the `onChangeWiki` prop and closes the popover.
- **Unlink calls PATCH then onUnlink** — Clicking "Unlink" (`data-testid="wiki-unlink-btn"`) sends `PATCH /api/wikis/{wikiId}` with `{ repoPath: null }`, then calls `onUnlink`. Mock `fetch` to verify the request body and method.
- **Unlink shows loading state** — While the PATCH is in flight, the unlink button text changes to "Unlinking…" and is disabled.
- **Unlink shows error on failure** — If PATCH returns a non-ok response, an error message appears inline; `onUnlink` is not called.
- **Open in Wiki Section navigates** — Clicking "Open in Wiki Section →" (`data-testid="wiki-open-standalone"`) sets `location.hash` to `#wiki/{wikiId}`.
- **Click-outside closes popover** — Clicking outside the popover and trigger button closes it.
- **Escape closes popover** — Pressing Escape while the popover is open closes it.
- **RepoWikiTab integration: gear appears when wiki linked** — When `RepoWikiTab` renders with a resolved wiki, the gear button is present in the DOM.
- **RepoWikiTab integration: unlink returns to LinkWikiPanel** — After `handleUnlink` fires, `RepoWikiTab` re-renders showing `LinkWikiPanel` instead of `WikiDetail`.
- **RepoWikiTab integration: Change Wiki opens Dialog with LinkWikiPanel** — Clicking "Change Wiki…" opens a `Dialog` containing `LinkWikiPanel`; closing the dialog returns to the wiki view.

## Acceptance Criteria

- [ ] A ⚙ gear icon is visible in the top-right of the wiki tab content when a wiki is linked.
- [ ] Clicking the gear opens a portal-rendered popover with wiki info, Change Wiki, Unlink, and Open in Wiki Section actions.
- [ ] The popover closes on click-outside, Escape, and after any action is taken.
- [ ] "Change Wiki…" opens a Dialog containing LinkWikiPanel; selecting a new wiki re-links and refreshes the view.
- [ ] "Unlink" sends PATCH `/api/wikis/{wikiId}` with `{ repoPath: null }`, shows loading state, then returns the tab to the empty/link state.
- [ ] "Unlink" shows an inline error if the PATCH fails; does not change the wiki state on failure.
- [ ] "Open in Wiki Section →" navigates to `#wiki/{wikiId}`.
- [ ] Popover repositions to avoid going off-screen (overflow correction).
- [ ] All styling follows existing SPA design tokens (matches AIActionsDropdown, Dialog, Button patterns).
- [ ] No gear icon is visible when no wiki is linked (LinkWikiPanel state).
- [ ] All new tests pass.
- [ ] No regressions in existing wiki tab, LinkWikiPanel, or WikiDetail behavior.

## Dependencies

- Depends on: 005

## Assumed Prior State

- Full Wiki tab is functional in repo detail page (commits 1–5).
- `RepoWikiTab` renders `WikiDetail` (embedded) when a wiki is linked, and `LinkWikiPanel` when no wiki is found.
- `LinkWikiPanel` exists with all three linking options (select existing, specify path, generate new).
- `PATCH /api/wikis/:wikiId` accepts `repoPath` (including `null` for unlinking) on the server.
- `Dialog` component exists in `shared/Dialog.tsx` with portal rendering, backdrop close, and Escape handling.
- `AIActionsDropdown` in `shared/AIActionsDropdown.tsx` provides the proven popover pattern to follow.
- `getApiBase()` is available from `utils/config` for constructing API URLs.
