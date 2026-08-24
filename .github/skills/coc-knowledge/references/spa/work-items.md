# Dashboard SPA — Work Items

## Origin scoping

Core Work Item paths — list, detail, create, update, pin, archive, delete,
hierarchy tree, plan history, parent re-linking, sync status, remote
import/convert, execution, Submit PR, AI review, Dreams next actions, and
comment-resolve — compute a canonical origin ID from the selected workspace remote
(`gh_*`, `ado_*`, `git_*`, or `local_*`) and call the origin-scoped coc-client
methods. They still pass `workspaceId` when the route needs a concrete clone for
provider, queue, or filesystem semantics.

PR list/detail, provider subresources (threads, reviewers, commits, checks,
combined and per-file diffs), and chat bindings use the same browser-safe origin
resolver, passing the selected `workspaceId`/`repoId` to choose the concrete clone.
Fresh-chat reset passes `workspaceId` so archive and process actions run against a
concrete clone.

`WorkItemContext` keys persistent lists, pagination, unseen IDs, and realtime
revisions by origin ID, so same-origin clones share list state and remote-shell
badges. `work-item-added`, `work-item-updated`, and `work-item-removed` WebSocket
events update both the raw event scope and the resolved origin scope for known
workspaces; origin-scoped events update the origin scope directly.
`WorkItemHierarchyTree` refetches through the origin-scoped realtime revision and
`client.workItems.treeForOrigin(...)`, passing `workspaceId` only for clone metadata
validation.

## Hierarchy tree

`WorkItemHierarchyTree` and `WorkItemHierarchyNode` render the tree. Local rows show
the work-item number beside the title and a status chip on leaves. Remote/Synced rows
keep the type avatar, title, remote mirror badge, and container rollups but omit local
numbers and leaf status chips, so remote identifiers stay the primary row metadata.
Compact GitHub mirror badges show the issue number only; detail-page badges keep the
provider label and link title. The toolbar's Refresh calls the same tree fetch and is
disabled while a request is in flight.

### Context menus

The hierarchy node and flat `WorkItemSection` right-click menus share a 📋 Copy
submenu (Copy ID / Copy title / Copy info) built by `buildCopyContextMenuItem`
(`workItemCopyMenu.ts`). Clipboard text comes from the pure `workItemInfo.ts`
formatters, which reuse `getWorkItemChatIdentifier`, `TYPE_LABELS`, and
`STATUS_LABEL` — do not add new prefix or label maps. Each action copies via
`copyToClipboard` and reports through the optional `ToastContext`.

Two `ContextMenu` constraints matter here:

- An item flagged `separator: true` renders as a divider **and its content is
  dropped**, so menus add dedicated separator entries to group the Copy item rather
  than flagging it.
- `clampSubmenuVertical` (exported alongside `clampMenuPosition`) clamps submenu
  panels to the viewport: it picks the larger of the space below or above the
  anchoring row and applies `maxHeight` + `overflowY: auto`, so long lists scroll
  instead of running off screen. Left/right flipping is separate.

## Tracker tabs

`WorkItemsTab` presents hierarchy mode as two top-level tracker tabs, **Local** and
**Remote**. The selected tab persists in `localStorage` under a `workspaceId`-scoped
key; valid saved values restore on mount and anything else falls back to Local. Work
item, session, and commit deep links keep the existing hash shape while the list pane
initializes from the saved tab.

**Local** passes `tracker=local-only` to the tree endpoint and shows local creation
actions for local-only Epic trees.

**Remote** calls `workItems.syncStatus(...)` with no provider override and treats the
workspace repo remote-derived `remoteProvider` as the authoritative visible provider,
requesting only the matching `tracker=github-backed` or `tracker=azure-boards-backed`
tree. With one supported provider detected, the tab shows that provider's icon only,
the chip header shows that provider only (no All chip), and title, subtitle, empty
copy, and the import dialog are provider-specific; unavailable/auth/setup warnings
apply only to the detected provider. A missing, unsupported, or unrecognized workspace
remote shows a setup message and hides provider chips and import affordances.

Remote import opens directly in the detected provider mode; afterwards the SPA
switches to Remote, persists it as the selected tab, selects and highlights the
imported root Epic, and aligns the provider filter with the imported provider. Import
is the user-facing Remote seeding action — subsequent remote-to-local refreshes are
owned by background provider polling, and remote-backed Epic roots expose no manual
pull action.

Provider status surfaces inline in the Remote view: Azure Boards missing setup says
import requires either an Azure DevOps repo remote or configured ADO org/project,
config-vs-remote mismatch text comes from the server, and Azure CLI auth failures keep
the `az login` guidance without exposing tokens. Adding children under GitHub- or
Azure-backed roots uses the normal create flow, which pushes the new child to the
backing provider before storing its mirror metadata. Tree rows and detail headers use
provider-specific mirror badges linking to the GitHub issue or Azure Boards work item
when the remote URL is available.

## Server-side cache

The list, grouped list, hierarchy tree, and remote sync-status routes are backed by a
server-side response cache that can be proactively warmed for the active workspace.
Background warming refreshes the default local list and grouped responses, the Local
tracker tree, the Remote sync status, and the detected Remote provider tree when
hierarchy and sync are enabled. A failed background refresh does not clear stale
cached responses; an explicit GET can pass `force=true` to bypass and replace.

## WorkItemDetail

`WorkItemDetail` is an always-editable inline form — title, description, priority,
tags, status, parent, success criteria, and plan content edit without an Edit-mode
toggle. Description and plan use per-field Source/Preview markdown controls.

