# Context: Pipeline Workflow Detail View

## User Story
The current CoC pipeline experience shows pipeline runs as opaque queue items — you can see the queue and the final output, but can't inspect individual nodes during or after execution. For complex pipelines (map over many items), users want to click into the live workflow graph, see individual map items, view their AI conversations, and resume chatting on specific items. The pipeline is essentially a workflow, and the UI should reflect that.

## Goal
Transform the pipeline run experience from an opaque queue-and-result view into a navigable workflow graph with per-item drill-down and chat resume capability.

## Commit Sequence
1. Add `parentProcessId` to `ProcessFilter` (query foundation)
2. Per-item child process creation in pipeline executor (data model)
3. Wire child process creation in queue executor bridge (persistence)
4. REST API routes for child processes (server layer)
5. SSE events for item-level progress (live streaming)
6. SPA Workflow Detail View with expandable DAG (primary UI)
7. Item Conversation Panel + chat resume (drill-down UI)
8. Navigation integration — Queue + Pipelines → Workflow (wiring)

## Key Decisions
- Reuse existing `AIProcess.parentProcessId` (already exists, line 380) and `GenericGroupMetadata.childProcessIds` (already exists) rather than inventing new linking mechanisms
- Each map item gets its own `AIProcess` with `type: 'pipeline-item'` — this is a real process, not a lightweight record, enabling full chat resume via the existing `POST /api/processes/:id/message` endpoint
- New dedicated route `#repos/:id/workflow/:processId` for the workflow view — separates from the existing ProcessDetail (which continues to work for non-pipeline processes)
- Queue tab stays as the "control plane" (opaque items) — the workflow view is the "observation plane"
- Child process creation is fire-and-forget (non-blocking) to avoid pipeline performance regression

## Conventions
- Plan files follow the deep-plan template with YAML frontmatter `status: pending`
- SPA components use functional React with hooks, inline styles (existing pattern)
- Hash-based routing (no React Router) — manual `window.location.hash` navigation
- Process ID format for children: `${parentProcessId}-m${itemIndex}` (map), `-r` (reduce), `-j` (job)
- SSE event naming follows existing pattern: `item-process` (hyphenated, lowercase)
