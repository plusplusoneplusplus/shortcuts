# Dashboard SPA — Work Items

## Work Items UI

The hierarchy tree uses `WorkItemHierarchyTree` and `WorkItemHierarchyNode`.
Local trees show the work-item number beside the title and a status chip for
leaf rows. Remote/Synced trees keep the type avatar, title, remote mirror badge,
and container rollups, but omit local work-item numbers and leaf status chips so
remote identifiers remain the primary row metadata. Compact GitHub mirror badges
render the issue number only; full detail-page badges keep the provider label and
link title. Core Work Item list/detail/create/update/pin/archive/delete, hierarchy-tree, plan
history, parent re-linking, sync status, remote import/convert, execution, Submit PR, AI review, Dreams work-item next actions, and comment-resolve UI paths compute a
canonical origin ID from the selected workspace remote (`gh_*`, `ado_*`,
`git_*`, or `local_*`) and call the origin-scoped coc-client methods while still
passing `workspaceId` when the route needs a concrete clone for provider,
queue, or filesystem semantics. PR list/detail, provider
subresources (threads, reviewers, commits, checks, combined/per-file diffs), and
chat bindings use the same browser-safe origin resolver and call origin-scoped
APIs while passing the selected `workspaceId`/`repoId` to choose the concrete
clone; fresh-chat reset still passes the selected `workspaceId` so
archiving/process actions run against a concrete clone. `WorkItemContext` keys persistent Work Item lists, pagination, unseen IDs,
and realtime revisions by that origin ID so same-origin clones share the same
list state and remote-shell Work Items badges.
`work-item-added`, `work-item-updated`, and `work-item-removed` WebSocket events
update the raw event scope and the resolved origin scope for known workspaces;
origin-scoped events update the origin scope directly. `WorkItemHierarchyTree`
uses the origin-scoped realtime revision and `client.workItems.treeForOrigin(...)`
to refetch tree data, passing the selected `workspaceId` only for clone metadata
validation. Work Item chat bindings use origin-scoped client methods and pass
the selected `workspaceId` only for fresh-chat archive/reset actions.
The hierarchy toolbar exposes a Refresh control that calls the same tree fetch
path and is disabled while the tree request is in flight.
Both the hierarchy node and flat `WorkItemSection` right-click context menus share
a 📋 Copy submenu (Copy ID / Copy title / Copy info) built by
`buildCopyContextMenuItem` (`workItemCopyMenu.ts`); the clipboard text comes from
the pure `workItemInfo.ts` formatters, which reuse `getWorkItemChatIdentifier`,
`TYPE_LABELS`, and `STATUS_LABEL` (no new prefix/label maps). Each action copies
via `copyToClipboard` and reports through the optional `ToastContext` (success /
error toast). Note: `ContextMenu` renders an item flagged `separator: true` as a
divider only and drops its content, so menus add dedicated separator entries to
group the Copy item rather than flagging it. Submenu panels are clamped to the
viewport by `clampSubmenuVertical` (exported alongside `clampMenuPosition`): it
picks the larger of the space below/above the anchoring row and applies
`maxHeight` + `overflowY: auto`, so long lists scroll instead of running off
screen. Left/right flipping is separate and unchanged. Submenu panels are clamped to the
viewport by `clampSubmenuVertical` (exported alongside `clampMenuPosition`): it
picks the larger of the space below/above the anchoring row and applies
`maxHeight` + `overflowY: auto`, so long lists scroll instead of running off
screen. Left/right flipping is separate and unchanged.

