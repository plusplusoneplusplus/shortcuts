# unified-right-panel

The workspace's only right panel. Work Items, Pull Requests, files, chat diffs, local HTML, and web tabs share one strip. Terminal, Settings, To-do, Canvas, Notes, and Git are `coc://` pages, not tab kinds. A canvas is `coc://canvas/<id>`. Notes is `coc://notes[/<path>]`. Git is `coc://git[/member/<id>][/<sha|branch-range|working-changes>[/<filePath>]]`. Mounts at every breakpoint. Dock state is `../useWorkspaceDock` (`../AGENTS.md`).

## Identity

- **Scope** (`workspaceId`) owns localStorage. In a group this is the group id.
- **Tab owner** is `ownerWorkspaceId` plus `ownerRoutingRef`. `null` pins a local owner to page origin. Route file and language calls with both.
- **Dock target** affects new tabs only.
- `work-items | pull-requests | note | html-page | browser` are workspace-owned. `file | diff | external | paste` belong to the selected chat (`scopeForKind`). Notes and Git are one workspace page each (`browserChatId` unset, resource ids `coc-notes` and `coc-git`). Canvas stays with its chat.
- Selected chat is `selectedTaskIdByRepo[workspaceId]`, never global `selectedTaskId`. `unifiedTabId` uses the concrete route when one exists.
- Draft `@workspace` tabs copy into the new chat in strip order and stay available for the next draft.
- `external` is an opaque capability, never persisted, and has no `+` entry. `paste` is an in-memory snapshot keyed by content hash, pruned when no tab references it. Ordinary `browser` tabs are session-only. `coc://` pages persist. `html-page` persists its view id and reopens from disk.
- Editable opens resolve filesystem spelling before publication. Failures offer Retry and do not open another buffer.

## State

- `unifiedPanelTabsModel.ts` is pure. No-ops keep the state reference. `orderByScope` is id-only.
- `migrateUnifiedPanelState` writes, so it runs in an effect, never in `getSnapshot`.
- Group folds and block order are `unified-right-panel:<scope>:groups`, separate from descriptors. `normalizeGroupOrder` drops unknown groups and appends missing ones. Moves stay inside the kind group. A group-pill drag past `GROUP_DRAG_THRESHOLD` moves the block. Shorter presses fold. Default-on `features.panelTabGroups`. Explicit false restores the ungrouped strip.
- Default-on `features.panelTabReordering`. Disabling it confines moves to sections. The strip accepts only its own HTML drag session and cancels on Escape, drag end, source close, or scope/flag change.
- With session-context attachments on, a file-tab drag also carries a `git-file` pointer. Reorder ignores it.
- One preview tab per scope section. Single click replaces it. Every other entry is permanent and inserts before the preview. An existing visible file is focused, never previewed. A line open mints a new `revealNonce`. Replacing a dirty preview waits on the unsaved-edits prompt. First edit, double-click, and a move promote in place.
- File history is one stack per scope, at most 50 locations, VS Code ten-line coalescing. Replay of a missing file drops every entry for it and keeps stepping. Alt+Left/Right (Ctrl+-/Ctrl+Shift+- on macOS) and mouse buttons 3/4. Focus must be inside the visible panel. Strip-tab Alt+Arrow stays with reorder.
- On chat change, the dock opens exactly when `visibleTabs` is non-empty. That reconciliation does not rerun when tabs change. A user close that empties `visibleTabs` collapses the panel unless the navigator is showing. Programmatic removal does not.
- Quick Open and Exact Open use capture-phase `quickOpenOwner`. Panel focus wins, else a mounted editor-mode Explorer, else an open panel or an eligible closed group panel. Closed-panel eligibility is group Ctrl/Cmd+P only, never Ctrl/Cmd+O. The winner calls `preventDefault` and `stopPropagation`. Accepting a file opens Explorer mode and does not force-widen the panel. A declined dirty-target switch leaves the dialog. Symbol rows open pinned.
- Ctrl/Cmd+W uses `closeTabOutcome`: `close`, `swallow`, or `ignore`. Swallow even an empty focused strip so the browser does not close the window. Ignore only when the active tab is `coc://terminal` and focus is inside that page. Meta+W still closes a terminal. Close goes through `requestClose`. File-view containers use `tabIndex={-1}`, so clicking rendered Markdown gives the panel focus without a Tab stop. Nested editors and controls keep their own focus. `UnifiedGitTab` focuses its portal host with a native capture-phase mousedown listener.
- Ctrl/Cmd+F focuses Explorer's filter only when the navigator column is visible and focused. Content focus stays with Monaco, diffs, or the terminal.
- `coc://todo` hides Explorer through the navigator open bit. Search state stays. Explicit reopen survives until To-do is selected again.

