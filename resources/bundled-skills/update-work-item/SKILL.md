---
name: update-work-item
description: Interactively update an existing work item — patch common fields or create a new plan version, then reset status to planning. Use when the user asks to modify, edit, revise, or update a work item.
---

# Update Work Item

Guide the user through updating an existing work-item plan via the `create_update_work_item` tool or CoC REST API. Always look up the work item first, present the complete revised plan, iterate on feedback, then update only when the user confirms.

## Instructions

### Phase 1 — Identify Work Item

1. If the user provides a work item ID (UUID or WI-N number), use it directly.
2. If no ID is provided, list recent work items via the REST API to help the user choose:

   ```powershell
   $workspaceId = (Invoke-RestMethod -Uri "http://localhost:4000/api/workspaces").workspaces |
       Where-Object { $_.rootPath -eq (git rev-parse --show-toplevel) } |
       Select-Object -ExpandProperty id

   Invoke-RestMethod -Uri "http://localhost:4000/api/workspaces/$workspaceId/work-items" |
       Select-Object -ExpandProperty items |
       Select-Object id, workItemNumber, title, status, priority
   ```

3. Fetch the full work item to understand its current state:

   ```powershell
   Invoke-RestMethod -Uri "http://localhost:4000/api/workspaces/$workspaceId/work-items/<workItemId>"
   ```

### Phase 2 — Draft Changes

4. Based on the user's request, produce a **full revised plan** using the standard template. Do not append raw text to the existing plan body and do not submit a partial diff.

5. Present the draft changes as an **update summary**:

   ```
   ✏️ Work Item Update Draft
   ──────────────────
   ID:       <id> (WI-<number>)
    Plan (new version v<N+1>):
    <complete revised plan markdown>
    ──────────────────
    Confirm to update, or give feedback to refine.
    ```

### Phase 3 — Refine

6. If the user provides corrections, update the draft and re-present the summary.
7. Repeat until the user confirms (e.g. "looks good", "update it", "yes", "confirm").

### Phase 4 — Update

8. Call the `create_update_work_item` tool with the confirmed complete revised plan:

   ```
   create_update_work_item({
     target:  "<id or WI-N>",
     plan:    "<complete revised plan markdown>",
     summary: "<short summary of the plan change>"   // optional
   })
   ```

   The tool saves a new plan version, resets status to `planning`, opens a change record, and broadcasts a dashboard update.

   If the `create_update_work_item` tool is unavailable, fall back to the REST API with `PATCH /api/workspaces/:workspaceId/work-items/:workItemId` and a `plan` object:

   ```powershell
   $body = @{
     plan = @{
       content    = "<complete revised plan markdown>"
       resolvedBy = "ai"
       summary    = "<short summary of the plan change>"
     }
     status = "planning"
   } | ConvertTo-Json -Depth 5

   Invoke-RestMethod `
       -Method Patch `
       -Uri "http://localhost:4000/api/workspaces/$workspaceId/work-items/<workItemId>" `
       -ContentType "application/json" `
       -Body $body
   ```

   For plan-only REST workflows, the dedicated endpoint is `PUT /api/workspaces/:workspaceId/work-items/:workItemId/plan`:

   ```powershell
   $planBody = @{
     content    = "<new plan markdown>"
     resolvedBy = "ai"
   } | ConvertTo-Json -Depth 5

   Invoke-RestMethod `
       -Method Put `
       -Uri "http://localhost:4000/api/workspaces/$workspaceId/work-items/<workItemId>/plan" `
       -ContentType "application/json" `
       -Body $planBody
   ```

9. On success, report to the user:

   ```
   ✅ Work item updated!
   ID:      <id> (WI-<number>)
   Title:   <title>
   Status:  planning
   Plan:    v<version> (if plan was updated, otherwise "unchanged")

   View it in the Work Items tab of the CoC dashboard.
   ```

## Edge Cases

- **Work item not found**: If the provided ID doesn't match any work item, list recent items and ask the user to confirm.
- **No plan change**: If the user's request does not produce a changed complete plan, do not call the tool.
- **Plan only**: Call the tool with `target` and `plan`; the plan must be the complete revised Markdown body.
- **Multiple workspaces**: Match the workspace whose `rootPath` most closely matches the current working directory.
- **Server not running**: If `localhost:4000` is unreachable, tell the user: "Start the CoC server with `coc serve` then try again."

## References

- [Work Item API Reference](references/work-item-api.md)
