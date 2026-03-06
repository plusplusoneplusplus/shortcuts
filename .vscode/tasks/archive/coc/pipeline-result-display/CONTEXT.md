# Context: Pipeline Result Display & Chat Gating

## Goal
Improve the CoC dashboard experience for pipeline executions by gating the chat input when no AI session exists (preventing broken 409 errors) and providing a pipeline-centric run history with rich result cards directly in the Pipelines tab.

## Commit Sequence
1. Gate chat input on `sdkSessionId` in both legacy SPA (`detail.ts`) and React SPA (`ProcessDetail.tsx`)
2. Pipeline run history & result card in Pipelines tab — inline run history below YAML editor, `PipelineResultCard` component with stats grid, mermaid diagrams, and formatted output. Running a pipeline stays on the Pipelines tab instead of auto-navigating to Queue.

## Key Decisions
- Chat input is hidden (not just disabled) for terminal processes without `sdkSessionId`
- `QueueTaskDetail.tsx` already has this gating pattern — we mirror it in `detail.ts` and `ProcessDetail.tsx`
- `RepoChatTab.tsx` needs no changes — it only creates chat-type tasks that always have sessions
- **Pipeline-centric UX**: after clicking Run, user stays on Pipelines tab and sees history inline (no auto-switch to Queue tab)
- Queue tab still shows pipeline tasks for operational visibility, but is no longer the primary pipeline experience
- `pipelineName` is stored in task metadata at creation time for early filtering (not just in the result)
- `GET /api/queue/history` extended with `pipelineName` query param
- Mermaid rendering uses the existing `useMermaid` hook and `renderMarkdownToHtml` pipeline (no new mermaid infrastructure)
- Pipeline result card only renders in `PipelineRunHistory` expansion; `ConversationTurnBubble` is not modified
- Graceful degradation: missing metadata fields result in hidden sections, not errors

## Conventions
- Process type detection: `process.type === 'pipeline-execution'` or `metadata.type` starting with `queue-run-pipeline`
- Session ID resolution: use `getSessionIdFromProcess()` from `ConversationMetadataPopover.tsx` in React; direct `proc.sdkSessionId` check in legacy SPA
- Styling: Tailwind utility classes, dark/light theme tokens (`dark:bg-[#252526]`, `text-[#848484]`)
- Tests: vitest + @testing-library/react, mock MarkdownView and markdown-renderer
