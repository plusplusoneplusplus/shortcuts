# unified-right-panel

The workspace's one and only right panel: a Cursor-style resource-tabbed column
holding Terminal, Notes, Settings, files, notes, canvases, chat diffs, local HTML pages, and web browser tabs, with a
Search/Explorer navigator at its right edge. The panel is unconditional within
the desktop dock gate.

`RepoDetail.tsx` and `repos/RepoGroupView.tsx` render it under the
`dockAvailable` gate (desktop) and wrap their subtree in
`UnifiedPanelHostProvider` under the same condition; the panel does not widen
that gate. The state around it — open, selected Search/Explorer mode, width,
resize, and target — comes from
`../useWorkspaceDock`, described in `../AGENTS.md`.

## Scope, owner, and identity

Three different workspace ids, kept apart on purpose:

- **Panel scope** (`workspaceId`) — whose localStorage the tab set lives in. In a
  repo group this is the group id.
- **Tab owner** (`tab.ownerWorkspaceId` + `tab.ownerRoutingRef`) — the owning
  server's workspace id plus its concrete clone route. A remote clone key keeps
  equal workspace ids on different hosts separate; `null` pins a local owner to
  page origin. Route every file and language request with both fields.
- **Dock target** — what `useWorkspaceDock` points Terminal and Explorer at. It
  affects new tabs only; changing it never retargets an open one. A multi-target
  panel (repo group, remote clones) switches it from `UnifiedPanelRepoPicker` on
  the tab strip; a switch also closes the `+` menu, whose search results are
  scoped to the repo they were fetched from.

Tabs are scoped by kind: `terminal | notes | settings | note | html-page | browser` are workspace-owned,
`file | canvas | diff | git | external | paste | todo` belong to the selected chat (`scopeForKind`).
A restored workspace list drops chat-owned kinds (legacy workspace Git tabs).
Chat-owned tabs opened while no chat is selected belong to the draft
`@workspace` scope. When that draft creates a chat, its tabs are copied into the
new chat in strip order with rebuilt ids and the same active/preview state; the
draft originals remain available for the next new conversation.
Display grouping is separate from ownership: `displayGroupForKind` puts
`canvas`, `git`, and `todo` with workspace kinds as `tools` and
`file | diff | external | paste` in `resources`. With default-on
`features.panelTabReordering` set to `false`, the strip groups workspace tools, chat
tools and resources, and confines moves to a section. Enabled, `moveVisibleTab`
stores a mixed id order in `orderByScope` for the selected chat/draft within the
owner-qualified panel storage scope. Drag target halves, Alt+Left/Right and
Move left/right menu actions share that order; the divider is omitted. Ordering
never changes descriptors, ownership, selection or keyed live views. The strip
accepts only its own native HTML drag session, auto-scrolls overflow near its
edges and cancels on Escape, drag end, source close or scope/flag changes.
Transient excursion tabs are excluded. Native HTML dragging does not add touch
gestures; keyboard and menu actions remain available.
`external` is a read-only definition source outside every workspace; its
resource id is the opaque capability the owning member's host issued, it has no
entry in the "+" menu, and it is never persisted. `html-page` carries an absolute
local path and an Electron view id, dedupes across chats in its panel scope, and is
persisted with its view id so a reload opens the file from disk. `paste` descriptors use `unifiedPasteTabs.ts` for a
stable content hash and character-count title; matching content dedupes within
the same chat and concrete owner. Paste descriptors and active selections are
ephemeral and have no `+` menu action. `openUnifiedPasteTab` captures raw text
in a panel-scope/resource-id memory map before opening the descriptor. Every
panel-state write prunes snapshots without a referencing paste tab; draft/chat
copies share a snapshot until the last copy closes. Clearing panel state releases
its snapshots. `UnifiedPasteTab` reads the panel-scope snapshot and hydrates
`RichEditorCore` in read-only mode using Markdown conversion without note I/O.
Its copy action uses the raw snapshot; it registers no dirty or save handlers.
`browser` is a session-only web tab (see "Browser
tabs"); every open mints a fresh resource id, so it never dedupes. `unifiedTabId`
folds kind, owner, scope key, and resource id into one id with `|` escaped, so a
resource id cannot forge another tab's identity. The selected chat comes from the
queue store's `selectedTaskIdByRepo[workspaceId]` — never the global
`selectedTaskId`, which can name another workspace's chat. `unifiedTabId` uses
the concrete route as the owner identity when one exists, so equal relative paths
from same-id clones never merge into one tab.
Editable file opens from the tree, definitions, file picker and closed-file history
resolve owning-filesystem spelling before publication. Resolution queues retain
the concrete owner and chat; failures offer Retry without opening another buffer.
Pre-existing duplicate buffers remain untouched and block ambiguous reuse.
`UnifiedTabView` scopes language documents and transport sessions by panel and
chat; Peek reuses only that scope's live model, and split mirrors share the tab's
model. A dock target change keeps explicit member opens valid within that panel.

## Layers

| File | Holds |
|---|---|
| `unifiedPanelTabsModel.ts` | Pure state: reading, opening, preview replacement, draft inheritance, promotion, activation, closing, section moves and mixed visible-order moves, plus the versioned localStorage codec. Every no-op retains the state reference for `useSyncExternalStore`. `orderByScope` holds id-only presentation order without moving descriptors between lists. Notes descriptors hold only panel-local selection. External tabs and their selections are ephemeral. Line-targeted opens mint a non-persisted `revealNonce`; ordinary refocusing retains position without scrolling. |
| `unifiedPanelStore.ts` | One localStorage entry per panel scope (`unifiedPanelStorageKey`), read through `useSyncExternalStore`; same pattern as `explorer/explorerStateStore`. `migrateUnifiedPanelState` rewrites an older entry at mount — it writes, so it runs in an effect, never in a `getSnapshot`. |
| `unifiedPanelTree.ts` | The navigator column's open and width state per panel scope, in its own localStorage entry. Panel-level, not per-tab — it outlives tab/chat/mode switches, panel collapse, and reload. Owns the two width rules: the navigator is clamped so the view keeps `UNIFIED_PANEL_VIEW_MIN_WIDTH`, and a panel narrower than `UNIFIED_TREE_MIN_PANEL_WIDTH` hides the column until widening restores it. |
| `useUnifiedPanelTabs.ts` | The in-tree hook. `chatId` selects a *view* over the stored state, not a session. |
| `unifiedPanelOpen.ts` | The imperative seam for callers outside the panel subtree: `openUnifiedPanelTab`, `focusUnifiedPanelTab`, `inheritDraftPanelTabs`, `unifiedTabIdFor`, `updateUnifiedPanelState`. Works with no panel mounted; inheritance is the non-revealing entry point. |
| `unifiedPanelHost.tsx` | The "may I reroute?" signal. `useUnifiedPanelHostForChat(chatId)` returns a host **only** when the panel is showing that chat's tabs. |
| `UnifiedRightPanel.tsx` | The shell: reuses `useWorkspaceDock` wholesale (open/mode/width/resize/target), keep-alive, dirty/error sets, the close guards, and the layout — resource views on the left, the selected Search/Explorer mode on the right edge. |
| `unifiedPanelNavigationHistory.ts` | Pure file-location history: panel-scope/tab identity, VS Code-style ten-line coalescing, branching, the 50-entry bound, replay suppression, missing-file drop, and the versioned codec. Each entry carries its file's reopen descriptor, so closing a tab keeps its entries; Back/Forward onto a closed file reopens it as a preview (through the preview slot's unsaved-edits guard) in the current chat's view, and never steps onto another scope's entries. |
| `unifiedPanelNavigationStore.ts` + `fileNavigationRouting.ts` | History per panel scope, cached in memory and persisted to `unified-right-panel:<scope>:navigation` (unreadable or entry-less-reopen-data is dropped on load), plus pure Go Back/Forward key (Alt+Arrow, or Ctrl+-/Ctrl+Shift+- on macOS) and auxiliary mouse-button classification. |
| `quickOpenRouting.ts`, `closeTabRouting.ts`, `findRouting.ts` | Pure ownership rules for the panel's document-level keyboard shortcuts. Find ownership is scoped to focus inside the Explorer navigator column. |
| `UnifiedPanelTabStrip.tsx` + `UnifiedPanelCanvasStack.tsx` + `UnifiedPanelTabContextMenu.tsx` + `unifiedPanelTabMenuModel.ts` | Presentational strip, native drag insertion markers and accessible tab menu. Four or more canvases compress into the active canvas plus a searchable count chip; switching and guarded closing preserve stored order. Grouped ordering draws a tools/resources divider. File tabs share Explorer's `FileNameIcon` and show the bare filename: no repo badge, with `unifiedTabTooltip` giving the `dirtyCloseLabel` repo-qualified path and the repo kept in screen-reader text; other kinds use fixed icons and keep their `repoLabel` badge. The menu model owns per-kind availability, move boundaries, local-only absolute paths and visible-order bulk targets. |
| `unifiedPanelSourceSplit.ts` + `UnifiedSourceMirror.tsx` | The two-pane source split (see "Source split"): pure drop/reconcile/width rules and the session-only split store, plus the second Monaco view used when one file fills both panes. |
| `unifiedPanelBreadcrumbs.ts` + `UnifiedPanelToolbar.tsx` | The toolbar row under the strip: breadcrumbs for the active file tab, an in-place directory picker, and the Search/Explorer navigator controls. The model decides whether the path can use repo browsing. **Do not** name the model `unifiedPanelToolbar.ts` — esbuild resolves module paths case-insensitively and collides it with the component. |
| `UnifiedPanelRepoPicker.tsx` | The dock target, as a button + listbox on the tab strip left of the `+` (the strip's `leadingControls`). Renders nothing below two targets. The label comes from the `target` prop, so a refused switch (`onSelectTarget` returning `false`) keeps reporting the real scope; below 340px of strip width the label drops to a chevron via a container query. |
| `UnifiedPanelTreeToggle.tsx` | The Explorer half of the panel's navigator controls. It renders with Search in the file toolbar or, when that toolbar is absent, in the tab strip. |
| `UnifiedTabView.tsx` | The kind switch. Every kind maps onto a view that already exists. |
| `UnifiedPanelOpenMenu.tsx` + `unifiedPanelOpenMenuModel.ts` | The searchable `+` popover. It reads `targets` for labels and the unavailable reason but does not change the target — the strip picker owns that. A query that normalizes to an http(s) URL adds an "Open … Browser" row (first for an explicit scheme, after file hits for a bare domain); a query written with another scheme adds an unselectable inline error row. Plain text stays a file search. |
| `unifiedBrowserTabs.ts` + `UnifiedBrowserTab.tsx` | Browser tab rules and view: `normalizeBrowserUrl` (http(s) only, `https://` for a bare domain, `http://` for loopback, no search fallback), `browserOpenInput`, and `browserSessionKey` (the concrete owner route, else workspace id). The view owns navigation, inline rejection and an Open in system browser fallback. The … menu opens `BrowserCookieImportDialog` when the desktop bridge supports `importCookies`: an editable domain plus JSON or cookie pairs, sent through owner-checked local IPC to the retained engine profile. Blank tabs import directly into the related or configured engine profile without creating a page; existing tabs keep their retained engine. Imports stay independent of redirects and never navigate automatically; cookie text stays in dialog state and is discarded on close. JSON preserves cookie attributes and supplied expiry/session semantics; pairs use host-only, secure cookies at `/` with SameSite Lax and expiry 30 days from import, surviving CoC restarts in that engine's installation-wide profile. Ctrl+L (Cmd+L on macOS) focuses and selects its complete editable value from toolbar controls or owner-qualified native `onFocusAddressRequested` events, only while active and visible. |
| `BrowserAddressBar.tsx` | Shared address editing and optional history combobox. Blank input makes no suggestion queries or dropdown; clearing invalidates replies. Main ranks eight suggestions with case-preserving suffix completion. Stored-URL activation, Escape, deletion/paste/caret/IME and owner checks preserve editing. Standard Copy adds escaped HTML plus the raw URL only for a fully selected, unedited committed page; drafts, partial selections and cut retain native defaults. Optional native address menus dispatch ordinary editing commands. See the knowledge shell reference for committed-page identity and clipboard fallback contracts. |
| `NativeViewTab.tsx` + `useNativeViewPlacement.ts` | Shared frame and navigation buttons. Electron browser/HTML placeholders register with the persistent webview layer; WebView2 uses native placement and hide-on-overlap. |
| `BrowserWebviewLayer.tsx` + `browserWebviewLayerStore.ts` | App-level Electron guest ownership, adoption, clipped placement, visibility and explicit close. Guests never move between workspace subtrees. |
| `unifiedSourceLinks.ts`, `unifiedNoteTabs.ts`, `unifiedExplorerFiles.ts`, `unifiedCanvasEmbeds.ts`, `unifiedCanvasEvents.ts`, `unifiedDiffSources.ts`, `unifiedChatChanges.ts` | One descriptor builder per entry point. Each returns `OpenUnifiedTabInput | null`; a null means "not ours" and the caller keeps its existing surface. |
| `unifiedGitTabHost.ts` + `UnifiedGitTab.tsx` | One Git tab per chat (fixed `GIT_TAB_RESOURCE_ID`, not in the "+" menu; `unifiedGitTabId` takes the chat id). Only the shown chat's tab mounts, so the host stays one node per panel scope. On a chat switch `useSplitGitPanel` hands `RepoGitTab` a new `viewScopeKey`, which cancels pending lookups and restores that chat's `gitView` or clears the selection. Its body is an empty host published by panel scope; in the desktop split view `RepoDetail` hands it to `RepoGitTab` as the detail portal target and opens the tab on every new git selection, so the middle pane keeps the chat. The descriptor's `gitView` holds only the serializable view (`PersistedGitView`: hashes/paths, never commit data or diffs); after a reload `RepoDetail` passes it to `RepoGitTab` as `restoreView`, which refetches it (a vanished commit shows a not-found notice) without re-focusing the tab. |
| `sentinelTodoPanelModel.ts` (+ dependency-free `sentinelTodoStatusModel.ts`, shared with WhatsApp `list todos`) + `sentinelTodoChats.ts` + `UnifiedTodoTab.tsx` | A Sentinel chat's To-do tab (see "Sentinel To-do"). |
| `sentinelTodoExcursion.ts` + `SentinelTodoOriginBar.tsx` | The way back from a chat opened through a To-do link (see "To-do excursions"). |
| `unifiedChatCanvasActions.ts` | The registry a `canvas` tab calls back into its owning chat through — "Ask AI" and "Send comments". Keyed by chat id alone. |
| `unifiedTerminalClose.ts`, `unifiedDirtyClose.ts` | The two close guards. |

## Views are reused, never re-implemented

Settings uses `repo-settings/WorkspaceSettingsHost.tsx`: one live `RepoSettingsTab`
or `RepoGroupSettingsTab` instance moves between top-level and panel slots through
a stable portal container. Default-on `features.panelSettings` admits the menu
entry; its workspace-owned descriptor carries the panel's concrete owner, never
the dock target. Panel navigation stays local. Closing parks the form without
discarding drafts; the top-level entry remains available. `workspaceSettingsClient.tsx`
pins all settings calls to that owner and rejects missing or changed remote routes
without falling through locally.

There is no second editor, search backend, terminal manager, or canvas store.
`git` is filled by `RepoGitTab`'s own `RepoGitDetailPane` through a portal.
`file` renders the Explorer's own `PreviewPane` (the same buffer controller the
Explorer sub-tab uses), `canvas` renders `CanvasPanel` (the panel is its ONLY
host — the chat has no canvas column of its own), `note` renders
`NoteEditor`, `notes` renders the shared `NotesView` with panel-local selection
restored from its descriptor (a missing path clears after tree validation)
and a container-width layout,
`diff` renders the chat's `WhisperDiffPanel`, and `terminal` renders
`TerminalView`. The add menu activates the target-owned Terminal tab and passes an
in-memory `openRequest`; descriptors never persist creation intent. `TerminalView`
waits for successful hydration before creating through its existing WebSocket
lifecycle if empty, retains pending creates across repeated requests, and requests
xterm focus only while active. Existing sessions are focused without adding a PTY.
Failed hydration uses the terminal notice and permits another explicit request to
retry. REST and PTY calls carry the tab's concrete owner route.
The file tree is not among them: it is
the panel's own column (`ExplorerPanel` in sidebar mode), so no tab mounts a
nested tab strip or a second editor — that is the "one tab row per panel" rule.