## Views

Reuse existing views. Do not add a second editor, terminal manager, search backend, or canvas store.

- `file` is Explorer `PreviewPane`. `diff` is `WhisperDiffPanel`. `coc://terminal` is `TerminalView`. `coc://canvas/<id>` is `CanvasPanel` through `UnifiedCanvasTab`. `coc://notes` is `NotesView` with panel-local selection. `coc://git` is an empty `UnifiedGitTab`. `RepoGitTab` portals its detail pane there. The commit list stays in `SplitWorkspacePanel`.
- `ExplorerPanel` `mode`: `editor`, `navigator`, or `sidebar`. This panel uses `sidebar` for the tree and mounts `ContentSearchPanel` for Search. Both stay mounted after first use.
- The file toolbar renders only for an active `file` tab. Reload and blame state are per tab id, in memory. `features.fileHistory` and `features.fileBlame` are default off. Blame opens `openPanelGitCommit` only when the tab route matches the panel owner.
- `parseCocAddress` is case-insensitive, ignores a trailing slash, and rejects query and hash. `coc://` never reaches a webview, `normalizeBrowserUrl`, browser history, or site approval. The address does not name an owner. `openCocPageTab` focuses an existing same-page tab except `coc://todo/<itemId>`, which always opens anew. Notes path changes replace the current history entry.
- Git addresses cannot represent `working-tree-file`, `working-tree-comments`, `branch-range-comments`, or `multi-commit`. Reload of those lands on history.
- Settings is one shared form. The newest slot shows it. A `coc://settings` slot mounts only while its tab is active. Terminal sessions belong to the workspace server. Leaving the page detaches. `cocOpenRequest` asks for a session only for the address the tab opened at.
- WI/PR tools follow the dock target and its concrete route. Notes and Settings belong to the panel workspace. Missing or changed remote routes do not fall through locally. Provider work-item and PR links open an owner-bound browser tab on desktop and the system browser on the web. Group roots need a member target.
- Source split (`features.panelSourceSplit`, default on) holds two `file` tabs in memory, keyed by scope plus chat. The focused pane is the active tab. The same file in both panes is one buffer. `UnifiedSourceMirror` is a second editor on that model. Panes keep at least 280px.
- Trusted `__trusted__:` and `__workspace_preview__:` paths are read-only. Default-on `features.binaryFileReveal` reveals through the owning server and never opens the file.
- A tab mounts on first activation and leaves on close. Collapse is `display:none`. Restored terminals spawn nothing until shown.
- Close order is terminal check, then dirty check, then `closeTab`. Terminal terminate goes through `getCocClientForWorkspace(owner)` before close. 404 is success. Anything else keeps the tab. Dirty files, notes, canvas, and Git use `ExplorerCloseTabsDialog`. A false save keeps the tab.

## Browser

