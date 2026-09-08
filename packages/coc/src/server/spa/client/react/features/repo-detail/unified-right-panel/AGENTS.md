# unified-right-panel

The workspace's one and only right panel: a Cursor-style resource-tabbed column
holding Terminal, Notes, files, notes, canvases, and chat diffs, with the file
tree as its right-edge column. There is no second right panel and no flag.

`RepoDetail.tsx` and `repos/RepoGroupView.tsx` render it under the
`dockAvailable` gate (`splitWorkspacePanel` + desktop) and wrap their subtree in
`UnifiedPanelHostProvider` under the same condition; the panel does not widen
that gate. The state around it — open, width, resize, target — comes from
`../useWorkspaceDock`, described in `../AGENTS.md`.

## Scope, owner, and identity

Three different workspace ids, kept apart on purpose:

- **Panel scope** (`workspaceId`) — whose localStorage the tab set lives in. In a
  repo group this is the group id.
- **Tab owner** (`tab.ownerWorkspaceId`) — the clone the bytes come from (a group
  member, a remote clone). Route every request by this, never by page origin.
- **Dock target** — what `useWorkspaceDock` points Terminal and Explorer at. It
  affects new tabs only; changing it never retargets an open one.

Tabs are scoped by kind: `terminal | notes | note` are workspace-owned,
`file | canvas | diff` belong to the selected chat (`scopeForKind`). `unifiedTabId`
folds kind, owner, scope key, and resource id into one id with `|` escaped, so a
resource id cannot forge another tab's identity. The selected chat comes from the
queue store's `selectedTaskIdByRepo[workspaceId]` — never the global
`selectedTaskId`, which can name another workspace's chat.

## Layers

| File | Holds |
|---|---|
| `unifiedPanelTabsModel.ts` | Pure state: `visibleTabs`/`activeTab`/`openTab`/`openPreviewTab`/`promoteTab`/`activateTab`/`closeTab`/`moveTab`, plus the versioned localStorage codec (`UNIFIED_PANEL_STATE_VERSION = 2`). Every op returns the **same reference** on a no-op — it feeds `useSyncExternalStore`. There is no `explorer` kind: the file tree is a column, not a tab. |
| `unifiedPanelStore.ts` | One localStorage entry per panel scope (`unifiedPanelStorageKey`), read through `useSyncExternalStore`; same pattern as `explorer/explorerStateStore`. `migrateUnifiedPanelState` rewrites an older entry at mount — it writes, so it runs in an effect, never in a `getSnapshot`. |
| `unifiedPanelTree.ts` | The file-tree column's own state: one open bit and one width per panel scope, in its own localStorage entry. Panel-level, not per-tab — it outlives tab/chat switches, collapse, and reload. Owns the two width rules: the tree is clamped so the view keeps `UNIFIED_PANEL_VIEW_MIN_WIDTH`, and a panel narrower than `UNIFIED_TREE_MIN_PANEL_WIDTH` hides the column (`isUnifiedTreeVisible`) **without** flipping the stored open bit, so widening restores it. |
| `useUnifiedPanelTabs.ts` | The in-tree hook. `chatId` selects a *view* over the stored state, not a session. |
| `unifiedPanelOpen.ts` | The imperative seam for callers outside the panel subtree: `openUnifiedPanelTab`, `focusUnifiedPanelTab`, `unifiedTabIdFor`, `updateUnifiedPanelState`. Works with no panel mounted. |
| `unifiedPanelHost.tsx` | The "may I reroute?" signal. `useUnifiedPanelHostForChat(chatId)` returns a host **only** when the panel is showing that chat's tabs. |
| `UnifiedRightPanel.tsx` | The shell: reuses `useWorkspaceDock` wholesale (open/width/resize/target), keep-alive, dirty/error sets, the close guards, and the layout — views on the left, the file-tree column on the right edge. |
| `UnifiedPanelTabStrip.tsx` | Presentational strip; derives the workspace/chat divider from `scopeForKind`. Its `trailing` slot is the tree toggle's fallback home. |
| `unifiedPanelBreadcrumbs.ts` + `UnifiedPanelToolbar.tsx` | The toolbar row under the strip: breadcrumbs for the active file tab plus the tree toggle. The model decides whether the crumbs may navigate the tree. **Do not** name the model `unifiedPanelToolbar.ts` — esbuild resolves module paths case-insensitively and collides it with the component. |
| `UnifiedPanelTreeToggle.tsx` | The single open/close control for the tree column, rendered in whichever of the two hosts is available. |
| `UnifiedTabView.tsx` | The kind switch. Every kind maps onto a view that already exists. |
| `UnifiedPanelOpenMenu.tsx` + `unifiedPanelOpenMenuModel.ts` | The searchable `+` popover. |
| `unifiedSourceLinks.ts`, `unifiedNoteTabs.ts`, `unifiedExplorerFiles.ts`, `unifiedCanvasEmbeds.ts`, `unifiedCanvasEvents.ts`, `unifiedDiffSources.ts`, `unifiedChatChanges.ts` | One descriptor builder per entry point. Each returns `OpenUnifiedTabInput | null`; a null means "not ours" and the caller keeps its existing surface. |
| `unifiedTerminalClose.ts`, `unifiedDirtyClose.ts` | The two close guards. |

