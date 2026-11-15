# repo-detail

Top bar and the per-repo detail view. Classic tab order. Workspace accepts `activity` and `chats`. The optional plan tab is `Plans (Dep.)`. Layout is fixed. Git and Explorer shortcuts keep the chat workspace selected. `RepoDetail` renders hidden sub-tabs synchronously. Panel behavior lives in `unified-right-panel/AGENTS.md`.

## Repo tabs

- `repoTabModel.ts` — pure overflow, visibility, labels, drag helpers.
- `useRepoTabSelection.ts` — the only `selectRepo(wsId, agentId?)`. Falsy `agentId` means no agent. `onRefresh` runs only when the same workspace id is re-selected under a different agent.
- `useRepoTabOrdering.ts` — persisted order. Pass the flat id list via `allRepoIdsRef`. Order math is `../../repos/repoOrder`.
- `RepoTabStrip.tsx` re-exports the symbols tests and TopBar import.
- Skills UI shares `useWorkspaceSkillsController` with settings. Do not copy it into the tab.

## Clone routing

Queue reads go through `useWorkspaceQueueSeed`, `useCocClient(sourceSelectionId)`, and `api/workspaceReads.ts`. Cache keys include server and API owner. Reconnect reads supersede pending ones. Task selection is `selectedTaskIdByRepo[sourceSelectionId]`. Remote selections never mirror into bare workspace keys. Unresolved remote owners skip local probes. `/chat/launch-terminal` stays on page-origin `fetchApi`. Remote queue events cannot replace page-origin queue state. Work-item reviews pass the concrete selection as `attachmentDestinationId`. Diff payloads keep the plain workspace id.

## Dock

Call `useWorkspaceDock` once per workspace view. `workspaceId` is panel scope (storage, tabs, Notes). Dock target is where new terminals and files open. They differ only when the caller passes `targets`. Omitting `targets` is a no-op. Changing target never retargets an open tab.

`RepoGroupView` is the only target supplier: deprioritized group root plus members. Stale members are `disabled`. While the request is in flight, `targets` is `undefined`.

- Group roots hide the Explorer menu entry. The tree is chrome, not a tab. `deepLink` is true only when target equals scope. Otherwise a file click would `SET_SELECTED_REPO` and leave the group.
- Target switches call `confirmDiscardExplorerEditsOnSwitch`. A declined `setTarget()` leaves storage and Quick Open untouched. Only an explicit `setTarget` persists. Fallback is first enabled non-deprioritized target, then first enabled, then scope.
- One control cycles hidden, docked, expanded, hidden. Expansion is in-memory, so reload restores docked. Expanded layout keeps chats mounted with `display:none`. Escape restores docked size unless an editor, terminal, dialog, or menu owns it. Mobile clears expansion. Ctrl/Cmd+\\ toggles visibility and does not advance the cycle.
- Widths persist through temporary clamps. The dock maximum subtracts live left width, both 8px handles, and a 360px middle reserve.
- Collapsed rail: owner-verified modes, unknown modes omitted, Ralph identity kept. Refresh (`features.railManualRefresh`, default on) reads queue, pins, and Git and never fetch, pull, or mutate. Groups read live members, never the virtual root. Hover never mutates Git. Missing upstream stays visible. Commit navigation uses `openPanelGitCommit` and does not touch the URL hash.
- `features.railStatusActions` (default on) portals the footer's Admin gear and quota ring. The rail has no quota hook of its own.
- Aggregated group chats keep the raw member workspace apart from its clone route via `WorkspaceOwnerContext`.

## Explorer

- Delete is default-on `features.explorerDelete`, physical workspaces only, Git metadata protected. Remote omitted flag means off. Dirty paths and in-flight saves block admission for this window only. Success closes affected clean tabs. Failure keeps buffers and refreshes disk. No rollback.
- `TreeNode` derives its spinner from `isDir && isExpanded && children === undefined && !loadError`. Do not add a loading flag. Failed listings show a retry. Cache generations drop pre-deletion reads and keep the visible snapshot.
- `hideUnfetchedDirs` only for a current successful name search under the 100-hit cap with ancestors loaded.
- Quick Open is one dialog: `files` (Ctrl/Cmd+P, 40ms) and `symbols` (Ctrl/Cmd+,, 500ms including `f `). Grammar is `paletteQuery.ts`. Symbols use the language-server bridge, merge as they land, and pin the highlighted row by identity. A status push re-derives indexing and does not restart the query, except the empty-server to answerable edge.
- File search highlights returned `indices` only. Group rows stay one server-ranked list. `onFileSelect` may return `false` to keep the dialog. `/search` is a fuzzy scan of the cached listing.
- Content search state persists per workspace. Results stay in memory. Typed input debounces 250ms. Toggles re-run immediately. Drop responses whose run id is not newest. The tree selection does not narrow search. The server owns caps. 400 renders the engine message. Zero matches is `empty`.
- `MonacoFileEditor` does not pass `value` through when it echoes an `onChange` this pane already reported.
- Page Ctrl/Cmd+Shift+F is `content-search/`, keyed by workspace plus clone route. It persists controls only. Seeding from a focused Git diff forces a literal query. Opens go through `contentSearchOpen` and do not retarget the dock.
- `SearchBar` test ids come from `testIdPrefix`. Do not hardcode them. Narrow layout is a prop from `isNarrowSidebar` (under 320px, never mobile).

## Preview and language

- Editable text through 10 MiB UTF-8 inclusive. Larger text is truncated on a character boundary and read-only. Trusted and workspace-preview paths stay read-only.
- Reload keeps the buffer until new bytes land and confirms before replacing unsaved edits. A landed reload restores view state and marks the language document clean at disk text.
- `filePreviewIdentity.ts` is the per-file policy. `usePreviewModelAttachment` owns one `attachmentScope` per model. Add releases there. `FileOpenQueue` resolves directory spelling before publication. Ambiguous duplicates stay untouched.
- File, tree, search, and language calls use the clone-qualified route. Browser document URIs keep the owning server's workspace id. Local repos pass an explicit local route. Explorer storage uses that route as owner key. Local owners keep the bare workspace id.
- TypeScript and JavaScript models move to `coc-lsp-typescript` / `coc-lsp-javascript` while providers are attached, then return to the base language. Do not flip global `typescriptDefaults`. Register extra languages in `explorer/monaco-setup.ts`.
- One global `registerEditorOpener`. The pane accepts its workspace and live group members and refuses other workspaces before any read. External targets are pinned read-only `external` tabs keyed by capability and are not persisted. Peek prepares a model before returning because standalone Monaco cannot open a missing model. `automaticLayout` stays explicitly `false`. `MonacoFileEditor` calls `layout()` itself.
- Badge copy lives in `languageStatus.ts`. Restart replays the unsaved buffer.

## Tests

`node scripts/run-vitest.mjs` on the explorer, Quick Open, content-search, RepoTabStrip, and `test/spa/react/workspace-right-dock/` files. Source-mirror tests (`TreeNode.test.ts`, `QuickOpen.test.ts`, `ExplorerPanel.persist.test.ts`) must be updated with the source they mirror.