`ExplorerPanel`'s `mode` prop is required and picks how much of it renders:
`editor` (the whole Explorer sub-tab, RepoDetail's only mount), `navigator` (tree
only, opens handed to `onOpenFile`), and `sidebar` (navigator without the
internal Files/Search switch or breadcrumb row). The right panel mounts
`ContentSearchPanel` beside the same resource area for Search mode. Both mode
bodies stay mounted after first use; only their visibility changes.

Resource toolbars render *below* the strip.

The live, default-on `features.markdownPanelPreview` flag applies only to
file tabs in this panel. `UnifiedTabView` opts `PreviewPane` into a rendered
default for editable `.md` and `.markdown` files. Its toolbar selects
Rendered or Raw; a line-targeted open selects Raw for Monaco's precise
cursor reveal. Both modes use `useFileContent`'s single edit buffer, with
the rendered view using the shared `useMarkdownPreview` pipeline and the
raw view using the existing editable Monaco editor. A mounted tab retains
its mode and unsaved text across tab switches; no mode preference is stored.
Rendered mode keeps a lightweight file-navigation controller that can
reopen Raw and restore a history destination's selection and scroll.
The standalone Explorer and the read-only source canvas retain their own
file-viewer behavior.

## Source split

Live, default-on `features.panelSourceSplit` lets two `file` tabs show side by
side; no other kind can enter a pane, and there are never more than two. A
file-tab drag from the strip (`onTabDragChange`) shows a drop target over the
right half of the editor area; dropping, or the file tab menu's **Open to the
Right**, puts that file in the right pane and keeps the active file on the
left (the same file on both sides when there is no other active file). A drop
on an existing split replaces only the right pane. Other drags, Escape and drag
end leave the layout unchanged; strip reordering keeps its own targets.

`unifiedPanelSourceSplit.ts` stores `{ left, right, focus, ratio }` tab ids in
memory, keyed by `unifiedPanelStorageKey(scope)` plus chat, so workspace and
chat switches restore only their own split and a reload shows ordinary tabs.
The focused pane is always the active tab: strip selection, Explorer, links,
Quick Open and language navigation all open there. A non-file active tab takes
the full panel without forgetting the split. The unfocused pane's preview tab
is promoted so a tree click never replaces it. Clicking or focusing a pane
focuses it; its header shows the bare file label (repo-qualified path on hover, repo in screen-reader text), dirty dot and close control.
Closing a pane ends the split and keeps both tabs; closing a pane's tab through
the usual guards shows the other pane's file.

Views stay keyed by tab in one row and are positioned with CSS `order` and
flex basis, so entering, resizing or leaving the split never remounts a
buffer. Panes keep at least 280px; below two panes plus the 4px divider
(measured on the editor area, excluding the navigator column) only the focused
pane shows, and widening restores both. The divider drags or uses
Arrow/Home/End within those bounds.

