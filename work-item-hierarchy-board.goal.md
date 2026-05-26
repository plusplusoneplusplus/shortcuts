---
feature: work-item-hierarchy-board
status: ready-for-ralph
---

# Work Item Hierarchy Board MVP

## Goal

Extend the existing CoC Work Items tab into a feature-gated, Azure DevOps-like hierarchy board for one workspace at a time: Epic -> Feature -> PBI / Story -> WorkItem or Bug.

The MVP must reuse the existing repo-scoped work item store, REST routes, coc-client domain, WebSocket refresh flow, and Work Items tab where practical. Existing WorkItem/Bug creation, listing, planning, execution, review, pinning, archive, delete, search, and deep-link behavior must remain unchanged when `workItems.hierarchy.enabled` is false.

## Functional Acceptance Criteria

1. [decision] AC-01: Add a disabled-by-default `workItems.hierarchy.enabled` config flag that controls hierarchy-only UI/API behavior without hiding the current Work Items tab.
2. [decision] AC-02: Extend the existing work item data model to support `epic`, `feature`, `pbi`, `work-item`, and `bug` types plus parent linkage in the same repo-scoped file store.
3. [decision] AC-03: Add hierarchy-aware server and coc-client APIs, including a tree endpoint with descendant roll-up counts, while keeping existing list/grouped endpoints compatible.
4. [decision] AC-04: Replace the enabled Work Items left pane with a collapsible hierarchy tree that supports top-level Epic creation, constrained child creation, parent picking, unlinking, and clear validation errors.
5. [decision] AC-05: Keep AI planning/execution/review flows leaf-only for `work-item` and `bug`; container nodes show metadata, children, and roll-up state only.
6. [decision] AC-06: Preserve existing Work Items behavior and tests when the hierarchy flag is disabled, and add targeted unit/client/SPA coverage for hierarchy mode.

## Out of Scope

