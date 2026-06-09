# Work Item API Reference

Base URL: `http://localhost:4000` (default CoC server port)

## List Workspaces

```
GET /api/workspaces
```

Response: `{ workspaces: WorkspaceInfo[] }`

Each `WorkspaceInfo` has: `id`, `name`, `rootPath`, `color?`, `remoteUrl?`

---

## List Work Items

```
GET /api/workspaces/:workspaceId/work-items
```

Query parameters: `status`, `source`, `priority`, `tags`, `type` (all optional).

Response: `{ items: WorkItemIndexEntry[] }`

Each index entry has: `id`, `workItemNumber`, `title`, `status`, `type`, `priority`, `planVersion`, `createdAt`, `updatedAt`, `tags`

---

## Get Work Item

```
GET /api/workspaces/:workspaceId/work-items/:workItemId
```

Response: Full `WorkItem` object including `id`, `workItemNumber`, `title`, `description`, `status`, `plan`, etc.

---

## Create Work Item

```
POST /api/workspaces/:workspaceId/work-items
Content-Type: application/json
```

**Request body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `title` | string | ✅ | Short descriptive title |
| `description` | string | | Markdown description |
| `source` | `"chat" \| "manual" \| "schedule"` | | Defaults to `"manual"` |
| `priority` | `"high" \| "normal" \| "low"` | | Defaults to `"normal"` |
| `tags` | string[] | | Optional labels |
| `autoExecute` | boolean | | Auto-run when status reaches `readyToExecute` |
| `plan.content` | string | | Markdown plan body |
| `plan.resolvedBy` | `"ai" \| "user"` | | Who generated the plan |

**Response: 201** — Full `WorkItem` object including `id`, `status: "created"`.

---

## Update Work Item

Patches fields on an existing work item. Only the provided fields are changed.

```
PATCH /api/workspaces/:workspaceId/work-items/:workItemId
Content-Type: application/json
```

**Updatable fields:** `title`, `description`, `status`, `priority`, `tags`, `autoExecute`, `reviewComments`, and `plan`.

`plan` accepts `{ content, resolvedBy?, summary? }`. When `plan.content` is present, the server saves the next plan version, updates the current work-item plan, opens a change record, broadcasts `work-item-updated`, and returns the updated work item.

**Response: 200** — Updated `WorkItem` object.

---

## Update Plan (creates a new plan version)

Saves a new plan version and updates the work item's current plan.

```
PUT /api/workspaces/:workspaceId/work-items/:workItemId/plan
Content-Type: application/json
```

**Request body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `content` | string | ✅ | Markdown plan content |
| `resolvedBy` | `"ai" \| "user"` | | Who generated the plan (default: `"user"`) |
| `summary` | string | | Short description of what changed |

**Response: 200** — `{ plan, version }` with incremented `plan.version`.

---

## Execute Work Item

Queues the work item as an AI background task. Does **not** run it in the current session.

```
POST /api/workspaces/:workspaceId/work-items/:workItemId/execute
Content-Type: application/json

{}
```

**Response: 200** — `{ taskId: string }`

---

## Status Lifecycle

```
created → planning → readyToExecute → executing → aiDone → done | failed
```

Terminal states (`done`, `failed`) can be re-opened back to `created`.

The `create_update_work_item` tool saves full revised plans as new versions and resets status to `planning` after a successful plan update.

---

## Standard Plan Template

```markdown
## Objective

<one or two sentences stating the goal>

## Background

<context and motivation>

## Steps

- [ ] <step 1>

## Acceptance Criteria

- [ ] <testable condition>

## Notes

_Additional constraints, links, or follow-ups._
```
