# unified-right-panel

The workspace's one and only right panel: a Cursor-style resource-tabbed column
holding Terminal, Notes, files, notes, canvases, and chat diffs, with a
Search/Explorer navigator at its right edge. There is no second right panel and
no flag.

`RepoDetail.tsx` and `repos/RepoGroupView.tsx` render it under the
`dockAvailable` gate (`splitWorkspacePanel` + desktop) and wrap their subtree in
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
  affects new tabs only; changing it never retargets an open one.

Tabs are scoped by kind: `terminal | notes | note` are workspace-owned,
`file | canvas | diff` belong to the selected chat (`scopeForKind`). `unifiedTabId`
folds kind, owner, scope key, and resource id into one id with `|` escaped, so a
resource id cannot forge another tab's identity. The selected chat comes from the
queue store's `selectedTaskIdByRepo[workspaceId]` — never the global
`selectedTaskId`, which can name another workspace's chat. `unifiedTabId` uses
the concrete route as the owner identity when one exists, so equal relative paths
from same-id clones never merge into one tab.

## Layers

| File | Holds |
|---|---|
| `unifiedPanelTabsModel.ts` | Pure state: `visibleTabs`/`activeTab`/`openTab`/`openPreviewTab`/`promoteTab`/`activateTab`/`closeTab`/`moveTab`, plus the versioned localStorage codec (`UNIFIED_PANEL_STATE_VERSION = 3`). Every op returns the **same reference** on a no-op — it feeds `useSyncExternalStore`. There is no `explorer` kind: the file tree is a column, not a tab. |
| `unifiedPanelStore.ts` | One localStorage entry per panel scope (`unifiedPanelStorageKey`), read through `useSyncExternalStore`; same pattern as `explorer/explorerStateStore`. `migrateUnifiedPanelState` rewrites an older entry at mount — it writes, so it runs in an effect, never in a `getSnapshot`. |
| `unifiedPanelTree.ts` | The navigator column's open and width state per panel scope, in its own localStorage entry. Panel-level, not per-tab — it outlives tab/chat/mode switches, panel collapse, and reload. Owns the two width rules: the navigator is clamped so the view keeps `UNIFIED_PANEL_VIEW_MIN_WIDTH`, and a panel narrower than `UNIFIED_TREE_MIN_PANEL_WIDTH` hides the column until widening restores it. |
| `useUnifiedPanelTabs.ts` | The in-tree hook. `chatId` selects a *view* over the stored state, not a session. |
| `unifiedPanelOpen.ts` | The imperative seam for callers outside the panel subtree: `openUnifiedPanelTab`, `focusUnifiedPanelTab`, `unifiedTabIdFor`, `updateUnifiedPanelState`. Works with no panel mounted. |
| `unifiedPanelHost.tsx` | The "may I reroute?" signal. `useUnifiedPanelHostForChat(chatId)` returns a host **only** when the panel is showing that chat's tabs. |
| `UnifiedRightPanel.tsx` | The shell: reuses `useWorkspaceDock` wholesale (open/mode/width/resize/target), keep-alive, dirty/error sets, the close guards, and the layout — resource views on the left, the selected Search/Explorer mode on the right edge. |
| `UnifiedPanelTabStrip.tsx` | Presentational strip; derives the workspace/chat divider from `scopeForKind`. |
| `unifiedPanelBreadcrumbs.ts` + `UnifiedPanelToolbar.tsx` | The toolbar row under the strip: breadcrumbs for the active file tab, an in-place directory picker, and the Search/Explorer navigator controls. The model decides whether the path can use repo browsing. **Do not** name the model `unifiedPanelToolbar.ts` — esbuild resolves module paths case-insensitively and collides it with the component. |
| `UnifiedPanelTreeToggle.tsx` | The Explorer half of the panel's navigator controls. It renders with Search in the file toolbar or, when that toolbar is absent, in the tab strip. |
| `UnifiedTabView.tsx` | The kind switch. Every kind maps onto a view that already exists. |
| `UnifiedPanelOpenMenu.tsx` + `unifiedPanelOpenMenuModel.ts` | The searchable `+` popover. |
| `unifiedSourceLinks.ts`, `unifiedNoteTabs.ts`, `unifiedExplorerFiles.ts`, `unifiedCanvasEmbeds.ts`, `unifiedCanvasEvents.ts`, `unifiedDiffSources.ts`, `unifiedChatChanges.ts` | One descriptor builder per entry point. Each returns `OpenUnifiedTabInput | null`; a null means "not ours" and the caller keeps its existing surface. |
| `unifiedChatCanvasActions.ts` | The registry a `canvas` tab calls back into its owning chat through — "Ask AI" and "Send comments". Keyed by chat id alone. |
| `unifiedTerminalClose.ts`, `unifiedDirtyClose.ts` | The two close guards. |