- [decision] Drag-and-drop reparenting.
- [decision] Full Kanban board columns/swimlanes.
- [decision] Automatic parent status changes from child progress.
- [decision] Custom hierarchy levels or custom work item types.
- [decision] Azure DevOps service integration, import, sync, or remote IDs.
- [decision] Sprint/iteration planning, backlog ranking, area paths, assignments, permissions, or estimates.
- [decision] Cross-repo parent/child relationships.
- [decision] Changes under `packages\vscode-extension\`.

## Constraints

- [decision] Multi-repo support is required. Hierarchies are scoped to exactly one workspace/repo, and parent/child links must never cross workspace IDs.
- [decision] All per-repo hierarchy data must remain under `getRepoDataPath(dataDir, workspaceId, 'work-items')`; do not add top-level per-repo directories under `~/.coc`.
- [decision] Existing records with missing `type` are treated as `work-item`; existing records without `parentId` remain unparented leaf items.
- [decision] Feature flag default is false.
- [decision] When the flag is false, existing WorkItem/Bug behavior stays unchanged; hierarchy-only types, hierarchy parent fields, and tree UI/API are hidden or rejected.
- [decision] Use the existing `@plusplusoneplusplus/coc-client` work-items domain for typed SPA transport.
- [decision] Do not add SDK session caching or any `sendFollowUp`-style API.
- [decision] Prefer existing route/store/component conventions; keep changes surgical.

## References to Load

- `.github\skills\coc-knowledge\references\server-architecture.md`
- `.github\skills\coc-knowledge\references\rest-api.md`
- `.github\skills\coc-knowledge\references\dashboard-spa.md`
- `.github\skills\coc-knowledge\references\admin-config.md`
- `packages\coc\AGENTS.md`
- `packages\coc\src\server\work-items\types.ts`
- `packages\coc\src\server\work-items\work-item-store.ts`
- `packages\coc\src\server\routes\work-item-routes.ts`
- `packages\coc\src\server\routes\work-item-plan-routes.ts`
- `packages\coc\src\server\routes\work-item-execution-routes.ts`
- `packages\coc\src\server\routes\work-item-changes-routes.ts`
- `packages\coc-client\src\contracts\work-items.ts`
- `packages\coc-client\src\domains\work-items.ts`
- `packages\coc\src\server\spa\client\react\features\work-items\WorkItemsTab.tsx`
- `packages\coc\src\server\spa\client\react\features\work-items\WorkItemSection.tsx`
- `packages\coc\src\server\spa\client\react\features\work-items\WorkItemDetail.tsx`
- `packages\coc\src\server\spa\client\react\features\work-items\CreateWorkItemDialog.tsx`
- `packages\coc\src\server\spa\client\react\contexts\WorkItemContext.tsx`
- `packages\coc\src\config.ts`
- `packages\coc\src\config\schema.ts`
- `packages\coc\src\config\namespace-registry.ts`
- `packages\coc\src\server\admin\admin-config-fields.ts`
- `packages\coc-client\src\contracts\admin.ts`

## Dependency Graph

- AC-02 depends on AC-01.
- AC-03 depends on AC-01 and AC-02.
- AC-04 depends on AC-01, AC-02, and AC-03.
- AC-05 depends on AC-02 and AC-04.
- AC-06 depends on AC-01 through AC-05.

## Slice Specs

### AC-01: Feature flag and runtime config

#### Behavior

1. [decision] Add `workItems.hierarchy.enabled` to CLI config, resolved config, default config, schema validation, namespace source tracking, admin config field registry, coc-client admin contracts, and runtime dashboard config.
2. [decision] Default value is false.
3. [decision] The current Work Items tab remains visible and works exactly as it does today when the flag is false.
4. [decision] When false, the SPA must not show hierarchy tree controls or hierarchy creation choices.
5. [decision] When false, the server must reject hierarchy-only writes: creating `epic`, `feature`, or `pbi`, or setting `parentId`.
6. [assumption] The tree endpoint may be registered always, but should return a clear disabled response when the flag is false.
7. [assumption] Mark the admin field runtime as live if the implementation can read `runtimeConfigService.config`; otherwise mark it reloadable and document reload behavior in tests.

#### Surfaces

- [decision] `packages\coc\src\config.ts`
- [decision] `packages\coc\src\config\schema.ts`
- [decision] `packages\coc\src\config\namespace-registry.ts`
- [decision] `packages\coc\src\server\admin\admin-config-fields.ts`
- [decision] `packages\coc\src\server\config\runtime-config-handler.ts`
- [decision] `packages\coc-client\src\contracts\admin.ts`
- [assumption] `packages\coc\src\server\spa\client\react\admin\AdminPanel.tsx`

#### API Contract

Admin config accepts:

```json
{
  "workItems.hierarchy.enabled": true
}
```

Runtime dashboard config adds:

```json
{
  "features": {
    "workItemsHierarchyEnabled": true
  }
}
```

#### Data Model

No new persistent work item hierarchy data is added by this slice beyond config in the existing CoC config file.

#### UX States

- Disabled: current Work Items UI only.
- Enabled: hierarchy board UI becomes available inside the existing Work Items tab.
- Admin dirty/saving/error states follow existing AdminPanel feature-toggle patterns.

#### Edge Cases and Failure Modes

- Invalid non-boolean config values are rejected by schema/admin validation.
- Runtime config refresh should not require stale HTML-only dashboard config.
- Existing routes for normal WorkItem/Bug must not be blocked by this flag.

#### Definition of Done

1. Manual demo: open Admin settings, enable the hierarchy flag, reload or refresh runtime config as required, navigate to a repo's Work Items tab, and see the hierarchy board entry point; disable it and confirm the current list/detail Work Items UI returns.
2. Test commands must include `npm --workspace @plusplusoneplusplus/coc run test:run -- test/server` for relevant config/admin tests and `npm --workspace @plusplusoneplusplus/coc-client run test:run -- test/domains test/client-integration.test.ts`.
3. Code-search assertions: `workItems.hierarchy.enabled` appears in config defaults, schema, namespace registry, admin field registry, coc-client admin contracts, and runtime dashboard config; feature flag default remains false.

### AC-02: Hierarchy data model and validation

#### Behavior

1. [decision] Extend `WorkItemType` to `epic | feature | pbi | work-item | bug`.
2. [decision] Add `parentId?: string` to full work items and index entries.
3. [decision] Treat missing `type` as `work-item` for all existing data.
4. [decision] Allowed parent-child pairs are strict:
   - Epic: no parent.
   - Feature: Epic parent or no parent.
   - PBI: Feature parent or no parent.
   - WorkItem: PBI parent or no parent.
   - Bug: PBI parent or no parent.
5. [decision] Skipped levels are invalid, except that any item may be temporarily unparented.
6. [decision] Parent and child must have the same `repoId`.
7. [decision] Self-parenting and cycles are invalid.
8. [decision] Deleting a parent with children is blocked with a clear conflict error; users must move/unlink/delete children first.
9. [assumption] Keep the existing repo-wide `workItemNumber` counter and use type-specific display labels in the SPA rather than adding separate counters per type.
10. [assumption] Do not add a persisted sort/order field in MVP; tree siblings sort by pinned first, then latest run/update time, matching current list behavior as closely as possible.

#### Surfaces

- [decision] `packages\coc\src\server\work-items\types.ts`
- [decision] `packages\coc\src\server\work-items\work-item-store.ts`
- [decision] `packages\coc-client\src\contracts\work-items.ts`
- [assumption] Add small reusable validation helpers near existing work item type helpers instead of duplicating validation across routes.

#### API Contract

Create/update payloads may include:

```json
{
  "type": "pbi",
  "parentId": "feature-123"
}
```

Validation failures return non-2xx JSON errors with clear messages for disabled hierarchy, invalid type, invalid parent type, cross-repo parent, self-parent, cycle, or parent deletion with children.

#### Data Model

Persistent files stay in:

```text
<dataDir>/repos/<workspaceId>/work-items/
  index.json
  <workItemId>.json
  plans/<workItemId>/vN.md
