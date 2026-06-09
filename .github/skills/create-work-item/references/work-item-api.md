# Work Item API Reference

Base URL: `http://localhost:4000` (default CoC server port)

## List Workspaces

```
GET /api/workspaces
```

Response: `{ workspaces: WorkspaceInfo[] }`

Each `WorkspaceInfo` has: `id`, `name`, `rootPath`, `color?`, `remoteUrl?`

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

**Response: 201** — Full `WorkItem` object including `id`, `status`, and `plan` when provided.

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

## Get Work Item

```
GET /api/workspaces/:workspaceId/work-items/:workItemId
```

---

## Update Work Item

```
PATCH /api/workspaces/:workspaceId/work-items/:workItemId
Content-Type: application/json
```

Updatable fields: `title`, `description`, `status`, `priority`, `tags`, `autoExecute`, `reviewComments`.

---

## Status Lifecycle

```
created → planning → readyToExecute → executing → aiDone → done | failed
```

Terminal states (`done`, `failed`) can be re-opened back to `created`.

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