## Views are reused, never re-implemented

There is no second editor, search backend, terminal manager, or canvas store.
`file` renders the Explorer's own `PreviewPane` (the same buffer controller the
Explorer sub-tab uses), `canvas` renders `CanvasPanel` (the panel is its ONLY
host — the chat has no canvas column of its own), `note` renders
`NoteEditor`, `diff` renders the chat's `WhisperDiffPanel`, and `terminal`
renders `TerminalView`. The file tree is not among them: it is
the panel's own column (`ExplorerPanel` in sidebar mode), so no tab mounts a
nested tab strip or a second editor — that is the "one tab row per panel" rule.

`ExplorerPanel`'s `mode` prop is required and picks how much of it renders:
`editor` (the whole Explorer sub-tab, RepoDetail's only mount), `navigator` (tree
only, opens handed to `onOpenFile`), and `sidebar` (navigator without the
internal Files/Search switch or breadcrumb row). The right panel mounts
`ContentSearchPanel` beside the same resource area for Search mode. Both mode
bodies stay mounted after first use; only their visibility changes.

Resource toolbars render *below* the strip.

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

`unifiedToolbarBreadcrumbs` turns the crumbs off — the row falls back to a plain
path label — for a `__trusted__:` absolute path because it is not repo-relative
and cannot use the repo directory API.

## The Search/Explorer navigator

Below the strip the panel is one row: the active tab's view on the left, the
selected Search or Explorer mode pinned to the right edge. Both modes share the
same panel-scope navigator width and point at the dock target. Explorer uses
`ExplorerPanel` in **sidebar mode** (`deepLink` only when that target is the
panel's own scope); Search uses `ContentSearchPanel`.

The navigator is panel-level chrome, not a tab: it renders for every tab kind
and for none at all. Its panel-scoped open bit lets the user collapse it without
closing resource tabs or the right panel. Search and Explorer are lazy-mounted
on first selection and then hidden with `display:none`, preserving requests,
results, tree expansion, resource tabs, terminal sessions, and unsaved buffers
across mode switches and navigator collapse. A panel too narrow for both columns
hides the navigator until it widens without changing the user's open bit.

The workspace header has one visibility toggle for the whole right panel. Search
and Explorer live inside the panel as peer navigator controls, so changing or
collapsing a navigator mode never closes the resource panel.

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

The dialogs are the Explorer's own `QuickOpen` / `ExactOpen` (portalled to
`document.body`). Exact Open and ordinary-repo Quick Open point at the dock
target. Repo-group Quick Open receives the group id, name, live-member count,
and owner base URL from `RepoGroupView`, so it searches the whole group while
the page and panel stay group-scoped. Because the dialogs portal outside the
panel root, "my dialog is already up" counts as panel focus.

A repo pick goes through `openTreeFile`: a trusted `__trusted__:` path lands
pinned and read-only, everything else takes the preview slot, exactly like a
tree click. A group pick first re-reads membership from the group owner, binds a
remote bare member id to that exact owner route, and asks `dock.setTarget()` to
run the dirty-editor guard. Missing/stale members, unknown remote routes, and a
declined guard leave tabs, target, tree, and dialog unchanged. An accepted pick
builds the preview descriptor directly from the result's member id and repo
label rather than waiting for target state to rerender.

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