`workItems.workflow.enabled` is the disabled-by-default durable workflow gate for
turning local Work Items and Goals into the command-center planning/execution
surface. The SPA receives it as `workItemsWorkflowEnabled` from bootstrap config
and `GET /api/config/runtime`; use `isWorkItemsWorkflowEnabled()` for UI gates so
legacy Work Items and Chat behavior remains unchanged while the flag is off.
Work Item detail renders the editable title in the top header row and keeps
type, status, mirror, plan version, priority, updated time, parent, tags,
auto-execute, source, and primary actions in the compact properties row directly
below it; the scrollable body starts with description/plan content rather than a
separate metadata card.
When the flag is on, the local create dialog exposes a Work Item vs Goal type
selector for title-first shell creation even when hierarchy mode is off; existing
bug and hierarchy-type creation paths keep their prior behavior. Saved local-only
Work Item and Goal details render as a command center around the editable current
version, primary actions, review state, and execution timeline. The mobile detail
layout keeps the same Work Item-centered flow with full-width touch-friendly
primary actions, wrapping Review buttons, lens-compatible chat behavior, and a
readable version/run timeline on narrow screens. Saved local-only Goal details
expose a Start/Continue grilling action that opens the existing Work Item chat
lens with Ralph grilling context (`grill-me` plus
`context.ralph.phase='grilling'`) and records the chat process on
`grillSessionId`. This Goal workflow keeps the Work Item system as the source of
truth and does not require a Notes-backed `.goal.md` mirror. The Work Item
execute dialog is also workflow-aware for saved local-only Work Items and Goals:
it exposes a per-run One-shot vs Ralph mode selector, defaults Work Items to
One-shot, defaults Goals to Ralph, and sends the selected execution mode through
the typed Work Items client. In Review, local-only Work Items/Goals expose an
explicit AI Review action that enqueues a `code-review` chat as a non-mutating
timeline entry, plus a Submit PR action only when the implementation change has
eligible commits and no recorded PR.

`features.ralphMultiAgentGrill` is a disabled-by-default runtime feature flag
surfaced to the SPA as `ralphMultiAgentGrillEnabled` from bootstrap config and
`GET /api/config/runtime`; use `isRalphMultiAgentGrillEnabled()` for UI gates.
The flag only enables the multi-agent Ralph grilling setup surfaces and prompt
contract. Notes direct goal launch remains separate because it skips grilling.

## Work Items

`WorkItemsTab` presents hierarchy mode as two top-level tracker tabs: **Local** and **Remote**. The selected tracker tab is stored in `localStorage` with a key scoped by `workspaceId`; valid saved values restore on mount, invalid or missing values fall back to Local, and work item/session/commit deep links keep using the existing hash shape while the list pane initializes from the saved tracker tab. The Local tab passes `tracker=local-only` to the tree endpoint and shows local creation actions for local-only Epic trees. The Remote tab calls `workItems.syncStatus(...)` without a provider override, uses the workspace repo remote-derived `remoteProvider` as the authoritative visible provider, and only requests the matching `tracker=github-backed` or `tracker=azure-boards-backed` tree. When one supported provider is detected, the Remote tab shows only that provider's icon, the provider chip header shows only that provider (no All chip), the title/subtitle/empty copy and import dialog are provider-specific, and unavailable/auth/setup warnings apply only to the detected provider. Available providers do not render a success/ready banner. Missing, unsupported, or unrecognized workspace remotes show a concise setup message and hide provider chips and import affordances. The Remote import action opens directly in the detected provider mode, then the SPA switches to Remote, persists Remote as the selected tracker tab, selects/highlights the imported root Epic row/card, and keeps the provider filter aligned with the imported provider.

The Work Items list, grouped list, hierarchy tree, and remote sync-status routes are backed by a server-side response cache that can be proactively warmed for the currently active workspace. Background warming refreshes the default local list/grouped responses, the Local tracker tree, the Remote sync status, and the detected Remote provider tree when hierarchy and sync are enabled. Failed background refreshes do not clear stale cached responses, and explicit GETs can pass `force=true` to bypass and replace the cached response.

