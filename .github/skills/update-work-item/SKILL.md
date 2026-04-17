---
name: update-work-item
description: Interactively update an existing work item — patch common fields or create a new plan version, then reset status to planning. Use when the user asks to modify, edit, revise, or update a work item.
---

# Update Work Item

Guide the user through updating an existing work item and persisting changes via the `update_work_item` tool or CoC REST API. Always look up the work item first, present a draft of changes, iterate on feedback, then update only when the user confirms.

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

4. Based on the user's request, determine which fields to update:
   - **Title**: Short, imperative phrase
   - **Description**: Markdown paragraph
   - **Priority**: `high`, `normal`, or `low`
   - **Tags**: Updated label list
   - **Plan**: Full revised plan using the standard template (creates a new plan version)

5. Present the draft changes as an **update summary**:

   ```
   ✏️ Work Item Update Draft
   ──────────────────
   ID:       <id> (WI-<number>)
   Title:    <current → new, or "unchanged">
   Priority: <current → new, or "unchanged">
   Tags:     <current → new, or "unchanged">

   Description:
   <new description, or "unchanged">

   Plan (new version v<N+1>):
   <new plan markdown, or "unchanged — no new version will be created">
   ──────────────────
   Confirm to update, or give feedback to refine.
   ```

### Phase 3 — Refine

6. If the user provides corrections, update the draft and re-present the summary.
7. Repeat until the user confirms (e.g. "looks good", "update it", "yes", "confirm").

### Phase 4 — Update

8. Call the `update_work_item` tool with the confirmed changes:

   ```
   update_work_item({
     workItemId:  "<id>",
     title:       "<new title>",          // omit if unchanged
     description: "<new description>",    // omit if unchanged
     priority:    "<new priority>",        // omit if unchanged
     tags:        ["<tag1>", "<tag2>"],   // omit if unchanged
     plan:        "<new plan markdown>"   // omit if no plan change
   })
   ```

   The tool patches the specified fields, saves a new plan version if `plan` is provided, and always resets status to `planning`.

   If the `update_work_item` tool is unavailable, fall back to the REST API:

   ```powershell
   $body = @{
     title       = "<new title>"
     description = "<new description>"
     priority    = "<new priority>"
     tags        = @("<tag1>", "<tag2>")
     status      = "planning"
   } | ConvertTo-Json -Depth 5

   Invoke-RestMethod `
       -Method Patch `
       -Uri "http://localhost:4000/api/workspaces/$workspaceId/work-items/<workItemId>" `
       -ContentType "application/json" `
       -Body $body
   ```

   For plan updates via REST, use the plan endpoint:

   ```powershell
   $planBody = @{
     content    = "<new plan markdown>"
     resolvedBy = "ai"
   } | ConvertTo-Json -Depth 5

   Invoke-RestMethod `
       -Method Post `
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
- **No fields changed**: If the user's request doesn't change any fields, confirm with the user before calling the tool.
- **Plan only**: If only the plan is being updated (no field changes), call the tool with just `workItemId` and `plan`.
- **Multiple workspaces**: Match the workspace whose `rootPath` most closely matches the current working directory.
- **Server not running**: If `localhost:4000` is unreachable, tell the user: "Start the CoC server with `coc serve` then try again."

## References

- [Work Item API Reference](references/work-item-api.md)