## Ctrl/Cmd+F focuses the file filter

When Explorer is the visible navigator and keyboard focus is inside the open
right panel, Ctrl/Cmd+F focuses Explorer's **Filter files** input. The panel
claims the key in the capture phase so the behavior also works from Monaco;
Ctrl/Cmd+Shift+F remains available for workspace search. Search mode, a hidden
or narrow navigator, and focus outside the panel leave native find unchanged.

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

## Persistence and migration (codec v3)

The tab codec is versioned (`UNIFIED_PANEL_STATE_VERSION`). v3 persists the
concrete owner route. v2 payloads remain valid with an omitted route and keep
their stable bare-workspace tab ids. The codec also preserves the `preview` bit,
so a restored preview comes back italic in the same replaceable slot, and it no
longer accepts the old `explorer` kind. `restoreUnifiedPanelState` reads v1
payloads rather than discarding them: Explorer descriptors fail the kind check
like any other unknown entry, and the restore reports `openTree` so the caller
opens the tree column instead. `migrateUnifiedPanelState` runs from a mount
effect in `UnifiedRightPanel`, flips that tree-open bit, and rewrites the entry
at the current version. An unknown version is discarded whole.

The parse repairs as well as validates. A section with two preview bits keeps
the **last** one and returns the rest permanent — nothing is dropped, because a
visible tab beats a silently vanished buffer — and a restored preview that is
not last is moved to the end. A `preview` bit on any kind but `file` is
discarded: only the tree's single click creates the slot, and it opens files.

The `+` menu keeps its **Explorer** entry, in place and with its label. The action
selects Explorer mode and opens the navigator instead of opening a tab.

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
| Chat source link | `ChatDetail` `coc-open-source-canvas` | Declines relative/group refs and paths outside a known root — `PreviewPane` reads repo-relative blobs, so a tab for those could only render an error. The chat's clone-qualified selection disambiguates same-id local and remote workspaces. |
| Note link | same handler, `kind: 'note'` branch | `resourceId` is `<fetchMode>\|<root>\|<path>`: the note root is part of the identity, resolved once at open time because the link is gone by restore time. |
| Explorer selection | `ExplorerPanel` `onOpenFile` | The tree column (and navigator mode elsewhere): `options.preview` picks the preview slot vs a permanent tab. |
| Language navigation | `UnifiedTabView` `onOpenFile` | A "go to definition" out of a file tab. The descriptor takes its workspace id, concrete route, and repo label from the SOURCE tab, never from the dock's current target, so the target read and language document stay on the initiating clone. Always a permanent tab. |
| Canvas embed | `shared/CanvasEmbed.tsx` "Open in panel" | Gated on `useUnifiedPanelHostForChat`; the chat id arrives through `ChatRenderContext.chatId` because the embed is portaled. |
| Linked canvas / New Canvas | the `+` menu | Both build through `canvasOpenInput`, so an embed, a menu pick, and an AI event converge on one tab per `(owning clone, canvas id, chat)`. |
| AI canvas create/update | `ChatDetail` `onCanvasUpdated` | See below. |
| `+` menu | the panel itself | Reuses QuickOpen's search behavior: nothing before the first keystroke, debounce, abort the previous request. |
| Chat-wide **Changes** | the `+` menu, via `unifiedChatChanges.ts` | See below. |

`dir` refs, the chat header's explorer toggle, and conversation-candidate
navigation stay on the docked source canvas by design. AI canvases do not: this
panel is their only host, so a chat with no panel (a pop-out, an embedded chat)
keeps inline previews and the standalone canvas window and opens no sidebar.

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
`UnifiedPanelCloseTabShortcut.test.tsx`), and the canvas
event relay. Entry-point rerouting is tested where the
entry point lives — `test/spa/react/repos/ChatDetailCanvasClosed.test.tsx` holds
the diff, source-link, note-link, and canvas cases, plus the guard that the chat
grows no canvas column of its own. `UnifiedCanvasTab.test.tsx` and
`unifiedChatCanvasActions.test.tsx` cover the tab's chat actions, pop-out, and
created-query routing.
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