`WorkItemDetail` is an always-editable inline form: title, description, priority, tags, status, parent, success criteria, and plan content remain editable without an Edit-mode toggle. Description and plan use per-field Source/Preview markdown controls. The view tracks a unified dirty draft; Ctrl+S/Cmd+S and the Save button send one origin-scoped `workItems.updateForOrigin` PATCH containing every dirty metadata field plus `plan.content` when changed. There is no instant status save and no standalone plan save from the detail screen. If a remote-backed save returns `WORK_ITEM_SYNC_CONFLICT`, the detail view renders an inline warning panel near the save/error area with per-field "Your draft" versus provider value cards and retries the same PATCH path with `syncConflictResolution` after the user applies choices. Dirty work-item detail pages show an unsaved-changes indicator, install a `beforeunload` warning, guard the local back breadcrumb, block dirty hash route changes when the user cancels, and intercept hash links before navigation. When `workItems.workflow.enabled` is on and the selected item is a local-only `work-item` or `goal`, legacy `aiDone` is presented as the user-facing **Review** state, Goal `drafting`/`planning` is presented as **Grilling**, and the execution history becomes a compact command-center timeline that shows the selected content version, execution mode, Ralph session ID, AI settings, selected skills, linked commits, PR linkage, errors, and the latest Review run summary. The Review section shows **Submit PR** only when the latest completed change has commits and no recorded PR; clicking it calls the explicit Work Items PR submission endpoint, and successful submission records branch/PR metadata before the item moves to Done. The plan version tabs load history through origin-scoped `workItems.planVersionsForOrigin`/`getPlanVersionForOrigin` calls and expose workflow-only **Compare to current** and **Restore as latest** actions for historical versions. Compare opens a diff modal backed by the origin immutable version compare API. Restore is disabled while the detail has unsaved edits and calls the origin restore API, which creates a new current version rather than overwriting the historical version or the current record in place.
Detail fetch and draft state are scoped to the current `workspaceId` + `workItemId`; stale responses from prior selections are ignored, and drafts initialize or save only when the loaded detail item matches the active selection.

With both `workItems.workflow.enabled` and `workItems.aiAuthoring.enabled` on,
saved local-only `work-item` details show **Draft with AI** for items without
plan content and **Revise with AI** for items with an existing plan. The action is
hidden for remote-backed items and non-`work-item` types, disabled while the
inline draft is dirty, opens `WorkItemAiDraftApplyDialog`, and auto-starts the
typed `workItems.applyAiDraftForOrigin(...)` call with `workspaceId`, the loaded
`updatedAt`, and current content-version guard. The dialog surfaces generating, clarification, retry,
failure, and cancel states; successful apply refreshes the detail and updates the
Work Items context with the returned immutable AI-authored version.

`WorkItemDetail` has a compact **Ask AI** action in the header. It opens `WorkItemChatPanel`, which restores the workspace-scoped remembered chat binding for the selected Work Item or starts a normal `chat` task through the same `InitialChatComposer` capabilities used by commit/PR chat. The composer frame is titled for the selected Work Item and displays the stable Work Item identifier plus saved title. If the inline form is dirty, the chat still uses the saved `item` state and shows an unsaved-edits warning until the Work Item is saved. The initial Work Item chat prompt uses pointer-only `<attached_pointer_context>` metadata plus safe Work Item labels/status/type/number; raw descriptions, plan content, provider payloads, file contents, diffs, credentials, and local paths are not inlined. With `features.commitChatLens` enabled, unpinned Work Item chat renders as a bottom-right lens inside the detail pane on desktop, tablet, and mobile; close/minimize/restore/pin/unpin state is localStorage-scoped by workspace and Work Item. With the flag disabled, the detail pane uses the non-lens embedded fallback and closes that fallback when selection changes.

With `workItems.workflow.enabled` on, saved local-only `goal` details show **Start grilling** or **Continue grilling** near the item actions. The action is hidden for remote-backed and non-Goal items, disabled while inline edits are dirty, starts a Work-Item-bound Ralph grilling chat in the lens, and records the chat process as `grillSessionId`. When the bound chat completes with a final `## Goal` block, the server saves that block as the next AI-authored immutable Goal content version and moves draft/planning Goals to Ready.

The split Local/Remote tracker views do not show the legacy per-item preview/import/export/sync toolbar, and remote-backed Epic roots do not expose manual provider pull actions. Initial import remains the user-facing Remote tracker seeding action; subsequent remote-to-local refreshes are owned by background provider polling. The Remote view surfaces provider status inline: Azure Boards missing setup says import requires either an Azure DevOps repo remote or configured ADO org/project, config-vs-remote mismatch text comes from the server, and Azure CLI auth failures keep the `az login` guidance without exposing tokens. Adding children under GitHub- or Azure-backed roots still uses the normal create flow, which pushes the new child to the backing provider before storing its mirror metadata. Tree rows and detail headers use provider-specific mirror badges that link to the GitHub issue or Azure Boards work item when the remote URL is available.
