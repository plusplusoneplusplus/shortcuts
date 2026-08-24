# Dashboard SPA — Work Items

## Origin scoping

Every core Work Item path — CRUD, pin/archive, hierarchy tree, plan history, parent
re-linking, sync status, remote import/convert, execution, Submit PR, AI review, Dreams
next actions, comment-resolve — computes a canonical origin ID from the selected
workspace remote (`gh_*`, `ado_*`, `git_*`, `local_*`) and calls the origin-scoped
coc-client methods, still passing `workspaceId` where the route needs a concrete clone
for provider, queue, or filesystem semantics. PR list/detail, provider subresources,
chat bindings, and fresh-chat reset use the same browser-safe origin resolver with the
selected `workspaceId`/`repoId` choosing the clone. Route contracts, response caching,
and warming: [../rest-api.md](../rest-api.md).

`WorkItemContext` keys persistent lists, pagination, unseen IDs, and realtime revisions
by origin ID, so same-origin clones share list state and remote-shell badges.
`work-item-added`/`-updated`/`-removed` WebSocket events update both the raw event scope
and the resolved origin scope for known workspaces; origin-scoped events update the
origin scope directly. `WorkItemHierarchyTree` refetches through the origin-scoped
realtime revision and `client.workItems.treeForOrigin(...)`, passing `workspaceId` only
for clone metadata validation.

## Hierarchy tree

`WorkItemHierarchyTree` / `WorkItemHierarchyNode` render the tree. Local rows show the
work-item number and a leaf status chip; Remote/Synced rows omit both so remote
identifiers stay the primary row metadata, keeping the type avatar, title, mirror badge,
and container rollups.

### Context menus

The hierarchy-node and flat `WorkItemSection` right-click menus share a Copy submenu
built by `buildCopyContextMenuItem` (`workItemCopyMenu.ts`); clipboard text comes from
the pure `workItemInfo.ts` formatters, which reuse `getWorkItemChatIdentifier`,
`TYPE_LABELS`, and `STATUS_LABEL` — do not add new prefix or label maps.

Two `ContextMenu` constraints matter: an item flagged `separator: true` renders as a
divider **and its content is dropped**, so menus add dedicated separator entries rather
than flagging the Copy item; and `clampSubmenuVertical` (exported alongside
`clampMenuPosition`) clamps submenu panels to the viewport using the larger of the space
below or above the anchoring row plus `maxHeight` + `overflowY: auto`. Left/right
flipping is separate.

## Tracker tabs

`WorkItemsTab` presents hierarchy mode as two tracker tabs, **Local** and **Remote**.
The selection persists in `localStorage` under a `workspaceId`-scoped key; invalid saved
values fall back to Local. Work item, session, and commit deep links keep the existing
hash shape while the list pane initializes from the saved tab.

**Local** passes `tracker=local-only` to the tree endpoint and shows local creation
actions for local-only Epic trees.

**Remote** calls `workItems.syncStatus(...)` with no provider override and treats the
repo remote-derived `remoteProvider` as the authoritative visible provider, requesting
only the matching `tracker=github-backed` or `tracker=azure-boards-backed` tree. Every
provider-facing surface is then specific to that one provider; a missing, unsupported,
or unrecognized remote instead shows a setup message and hides provider chips and import
affordances. Provider-status copy comes from the server, and Azure CLI auth failures keep
the `az login` guidance without exposing tokens.

Remote import opens in the detected provider mode; afterwards the SPA switches to
Remote, persists that tab, selects the imported root Epic, and aligns the provider
filter. Import is the only user-facing Remote seeding action — subsequent
remote-to-local refreshes are owned by background provider polling, and remote-backed
Epic roots expose no manual pull. Adding children under provider-backed roots uses the
normal create flow, which pushes the child to the provider before storing its mirror
metadata.

## WorkItemDetail

`WorkItemDetail` is an always-editable inline form — title, description, priority, tags,
status, parent, success criteria, and plan content edit with no Edit-mode toggle, with
per-field Source/Preview markdown controls on description and plan. Layout is the same
regardless of the workflow flag: editable title in the top header row; type, status,
mirror, plan version, priority, updated time, parent, tags, auto-execute, source, and
primary actions in the properties row; description and plan content start the scrollable
body.

The view tracks one unified dirty draft. Ctrl/Cmd+S and Save send a **single**
origin-scoped `workItems.updateForOrigin` PATCH carrying every dirty metadata field plus
`plan.content` when changed — status and plan have no separate save path. A
remote-backed save returning `WORK_ITEM_SYNC_CONFLICT` renders an inline panel with
per-field "Your draft" versus provider value cards, then retries the same PATCH with
`syncConflictResolution` once the user applies choices.

