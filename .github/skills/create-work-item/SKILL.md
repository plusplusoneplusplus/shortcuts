---
name: create-work-item
description: Interactively create a work item for this repository with title, description, status, and an AI-generated plan. Use when the user asks to create a work item, track a feature request, file a bug, or queue a task for later AI execution. Never execute the work item inside the chat session — queue it via the API instead.
---

# Create Work Item

Guide the user through creating a well-structured work item and persisting it to the **Work Items** page via the CoC REST API. Always present a draft summary first, iterate on feedback, then create only when the user confirms.

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

6. Find the current workspace ID:

   ```powershell
   # Get the current git repo root
   $repoRoot = git rev-parse --show-toplevel

   # List all registered workspaces
   $workspaces = (Invoke-RestMethod -Uri "http://localhost:4000/api/workspaces").workspaces

   # Match workspace whose rootPath equals the repo root (normalize separators)
   $ws = $workspaces | Where-Object {
       ($_.rootPath -replace '\\', '/') -eq ($repoRoot -replace '\\', '/')
   } | Select-Object -First 1
   $workspaceId = $ws.id
   ```

7. Create the work item:

   ```powershell
   $body = @{
       title       = "<title>"
       description = "<description>"
       priority    = "<priority>"
       tags        = @("<tag1>", "<tag2>")   # omit if empty
       source      = "chat"
       plan        = @{
           content    = "<plan markdown>"
           resolvedBy = "ai"
       }
   } | ConvertTo-Json -Depth 5

   $result = Invoke-RestMethod `
       -Method Post `
       -Uri "http://localhost:4000/api/workspaces/$workspaceId/work-items" `
       -ContentType "application/json" `
       -Body $body
   ```

8. On success (HTTP 201), report to the user:

   ```
   ✅ Work item created!
   ID:     <id>
   Title:  <title>
   Status: created

   View it in the Work Items tab of the CoC dashboard (http://localhost:4000).
   ```

### Phase 4 — Execution (only if explicitly requested later)

9. **Never execute the work item's steps in the current chat session.**

   If the user asks to execute the work item:
   - Do **not** run the steps yourself.
   - Queue it as a separate background AI task:

   ```powershell
   Invoke-RestMethod `
       -Method Post `
       -Uri "http://localhost:4000/api/workspaces/$workspaceId/work-items/$workItemId/execute" `
       -ContentType "application/json" `
       -Body "{}"
   ```

   - Confirm to the user: "✅ Work item queued for execution. Track progress in the Work Items tab."

## Edge Cases

- **Server not running**: If `localhost:4000` is unreachable, tell the user: "The CoC server doesn't appear to be running. Start it with `coc serve` then try again."
- **Multiple workspaces**: Match the workspace whose `rootPath` most closely matches the current working directory (exact match preferred, then closest ancestor).
- **No workspace registered**: If no workspace matches, ask the user to open the CoC dashboard and register the current repository first.
- **Execute before create**: If the user asks to execute before the work item is created, complete the creation flow first, then queue execution.

## References

- [Work Item API Reference](references/work-item-api.md)