- Ctrl/Cmd+T creates a blank tab for the dock target when focus is inside the one visible panel. Repeats are consumed. Native `onOpenMenuRequested` counts only for the matching active visible view.
- Default-on `features.browserTabShortcuts`: Ctrl/Cmd+1–9 over rendered web tabs, 9 meaning last. Editors, Monaco, and terminals keep their keys.
- Ctrl/Cmd+Shift+T restores the newest closed web tab from a memory stack of 20 per scope and chat. Only `closeTabByUser` records. Entries omit view ids. A restore mints a fresh view.
- Default-off `features.chatScopedBrowserTabs` files a tab under the selected chat. Turning the flag off calls `releaseBrowserChatOwners`. To-do pages are not released that way. Duplicate, popup, and reopen keep the source owner.
- Annotation, downloads, history, favorites, and demo recording follow `packages/coc/AGENTS.md`, `packages/coc-desktop/AGENTS.md`, and [browser-demos.md](../../../../../../../../../../.github/skills/coc-knowledge/references/browser-demos.md).
- Electron guests are created once in `BrowserWebviewLayer` and adopted on first `dom-ready`. Remounts, chat switches, and collapse keep the guest. Inactive hosts use `visibility:hidden`, never `display:none`. Background-control guests stay at last geometry (1280×800 if never placed) with opacity 0 so screenshots still work.
- WebView2 paints above DOM. Modals hide it. `data-native-view-overlay` hides intersecting views. `data-native-view-passthrough` exempts underlays.
- A plain http(s) click in a chat bubble opens a panel browser tab. Modifier clicks, owned link handlers, the web app, and an unclaimed event keep the default.
- AI reveal uses the trusted native resource id and concrete owner. Stop uses the owning client's `processes.cancel` and clears activity only after cancellation succeeds. Late replies cannot restore a finished turn.

## Other entry points

- Chat diffs, source links, directory links, HTML links, notes, Explorer, definitions, canvas embeds, and AI canvas events use `openUnifiedPanelTab` with the originating chat and concrete owner. Hosted links resolve ownership first. Chats without a matching panel keep their existing surface.
- Kusto canvas updates only reconcile. Other canvas updates may reopen a dismissed tab. Handlers read the host through refs because `useChatSSE` does not resubscribe. With no host the event is still published and nothing is activated.
- Chat Changes uses resource id `chat-changes-<chatId>`, not a content hash. The registry is not persisted. Missing means the transcript has not loaded. `null` means it loaded and changed nothing. A restored tab claims the source. Publishing never mints a source for a closed tab. Path keys are forward-slash normalized.
- Canvas pop-out is `coc-canvas-<id>` on the owning workspace. A new Kusto query opens a sibling tab. The originating tab keeps its draft.

## Sentinel To-do

Ledger behavior, jobs, categories, dependencies, Refrains, Coda, and Overtures live in [packages/coc/AGENTS.md](../../../../../../../../AGENTS.md) and the knowledge references. This panel only hosts them.

- A hosted Sentinel publishes its ledger owner into `sentinelTodoChats` keyed by `(panel scope, chat id)`.
- The page is `coc://todo`, kept with that chat. `releaseBrowserChatOwners` does not drop it.
- Fetch `client.sentinelTodos.get` with `full: true` on the owning server. Refresh from that server's `sentinel-todos-changed` socket.
- Auto-open on `ledgerRevision === 1` only when the chat shows no tab and no To-do page.
- The tab shares `sentinelTodoRecentPage`: all unarchived non-Done items, then recent Done inside a 50-item budget. Archived follows Done.
- Writes send the revision they were based on and keep the draft on conflict. Creates reuse one idempotency key per draft.
- The tab never starts, retries, cancels, converts, or copies items. Manual items stay tracking-only.
- Excursions are unstored pinned copies. They never write the ledger or send messages.
- Message admission treats transport failure and the 30s deadline as uncertain. Retry of an uncertain attempt needs a separate confirmation. Confirmed admission alone clears the draft.

## Tests

`test/spa/react/workspace-right-dock/unified*`, plus the routing suites named beside each shortcut above. Role queries skip `display:none`. Pass `{ hidden: true }` for a collapsed panel. `clearUnifiedPanelState()` does not clear the tree store. Call `clearUnifiedTreeState()` too. A dirty preview is unreachable in the UI because the first edit promotes. `UnifiedPanelPreviewDirtyGuard.test.tsx` stubs `promoteTab`. Do not delete that case.