```

Full item/index entry additions:

```json
{
  "type": "epic",
  "parentId": "optional-parent-id"
}
```

#### UX States

No direct UX in this slice, but invalid hierarchy writes must surface as readable form errors in AC-04.

#### Edge Cases and Failure Modes

- Existing work items with no type must list as `work-item`.
- Existing bugs remain bugs if they have `type: "bug"`.
- Reparenting must be atomic with index updates.
- Parent deletion must check index entries without relying on client state.
- Corrupt or missing parent references should not crash listing; [assumption] show such items as unparented with a validation warning only where practical.

#### Definition of Done

1. Manual demo: create an Epic, Feature, PBI, WorkItem, and Bug via API with valid parent links; verify files are stored under the same workspace work-items directory and list as one repo-scoped collection.
2. Test commands must include `npm --workspace @plusplusoneplusplus/coc run test:run -- test/server/work-items`.
3. Code-search assertions: no new top-level per-repo data directory is introduced; `getRepoDataPath(..., workspaceId, 'work-items')` remains the storage base; no `packages\vscode-extension\` files are touched.

### AC-03: Hierarchy REST and coc-client API

#### Behavior

1. [decision] Keep existing list/grouped/get/create/patch/delete routes compatible for current WorkItem/Bug behavior.
2. [decision] Add a hierarchy tree read API instead of forcing the SPA to reconstruct the full tree from paginated grouped status responses.
3. [decision] Extend create and patch handling to accept `type` and `parentId` when the hierarchy flag is enabled.
4. [decision] Existing `type=work-item` filtering includes items with missing type.
5. [decision] Tree results include unparented items at their natural level and descendant roll-up counts by type and status.
6. [decision] Tree roll-ups count all descendants, not only immediate children.
7. [decision] Parent picker can use existing list search/type filtering or a small helper API if needed; do not load all process data or unrelated repositories.
8. [assumption] Add `WorkItemsClient.tree(workspaceId, filter?)` and extend existing request/response contract types.

#### Surfaces

- [decision] `packages\coc\src\server\routes\work-item-routes.ts`
- [assumption] Add `packages\coc\src\server\routes\work-item-hierarchy-routes.ts` only if it keeps route code cleaner.
- [decision] `packages\coc\src\server\routes\index.ts`
- [decision] `packages\coc-client\src\contracts\work-items.ts`
- [decision] `packages\coc-client\src\domains\work-items.ts`
- [decision] `packages\coc-client\test\domains\work-items.test.ts`
- [decision] `packages\coc-client\test\domains\work-items.mock.test.ts`

#### API Contract

Recommended tree endpoint:

```text
GET /api/workspaces/:id/work-items/tree?q=&type=&status=&includeArchived=false
```

Recommended response:

```json
{
  "roots": [
    {
      "item": {
        "id": "epic-1",
        "repoId": "repo-a",
        "type": "epic",
        "title": "Example epic",
        "status": "created",
        "parentId": null
      },
      "children": [],
      "rollup": {
        "descendantCount": 0,
        "byType": {
          "epic": 0,
          "feature": 0,
          "pbi": 0,
          "work-item": 0,
          "bug": 0
        },
        "byStatus": {
          "created": 0,
          "planning": 0,
          "readyToExecute": 0,
          "executing": 0,
          "aiDone": 0,
          "aiFailed": 0,
          "done": 0,
          "failed": 0
        }
      }
    }
  ],
  "total": 1
}
```

Existing create route accepts hierarchy fields when enabled:

```text
POST /api/workspaces/:id/work-items
```

Existing patch route accepts parent changes when enabled:

```text
PATCH /api/workspaces/:id/work-items/:itemId
```

#### Data Model

No separate tree file is required. The tree is derived from the existing per-workspace `index.json` plus full item reads only when required for detail.

#### UX States

- Loading: tree fetch in progress.
- Empty: no work items in hierarchy mode, with a primary Create Epic action and secondary Create unparented WorkItem/Bug actions.
- Error: readable API error with retry.
- Disabled: endpoint returns disabled response and SPA hides hierarchy UI.

#### Edge Cases and Failure Modes

- Tree endpoint handles archived items consistently with current archive toggle behavior.
- Tree endpoint must not include another workspace's items.
- Invalid parent links from older/corrupt data must not create infinite recursion.
- Search should match current search fields: title, description, tags.
- Parent picker should not offer descendants as valid parents.

#### Definition of Done

1. Manual demo: enable the flag, create a valid hierarchy via REST/client, fetch `/work-items/tree`, and confirm nested children plus descendant roll-up counts are correct.
2. Test commands must include `npm --workspace @plusplusoneplusplus/coc run test:run -- test/server/work-items test/server/work-items/work-item-routes.test.ts` and `npm --workspace @plusplusoneplusplus/coc-client run test:run -- test/domains/work-items.test.ts test/domains/work-items.mock.test.ts`.
3. Code-search assertions: existing `WorkItemsClient.list`, `grouped`, `get`, `create`, `update`, `delete`, `pin`, `archive`, `execute`, and plan methods remain present; existing route paths remain unchanged.

### AC-04: Hierarchy board UI inside Work Items tab

#### Behavior

1. [decision] When `workItemsHierarchyEnabled` is false, `WorkItemsTab` renders the existing `WorkItemSection` list/detail UI.
2. [decision] When enabled, the left pane renders a collapsible hierarchy tree.
3. [decision] The enabled left pane has a header action to create a top-level Epic and secondary actions for unparented WorkItem/Bug so existing workflows remain accessible.
4. [decision] Selecting a tree node opens the right detail pane for that node.
5. [decision] Tree context/menu actions include valid child creation, parent change, unlink parent, pin/archive/delete, constrained by item type and deletion rules.
6. [decision] Child creation is constrained:
   - Epic -> Feature
   - Feature -> PBI / Story
   - PBI -> WorkItem or Bug
   - WorkItem/Bug -> no children
7. [decision] Reparenting uses a parent picker, not drag-and-drop.
8. [decision] Tree node labels use API type values but user-facing labels show `Epic`, `Feature`, `PBI / Story`, `Work Item`, and `Bug`.
9. [decision] Parent nodes show descendant roll-up counts by status/type and child counts.
10. [assumption] Tree rows show type label/pill, existing number if present, title, status chip, descendant progress summary, and updated time.
11. [assumption] Collapse state is persisted per workspace in localStorage.

#### Visual Design

Use the existing split-pane Work Items layout. The left pane becomes a board outline:

```text
Work Items Board                         + Epic
Search hierarchy...