## Views are reused, never re-implemented

There is no second editor, search backend, terminal manager, or canvas store.
`file` renders the Explorer's own `PreviewPane` (the same buffer controller the
Explorer sub-tab uses), `canvas` renders `CanvasPanel`, `note` renders
`NoteEditor`, `diff` renders the chat's `WhisperDiffPanel`, and `terminal`
renders `TerminalView`. The file tree is not among them: it is
the panel's own column (`ExplorerPanel` in sidebar mode), so no tab mounts a
nested tab strip or a second editor — that is the "one tab row per panel" rule.

`ExplorerPanel`'s `mode` prop is required and picks how much of it renders:
`editor` (the whole Explorer sub-tab, RepoDetail's only mount), `navigator` (tree
only, opens handed to `onOpenFile`), and `sidebar` (navigator, minus the internal
breadcrumb row — this panel's file-tree column, whose breadcrumbs belong to the
panel-level toolbar instead). Nothing is inferred from `onOpenFile`: the two host
modes are indistinguishable that way, so every caller states its mode.

Resource toolbars render *below* the strip; the only thing that ever enters the
strip is the tree toggle, through its `trailing` slot.

## The toolbar row

Directly under the strip and above the active view, rendered **only** while the
active tab is a `file` tab — every other kind brings its own toolbar inside its
own view, and the panel does not stack two. It shows `explorer/Breadcrumbs` for
the file's path (scrolled to the tail, so a long path truncates from the left
with the whole thing in the row's tooltip), the tab's `repoLabel` when it has
one, and the tree toggle at its right end.

The toggle has two homes and one state: the row while it exists, and the tab
strip beside `+` whenever it does not (a non-file tab, or no tabs). Exactly one
is on screen at a time and both drive `unifiedPanelTree`.

A breadcrumb click **reveals a folder in the tree** — it never opens, closes, or
activates a tab. It does that by writing the Explorer's own per-workspace
`explorerStateStore` selection/expansion for the tree's target, which is the
same store the column reads, so there is no second selection model. Ancestors
are expanded along with the target; a row inside a collapsed parent is not a
reveal.

`unifiedToolbarBreadcrumbs` turns the crumbs off — the row falls back to a plain
path label — for a `__trusted__:` absolute path (not repo-relative, no row in
any tree) and for a file whose `ownerWorkspaceId` is not the tree's current
target (its path resolves in a different repo). Retargeting the dock therefore
mutes an open tab's crumbs without touching the tab.

## The file-tree column