The view tracks one unified dirty draft. Ctrl+S / Cmd+S and the Save button send a
**single** origin-scoped `workItems.updateForOrigin` PATCH carrying every dirty
metadata field plus `plan.content` when changed — status and plan have no separate
save path of their own.

A remote-backed save returning `WORK_ITEM_SYNC_CONFLICT` renders an inline warning
panel near the save area with per-field "Your draft" versus provider value cards, then
retries the same PATCH with `syncConflictResolution` once the user applies choices.

Dirty pages show an unsaved-changes indicator, install a `beforeunload` warning, guard
the local back breadcrumb, block dirty hash route changes when the user cancels, and
intercept hash links before navigation. Detail fetch and draft state are scoped to the
current `workspaceId` + `workItemId`: stale responses from prior selections are
ignored, and drafts initialize or save only when the loaded item matches the active
selection.

### Plan versions

Plan version tabs load history through origin-scoped `workItems.planVersionsForOrigin`
/ `getPlanVersionForOrigin`. Workflow-only **Compare to current** and **Restore as
latest** actions appear for historical versions. Compare opens a diff modal backed by
the origin immutable version compare API. Restore is disabled while the detail has
unsaved edits and calls the origin restore API, which **creates a new current version**
rather than overwriting the historical version or the current record in place.

### Ask AI

The header's compact **Ask AI** action opens `WorkItemChatPanel`, which restores the
workspace-scoped remembered chat binding for the selected item or starts a normal
`chat` task through the same `InitialChatComposer` capabilities as commit and PR chat.
The composer frame is titled for the item and shows its stable identifier plus saved
title. If the inline form is dirty, the chat uses the **saved** `item` state and shows
an unsaved-edits warning.

The initial prompt uses pointer-only `<attached_pointer_context>` metadata plus safe
labels, status, type, and number. Raw descriptions, plan content, provider payloads,
file contents, diffs, credentials, and local paths are never inlined.

With `features.commitChatLens` enabled, unpinned Work Item chat renders as a
bottom-right lens inside the detail pane on desktop, tablet, and mobile, with
close/minimize/restore/pin/unpin state localStorage-scoped by workspace and Work Item.
With the flag disabled, the detail pane uses the embedded fallback and closes it when
selection changes.

## Workflow gate

`workItems.workflow.enabled` is the disabled-by-default durable workflow gate that
turns local Work Items and Goals into the command-center planning/execution surface.
The SPA receives it as `workItemsWorkflowEnabled` from bootstrap config and
`GET /api/config/runtime`; gate UI on `isWorkItemsWorkflowEnabled()`.

Detail layout is the same either way: the editable title sits in the top header row,
with type, status, mirror, plan version, priority, updated time, parent, tags,
auto-execute, source, and primary actions in the compact properties row below it. The
scrollable body starts with description and plan content.

With the flag on:

- The local create dialog exposes a Work Item vs Goal type selector for title-first
  shell creation even when hierarchy mode is off. Bug and hierarchy-type creation
  paths are unaffected.
- Saved local-only Work Item and Goal details render as a command center around the
  editable current version, primary actions, review state, and execution timeline. The
  mobile layout keeps the same flow with full-width primary actions, wrapping Review
  buttons, lens-compatible chat, and a readable version/run timeline.
- For local-only `work-item` and `goal` items, `aiDone` presents as **Review** and Goal
  `drafting`/`planning` presents as **Grilling**. Execution history becomes a compact
  timeline showing the selected content version, execution mode, Ralph session ID, AI
  settings, selected skills, linked commits, PR linkage, errors, and the latest Review
  run summary.
- The execute dialog is workflow-aware for saved local-only items: a per-run One-shot
  vs Ralph mode selector, defaulting Work Items to One-shot and Goals to Ralph, sent
  through the typed Work Items client.
- Review exposes an **AI Review** action enqueuing a `code-review` chat as a
  non-mutating timeline entry, plus **Submit PR** only when the latest completed change
  has eligible commits and no recorded PR. Submit PR calls the explicit Work Items PR
  submission endpoint and records branch/PR metadata on success before the item moves
  to Done.

### Goals and grilling

With the workflow flag on, saved local-only `goal` details show **Start grilling** or
**Continue grilling** near the item actions — hidden for remote-backed and non-Goal
items, disabled while inline edits are dirty. It starts a Work-Item-bound Ralph
grilling chat in the lens (`grill-me` plus `context.ralph.phase='grilling'`) and
records the chat process as `grillSessionId`. When that chat completes with a final
`## Goal` block, the server saves it as the next AI-authored immutable Goal content
version and moves draft/planning Goals to Ready.

The Work Item system is the source of truth for this flow — it does not require a
Notes-backed `.goal.md` mirror.

### AI authoring

With both `workItems.workflow.enabled` and `workItems.aiAuthoring.enabled` on, saved
local-only `work-item` details show **Draft with AI** (no plan content) or **Revise
with AI** (existing plan). The action is hidden for remote-backed items and
non-`work-item` types and disabled while the inline draft is dirty. It opens
`WorkItemAiDraftApplyDialog` and auto-starts `workItems.applyAiDraftForOrigin(...)`
with `workspaceId`, the loaded `updatedAt`, and the current content-version guard. The
dialog surfaces generating, clarification, retry, failure, and cancel states; a
successful apply refreshes the detail and updates the Work Items context with the
returned immutable AI-authored version.

### Multi-agent grilling flag

`features.ralphMultiAgentGrill` is a disabled-by-default runtime flag surfaced as
`ralphMultiAgentGrillEnabled` from bootstrap config and `GET /api/config/runtime`; gate
UI on `isRalphMultiAgentGrillEnabled()`. It enables only the multi-agent Ralph grilling
setup surfaces and prompt contract. Notes direct goal launch stays separate because it
skips grilling.
