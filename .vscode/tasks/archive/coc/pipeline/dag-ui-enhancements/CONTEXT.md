# Context: DAG UI Enhancements

## User Story
Users viewing the Pipeline Flow Preview diagram (Input → Map → Reduce) cannot instinctively understand the workflow. The current diagram shows labeled boxes with arrows but lacks data flow details, validation feedback, execution progress, and interactive exploration. The user wants hovering on nodes to reveal content, plus additional features that make the pipeline's behavior immediately obvious.

## Goal
Enhance the Pipeline Flow Preview in the SPA with rich hover tooltips, data flow annotations, validation error pins, execution feedback, and navigation controls so users instinctively understand the workflow without reading the YAML.

## Commit Sequence
1. Visual Context Layer (legend, breadcrumb, parallel indicator)
2. Rich Hover Tooltips (phase-specific details on node hover)
3. Edge Data Annotations (data shape badges, schema preview on edges)
4. Validation Error Pins (red markers on misconfigured nodes)
5. Execution Feedback Enhancements (duration overlay, animated particles)
6. Zoom and Pan (mouse wheel zoom, drag to pan, controls)

## Dependency Flow
- 001, 002, 006 can start in parallel
- 003 depends on 002 (uses config data piping)
- 004, 005 depend on 001 (node/edge base changes)

## Key Decisions
- All changes target SPA React components in `packages/coc/src/server/spa/`
- Tooltips use HTML positioned outside SVG (portal pattern), not SVG foreignObject
- Hover tooltips (static config data) coexist with click popovers (live execution data)
- Edge particles use SVG `<animateMotion>` for simplicity
- Zoom/pan via a reusable `useZoomPan` hook with `<g transform>`

## Conventions
- Tailwind CSS for styling, dark mode via `dark:` prefix
- Vitest for testing, `data-testid` attributes for test selectors
- Colors from `dag-colors.ts` — no new color constants
- Props drilled through component hierarchy (no context/store)