Epic E-12  Checkout modernization     3/8 done
  Feature F-13  Cart flow             1/5 done
    PBI PBI-14  Guest checkout        0/2 done
      WI-15  Add address form         readyToExecute
      BUG-16 Tax total mismatch       aiDone

Unparented
  WI-7 Existing task                   planning
```

The right pane keeps the current detail shell. Container details show title, description, status, parent picker, children list, and roll-up cards. Leaf details reuse existing plan/execution/review sections with an added parent metadata row.

#### Surfaces

- [decision] `packages\coc\src\server\spa\client\react\features\work-items\WorkItemsTab.tsx`
- [assumption] New `WorkItemHierarchyTree.tsx`
- [assumption] New `WorkItemHierarchyNode.tsx`
- [assumption] New `WorkItemParentPicker.tsx`
- [decision] `packages\coc\src\server\spa\client\react\features\work-items\CreateWorkItemDialog.tsx`
- [decision] `packages\coc\src\server\spa\client\react\features\work-items\WorkItemDetail.tsx`
- [decision] `packages\coc\src\server\spa\client\react\contexts\WorkItemContext.tsx`
- [decision] `packages\coc\src\server\spa\client\react\App.tsx`

#### API Contract

The SPA uses `getSpaCocClient().workItems.tree(...)`, `create(...)`, and `update(...)` rather than raw `fetchApi` for hierarchy work item operations where client methods exist.

#### Data Model

UI stores only transient selection/collapse/search state. Persistent hierarchy state stays in server work item files.

#### UX States

- Flag disabled: existing UI.
- Empty hierarchy: Create Epic primary action plus Create WorkItem/Bug secondary actions.
- Loading: tree skeleton or current small loading indicator.
- Error: retry action and readable message.
- Unparented: dedicated tree group for existing items and intentionally unlinked items.
- Archived: follow current hidden-by-default/toggle semantics.
- Mobile: preserve current list/detail mobile navigation pattern; tree is the mobile list.

#### Edge Cases and Failure Modes

- Parent picker must not list invalid parent types, current item, descendants, archived parents unless explicitly allowed by existing archive toggle state, or items from other workspaces.
- If a selected item is deleted by WebSocket update, navigate back to tree/list as current detail does.
- If a parent delete is blocked, keep the item selected and show the conflict error.
- Search results should preserve enough ancestors to show context, or clearly show matched nodes in an Unparented/Search Results group. [assumption] Preserve ancestors where practical.

#### Definition of Done

1. Manual demo: enable the flag, open a repo Work Items tab, create Epic -> Feature -> PBI / Story -> WorkItem and Bug, collapse/expand nodes, move a WorkItem to another PBI through parent picker, unlink it, and verify it appears under Unparented.
2. Test commands must include `npm --workspace @plusplusoneplusplus/coc run test:run -- test/spa/react` for targeted Work Items hierarchy tests.
3. Code-search assertions: no `drag`/`drop` reparenting implementation is added; `WorkItemSection` remains available for disabled mode; Work Items tab still has existing create WorkItem/Bug affordances when hierarchy mode is disabled.

### AC-05: Leaf-only planning and execution behavior

#### Behavior

1. [decision] Only `work-item` and `bug` show plan editing, Start Implementing, execution session, AI review, request changes, commit review, and resolve-comment flows.
2. [decision] Epics, Features, and PBIs are planning containers only in this MVP.
3. [decision] Container nodes may use the existing status values, but they do not auto-execute and do not auto-transition based on descendants.
4. [decision] Existing WorkItem/Bug plan/execution behavior remains unchanged except for optional parent metadata display.
5. [decision] Existing deep links to work item detail/session/commit continue to work for leaf items.
6. [assumption] If a user deep-links to a container item, show container detail without plan/execution sections.

#### Surfaces

- [decision] `packages\coc\src\server\spa\client\react\features\work-items\WorkItemDetail.tsx`
- [decision] `packages\coc\src\server\spa\client\react\features\work-items\WorkItemPlanSection.tsx`
- [decision] `packages\coc\src\server\spa\client\react\features\work-items\WorkItemExecuteDialog.tsx`
- [decision] `packages\coc\src\server\routes\work-item-execution-routes.ts`
- [decision] `packages\coc\src\server\work-items\work-item-executor.ts`

#### API Contract

Execution routes reject container types:

```text
POST /api/workspaces/:id/work-items/:itemId/execute
POST /api/workspaces/:id/work-items/:itemId/resolve-comments
```

If `item.type` is `epic`, `feature`, or `pbi`, return a clear non-2xx error such as `Only WorkItem and Bug items can be executed`.

#### Data Model

No execution history, changes, or plan versions are created for containers by MVP UI flows.

#### UX States

- Container selected: metadata and children only.
- Leaf selected: existing detail behavior plus parent metadata.
- Invalid execute attempt by API: readable server error.

#### Edge Cases and Failure Modes

- Container status manually set to `readyToExecute` must not trigger auto-execute.
- `autoExecute` is ignored or hidden for containers.
- Existing leaves with missing `type` still behave as executable `work-item`.

#### Definition of Done

1. Manual demo: select an Epic/Feature/PBI and verify no plan/execution controls appear; select a WorkItem/Bug and verify current plan/execution/review controls still appear and work.
2. Test commands must include `npm --workspace @plusplusoneplusplus/coc run test:run -- test/server/work-items test/spa/react/repos`.
3. Code-search assertions: execution route logic has an explicit leaf-type guard; container UI does not render `WorkItemPlanSection` or `WorkItemExecuteDialog`.

### AC-06: Tests, compatibility, and final validation

#### Behavior

1. [decision] Add or update tests across server store, server routes, coc-client contracts/domain, SPA components/context, and disabled-mode compatibility.
2. [decision] Do not remove or weaken existing Work Items tests.
3. [decision] Existing WorkItem/Bug behavior remains the compatibility baseline.
4. [assumption] Documentation updates are limited to directly related REST/API or admin config references if the repo keeps those generated/manually maintained docs in sync.

#### Surfaces

- [decision] `packages\coc\test\server\work-items\*.test.ts`
- [decision] `packages\coc\test\server\work-items\work-item-routes.test.ts`
- [decision] `packages\coc\test\spa\react\repos\*.test.tsx`
- [decision] `packages\coc\test\spa\react\context\WorkItemContext.test.tsx`
- [decision] `packages\coc-client\test\domains\work-items.test.ts`
- [decision] `packages\coc-client\test\domains\work-items.mock.test.ts`
- [decision] `packages\coc-client\test\client-integration.test.ts`

#### API Contract

Tests must cover:

- Creating each hierarchy type when enabled.
- Rejecting hierarchy types/parent fields when disabled.
- Valid and invalid parent-child pairs.
- Self-parent, cycle, cross-repo parent rejection.
- Parent deletion blocked when children exist.
- Tree response shape and descendant roll-ups.
- Existing list/grouped responses still work for WorkItem/Bug.
- Leaf-only execution guard.

#### Data Model

Test fixtures must use temporary per-test data directories and must not rely on shared local `~/.coc` state.

#### UX States

SPA tests must cover disabled mode, enabled empty state, tree rendering, constrained child creation affordances, parent picker/unlink behavior, and container-vs-leaf detail rendering.

#### Edge Cases and Failure Modes

- Tests must not depend on localStorage from other tests.
- Tests must not rely on real git, network, or external Azure DevOps services.
- Preserve Windows path compatibility.

#### Definition of Done

1. Manual demo script:
   1. Start CoC with the hierarchy flag disabled and confirm current Work Items tab behavior is unchanged.
   2. Enable `workItems.hierarchy.enabled`.
   3. Create Epic -> Feature -> PBI / Story -> WorkItem and Bug.
   4. Move and unlink a leaf through the parent picker.
   5. Try to delete a parent with children and confirm deletion is blocked.
   6. Execute a leaf WorkItem/Bug and confirm current execution flow still works.
   7. Select a container item and confirm no plan/execution controls appear.
2. Exact test/build commands:
   1. `npm --workspace @plusplusoneplusplus/coc-client run test:run -- test/domains/work-items.test.ts test/domains/work-items.mock.test.ts test/client-integration.test.ts`
   2. `npm --workspace @plusplusoneplusplus/coc run test:run -- test/server/work-items test/server/work-items/work-item-routes.test.ts test/spa/react`
   3. `npm run build`
   4. `npm run test`
3. Code-search assertions:
   1. `workItems.hierarchy.enabled` default is false.
   2. No files under `packages\vscode-extension\` are modified.
   3. No new top-level per-repo data directory under `~/.coc` is introduced.
   4. No drag-and-drop hierarchy reparenting code is added.
   5. No SDK session cache or `sendFollowUp` API is added.

## Open Questions

None.

## Ready-for-Ralph Checklist

- [x] Every functional AC has a Definition of Done.
- [x] No `[open]` items remain.
- [x] Dependency graph has no cycles.
- [x] `## References to Load` lists the cross-cutting docs and code the implementer needs.