A dirty page installs a `beforeunload` warning and blocks the back breadcrumb, hash
route changes, and intercepted hash links when the user cancels. Detail fetch and draft
state are scoped to the current `workspaceId` + `workItemId`: stale responses from prior
selections are ignored, and drafts initialize or save only when the loaded item matches
the active selection.

### Plan versions

Plan version tabs load history through origin-scoped `workItems.planVersionsForOrigin` /
`getPlanVersionForOrigin`. Workflow-only **Compare to current** and **Restore as latest**
appear for historical versions. Compare opens a diff modal backed by the origin
immutable version compare API. Restore is disabled while the detail has unsaved edits
and calls the origin restore API, which **creates a new current version** rather than
overwriting the historical version or the current record in place.

### Ask AI

The header's **Ask AI** action opens `WorkItemChatPanel`, restoring the workspace-scoped
remembered chat binding for the item or starting a normal `chat` task through the same
`InitialChatComposer` capabilities as commit and PR chat. A dirty inline form does not
leak into it: the chat uses the **saved** `item` state and warns about unsaved edits. The
initial prompt carries pointer-only `<attached_pointer_context>` metadata plus safe
labels, status, type, and number — never raw descriptions, plan content, provider
payloads, file contents, diffs, credentials, or local paths.

Work Item chat is one of the review-chat lens targets — see [chat.md](chat.md) for lens
presentation and persisted state. With `features.commitChatLens` off the detail pane uses
the embedded fallback and closes it when selection changes.

## Workflow gate

`workItems.workflow.enabled` is the disabled-by-default durable workflow gate turning
local Work Items and Goals into the planning/execution command center. The SPA receives
it as `workItemsWorkflowEnabled` from bootstrap config and `GET /api/config/runtime`;
gate UI on `isWorkItemsWorkflowEnabled()`. With it on:

- The local create dialog exposes a Work Item vs Goal type selector for title-first
  shell creation even when hierarchy mode is off; Bug and hierarchy-type creation are
  unaffected.
- Saved local-only Work Item and Goal details render as a command center around the
  editable current version, primary actions, review state, and an execution timeline of
  content version, execution mode, Ralph session ID, AI settings, selected skills, linked
  commits, PR linkage, errors, and the latest Review run summary. `aiDone` presents as
  **Review**, Goal `drafting`/`planning` as **Grilling**.
- The execute dialog gains a per-run One-shot vs Ralph selector for saved local-only
  items, defaulting Work Items to One-shot and Goals to Ralph.
- Review exposes **AI Review** (a `code-review` chat recorded as a non-mutating timeline
  entry) plus **Submit PR**, offered only when the latest completed change has eligible
  commits and no recorded PR; success records branch/PR metadata before Done.

### Goals and grilling

Saved local-only `goal` details show **Start grilling** / **Continue grilling** — hidden
for remote-backed and non-Goal items, disabled while inline edits are dirty. It starts a
Work-Item-bound Ralph grilling chat in the lens (`grill-me` plus
`context.ralph.phase='grilling'`) and records the chat process as `grillSessionId`. When
that chat completes with a final `## Goal` block, the server saves it as the next
AI-authored immutable Goal content version and moves draft/planning Goals to Ready. The
Work Item system is the source of truth here; no Notes-backed `.goal.md` mirror is
required.

### AI authoring

With both `workItems.workflow.enabled` and `workItems.aiAuthoring.enabled` on, saved
local-only `work-item` details show **Draft with AI** (no plan content) or **Revise with
AI** (existing plan), hidden for remote-backed items and non-`work-item` types and
disabled while the inline draft is dirty. It opens `WorkItemAiDraftApplyDialog` and
auto-starts `workItems.applyAiDraftForOrigin(...)` with `workspaceId`, the loaded
`updatedAt`, and the current content-version guard. The dialog surfaces generating,
clarification, retry, failure, and cancel states; a successful apply refreshes the
detail and updates the Work Items context with the returned immutable version.

### Multi-agent grilling flag

`features.ralphMultiAgentGrill` (disabled by default) reaches the SPA as
`ralphMultiAgentGrillEnabled` from bootstrap config and `GET /api/config/runtime`; gate
UI on `isRalphMultiAgentGrillEnabled()`. It enables only the multi-agent Ralph grilling
setup surfaces and prompt contract. Notes direct goal launch stays separate because it
skips grilling.