Each pane's `PreviewPane` keeps its own selection, scroll and owner routing.
The same file in both panes is one tab and one `PreviewPane` buffer: it
publishes its Monaco model (`onModelShare`), and `UnifiedSourceMirror` creates
a second editor on that model, following its read-only state and saving
through the tab's registered save. Equal paths from different owners or clones
are different tabs and buffers.

## File navigation history

The panel owns one history of file locations per panel scope, persisted to
localStorage. A location carries the panel scope, concrete file-tab id, the
file's reopen descriptor, and Monaco selection — no scroll or view
state, matching VS Code's `TextEditorPaneSelection`. The pure model follows VS
Code's `EditorNavigationStack` behavior at commit
`bdadf2eb338657fd540c1b38713393b4a5856de1`: ordinary moves less than ten lines
apart replace the current entry **in place, keeping any forward branch**, while
navigation and jump events at a different line push a new entry. Only a push
truncates the forward branch. The stack holds at most 50 locations, suppresses
records during replay, and keeps locations of closed tabs: replaying one reopens
the file as a preview. A replayed file whose read fails is gone — every entry for
it is dropped (`dropReplayedNavigationEntry`), a tab the replay reopened is closed
again, and replay keeps stepping the same direction.
File reads report missing files asynchronously, so the initiating Back/Forward
keyboard or auxiliary mouse event is claimed before a closed destination's
read failure is known. Once all missing entries are removed, subsequent
history inputs fall through to native browser behavior.

`MonacoFileEditor` exposes a navigation controller that captures and restores the
selection. Restore sets the selection and reveals it centered only when it is
outside the viewport (`revealRangeInCenterIfOutsideViewport`); an editor still at
its hidden 0px layout waits for the first non-zero `onDidLayoutChange` before
revealing. `PreviewPane` reports cursor changes only — scroll and relayout never
record — using Monaco's `api`, `code.navigation`, and `code.jump` source labels,
and captures the source before a cross-file language jump. `UnifiedRightPanel`
records only the active file, activates the destination tab, and marks replay
before restoring so emitted cursor events cannot fork history. Remounting the
same panel scope reuses its in-memory history.

Go Back / Go Forward use VS Code's keys: Alt+Left/Alt+Right on Windows and Linux,
Ctrl+-/Ctrl+Shift+- on macOS (where Alt+Arrow stays with Monaco for word
movement). Mouse buttons 3/4 share the same replay operation. Keyboard ownership
requires focus inside the visible panel; mouse ownership requires the button-down
target inside it. Both also require an active file and an accessible destination.
Alt+Arrow on a focused strip tab (or its close button) stays with the strip's
tab reorder (`tabStripClaimsKey`) and never steps history.
The handler prevents default and stops propagation only after a step succeeds,
and a claimed mouse-down also claims its matching mouse-up.

## The toolbar row

Directly under the strip and above the active view, rendered **only** while the
active tab is a `file` tab — every other kind brings its own toolbar inside its
own view, and the panel does not stack two. It shows `explorer/Breadcrumbs` for
the file's path (scrolled to the tail, so a long path truncates from the left
with the whole thing in the row's tooltip) and the tab's `repoLabel` when it has
one.

The Search and Explorer controls sit at the row's right edge. When the file
toolbar is not rendered, the same pair moves beside the tab strip's `+`. Each
selects its navigator mode, opens it when needed, and collapses it when selected
again.

A breadcrumb click opens an in-place directory picker listing that folder's
files and subfolders. Picking a subfolder drills into it; picking a file opens
the file in the preview slot. The picker reads through the active tab's
`ownerWorkspaceId` and `ownerRoutingRef`, so an open repo-group member or remote
clone remains correctly routed even when the Explorer targets another repo. It
does not change Explorer selection, expansion, mode, or focus.

`unifiedToolbarBreadcrumbs` shows a plain path label for `__trusted__:` and
`__workspace_preview__:` paths. These read-only resources do not use the repo
directory API or expose relative-path copy and Explorer reveal actions.

## The Search/Explorer navigator

