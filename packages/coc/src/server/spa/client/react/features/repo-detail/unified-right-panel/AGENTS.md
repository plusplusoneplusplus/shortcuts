# unified-right-panel

One Cursor-style resource-tabbed right panel behind `features.unifiedRightPanel`
(default **off**, runtime flag `unifiedRightPanelEnabled`, hook
`hooks/feature-flags/useUnifiedRightPanelEnabled`). With the flag off nothing here
mounts and `WorkspaceRightDock` behaves exactly as before — see the "Workspace
right dock" section of `../AGENTS.md`.

`RepoDetail.tsx` and `repos/RepoGroupView.tsx` render one of the two panels in the
same slot, under the same `dockAvailable` gate; the panel does not widen dock
availability. Both wrap their subtree in `UnifiedPanelHostProvider`.

## Scope, owner, and identity

Three different workspace ids, kept apart on purpose:

- **Panel scope** (`workspaceId`) — whose localStorage the tab set lives in. In a
  repo group this is the group id.
- **Tab owner** (`tab.ownerWorkspaceId`) — the clone the bytes come from (a group
  member, a remote clone). Route every request by this, never by page origin.
- **Dock target** — what `useWorkspaceDock` points Terminal and Explorer at. It
  affects new tabs only; changing it never retargets an open one.

Tabs are scoped by kind: `terminal | explorer | notes | note` are workspace-owned,
`file | canvas | diff` belong to the selected chat (`scopeForKind`). `unifiedTabId`
folds kind, owner, scope key, and resource id into one id with `|` escaped, so a
resource id cannot forge another tab's identity. The selected chat comes from the
queue store's `selectedTaskIdByRepo[workspaceId]` — never the global
`selectedTaskId`, which can name another workspace's chat.

## Layers

| File | Holds |
|---|---|
| `unifiedPanelTabsModel.ts` | Pure state: `visibleTabs`/`activeTab`/`openTab`/`activateTab`/`closeTab`/`moveTab`, plus the versioned localStorage codec. Every op returns the **same reference** on a no-op — it feeds `useSyncExternalStore`. |
| `unifiedPanelStore.ts` | One localStorage entry per panel scope (`unifiedPanelStorageKey`), read through `useSyncExternalStore`; same pattern as `explorer/explorerStateStore`. |
| `unifiedPanelTree.ts` | The file-tree column's own state: one open bit and one width per panel scope, in its own localStorage entry. Panel-level, not per-tab — it outlives tab/chat switches, collapse, and reload. Owns the two width rules: the tree is clamped so the view keeps `UNIFIED_PANEL_VIEW_MIN_WIDTH`, and a panel narrower than `UNIFIED_TREE_MIN_PANEL_WIDTH` hides the column (`isUnifiedTreeVisible`) **without** flipping the stored open bit, so widening restores it. |
| `useUnifiedPanelTabs.ts` | The in-tree hook. `chatId` selects a *view* over the stored state, not a session. |
| `unifiedPanelOpen.ts` | The imperative seam for callers outside the panel subtree: `openUnifiedPanelTab`, `focusUnifiedPanelTab`, `unifiedTabIdFor`, `updateUnifiedPanelState`. Works with no panel mounted. |
| `unifiedPanelHost.tsx` | The "may I reroute?" signal. `useUnifiedPanelHostForChat(chatId)` returns a host **only** when the panel is showing that chat's tabs. |
| `UnifiedRightPanel.tsx` | The shell: reuses `useWorkspaceDock` wholesale (open/width/resize/target), keep-alive, dirty/error sets, the close guards. |
| `UnifiedPanelTabStrip.tsx` | Presentational strip; derives the workspace/chat divider from `scopeForKind`. |
| `UnifiedTabView.tsx` | The kind switch. Every kind maps onto a view that already exists. |
| `UnifiedPanelOpenMenu.tsx` + `unifiedPanelOpenMenuModel.ts` | The searchable `+` popover. |
| `unifiedSourceLinks.ts`, `unifiedNoteTabs.ts`, `unifiedExplorerFiles.ts`, `unifiedCanvasEmbeds.ts`, `unifiedCanvasEvents.ts`, `unifiedDiffSources.ts` | One descriptor builder per entry point. Each returns `OpenUnifiedTabInput | null`; a null means "not ours" and the caller keeps its existing surface. |
| `unifiedTerminalClose.ts`, `unifiedDirtyClose.ts` | The two close guards. |

## Views are reused, never re-implemented

There is no second editor, search backend, terminal manager, or canvas store.
`file` renders the Explorer's own `PreviewPane` (same buffer controller as the
flag-off Explorer tabs), `canvas` renders `CanvasPanel`, `note` renders
`NoteEditor`, `diff` renders the chat's `WhisperDiffPanel`, `terminal` renders
`TerminalView`, and `explorer` renders `ExplorerPanel` in **navigator mode** (no
editor pane and no nested tab strip — that is the "one tab row per panel" rule).

`ExplorerPanel`'s `mode` prop picks how much of it renders: `editor` (the whole
Explorer sub-tab), `navigator` (tree only, opens handed to `onOpenFile`), and
`sidebar` (navigator, minus the internal breadcrumb row — the file-tree column,
whose breadcrumbs belong to the panel-level toolbar instead). State it
explicitly; the legacy inference from `onOpenFile` cannot tell the two host
modes apart and only survives as the default for existing callers.

Resource toolbars render *below* the strip; nothing portals into it.

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
| Explorer selection | `ExplorerPanel` `onOpenFile` | Navigator mode. |
| Canvas embed | `shared/CanvasEmbed.tsx` "Open in panel" | The only entry point that needed a new affordance. Gated on `useUnifiedPanelHostForChat`; the chat id arrives through `ChatRenderContext.chatId` because the embed is portaled. |
| AI canvas create/update | `ChatDetail` `onCanvasUpdated` | See below. |
| `+` menu | the panel itself | Reuses QuickOpen's search behavior: nothing before the first keystroke, debounce, abort the previous request. |

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

## Tests

`test/spa/react/workspace-right-dock/unified*` and `Unified*` cover the model,
store, strip, shell, menu, per-kind views, both close guards, terminal-session
survival, and the canvas event relay. Entry-point rerouting is tested where the
entry point lives — `test/spa/react/repos/ChatDetailCanvasClosed.test.tsx` holds
the diff, source-link, note-link, and canvas cases; the flag-off/flag-on swap is
pinned in `test/spa/react/repos/RepoGroupView.dock.test.tsx`.

Traps that have bitten this directory:

- Several suites mock `react/utils/config` with an **explicit export list**, so a
  new `is…Enabled` reaching RepoDetail/RepoGroupView breaks them with "No <name>
  export is defined on the mock" (`RepoDetail-layout-mode.test.tsx`,
  `RepoDetail.queue-remote-routing.test.tsx`). The same applies to context mocks.
- Role queries skip `display:none` subtrees — assert a collapsed panel with
  `{ hidden: true }`.
- A mid-test `writeUnifiedPanelState` needs `act()`; it notifies
  `useSyncExternalStore` subscribers outside React's batch.
- Tab testids embed the whole tab id, so match on the kind prefix, not the
  resource id.
