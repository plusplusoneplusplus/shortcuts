# Context: Pipeline DAG Visualization

## User Story
As a CoC dashboard user running YAML AI pipelines, I want to see a visual DAG flowchart of my pipeline's stages (input → filter → map → reduce) with live status coloring, so I can immediately understand execution progress, data flow between phases, and failure locations — without mentally reconstructing the pipeline topology from flat process lists.

## Goal
Add an inline, collapsible DAG visualization to the ProcessDetail view in the CoC SPA dashboard that renders pipeline phases as an SVG flowchart with live status coloring, progress bars, and interactive phase detail popovers.

## Commit Sequence
1. Pipeline Phase Types & ProcessOutputEvent Extension
2. Pipeline Executor Phase Emission
3. SSE Pipeline Event Relay & Client Handling
4. Static DAG Visualization Components
5. Live DAG Updates via SSE
6. Node Interaction — Phase Popovers, Tooltips & Scroll-to-Error

## Key Decisions
- Custom React SVG over Mermaid — avoids flicker on live updates; the DAG is always linear (max 4 nodes)
- Phase events flow: executor → onPhaseChange callback → store.emitProcessEvent → SSE handler → client addEventListener
- The filter node is omitted (not greyed out) when the pipeline YAML has no filter section
- Single-job pipelines render a single centered "Job" node
- Progress updates throttled at 250ms to prevent excessive re-renders
- Phase detail is an inline expanding panel (not a modal/portal), following ToolCallView's pattern

## Conventions
- SPA React components in `packages/coc/src/server/spa/client/react/processes/dag/`
- Vitest + @testing-library/react with jsdom for SPA tests
- Reuse Badge color palette for status coloring (light + dark variants)
- Use `cn()` utility for Tailwind class merging
- Follow existing `useRef<SVGSVGElement>` pattern from WikiGraph.tsx for SVG rendering