Below the strip the panel is one row: the active tab's view on the left, the
file-tree column pinned to the right edge. The column is `ExplorerPanel` in
**sidebar mode**, pointed at the dock target (`deepLink` only when that target is
the panel's own scope), and its selections build their descriptor with
`explorerFileTabInput`.

It is panel-level chrome, not a tab: it renders for every tab kind and for none
at all, so closing the last tab with the tree open leaves the panel showing the
tree beside the empty state. It is mounted while `unifiedPanelTree`'s open bit is
set and hidden with `display:none` when the panel is too narrow for both columns,
so widening brings it back with its expansion intact.

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

`quickOpenOwner({ panelOpen, panelHasFocus, explorerMounted, explorerHasFocus })`
is the whole decision, pure and unit-tested: focus inside the panel wins;
otherwise a mounted Explorer sub-tab wins (focused or not, which is what keeps
today's behaviour for a user with no panel open); otherwise the open panel; else
nobody. `explorerMounted`/`explorerHasFocus` come from a module-level registry of
focus probes — only `mode: 'editor'` mounts register, because a navigator/sidebar
Explorer is somebody else's column.

The panel listens in the **capture** phase on `document` and calls
`stopPropagation()` when it wins, so `ExplorerPanel`'s bubble-phase listener never
runs — and neither does Monaco, whose handlers sit on the editor's own DOM, so
Ctrl+P inside a code buffer in this panel opens this dialog. `preventDefault()`
is always called by the winner, so the browser print dialog never appears.

The dialogs are the Explorer's own `QuickOpen` / `ExactOpen` (portalled to
`document.body`), pointed at the **dock target** — the clone the tree column
browses — not the panel scope, which in a repo group is the group. Because they
portal outside the panel root, "my dialog is already up" counts as panel focus.

A pick goes through `openTreeFile`: a trusted `__trusted__:` path lands pinned and
read-only, everything else takes the preview slot, exactly like a tree click. It
also sets the tree's open bit, and the reveal comes free — the new tab is active,
`unifiedToolbarBreadcrumbs` resolves its path, and `ExplorerPanel`'s
`activeFilePath` tracking expands the ancestors and centres the row. The bit is
set even when the panel is too narrow for `isUnifiedTreeVisible`: the bit is what
the user asked for and widening restores it, but the panel is never force-widened
over a boundary the user dragged.

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
state in the store.

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

## The preview slot

Each scope section has at most **one preview tab**, and it is always the
section's last tab. The file tree's single click opens into it
(`openPreviewTab`); the next single click replaces the descriptor *at that same
index*, so the strip shows one italic tab that changed resource rather than a
tab closing and another appearing. Every other entry point — `+`, a chat source
link, a note link, a canvas embed, a diff action, the tree's own double click —
goes through `openTab` and is permanent, which is also why `openTab` inserts a
new tab *before* the preview and `moveTab`'s "to the end" stops one place short
of it.

Two rules keep the slot honest:

- **A file that already has a visible tab is focused, never previewed.** That
  covers both a permanent tab (which must not be demoted) and the current
  preview (which must not churn its buffer) — and both return the same state
  reference when that tab is already active.
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
| Drag or Alt+Arrow the tab | `moveTab` promotes what it moves, so both reorder paths agree |

The tree's double click arrives as click, click, dblclick. The two clicks are the
same preview open, which the model answers with the identical state reference, so
nothing remounts before the promotion lands. `ExplorerPanel` needs `onFilePin`
wherever a permanent tab has somewhere to live — its own strip *or* a host that
takes the opens — not only when its own `explorerEditorTabs` flag is on.

## Persistence and migration (codec v2)

The tab codec is versioned (`UNIFIED_PANEL_STATE_VERSION`). v2 persists the
`preview` bit, so a restored preview comes back italic in the same slot, still
replaceable, and it dropped the `explorer` kind. `restoreUnifiedPanelState`
reads a v1 payload rather than discarding it: its Explorer descriptors fail the
kind check like any other unknown entry, and the restore reports `openTree` so
the caller opens the tree column instead — an Explorer tab carried no state, so
nothing is lost. `migrateUnifiedPanelState` (called from a mount effect in
`UnifiedRightPanel`) is what acts on that: it flips the tree's open bit and
rewrites the entry at the current version. A version this build does not know is
still discarded whole.

The parse repairs as well as validates. A section with two preview bits keeps
the **last** one and returns the rest permanent — nothing is dropped, because a
visible tab beats a silently vanished buffer — and a restored preview that is
not last is moved to the end. A `preview` bit on any kind but `file` is
discarded: only the tree's single click creates the slot, and it opens files.

The `+` menu keeps its **Explorer** entry, in place and with its label, but the
action toggles the tree column instead of opening a tab.

## Permissions ride on one bit

`tab.readOnly` moves only on an explicit `openTab` — the entry point decides, and
moving or restoring a tab can never widen it. `PreviewPane` drops its write when
read-only (no save button, no `writeBlob`, and `onRegisterSave(null)`), so a
read-only tab has no write path at all.

- `sourceLinkTabInput` (chat source links) → always `readOnly: true`. A link is a
  reference, not an authorization.
- `explorerFileTabInput` (Explorer selections, `+` results) → editable, because
  the Explorer is an authorized entry point.
- `noteTabInput` → editable; a note link opens the editor the docked canvas
  would have shown.

## Keep-alive and terminals

A tab joins the mounted set when it **first becomes active**, and leaves on close.
Mount-on-activation (not mount-on-presence) is what makes a restored terminal
descriptor attach nothing until it is shown — restoration never spawns a PTY.
Collapse is `display:none` on the whole column, so a tab switch, chat switch,
collapse, or workspace navigation detaches nothing. Only an explicit close ends a
session.

## Closing is guarded

Both the strip's ✕ and a view's own close button go through `requestClose`, which
runs the terminal check, then the dirty check, then `closeTab`:

- **Terminal.** `TerminalView` reports its sessions through `onSessionsChange`;
  `liveTerminalSessionIds` counts only `running` sessions that have a server id, so
  a tombstone-only tab closes with no prompt. Terminate happens **before** the
  close and routes through `getCocClientForWorkspace(owner)`; 404 counts as
  success, anything else rejects and the tab, the view, and the PTYs all stay.
- **Dirty buffers.** `DIRTY_CLOSE_KINDS` is `file | note | canvas` — the three
  kinds that both report dirtiness (`onDirtyChange`) and hand back a way to write
  it (`onRegisterSave`), so the Save button always has something behind it. The
  prompt is the Explorer's own `explorer/ExplorerCloseTabsDialog`. A rejected or
  `false` save keeps the tab, the buffer, and the prompt as a retry.

`CanvasPanel` and `NoteEditor` publish exactly the contract `PreviewPane`
established; `useCanvasRecord.saveNow()` and `NoteEditor`'s flush both return
false when the write did not land, including when the draft moved while it was in
flight.

## Entry points

Every entry point follows one shape: build a descriptor, and with a matching host
call `openUnifiedPanelTab` and return; otherwise fall through to the pre-existing
surface untouched.

| Entry point | Lives in | Notes |
|---|---|---|
| Chat diff action | `ChatDetail` `WHISPER_DIFF_EVENT` handler | A whisper diff is rebuilt from an in-memory transcript, so `unifiedDiffSources` is the join between a persisted tab and its source. |
| Chat source link | `ChatDetail` `coc-open-source-canvas` | Declines relative/group refs and paths outside a known root — `PreviewPane` reads repo-relative blobs, so a tab for those could only render an error. |
| Note link | same handler, `kind: 'note'` branch | `resourceId` is `<fetchMode>\|<root>\|<path>`: the note root is part of the identity, resolved once at open time because the link is gone by restore time. |
| Explorer selection | `ExplorerPanel` `onOpenFile` | The tree column (and navigator mode elsewhere): `options.preview` picks the preview slot vs a permanent tab. |
| Canvas embed | `shared/CanvasEmbed.tsx` "Open in panel" | The only entry point that needed a new affordance. Gated on `useUnifiedPanelHostForChat`; the chat id arrives through `ChatRenderContext.chatId` because the embed is portaled. |
| AI canvas create/update | `ChatDetail` `onCanvasUpdated` | See below. |
| `+` menu | the panel itself | Reuses QuickOpen's search behavior: nothing before the first keystroke, debounce, abort the previous request. |
| Chat-wide **Changes** | the `+` menu, via `unifiedChatChanges.ts` | See below. |

`dir` refs, the chat header's explorer toggle, and conversation-candidate
navigation stay on the docked source canvas by design.

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
through refs. **Any future SSE-driven entry point must do the same.**

## The chat's own Changes (`unifiedChatChanges.ts`)

The `+` menu lists **Changes** after New Canvas, but only when the selected chat
has recorded a completed file edit — so the answer has to exist *before* anything
is opened. The chat publishes its whole-chat `WhisperDiffOpenContext` (built by
`chat/conversation/tool-calls/chatChangesModel.ts`) into a `useSyncExternalStore`
registry keyed by `(panel scope workspace, chat id)`, the same shape
`unifiedCanvasEvents` uses; the menu reads it back and hides the entry on `null`.
The scope key is what isolates chats across repos, repo groups, and remote
clones.

The tab is an ordinary `diff` tab over the existing `WhisperDiffPanel`, with one
difference: its `resourceId` is the fixed `chat-changes-<chatId>` rather than
`whisperDiffSourceId`'s content hash. A whole-chat context grows as the chat
edits more files, and a re-hash would open a *second* tab instead of refreshing
the open one — hence `registerUnifiedDiffSource(ctx, { sourceId })`, which moves
the content hash to the record's `contentKey` so an unchanged re-register still
keeps the stored context identity (and with it the user's file selection).

## Tests

`test/spa/react/workspace-right-dock/unified*`, `quickOpenRouting.test.ts` and
`Unified*` cover the model, store, strip, shell, menu, per-kind views, both close
guards, terminal-session survival, the Ctrl+P routing matrix, the Ctrl/Cmd+W
close-tab shortcut (`closeTabRouting.test.ts`,
`UnifiedPanelCloseTabShortcut.test.tsx`), and the canvas
event relay. Entry-point rerouting is tested where the
entry point lives — `test/spa/react/repos/ChatDetailCanvasClosed.test.tsx` holds
the diff, source-link, note-link, and canvas cases.
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