Below the strip the panel is one row: the active tab's view on the left, the
selected Search or Explorer mode pinned to the right edge. Both modes share the
same panel-scope navigator width and point at the dock target. Explorer uses
`ExplorerPanel` in **sidebar mode** (`deepLink` only when that target is the
panel's own scope); Search uses `ContentSearchPanel`.

The navigator is panel-level chrome, not a tab: it renders for every tab kind
and for none at all. Its panel-scoped open bit lets the user collapse it without
closing resource tabs or the right panel.

Activating a `todo` tab hides Explorer through this open bit; Search keeps its
state. Explicit Explorer reopen survives
item interactions, portaled menus, ledger refreshes and rerenders. Selecting To-do
again or returning focus/pointer interaction from another content view hides
Explorer again; panel chrome does not change the focused content view. Activation
is scoped to the panel workspace, selected chat and active tab, including pinned
To-do tabs. Source buffers, tabs, navigator width and dock target stay intact.

Search and Explorer are lazy-mounted on first selection and then hidden with
`display:none`, preserving requests,
results, tree expansion, resource tabs, terminal sessions, and unsaved buffers
across mode switches and navigator collapse. A panel too narrow for both columns
hides the navigator until it widens without changing the user's open bit.

The workspace header has one control cycling hidden → docked → expanded → hidden
through the canonical dock stores (see `../AGENTS.md`). Search
and Explorer live inside the panel as peer navigator controls, so changing or
collapsing a navigator mode never closes the resource panel. The selected chat's
header folder button shares the panel-scope open/mode and tree stores: it opens
the panel in Explorer mode, or closes only the tree if Explorer is already
shown. A chat without a matching host uses its source-canvas tree.

On initial mount and whenever the panel scope's selected chat changes,
`UnifiedRightPanel` sets the dock open exactly when `visibleTabs` is non-empty.
Workspace-owned tabs therefore keep the panel visible across chats, while an
empty destination closes it. Closing also resets session-only expansion; descriptors,
active-tab memory, target, mode, width, ordering, and mounted resource state stay
untouched. The reconciliation does not rerun when tabs change, so explicitly
opening an empty panel remains possible until the next chat selection or reload.

A user close that empties `visibleTabs` collapses the panel through the same
open bit (`setWorkspaceDockOpen(workspaceId, false)`), unless the navigator is
showing (`isUnifiedTreeVisible`). This covers the strip ✕, middle click,
Ctrl/Cmd+W, the tab menu's single and bulk closes, and views' own close buttons,
all of which funnel through `closeTabByUser`. The decision
(`shouldCollapseAfterClose` in `closeTabRouting.ts`) runs once, after the tabs
update, and only after a bulk queue has drained; a cancelled or failed guard
never reaches it. Tabs of other chats are not in `visibleTabs`, so they never
hold the panel open. Programmatic removals (navigation replay, chat switches)
do not trigger it.

It **follows the host's active file**: `ExplorerPanel`'s `activeFilePath` prop
is a tri-state, and the panel derives it from the same `unifiedToolbarBreadcrumbs`
answer the breadcrumbs use. A path (a file tab whose owner is the tree's target)
expands its ancestors — lazy-loading the levels that are not cached — selects the
row and centres it. `null` (a file tab the tree cannot show: another clone, a
`__trusted__:` path) drops the highlight and leaves the scroll alone. Omitting it
(any other kind, or no tabs) means the tree keeps the last file highlighted where
it is. Revealing is additive, so a folder the user opened by hand stays open, and
it fires on the tracked *value* changing rather than on every render, so an
ordinary scroll or collapse is never yanked back. A lazy load that fails during
tracking is silent: no panel-wide error, no highlight moved — the same walk from
the toolbar's "Reveal open file" button still reports its failure, because that
one the user asked for.

Its width has two owners on purpose: the drag runs through `useResizablePanel`
with **no** `storageKey` (a second localStorage owner for one number would drift
from the store the toggle reads) and commits to `unifiedPanelTree` when the drag
ends. What renders is that width put through `clampUnifiedTreeWidth` against the
panel's live width, so the tree gives up space before the view does.

## Quick Open owns its own keyboard (`quickOpenRouting.ts`)

Ctrl/Cmd+P (Quick Open) and Ctrl/Cmd+O (Exact Open) are the panel's, not the
tree column's. The handler used to live in `ExplorerPanel`, which this panel
only mounts while the column is open — so a collapsed column meant no listener
at all, and a mounted Explorer sub-tab meant *two* listeners and two stacked
dialogs.

`quickOpenOwner({ panelOpen, panelHasFocus, explorerMounted, explorerHasFocus,
panelEligibleWhenClosed })` is the whole decision, pure and unit-tested: focus
inside the panel wins; otherwise a mounted Explorer sub-tab wins (focused or
not, which keeps ordinary-repo behavior); otherwise an open panel or an eligible
closed group panel wins; else nobody. Closed-panel eligibility is passed only
for repo-group Ctrl/Cmd+P, never Ctrl/Cmd+O. `explorerMounted` /
`explorerHasFocus` come from a module-level registry of focus probes — only
`mode: 'editor'` mounts register, because a navigator/sidebar Explorer is
somebody else's column.

The panel listens in the **capture** phase on `document` and calls
`stopPropagation()` when it wins, so `ExplorerPanel`'s bubble-phase listener never
runs — and neither does Monaco, whose handlers sit on the editor's own DOM, so
Ctrl+P inside a code buffer in this panel opens this dialog. `preventDefault()`
is always called by the winner, so the browser print dialog never appears.

`RepoGroupView` keeps the panel mounted on every desktop group sub-tab even
while collapsed, so this same listener owns Ctrl/Cmd+P from Workspace, Git,
Notes, and Settings. Opening or cancelling the portal does not change the
panel's open bit; accepting a result opens Explorer mode through the atomic
selection transaction. Mobile mounts no panel and remains unchanged.

`quickOpenShortcut` also claims Ctrl/Cmd+, and returns `'goto'`; both owners
open the same `QuickOpen` on `mode: 'symbols'`. Claiming it here rather than in
the palette keeps panel-vs-Explorer ownership one decision, so two dialogs can
never stack.

The dialogs are the Explorer's own `QuickOpen` / `ExactOpen` (portalled to
`document.body`). Exact Open and ordinary-repo Quick Open point at the dock
target. Repo-group Quick Open receives the group id, name, live-member count,
and owner base URL from `RepoGroupView`, so it searches the whole group while
the page and panel stay group-scoped. Because the dialogs portal outside the
panel root, "my dialog is already up" counts as panel focus.

A repo pick goes through `openTreeFile`: a trusted `__trusted__:` path lands
pinned and relies on `PreviewPane`'s trusted-path guard to omit its write route;
everything else takes the preview slot, exactly like a tree click. A group pick
first re-reads membership from the group owner, binds a
remote bare member id to that exact owner route, and asks `dock.setTarget()` to
run the dirty-editor guard. Missing/stale members, unknown remote routes, and a
declined guard leave tabs, target, tree, and dialog unchanged. An accepted pick
builds the preview descriptor directly from the result's member id and repo
label rather than waiting for target state to rerender.

A symbol row carries a position, so it opens **pinned** on its declaration the
way a definition jump does, instead of taking the preview slot. Every accepted
pick — repo or group, file or symbol — closes the palette.

An accepted pick opens Explorer mode and sets the tree's open bit; the active
tab then drives `ExplorerPanel.activeFilePath`, which expands ancestors and
centres the row. The bit is set even when the panel is too narrow for
`isUnifiedTreeVisible`: widening restores it, but the panel is never
force-widened over a boundary the user dragged.

## Ctrl/Cmd+W closes the active tab (`closeTabRouting.ts`)

Same capture-phase listener idiom as Quick Open, for the same reason: it has to
beat Monaco inside a code buffer. `closeTabOutcome({ panelOpen, panelHasFocus,
focusInActiveTerminal, metaKey, hasActiveTab })` is the whole decision, pure and
unit-tested, and it has three outcomes rather than two — `close`, `swallow`,
`ignore`.

`swallow` is the load-bearing one. Ctrl/Cmd+W is the browser's close-window key,
so while the panel holds the focus it must claim the key **even with an empty
strip**: falling through would shut the user's window because they tidied a tab
strip. Panel focus is a live DOM check against `panelRootRef` plus
`offsetParent !== null` (the collapsed panel is `display:none`), never focus
state in the store. `UnifiedGitTab` makes its portal host focusable and uses a
native capture-phase mousedown listener to focus it when reading nonfocusable
Git content. Editors and controls retain their own focus. Native DOM handling
follows the portal host even though React events belong to the left Git list.

The one `ignore` beyond "not our focus" is the terminal: a plain Ctrl+W is
readline's delete-previous-word, so it is handed to xterm — which sends `\x17`
and preventDefaults it itself, so the browser still never sees it. The carve-out
is keyed on the active tab being a `terminal` **and** the focus sitting inside
that tab's own `unified-panel-view-<id>` container, never on platform detection;
focus on the strip's tab button is not somebody typing at a prompt. Cmd/Meta+W
closes a terminal normally. The accepted consequence is that on Linux/Windows a
terminal tab is closed with the ✕ or a middle click, not the keyboard.

The close goes through `requestClose`, never `closeTab`, so a live PTY and an
unsaved buffer still get their prompts. `ExplorerPanel`'s own Ctrl+W handler is
independent and self-gates on its own root; there is deliberately no shared
helper.

## Ctrl/Cmd+F follows navigator focus (`findRouting.ts`)

The Explorer navigator owns Ctrl/Cmd+F only when it is visible and keyboard
focus is inside its column. It focuses Explorer's **Filter files** input and
claims the key in the capture phase to beat `ExplorerPanel`'s bubble listener.
Focus in the content column stays with the active resource, so Monaco and diff
views open their own find widgets and terminals retain native find-in-page.
Focus on panel chrome, Search mode, a hidden or narrow navigator, and a closed
panel leave the key unchanged. Ctrl/Cmd+Shift+F remains available for workspace
search.

## The preview slot

Each scope section has at most **one preview tab**. Grouped ordering keeps it
last; mixed ordering preserves its presentation slot. The file tree's single click opens into it
(`openPreviewTab`); the next single click replaces the descriptor *at that same
index*, so the strip shows one italic tab that changed resource rather than a
tab closing and another appearing. Every other entry point — `+`, a chat source
link, a note link, a canvas embed, a diff action, the tree's own double click —
goes through `openTab` and is permanent, which is also why `openTab` inserts a
new tab *before* the preview. Section moves stop before the preview; a mixed
move can land anywhere in the visible strip and promotes the moved preview.

The tracked-content overlay is also a preview entry point. It preflights the
owner and file before calling `openUnifiedPanelPreviewTab`, the imperative seam
for callers outside the panel subtree. Group results keep the group as panel
scope while the tab descriptor carries the member workspace id and concrete
member route; opening one never retargets the dock or changes the page scope.

Two rules keep the slot honest:

- **A file that already has a visible tab is focused, never previewed.** That
  covers both a permanent tab (which must not be demoted) and the current
  preview (which must not churn its buffer). An open with no line preserves the
  existing cursor, scroll, and state reference when already active; an open with
  a line updates the line/column and mints a fresh reveal nonce, including for a
  repeated jump to the same line.
- **Reuse destroys a buffer, so it is guarded like a close.** The shell asks
  `previewToReplace` first and, if the outgoing preview is dirty, queues the
  open behind the unsaved-edits prompt (`pendingPreviewOpen`); cancel drops the
  queued open. In practice an edit has already promoted the tab, so this is a
  safety net rather than the common path.

`promoteTab` clears the bit in place — same id, position, buffer, dirty state —
and is one-way. Promotion frees the slot, so the next single click opens a new
preview beside the promoted tab.

Four gestures reach it, all meaning "I am keeping this file":

| Gesture | Where it is wired |
| --- | --- |
| Double click the tree row (or Ctrl/Cmd+Enter, or the row menu's **Open**) | `ExplorerPanel` sends `preview: false`; `openTreeFile` routes it to `openTab`, whose merge drops the bit in place |
| Double click the tab, or Enter on a focused preview tab | `UnifiedPanelTabStrip`'s `onPromote` |
| First edit | `handleDirtyChange` promotes on the `false → true` transition |
| Drag, Alt+Arrow or a move menu action | Section and mixed-order moves promote a preview when its position changes |

The tree's double click arrives as click, click, dblclick. The two clicks are the
same preview open, which the model answers with the identical state reference, so
nothing remounts before the promotion lands. `ExplorerPanel` needs `onFilePin`
wherever a permanent tab has somewhere to live — its own strip *or* a host that
takes the opens — not only when its own `explorerEditorTabs` flag is on.

## Persistence and migration

The versioned tab codec persists concrete owner routes, preview bits,
panel-local Notes selection, per-chat id-only presentation orders, and each
`html-page` tab's `htmlPageId` (a restored descriptor without one is dropped).
Native `browser`, `paste`, and external capability tabs stay in memory only; their active
selection is omitted from storage too. Older supported payloads retain their
stable bare-workspace ids when a concrete route is absent. An old `explorer`
descriptor opens the tree column during `migrateUnifiedPanelState` rather than
restoring a resource tab. Unknown versions are discarded. Order parsing drops
duplicate, stale and wrong-chat ids; unopened ids never restore content.
Closing prunes ordered ids, preview replacement retains its slot, and draft
inheritance translates copied ids. Ephemeral ids are omitted with their tabs.

The parse repairs as well as validates. A section with two preview bits keeps
the **last** one and returns the rest permanent — nothing is dropped, because a
visible tab beats a silently vanished buffer — and a restored preview that is
not last is moved to the end. A `preview` bit on any kind but `file` is
discarded: only the tree's single click creates the slot, and it opens files.

The `+` menu keeps its **Explorer** entry, in place and with its label. The action
selects Explorer mode and opens the navigator instead of opening a tab.

## File write permissions

Repo and clone file tabs are editable regardless of whether they came from a
chat source link, Explorer selection, or Quick Open result. Their owner workspace
and concrete route select the existing blob write endpoint. Trusted absolute
paths keep the `__trusted__:` prefix and rely on `PreviewPane`'s path guard,
which omits the write route, Save button, and registered save handler.

`PreviewPane` shares owner-qualified dirty-path/save admission with Explorer
deletion. A pending delete makes affected files read-only across every mounted
instance in this window; unrelated paths and clones stay writable.
`closeDeletedExplorerTabs` removes affected clean file descriptors from every
cached panel/chat scope only after successful deletion. Failed and partially
completed deletion retains buffers and descriptors. Dirty protection does not
span independent windows.

Outside-root links, group-probed files, and explicit HTML source views use
`__workspace_preview__:<absolute path>` with the owning workspace and concrete
clone route. `PreviewPane` loads them through the authorized workspace preview
API, with no write route, live language document, or selection attachment.
Images retain MIME/encoding; CSV is text, not a table viewer. Preview failures,
oversized content, and binary blobs offer an owner-routed Download action.
Concrete unresolved remote routes fail visibly without local fallback.

## Keep-alive and terminals

A tab joins the mounted set when it **first becomes active**, and leaves on close.
Mount-on-activation (not mount-on-presence) is what makes a restored terminal
descriptor attach nothing until it is shown — restoration never spawns a PTY.
Collapse is `display:none` on the whole column, so a tab switch, chat switch,
collapse, or workspace navigation detaches nothing. Only an explicit close ends a
session.

## Closing is guarded

The strip's ✕, middle-click, tab-menu commands, and the close buttons owned by
canvas, note, diff, and external views go through `requestClose`, which runs the
terminal check, then the dirty check, then `closeTab`. Bulk tab-menu commands
select targets from the currently visible workspace + selected-chat strip and
process them in rendered order through the same protected path. Cancel leaves
that target open and continues with later targets. File tabs use only the strip's
✕ because `PreviewPane`'s floating close button would duplicate it:

- **Terminal.** `TerminalView` reports its sessions through `onSessionsChange`;
  `liveTerminalSessionIds` counts only `running` sessions that have a server id, so
  a tombstone-only tab closes with no prompt. Terminate happens **before** the
  close and routes through `getCocClientForWorkspace(owner)`; 404 counts as
  success, anything else rejects and the tab, the view, and the PTYs all stay.
- **Dirty buffers.** `DIRTY_CLOSE_KINDS` is `file | note | canvas | git` — the
  kinds that both report dirtiness (`onDirtyChange`) and hand back a way to write
  it (`onRegisterSave`), so the Save button always has something behind it. The
  prompt is the Explorer's own `explorer/ExplorerCloseTabsDialog`. A rejected or
  `false` save keeps the tab, the buffer, and the prompt as a retry. The `git`
  tab's body (`UnifiedGitTab`) publishes its bound callbacks as a dirty bridge in
  `unifiedGitTabHost`; `useSplitGitPanel` hands `RepoGitTab` forwarders so an
  edited working-tree diff marks and guards the Git tab, labelled by its file.

`CanvasPanel` and `NoteEditor` publish exactly the contract `PreviewPane`
established; `useCanvasRecord.saveNow()` and `NoteEditor`'s flush both return
false when the write did not land, including when the draft moved while it was in
flight.

The tab context menu opens from right-click, the Context Menu key, or Shift+F10,
keeps keyboard focus inside enabled actions, clamps to the viewport, and restores
focus to its originating tab on dismissal. Every kind exposes the close group;
preview tabs add Keep Open, and file tabs add path copy and Explorer reveal.
Reveal retargets the dock to the file owner, selects Explorer mode, opens the tree,
and relies on `activeFilePath` tracking to expand and highlight the row without
changing the active tab.

## New-browser shortcut

Ctrl/Cmd+T creates and activates a blank browser tab through `browserOpenInput`
and the panel tab store; its address input receives the existing autofocus.
The tab uses the dock target's concrete workspace and clone route. Focus inside
an open, visible panel owns the chord, including browser address editing and
the add menu; other editable content, Monaco, terminal bindings, and handled
events retain their bindings. Body focus routes to the single visible panel;
multiple visible panels require explicit panel focus. Repeats are consumed
without creating tabs. Native browser pages forward `onOpenMenuRequested` with
the source view id after returning host focus; only the matching active,
visible browser tab creates a new tab. The `+` and empty-state Open buttons
open `UnifiedPanelOpenMenu`.

## Reopen-closed-tab shortcut

Ctrl/Cmd+Shift+T always restores web tabs newest-first; there is no feature flag
or setting, and a stale saved `features.panelReopenClosedTab` is ignored. `unifiedClosedBrowserTabs.ts` keeps a module-memory
stack of 20 per `closedBrowserTabScopeKey(workspaceId, chatId)` (owner-qualified
panel storage key plus chat): it survives remounts and scope switches, never
reaches storage, and resets on reload. `closeTabByUser` is the only recorder, so
strip, menu, Ctrl+W and bulk closes record in close order while `closeTab`
cleanup, `closeBrowserPanelView` and other kinds (HTML previews included) never
do. Entries snapshot owner, route, repo label, last URL and title — never view
ids. A restore drops an entry whose owner is no longer this panel's workspace or
an enabled target on the same route, otherwise opens it through
`browserOpenInput` (fresh view id, stored title as provisional label) and
focuses the restored strip tab; a blank restore keeps its address autofocus.
Any focus inside the open, visible panel owns the chord, including editors,
terminals and an empty stack; repeats restore nothing. Native pages forward
`onReopenClosedRequested` with the source view id; only the matching active,
visible browser tab restores, and a subscription ignores further requests once it
has restored (the source view is no longer active), so a duplicate delivered
before the re-render cannot drain a second entry.

## Entry points

Entry points use `openUnifiedPanelTab` with the originating chat and concrete
owner. Hosted file links resolve ownership before opening; only chats without a
matching panel use the source dock.

| Entry point | Lives in | Notes |
|---|---|---|
| Chat diff action | `ChatDetail` `WHISPER_DIFF_EVENT` handler | A whisper diff is rebuilt from an in-memory transcript, so `unifiedDiffSources` is the join between a persisted tab and its source. |
| Chat source link | `ChatDetail` `coc-open-source-canvas` | `resolveChatFileLink` uses the source chat's server-specific workspace set, probes group ownership with `files/preview?resolve=true`, and builds permanent file tabs. Outside-root and group-probed paths are read-only workspace previews. Requests are aborted on chat/owner changes; late results cannot open the destination chat's panel. |
| Directory link | `resolveChatFileLink` / `coc-open-panel-directory` | Preflights the folder owner, targets the matching panel/chat/clone, runs the dock's dirty-buffer guard, and reveals/expands the folder in Explorer. Outside-workspace folders show an explicit unsupported error. |
| Desktop HTML link | `file-path-preview.ts` `coc-open-html-page` | The local server authorizes and canonicalizes the path before the main process verifies the file and the panel claims the event. Approved roots include local workspaces, repo output data, OS temp, and the provider data folders under `~/.copilot`, `~/.codex`, and `~/.claude`; remote-server paths stay on the source-viewer path. The tab uses `UnifiedHtmlPageTab` to align a native view with its placeholder. Without a matching panel host the native view closes and the link takes the source-viewer path. |
| Note link | same handler, `kind: 'note'` branch | `resourceId` is `<fetchMode>\|<root>\|<path>`; concrete owner routing reaches both NoteEditor IO adapters. Group-probed Markdown stays read-only. |
| Explorer selection | `ExplorerPanel` `onOpenFile` | The tree column (and navigator mode elsewhere): `options.preview` picks the preview slot vs a permanent tab. |
| Language navigation | `UnifiedTabView` `onOpenFile` | A "go to definition" out of a file tab. The descriptor takes its workspace id, concrete route, and repo label from the SOURCE tab, never from the dock's current target, so the target read and language document stay on the initiating clone. Always a permanent tab. |
| Canvas embed | `shared/CanvasEmbed.tsx` "Open in panel" | Gated on `useUnifiedPanelHostForChat`; the chat id arrives through `ChatRenderContext.chatId` because the embed is portaled. |
| Linked canvas / New Canvas | the `+` menu | Both build through `canvasOpenInput`, so an embed, a menu pick, and an AI event converge on one tab per `(owning clone, canvas id, chat)`. |
| AI canvas create/update | `ChatDetail` `onCanvasUpdated` | See below. |
| `+` menu | the panel itself | Reuses QuickOpen's search behavior: nothing before the first keystroke, debounce, abort the previous request. |
| Chat-wide **Changes** | the `+` menu, via `unifiedChatChanges.ts` | See below. |

User and assistant file links, tool-result paths, and portaled Markdown tool
previews share the source event with originating chat/workspace metadata.
Inline images/lightboxes, tables, and canvas embeds remain inline. Mobile,
pop-out, embedded, and background chats without a matching panel keep the source
dock. The chat header's Explorer toggle follows the same hosting rule.
Unresolved hosted links surface an error rather than opening a second panel.

## Desktop HTML pages

`UnifiedHtmlPageTab` and `UnifiedBrowserTab` both render through
`NativeViewTab.tsx`: `NativeViewTab` registers its placeholder with the persistent
`BrowserWebviewLayer`, and `NativeViewNavButtons` owns the Back/Forward/Reload
(Stop) controls. `desktopHtmlPageBridge()` (`shared/file-path/html-page-bridge.ts`)
picks the page API: the merged `cocDesktop.browser` `file` source (view
`html-page:<pageId>`, session `html-page`) when `browser.sources` includes
`file`, else the older `cocDesktop.htmlPage` (no history, so Back/Forward stay
disabled). The layer tracks resize, scroll and ancestor clipping. Inactive,
collapsed and unmounted tabs hide their hosts without destroying guests; DOM
menus remain above live pages. Tab close removes the host and closes the guest.
Its toolbar shows the file path
read-only, goes back/forward, reloads
the page, opens the file in the system browser, or requests a read-only source
tab (`forceSourceViewer` uses the workspace preview transport). The event carries
the selected chat so other mounted conversations cannot claim it. Load errors
surface inline with the same source fallback. Full SPA reloads close all guests;
persisted HTML descriptors reopen files from disk with fresh history and scroll.
The file guest uses an isolated in-memory session, never a browser profile;
browser-data cleanup excludes it. The main attach guard authorizes only the
exact pending validated file URL. `file-path-preview.ts` calls the owning local server's
`files/html/resolve` route before opening the guest, so paths outside a repo
can open only from the server's canonical HTML allowlist and a remote path can
never be handed to the local Electron process.

## Browser tabs

The `+` menu's **Browser** entry opens a blank tab; a pasted URL opens one at
that address. Each tab captures the dock target and its concrete route as
owner when opened — that owner is the tab's routing identity, and a later
target switch never retargets it. Tabs are workspace-owned, so they stay
across chat switches, and `browser` is an ephemeral kind: neither the tab, its
URL, nor its selection reaches storage, so a restart starts with none.
`updateBrowserTab` follows the page's URL and label without activating the tab.
AI browser control uses the same session-only descriptors and imperative
`openUnifiedPanelTab` seam, so commands can reveal a collapsed or unmounted dock.
Main's `browser.control.onReveal` supplies the native resource id and trusted
concrete owner; `findBrowserPanelView` retains an existing tab's panel scope.
Conversation scope comes from `browser-control-scope.ts`, not a repo-group picker
or an unrelated selected chat. Server-owned selection is separate from an
explicit `select(tab)` command target; other actions use the request's
`selectedTab` envelope. Main-qualified ids include the owning desktop window;
only same-owner-workspace URL views and their URL popouts participate, excluding
file previews and other clones. The SPA relays structured commands on existing
local/clone sockets and never receives a raw CDP/debugger capability.
`UnifiedBrowserTab` includes `BrowserControlBadge` for its concrete workspace,
clone route and unified descriptor id. The relay maps native tab ids only through
the trusted owning window and starts activity immediately on reveal, before a
slow command completes. Activity is turn-scoped: successful commands update the
tab without ending ownership; terminal/cancelling process notifications and
disconnects clear it. Local and remote activities use distinct source-qualified
keys. Late replies cannot restore a finished turn; another command or reveal
requires an authoritative running notification to resume a finished process.
The badge requires the
desktop bridge and live feature/per-repo tool admission. It never locks user
input; Stop uses the owning client's existing `processes.cancel` and clears
activity only after cancellation succeeds.
In the desktop app `UnifiedBrowserTab` drives `window.cocDesktop.browser`
(`shared/file-path/browser-bridge.ts`): the tab's `resourceId` is the view id
and `browserSessionKey(tab)` the routing owner. Browser profiles persist per
engine across all installation workspaces; browser tab descriptors stay
ephemeral. A blank tab opens no view until it
has a URL; address submits on a live view call `navigate`. The toolbar has
Back/Forward/Reload|Stop, an editable address, and `BrowserToolbarMenu`
with the actual engine, desktop History and the current-page system-browser action. The menu is
a fixed dropdown portalled to the document body above the live Electron page.
Escape, outside clicks, repeated trigger clicks, and loss of tab visibility or
ownership dismiss it. Page titles appear in tab labels; load errors and download
handoff notices appear in the tab body. Unmounting hides the view; `closeTab`
closes it. `onState` feeds `updateBrowserTab`
(URL after redirects, title as label). `onNewTab` opens another browser tab
with the opener's owner and `browserEngine`; the desktop default affects only
new views. Desktop Preferences lives in Admin Appearance and uses local IPC.
The SPA entry point subscribes to `onClosed` and removes target-engine tabs
from every cached workspace via `closeBrowserPanelView`, including unmounted
panels, and removes their webview hosts.

`BrowserHistoryPanel` is a desktop-only dialog opened from the toolbar menu.
It queries 50-entry pages by URL/title, shows visit times, deletes individual URLs
and calls main's native-confirmed history clear. Main invalidations refresh all
open panels; loading, storage and mutation errors are explicit. Paused history
remains searchable. Queries and mutation replies are ignored after unmount;
owner, tab and visibility changes dismiss the dialog. Opening an entry mints a
fresh tab through the panel's current dock target and concrete clone route, with
no inherited engine override. Electron guests stay attached under the dialog;
its modal/overlay marker hides WebView2 surfaces.

Electron opens return `embed: 'webview'` with a main-approved `src` and `partition`.
The app-level `BrowserWebviewLayer` creates each guest once and calls
`browser.adopt(viewId, guestId)` on the first `dom-ready` (stock Electron gates
`getWebContentsId` on that event). `NativeViewTab` registers a
placeholder, not a guest: workspace remounts, chat switches, and collapse retain
the guest's DOM parent, history, scroll and input. Resize, ancestor layout and
scroll events update fixed bounds and clip to ancestor overflow viewports.
Inactive hosts use `visibility: hidden` and `pointer-events: none`, never
`display: none`. Menus, dialogs and toasts paint above visible Electron guests.
Close removes the host; a late open response cannot recreate it.

WebView2 uses `useNativeViewPlacement`. Native views paint
above DOM, so explicit panel overlays, modal dialogs, tab menus and
`data-native-view-overlay` elements hide them. A 5x5 `elementFromPoint` grid
detects other overlapping DOM content; `data-native-view-passthrough` exempts
underlays. Without a desktop bridge the view offers Open in
system browser (`openUrlInSystemBrowser`, `window.open` noopener) instead of
embedded browsing.

In the desktop app a plain click on an http(s) link in a chat bubble opens a new
browser tab: `file-path-preview.ts` sends `coc-open-browser-url`
(`requestPanelBrowserTab`), and the mounted panel claims it with the dock target
as owner and opens the dock. Modifier clicks, URLs an enabled link handler owns
(Teams, OneNote, …), the web app, and an unclaimed event keep the default.

## Sentinel To-do

Every hosted Sentinel chat has a persistent To-do ledger.
Default-off `features.sentinelPrOutcomeWake` adds `SentinelTodoPrOutcomes` inside
the selected normal item's existing detail view, not another panel. It reads exact
PR outcome/delivery evidence and offers Check outcome and per-item Pause/Resume
notifications through the owner-routed client. Admission is displayed as queued,
not completed review. Requests and mutations discard stale owner/item responses;
unresolved remote owners never fall through to the local client. Automatic outcome
bindings stay out of the editable delegation-trigger list.
A hosted Sentinel `ChatDetail` publishes its ledger owner — the chat's workspace
and process id — into `sentinelTodoChats` keyed by `(panel scope, chat id)` and
withdraws it with the host. The `todo` descriptor is
one tab per concrete owner and chat: `resourceId` is the parent process id.
`routingRefForPanelOwner` binds the owner workspace to the panel's server,
including repo-group members. Only the descriptor persists; the ledger is fetched from the owning server
(`client.sentinelTodos.get` with `full: true`, routed like the chat) and refreshed by that server's
`sentinel-todos-changed` events on a workspace-subscribed socket. Stored `todo`
tabs remain visible in `useUnifiedPanelTabs`; the `+` menu offers To-do for the
selected hosted Sentinel chat.

The first ledger write (`ledgerRevision === 1`) opens the tab only when the chat
shows no tab at all (`shouldAutoOpenSentinelTodoTab`), so it never steals focus
and never reopens a closed tab; the `+` menu reopens it. `UnifiedTodoTab` shares
`sentinelTodoRecentPage` with REST/tool/messaging lists: every unarchived non-Done
item is included, then recently updated Done items fill a 50-item budget. Active
counts above 50 stay complete; archived history follows Done. Saved fulfillment,
not linked job completion, determines selection. Show older items reveals 50 more
history items, with section ordering applied to the selected rows. Explicit prerequisite/rule links and restored
open details reveal older rows. Dependencies, triggers and Scrubber projections
receive the full snapshot independently of visible rows. The tab splits the visible items by type
(`sentinelTodoType`; a missing type reads as normal) through
`sentinelTodoSections(items, type)`. `sentinelTodoDisplayStatus` derives In review
from local pending assessment evidence, independently of persisted fulfillment status
and result delivery. Running/queued follow-ups stay In progress, and each job retains
its own assessment label. New unavailable/unknown follow-ups keep the stored status.
Done, archived, manual and user-superseded items retain their verdicts; failed delivery
needs attention. Normal tracking lists active items (Needs attention, In review,
In progress, To do; oldest first within a display status), then the Manual
tracking region, then normal initially collapsed Done and Archived sections. Manual tracking is a labelled region whose
`aria-expanded` toggle, named `Manual tracking (<active> active)`, starts
expanded. It stays visible when empty (`No manual items yet.`), has its own
**Add manual item** form (required Title; optional Notes, Done when and Priority;
creates send `type: 'manual'`, normal creates send no type), and its own
initially collapsed Done and Archived groups. Reopening returns an item to the
active list. The tab never offers delegation, conversion or copying. Each add form
owns its draft and idempotency key (`useAddItemForm`). Every write carries the item revision it was based on; a
conflict reloads the ledger and keeps the typed draft, and the next save is based
on the newer revision. Creates carry one idempotency key per draft across retries.
Event invalidation, manual toolbar refresh and post-write reloads share the
owner-scoped full-snapshot loader. Creates and saves wait until a snapshot at
or above the write's returned `ledgerRevision` is applied, reusing an in-flight
read only when its result covers that revision; otherwise they fetch once. Pending reads disable manual refresh with a
synchronous admission guard and busy indicator; reloads retain rows, selection,
drafts and older-item expansion. Selection and changes to its tracking type or
active/Done/Archived membership reveal its containing sections, including restored
selection after owner remounts. Other refreshes preserve section visibility.
Collapsing a selected item's section or its Manual tracking parent clears selection
and closes details while retaining the hidden editor's drafts. Read failures use the existing
retry notice without clearing the snapshot. Late loads are dropped by a sequence counter.
Choosing Needs attention from the status group requires a
reason; choosing Done asks for an optional one (`sentinelTodoStatusReason`) — a blank
Done sends `statusReason: null` and records no outcome, a supplied one is also the outcome. Add and Edit forms carry a Priority select
(Regular default, High); a High row draws an `aria-hidden` red leading band over the card's
reserved `pl-1` gutter (every row reserves it, so priority changes never shift content) plus a
visible High badge with `High priority` screen-reader text. `sentinelTodoPriority` reads a
missing value (older owning server) as Regular. Priority never reorders sections. The header shows the
active normal count and, when nonzero, how many normal items display Needs attention (stored or derived).
`UnifiedTodoTab` always uses list/detail presentation measured by `useContainerWidth`
on the actual panel. At 660px the compact selectable list and detail editor scroll
independently; below that width selection opens details and Back returns focus to
the selected row. Detail Close clears selection, returns list focus and preserves
owner-scoped deselection across refreshes/remounts. Pending item, tag, dependency
and PR-outcome mutations, plus pending Scrubber actions, block Close. Native pressed buttons expose selection;
arrows/Home/End move row focus without selecting. Visited editors stay mounted
but hidden across selection and resizing, retaining drafts.
List cards combine status, priority, wrapping title and an ellipsis menu in a compact header,
with target/Updated/latest-job metadata below. Identical item/job titles use an
accessible Open job link; distinct job titles remain visible. Full job history,
conversation references and editing controls live in the detail pane.
Default-off `sentinelTodoTagsEnabled` adds named restrained tag chips, a tag filter
including Untagged, a selection-independent library manager and a detail picker.
Enabling the live gate reloads the full owner snapshot without resetting drafts.
Absent libraries distinguish loading, read failure and owning-server unavailability,
with explicit retry; missing capability never fabricates an empty library.
Filtering uses the full owner snapshot independently of the recent history budget.
Item tag drafts share the owner-scoped remembered view across remounts. Library edits keep
parent identity; deletion confirms removal from all items. Explicit picks and
clears are manual; re-suggest confirms replacing them. Classification notices
remain separate from save errors, status and execution controls. Narrow panels
wrap tags and use native keyboard-accessible controls.
With session-context attachments enabled, list cards and the detail pane's Attach
button are copy-drag sources for their owning Sentinel composer. List cards expose
Attach in the shared overflow menu; detail-pane Attach controls remain inline.
Menu interactions stay isolated from row selection and dragging. Detail cards use
`select-text` and keep informational text outside draggable ancestors for native
mouse and touch selection. Payloads
contain the stable item reference and owner, not notes or job data; attaching never
writes the ledger or starts a job. The shared composer reads authoritative details
on drop and send (see the composer knowledge reference). Details list every job and explain when the displayed status is derived
(`Saved status: …`), then Reason, Done when, Outcome and Notes. Notes start expanded;
notes over two lines or 160 characters have an optional collapse toggle
(`sentinelTodoFoldNotes`). Visibility is remembered with each item's drafts in the
owner-scoped, in-memory `SentinelTodoView` across refreshes and remounts.
The footer shows Created, a `Status` button group of the four
stored statuses (active items only; the saved one is `aria-pressed`, pressing it is a no-op, In review is
never offered), and ghost Edit/Reopen/Archive or Restore buttons. Manual tracking's header carries a
`Tracked only · never run` tag. Conversation entries in `item.references`
(missing `kind` also means conversation) render below jobs as compact, truncated
`Ref` links with owner-correct excursions and no execution or review label.
Default-off runtime `sentinelTodoExternalReferencesEnabled` adds wrapping PR,
Email and Link anchors to every card and detail view. PR labels identify their
provider, repository and number; hover titles retain the complete URL. Only
HTTP(S), plus `mailto:` for email references, render as links. Native anchors
preserve keyboard and modified-click behavior, isolate card events, and use the
desktop panel browser when available. Add/Edit forms manage multiple external
references within their existing Save, draft, revision and error lifecycle.
Untouched references are omitted from writes; an explicit empty list clears only
external references, never conversation references.

`SentinelTodoDependencies` is gated by default-off
`sentinelTodoDependenciesEnabled`. Its owner/item-keyed details add independent
Waiting/Ready chips, typed prerequisite drafts and exact PR-output
binding with visible provenance. Readiness reads use the owner client, abort on
revision/owner changes and refresh for prerequisite-only ledger edits. Graph and
binding saves keep their captured revision; conflicts retain drafts and require an
explicit rebase before retrying. The prerequisite-first, cycle-bounded chain uses
the same owner-ledger item navigation as triggers. Artifact evidence opens the
prerequisite content workspace's read-only preview on the owning server, never a raw
file reference as a browser URL.
Durable prerequisite-review warnings appear separately from readiness and
fulfillment; they do not cancel running work. Sentinel follows ordinary user
authorization in the owning conversation.
Manual items remain Tracking only. No launch, retry, cancel or approval controls
are added to the To-do tracking surface.

`SentinelTodoJobPreview` shares owner labels across latest/earlier titles and previews.
`sentinelTodoJobOwner` resolves each job's server-qualified workspace from cached
App/Repos local, remote and group metadata. Local jobs inherit the ledger's server;
unqualified remote jobs have unknown ownership. The current concrete repo omits its
badge; other local repos show their name, remote repos their configured server / repo.
`targetRepo.label` is a fallback only for an exact owner match. Offline names retain
their provenance; missing metadata has accessible qualified-identity details.

Noninteractive Ask/Autopilot/Ralph pills use the ledger's compact current-mode
projection, shared chat normalization/palette and Ralph session identity.
Unknown modes stay omitted; session identity takes precedence. Owner pills truncate
with full accessible descriptions; titles and pills wrap without extra reads,
polling or focus targets. Job-title hover/focus previews and ArrowDown actions share
a bounded pane/viewport portal. Escape/Close restore focus; outside presses and focus
departure dismiss. Title and Open job anchors retain excursion navigation and
modifier clicks.

Preview reads are lazy and abortable, pinned to the job's workspace and concrete
server or ledger-owner route. Unresolved remote owners never fall through locally;
validated external destinations remain navigable after failed reads. Ordinary jobs
use `processes.get(..., { workspace, preview: true })` for a bounded recorded
assistant/result/error excerpt, never a user-request snapshot or transcript. Ralph
uses `taskGroups.get(workspace, sessionId)` for whole-session phase, iteration counts
and terminal reason; child completion cannot settle the session. Each mounted
reference caches one excerpt for 15 seconds, invalidated by client or execution
changes; stale refresh failures stay explicit. Execution, review and recorded
result reasons remain separate from the item verdict. The tab never starts,
retries, or cancels jobs. Tests live in `test/server/sentinel-todos/` and the
read-only `test/e2e/sentinel-todo-job-preview.spec.ts` native-style fixture.

### To-do Scrubber

`SentinelTodoScrubber` wraps the To-do body after a ledger loads, gated by the
live, default-off scrubber flag. `UnifiedTodoTab` passes a function child that places
the single strip (and its history) in the list column below triggers, beside the
detail pane; a plain child renders the strip first. The strip is not sticky and its
schedule editor and selection wrap inline. Its owner/endpoint-keyed strip uses
`client.sentinelTodos.scrubber` and an exact workspace/process WebSocket filter;
late reads and mutations cannot update a remounted owner. A visibility-aware
poll refreshes missed events. All-open and selected runs start separate queued
read-only chats, with Cancel and owner-routed chat links using excursion navigation.
Selection contains open normal/manual items and filters closed items again at admission.
Config drafts keep their captured revision through refresh; conflicts reload
without retrying writes. The schedule editor shares browser-safe validation and
presets from `server/schedule/scrub-cron.ts`; Resume saves the current revision.
Completed run details feed an owner-local findings context shared by row badges,
the strip and the To-do toolbar slot.
The newest finding wins, including hidden dismissed/suppressed/undone findings;
auto-Done attribution requires the item's exact applied revision. Accept uses the
snapshot revision, Undo the applied revision, and conflicts require a fresh scrub.
Bulk acceptance shares the action busy guard and freezes the admitted snapshot
revisions. It skips known stale proposals, continues past 409s without retries,
stops on other errors, reports partial results and reloads ledger/findings.
Owner/endpoint remounts or flag disabling stop remaining batch requests.
Successful actions reload the ledger for derived job states. Evidence links allow
HTTP(S) only; other references render as text. `SentinelTodoScrubHistory` lists
retained summaries after the strip and lazily reads owner-routed details.
Run changes refresh selected details; switching, pruning or closing aborts reads
and rejects late results. The read-only log retains all finding states and audit
actors, timestamps, before/after revisions, outcomes, exclusions and evidence.
Shared `ScrubRunChatLink` preserves the owning route and excursion behavior.
Tests use isolated mock clients in
`test/server/sentinel-scrubber/panel.test.tsx` and `test/server/sentinel-todos/panel.test.tsx`.

### To-do triggers

`SentinelTodoTriggers` is a separate section below the cards, gated by existing
`triggers.enabled`. Its owner-qualified `client.triggers` calls use the ledger's
workspace/process on the owning server. `sentinelTodoTriggerModel` keeps rule
Waiting/Paused/terminal/error and delivery state separate from item/job/review
states; rows link the canonical PR or display the saved zoned date and UTC tooltip.
Item navigation expands
and focuses only the target and its containing Normal/Manual Done/Archived
sections, preserving other expansion state. Missing targets retain unavailable
feedback; owner changes isolate row state and cancel pending highlights.
`SentinelTodoTriggerEditor` selects eligible normal items, PR URL/local picker or
one-time date/time, and optional guidance. Date mode and rows require the owning
client's `sentinelTodoCapabilities` result, never the page-origin flag. Default-off
`features.sentinelTodoDateTimeTriggers` gates date authoring and arming on that server.
Shared coc-client helpers validate local date/time and IANA zone, expose both DST
overlap offsets and preview the exact UTC instant. Dialogs trap keyboard focus.
Lifecycle writes carry revisions; Run now and overdue resume require confirmation.
Clearing retains dedupe receipts; removed pending date rules suppress delivery.
Rules never expire, mark items Done, launch jobs directly or grant authorization.
`triggers-panel.test.tsx` covers states, controls and ownership.

### To-do excursions

`SentinelTodoConversationReferences` displays server/workspace labels and cached
unverified status. React and return-focus keys include server/workspace/process
identity. Same-server references use the ledger owner's concrete clone route.
A plain click on a durable remote reference verifies it through
`resolveDashboardChatReference` before navigation or excursion creation. Ten-second
deadlines, new clicks, hash navigation, owner changes and unmount cancel pending
reads and suppress late results. Unavailable targets keep the current chat and
show retry guidance; opening never changes the ledger's stored verification.
Modified clicks keep durable hrefs for the browser.

A plain primary click on an in-app (`#…`) Job or verified Ref link starts one in-memory
excursion per window (`sentinelTodoExcursion.ts`): the origin's panel scope, chat,
ledger owner, published title and owner-qualified chat route, the followed link,
and up to five hosted chats visited since. The owner workspace/process defines
the return destination; a matching group member route or chat sub-view is kept.
Back reapplies routing even when the destination hash is already current.
Hosted `ChatDetail`s mount `SentinelTodoOriginBar`,
which records each selection as a visit (keyed by panel scope + chat) and, on the
path, shows Back to Sentinel, a foldable breadcrumb and a close button. Arriving
at the origin after leaving, Back, close, Unpin and closing the pinned tab end it;
a link in the pinned list keeps the path and only updates the link to refocus.
Modified clicks, external links and reloads never start or keep one.

On the path, `useUnifiedPanelTabs` layers the origin's To-do over the read state
(`withPinnedSentinelTodo`, labelled `To-do · <Sentinel>`); it is never stored, its
selection is kept with `rememberActiveTab` (the codec drops it), and the shell
reopens the dock and activates it when `pinnedId` changes. The pinned copy reads
the origin's ledger owner and shows an owner banner with Unpin. Each owner's view
(list scroll, selected item, detail visibility, sections, expanded rows and item/status
drafts) is remembered in memory across remounts; Back additionally focuses the visible
followed link once. Owner/transport remounts invalidate pending ledger responses;
unresolved owners fail without page-origin reads. Excursions never write ledger, status, review or
chat state and never send messages.

## AI canvas updates (`unifiedCanvasEvents.ts`)

Split in two. **Routing** goes through `openUnifiedPanelTab`, so a later update
reopens a collapsed panel and recreates a tab the user dismissed — activation is
required on every update, not only on creation. **Reconciliation** goes through a
`useSyncExternalStore` registry (`publishUnifiedCanvasEvent` /
`useUnifiedCanvasEvent`), because the mounted `CanvasPanel` lives in the panel
tree, far from the chat SSE stream. Identity is `(owning clone, canvas id)`, never
the title; revision is the ordering, and a non-advancing event is dropped.

`useChatSSE` captures its callbacks when it opens the EventSource and does not
re-subscribe when they change, so this handler reads the host and workspace list
through refs. **Any future SSE-driven entry point must do the same.** With no
host (a background chat, or a chat with no panel) the event is still *published*
so a mounted view reconciles, but nothing is opened or activated.

## A canvas tab's chat actions (`unifiedChatCanvasActions.ts`)

`UnifiedCanvasTab` resolves three things `CanvasPanel` cannot get from a tab
descriptor: the live event, the owning chat's composer actions, and pop-out /
Kusto-creation chrome.

- **Ask AI / Send comments** go to the chat named by `tab.chatId` — the
  *originating* conversation, so a pending send never follows a chat switch. A
  chat that is not mounted publishes nothing, and the tab then omits both props,
  which is what hides the actions instead of dropping the work silently.
- **Pop out** goes through `features/canvas/canvasPopOut.ts`, keyed on the
  canvas's OWNING workspace and named `coc-canvas-<id>`, so a repeat click
  focuses the live window. A blocked popup leaves the canvas in its tab.
- **A created Kusto query** opens as its own tab under the same chat and owner;
  the originating tab keeps its draft. There is no in-tab canvas switcher — the
  strip is the one control, so `availableCanvases` is deliberately not passed.

## The chat's own Changes (`unifiedChatChanges.ts`)

The `+` menu lists **Changes** after New Canvas, but only when the selected chat
has recorded a completed file edit — so the answer has to exist *before* anything
is opened. The chat publishes its whole-chat `WhisperDiffOpenContext` (built by
`chat/conversation/tool-calls/chatChangesModel.ts`) into a `useSyncExternalStore`
registry keyed by `(panel scope workspace, chat id)`, the same shape
`unifiedCanvasEvents` uses; the menu reads it back and hides the entry on `null`.
The scope key is what isolates chats across repos, repo groups, and remote
clones.

One more thing that model owns: **path form**. Tool args carry whatever the
agent's platform produced, so a chat can record `src\a.ts` from a Windows run and
`src/a.ts` from a POSIX one — sometimes both, for the same file. `collectFileEdits`
canonicalizes its map key to forward slashes (`normalizeFileEditPath`), so one
file stays one row in the list, one dropdown item and one diff section. The raw
args are left alone; every reconstruction and the shell-delete pass already
normalize both sides before comparing, so nothing downstream had to change.

The tab is an ordinary `diff` tab over the existing `WhisperDiffPanel`, with one
difference: its `resourceId` is the fixed `chat-changes-<chatId>` rather than
`whisperDiffSourceId`'s content hash. A whole-chat context grows as the chat
edits more files, and a re-hash would open a *second* tab instead of refreshing
the open one — hence `registerUnifiedDiffSource(ctx, { sourceId })`, which moves
the content hash to the record's `contentKey` so an unchanged re-register still
keeps the stored context identity (and with it the user's file selection).

### Surviving a reload

The descriptor persists; the source registry does not. So the registry records
*resolution*, not just content: a missing key means the chat's transcript has not
loaded yet, a `null` value means it loaded and changed nothing, and
`withdrawUnifiedChatChanges` (a chat switch, unmount) puts a key back to missing.
`ChatDetail` publishes only once its `loading` flag clears, which is what makes
the absence meaningful. `getUnifiedChatChanges` still answers `null` for both
shapes, so the menu's gate is unchanged.

A restored `UnifiedDiffTab` whose `sourceId` is `chatChangesSourceId(tab.chatId)`
reads that entry directly: unresolved renders loading, resolved-with-nothing
renders the panel's ordinary empty diff, and resolved-with-changes renders the
diff *and claims the source id* for it. Claiming from the mounted tab is the
whole design — publishing itself still never mints a source
(`refreshOpenChangesSource` only refreshes an existing one), so a tab the user
never opened or has closed has no component to bring it back. Everything else
keeps expiring: a whisper group's source is content-addressed and has no
publisher, so a restored group tab still shows "no longer available".

`chatChangesRehydration.test.tsx` covers that window end to end (loading → the
chat's diff, the empty case, the whisper-group regression, and a closed tab that
a publish does not recreate), and `chatChangesCombinedView.test.tsx` is the
end-to-end case for this path: a chat's
turns go through `buildChatChangesContext` and `chatChangesTabInput` into a
rendered `UnifiedDiffTab`, pinning that repeated edits and a later reversion
replay as successive hunks, that a record captured in both `toolCalls` and
`timeline` replays once, that deleted and non-reconstructable files land under
"Not shown", and that repeated opens (and a close then reopen) land on the one
tab. Its fixture is cross-platform — two of its files are recorded with Windows
backslash paths, one edited and one removed by `Remove-Item` — and
`chatChangesModel.test.ts` plus `test/spa/processes/toolGroupUtils.test.ts` pin
the same forms at the unit level, including a chat that records one file both
ways.

## Tests

`test/spa/react/workspace-right-dock/unified*`, `quickOpenRouting.test.ts` and
`Unified*` cover the model, store, strip, shell, menu, per-kind views, both close
guards, terminal-session survival, the Ctrl+P routing matrix, the Ctrl/Cmd+W
close-tab shortcut (`closeTabRouting.test.ts`,
`UnifiedPanelCloseTabShortcut.test.tsx`), the navigator-scoped Ctrl/Cmd+F rule
(`findRouting.test.ts`, `UnifiedPanelQuickOpen.test.tsx`, and the diff case in
`UnifiedPanelResourceTabs.test.tsx`), and the canvas
event relay. Entry-point rerouting is tested where the
entry point lives — `test/spa/react/repos/ChatDetailCanvasClosed.test.tsx` holds
the diff, source-link, note-link, and canvas cases, plus the guard that the chat
grows no canvas column of its own. `UnifiedCanvasTab.test.tsx` and
`unifiedChatCanvasActions.test.tsx` cover the tab's chat actions, pop-out, and
created-query routing.
`WorkspaceSettingsHost.test.tsx` and `WorkspaceSettingsOwner.test.tsx` cover shared
form identity, draft/error retention, concrete-owner routing and unavailable owners.
`test/spa/react/repos/RepoGroupView.dock.test.tsx` and
`test/spa/react/repos/RepoDetail-workspace-dock.test.ts` pin that both hosts
render this panel whenever the panel slot is available, and nothing else in it.

Traps that have bitten this directory:

- **A dirty preview is unreachable through the UI**, because the first edit
  promotes the tab. `UnifiedPanelPreviewDirtyGuard.test.tsx` stubs `promoteTab`
  to a no-op so the reuse guard is still exercised; do not "fix" that suite by
  deleting it, and do not try to set the case up through the editor.

- Several suites mock `react/utils/config` with an **explicit export list**, so
  any `is…Enabled` reaching RepoDetail/RepoGroupView must appear in every such
  mock or they fail with "No <name> export is defined on the mock"
  (`RepoDetail-layout-mode.test.tsx`, `RepoDetail.queue-remote-routing.test.tsx`).
  The same applies to context mocks.
- Role queries skip `display:none` subtrees — assert a collapsed panel with
  `{ hidden: true }`.
- A mid-test `writeUnifiedPanelState` needs `act()`; it notifies
  `useSyncExternalStore` subscribers outside React's batch.
- Tab testids embed the whole tab id, so match on the kind prefix, not the
  resource id.
- Any suite that reaches the `+` menu's Explorer entry, or that mounts a panel
  scope another case left with an open tree, must call `clearUnifiedTreeState()`
  in its setup: the toggle now persists to its own store, which
  `clearUnifiedPanelState()` does not touch.
