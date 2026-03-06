# Context: CoC SPA Comment Anchor Relocation

## User Story
When I add comments on a task file in the CoC SPA dashboard and then make small edits to the file, the comment highlights break — they either disappear or attach to the wrong text. I need comments to survive small file amendments, like they do in the VS Code extension.

## Goal
Close the gap between the CoC SPA's naive `indexOf`-based comment highlighting and the VS Code extension's robust line+column coordinate system with anchor relocation, maximizing code reuse from `pipeline-core`.

## Commit Sequence
1. Fix anchor creation with source-accurate positions
2. Add server-side anchor relocation on comment retrieval
3. Bake comment highlights into rendering pipeline
4. Simplify CommentHighlight to event-only component

## Key Decisions
- **Build-time injection over DOM mutation**: Highlights are baked into the HTML string during `renderMarkdownToHtml`, matching the VS Code extension's approach — eliminates the `indexOf` text search entirely.
- **Server-side relocation**: The 5-strategy relocation pipeline (`batchRelocateAnchors`) runs in the GET handler, not the client — keeps the SPA thin.
- **Maximum pipeline-core reuse**: `createAnchorData`, `batchRelocateAnchors`, `groupCommentsByAllCoveredLines`, `getHighlightColumnsForLine`, `applyCommentHighlightToRange` are all consumed directly from `@plusplusoneplusplus/pipeline-core`.

## Conventions
- Comment types use `TaskComment` from `task-comments-types.ts`, not `MarkdownComment` from pipeline-core
- Rendering uses `data-line` attributes (1-based) on `<div class="md-line">` elements
- Highlight spans use `<span class="commented-text" data-comment-id="...">` (matching VS Code extension CSS class)
