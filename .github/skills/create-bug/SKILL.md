---
name: create-bug
description: Interactively create a bug work item for this repository with title, description, priority, tags, and an optional AI-generated plan. Use when the user asks to file a bug, report a defect, or log an issue. Never execute the bug fix inside the chat session — queue it through the unified work-item tool instead.
---

# Create Bug

Guide the user through creating a well-structured bug report and persisting it to the **Work Items** page as a typed bug through `create_update_work_item` with `type: "bug"`. Always present a draft summary first, iterate on feedback, then create only when the user confirms.

## Instructions

### Phase 1 — Draft

1. Analyze the user's request and extract or infer:
   - **Title**: Short, imperative phrase (e.g. "Fix crash on empty input in queue processor")
   - **Description**: Markdown paragraph with what's broken, reproduction steps, and expected behavior
   - **Priority**: `high`, `normal` (default), or `low`
   - **Tags**: Optional labels (e.g. `["regression", "ui"]`)
   - **Plan**: Optional complete markdown plan using the standard template

2. Generate a plan using this exact template:

   ```markdown
   ## Objective

   <one or two sentences stating what the bug fix should achieve>

   ## Background

   <context: what's broken, how to reproduce, expected vs actual behavior>

   ## Steps

   - [ ] <step 1>
   - [ ] <step 2>

   ## Acceptance Criteria

   - [ ] <testable condition>

   ## Notes

   _Additional constraints, links, or follow-ups._
   ```

3. Present the full draft as a **bug report summary**:

   ```
   🐛 Bug Report Draft
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

6. Call `create_update_work_item` with the confirmed details:

   ```
   create_update_work_item({
     type:        "bug",
     title:       "<confirmed title>",
     description: "<confirmed description>",
     priority:    "<confirmed priority>",
     tags:        ["<tag1>", "<tag2>"],   // omit if none
     plan:        "<confirmed plan markdown>" // omit when no plan was confirmed
   })
   ```

   The tool persists the bug to the Work Items page and broadcasts a live update to any connected dashboard. Bugs with a plan are created in `planning`; bugs without a plan are created in `created`.

   If the chat-facing work-item tool is unavailable, fall back to the REST API:

   ```powershell
   $workspaceId = (Invoke-RestMethod -Uri "http://localhost:4000/api/workspaces").workspaces |
       Where-Object { $_.rootPath -eq (git rev-parse --show-toplevel) } |
       Select-Object -ExpandProperty id

   $body = @{
     title       = "<confirmed title>"
     description = "<confirmed description>"
     priority    = "<confirmed priority>"
     type        = "bug"
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
   ✅ Bug report created!
   ID:     <id>
   Title:  <title>
   Status: <created or planning>

   View it in the Work Items tab of the CoC dashboard.
   ```

### Phase 4 — Execution (only if explicitly requested later)

9. **Never execute the bug fix steps in the current chat session.**

   If the user asks to execute the bug fix after it has been created, queue it as a background AI task via the REST API. Do **not** run the steps yourself.

   ```powershell
   Invoke-RestMethod `
       -Method Post `
       -Uri "http://localhost:4000/api/workspaces/<workspaceId>/work-items/<workItemId>/execute" `
       -ContentType "application/json" `
       -Body "{}"
   ```

   Confirm to the user: "✅ Bug fix queued for execution. Track progress in the Work Items tab."

## Edge Cases

- **Multiple workspaces**: For the execution step, match the workspace whose `rootPath` most closely matches the current working directory (exact match preferred, then closest ancestor).
- **No workspace registered**: If no workspace matches for execution, tell the user to open the CoC dashboard and register the current repository first.
- **Execute before create**: If the user asks to execute before the bug report is created, complete the creation flow first, then queue execution.
- **Server not running (execution only)**: If `localhost:4000` is unreachable when trying to queue execution, tell the user: "Start the CoC server with `coc serve` then try again."

## References

- [Work Item API Reference](references/work-item-api.md)
