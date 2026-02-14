---
status: pending
---

# 018: Implement Web Dashboard

## Summary
Build a lightweight web dashboard that visualizes DAG structures, run status, task timelines, and operational metrics — served by the API server from commit 017.

## Motivation
Airflow's web UI is its primary operational interface. While VS Code provides some visibility, a standalone dashboard enables operations teams to monitor pipelines without needing VS Code installed. This commit provides a self-contained dashboard built with vanilla HTML/CSS/JS (no build step required).

## Changes

### Files to Create
- `packages/pipeline-core/src/api/dashboard/` — Dashboard static files:
  - `index.html` — SPA shell with navigation (DAGs, Runs, Metrics, Pools)
  - `styles.css` — Dashboard styling (dark/light theme, responsive)
  - `app.js` — Main application:
    - Router (hash-based)
    - API client (fetch wrapper)
    - SSE connection for real-time updates
  - `views/`:
    - `dag-list.js` — DAG list with status indicators, pause/unpause toggle
    - `dag-detail.js` — DAG graph visualization (SVG-based), recent runs
    - `run-detail.js` — Task instance list with status, duration, logs link
    - `gantt-chart.js` — Gantt chart of task execution timeline (like Airflow)
    - `metrics-view.js` — Key metrics with mini charts
    - `pool-view.js` — Pool utilization bars
  - `components/`:
    - `dag-graph.js` — SVG DAG renderer (nodes as boxes, edges as arrows)
    - `status-badge.js` — Colored status indicator
    - `duration-format.js` — Human-readable duration formatting
    - `auto-refresh.js` — Periodic refresh with SSE updates
- `packages/pipeline-core/src/api/dashboard-handler.ts` — Serves static dashboard files:
  - Embedded as strings in the JS bundle (no external file serving needed)
  - `GET /dashboard/*` routes serve HTML/CSS/JS
  - `GET /` redirects to `/dashboard/`

### Files to Modify
- `packages/pipeline-core/src/api/server.ts` — Mount dashboard handler alongside API routes
- `packages/pipeline-core/src/api/routes/health-routes.ts` — Add dashboard availability indicator

## Implementation Notes
- Dashboard is vanilla HTML/CSS/JS — no React, no build step, no node_modules
- Static files are embedded as template strings in `dashboard-handler.ts` (like deep-wiki's SPA template approach)
- DAG graph rendering uses inline SVG — nodes positioned via simple layered layout algorithm (topological layers → horizontal spread)
- Gantt chart renders as horizontal bars with time scale — CSS-based positioning
- SSE provides real-time updates — task status changes reflect immediately without polling
- Dark/light theme via CSS custom properties + media query (`prefers-color-scheme`)
- Responsive layout: works on desktop and tablet
- Dashboard is optional — API server can be started without it (`serveDashboard: false`)
- Total bundle size target: <50KB (no external libraries)

## Tests
- `packages/pipeline-core/test/api/dashboard-handler.test.ts`:
  - Dashboard root serves HTML with correct content-type
  - CSS file served with correct content-type
  - JS file served with correct content-type
  - Unknown dashboard path returns 404
- Manual testing checklist (documented in plan, not automated):
  - DAG list loads and shows all DAGs
  - DAG detail shows graph visualization
  - Run detail shows task instances
  - Gantt chart renders correctly
  - SSE updates reflect in real-time
  - Dark/light theme toggles work

## Acceptance Criteria
- [ ] Dashboard serves from API server without additional setup
- [ ] DAG list shows all registered DAGs with status
- [ ] DAG graph visualizes task dependencies as nodes/edges
- [ ] Run detail shows task instances with status and duration
- [ ] Gantt chart shows task execution timeline
- [ ] SSE provides real-time updates
- [ ] No external JavaScript dependencies (vanilla JS only)
- [ ] Dark/light theme support
- [ ] Existing tests pass

## Dependencies
- Depends on: 017
