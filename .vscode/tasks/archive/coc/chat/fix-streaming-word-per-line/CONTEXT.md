# Context: Fix Streaming Chat Word-per-Line Rendering

## User Story
The AI Execution Dashboard chat renders each streaming word/phrase on its own line instead of flowing as paragraphs. Each SDK token delta (1-3 words) becomes a separate timeline event, rendered as an independent block `<div>`. The fix should merge consecutive content items at the source — both server-side (for persistence/reload) and browser-side (for live streaming).

## Goal
Eliminate word-per-line rendering by smart-appending consecutive content timeline items instead of always creating new entries, while preserving tool events as natural merge boundaries.

## Commit Sequence
1. Smart-append consecutive content items in server-side timeline buffer
2. Smart-append consecutive content items in browser-side SSE chunk handler

## Key Decisions
- **Smart-append over post-hoc merge**: Merge at the point of creation (appendTimelineItem / chunk handler) rather than adding a utility function applied later. Simpler, fewer moving parts.
- **No SDK-level buffering**: The Copilot SDK's per-token callbacks are intentional for low-latency streaming UX. Buffering there would degrade all 3 consumers.
- **Tool events as boundaries**: Tool-start/complete/failed events always create new entries, naturally separating content blocks around tool executions.
- **SSE streaming unaffected**: `emitProcessOutput()` is called before timeline append, so the typing effect is preserved.

## Conventions
- Timeline items use `type: 'content'` for text and `type: 'tool-*'` for tool lifecycle events
- Server types use `Date` timestamps; client types use ISO string timestamps
- Tests in queue-executor-bridge use mock `sendMessage` implementations that call `onStreamingChunk`/`onToolEvent`
