---
name: create-work-item
description: Interactively create a work item for this repository with title, description, status, and an AI-generated plan. Use when the user asks to create a work item, track a feature request, file a bug, or queue a task for later AI execution. Never execute the work item inside the chat session — queue it via the API instead.
---

# Create Work Item

Guide the user through creating a well-structured work item and persisting it to the **Work Items** page via the `create_update_work_item` tool. Always present a draft summary first, iterate on feedback, then create only when the user confirms.

## Instructions

### Phase 1 — Draft

1. Analyze the user's request and extract or infer:
   - **Title**: Short, imperative phrase (e.g. "Add retry logic to queue processor")
   - **Description**: Markdown paragraph with what needs to be done and why
   - **Priority**: `high`, `normal` (default), or `low`
   - **Tags**: Optional labels (e.g. `["bug", "backend"]`)
   - **Plan**: Complete markdown plan using the standard template

2. Generate a plan using this exact template:

   ```markdown
   ## Objective

   <one or two sentences stating the goal>

   ## Background

   <context and motivation for this work>

   ## Steps

   - [ ] <step 1>
   - [ ] <step 2>

   ## Acceptance Criteria

   - [ ] <testable condition>

   ## Notes

   _Additional constraints, links, or follow-ups._
   ```

3. Present the full draft as a **work item summary**:

   ```
   📋 Work Item Draft
   ──────────────────
   Title:       <title>
   Priority:    <priority>
   Tags:        <comma-separated tags, or "none">

   Description:
   <description>

   Plan:
   <plan markdown>
   ──────────────────
   Confirm to create, or give feedback to refine.
   ```

### Phase 2 — Refine

4. If the user provides comments or corrections, update the draft and re-present the summary.
5. Repeat until the user confirms (e.g. "looks good", "create it", "yes", "confirm").

### Phase 3 — Create

6. Call the `create_update_work_item` tool with the confirmed details and no existing work item target:

   ```
   create_update_work_item({
     title:       "<confirmed title>",
     description: "<confirmed description>",
     priority:    "<confirmed priority>",
     tags:        ["<tag1>", "<tag2>"],   // omit if none
     plan:        "<confirmed plan markdown>"
   })
   ```

   The tool persists the work item to the Work Items page and broadcasts a live update to any connected dashboard.

   If the `create_update_work_item` tool is unavailable, fall back to the REST API:

   ```powershell
   $workspaceId = (Invoke-RestMethod -Uri "http://localhost:4000/api/workspaces").workspaces |
       Where-Object { $_.rootPath -eq (git rev-parse --show-toplevel) } |
       Select-Object -ExpandProperty id

   $body = @{
     title       = "<confirmed title>"
     description = "<confirmed description>"
     priority    = "<confirmed priority>"
     tags        = @("<tag1>", "<tag2>")
     plan        = @{ content = "<confirmed plan markdown>"; resolvedBy = "ai" }
   } | ConvertTo-Json -Depth 5

   Invoke-RestMethod `
       -Method Post `
       -Uri "http://localhost:4000/api/workspaces/$workspaceId/work-items" `
       -ContentType "application/json" `
       -Body $body
   ```

7. On success, report to the user:

   ```
   ✅ Work item created!
   ID:     <id>
   Title:  <title>
   Status: created

   View it in the Work Items tab of the CoC dashboard.
   ```

### Phase 4 — Execution (only if explicitly requested later)

9. **Never execute the work item's steps in the current chat session.**

   If the user asks to execute the work item after it has been created, queue it as a background AI task via the REST API. Do **not** run the steps yourself.

   ```powershell
   Invoke-RestMethod `
       -Method Post `
       -Uri "http://localhost:4000/api/workspaces/<workspaceId>/work-items/<workItemId>/execute" `
       -ContentType "application/json" `
       -Body "{}"
   ```

   Obtain `workspaceId` by calling `GET http://localhost:4000/api/workspaces` and matching the workspace whose `rootPath` equals the current git repo root. Use the `id` returned from the create step as `workItemId`.

   Confirm to the user: "✅ Work item queued for execution. Track progress in the Work Items tab."

## Edge Cases

- **Multiple workspaces**: For the execution step, match the workspace whose `rootPath` most closely matches the current working directory (exact match preferred, then closest ancestor).
- **No workspace registered**: If no workspace matches for execution, tell the user to open the CoC dashboard and register the current repository first.
- **Execute before create**: If the user asks to execute before the work item is created, complete the creation flow first, then queue execution.
- **Server not running (execution only)**: If `localhost:4000` is unreachable when trying to queue execution, tell the user: "Start the CoC server with `coc serve` then try again."

## References

- [Work Item API Reference](references/work-item-api.md)
