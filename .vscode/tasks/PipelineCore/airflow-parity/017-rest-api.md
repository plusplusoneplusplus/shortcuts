---
status: pending
---

# 017: Implement REST API Server

## Summary
Build a lightweight HTTP REST API that exposes DAG management, run history, trigger/cancel operations, and real-time status — enabling external tools, dashboards, and CI/CD integration.

## Motivation
Airflow's REST API enables programmatic interaction from CI/CD pipelines, monitoring tools, and custom UIs. Without an API, all interaction must happen through CLI or VS Code extension. This commit provides a standalone HTTP server that can run alongside the scheduler.

## Changes

### Files to Create
- `packages/pipeline-core/src/api/server.ts` — `APIServer` class:
  - Lightweight HTTP server using Node.js built-in `http` module (no Express dependency)
  - JSON body parsing, CORS headers, basic routing
  - `start(port)` / `stop()` lifecycle
- `packages/pipeline-core/src/api/routes/` — Route handlers:
  - `dag-routes.ts`:
    - `GET /api/v1/dags` — List all DAGs
    - `GET /api/v1/dags/:dagId` — Get DAG details
    - `PATCH /api/v1/dags/:dagId` — Update DAG (pause/unpause)
  - `run-routes.ts`:
    - `GET /api/v1/dags/:dagId/runs` — List runs (with query params for filtering)
    - `POST /api/v1/dags/:dagId/runs` — Trigger new run
    - `GET /api/v1/dags/:dagId/runs/:runId` — Get run details + task instances
    - `DELETE /api/v1/dags/:dagId/runs/:runId` — Cancel run
    - `POST /api/v1/dags/:dagId/runs/:runId/retry` — Retry failed tasks
  - `task-routes.ts`:
    - `GET /api/v1/dags/:dagId/runs/:runId/tasks` — List task instances
    - `GET /api/v1/dags/:dagId/runs/:runId/tasks/:taskId` — Task instance details
    - `GET /api/v1/dags/:dagId/runs/:runId/tasks/:taskId/xcom` — Get XCom values
  - `stats-routes.ts`:
    - `GET /api/v1/dags/:dagId/stats` — DAG statistics
    - `GET /api/v1/metrics` — Current metrics snapshot
  - `health-routes.ts`:
    - `GET /api/v1/health` — Health check (scheduler status, uptime)
    - `GET /api/v1/version` — API version info
  - `pool-routes.ts`:
    - `GET /api/v1/pools` — List pools with status
    - `POST /api/v1/pools` — Create pool
    - `PATCH /api/v1/pools/:name` — Update pool slots
- `packages/pipeline-core/src/api/middleware.ts` — Request middleware:
  - JSON body parser
  - CORS headers
  - Request logging
  - Error handler (maps errors to HTTP status codes)
- `packages/pipeline-core/src/api/sse.ts` — Server-Sent Events:
  - `GET /api/v1/events` — Real-time event stream (task state changes, run completions)
  - Reuses event emitter from 003
- `packages/pipeline-core/src/api/types.ts` — API types:
  - `APIServerOptions`: port, persistenceProvider, scheduler?, metricsCollector?, corsOrigins?
  - Request/response DTOs for each endpoint
- `packages/pipeline-core/src/api/index.ts` — Barrel export

### Files to Modify
- `packages/pipeline-core/src/index.ts` — Export API module

## Implementation Notes
- Uses Node.js built-in `http` module — NO Express, Koa, or Fastify dependency (keeps pipeline-core dependency-free)
- Simple route matching: split URL path, match against registered patterns
- SSE (Server-Sent Events) for real-time updates — simpler than WebSocket, works everywhere
- All responses are JSON with consistent `{ data, error?, meta? }` envelope
- HTTP status codes follow REST conventions: 200 OK, 201 Created, 404 Not Found, 409 Conflict, 500 Internal Error
- API server is optional — scheduler works without it
- Default port: 8080 (configurable)
- CORS configured for localhost by default (for local dashboard development)

## Tests
- `packages/pipeline-core/test/api/server.test.ts`:
  - Server starts and stops cleanly
  - Health endpoint returns correct data
  - 404 for unknown routes
- `packages/pipeline-core/test/api/dag-routes.test.ts`:
  - List DAGs returns registered DAGs
  - Pause/unpause DAG
- `packages/pipeline-core/test/api/run-routes.test.ts`:
  - Trigger run returns run ID
  - List runs with filtering
  - Cancel run marks as cancelled
  - Retry re-queues failed tasks
- `packages/pipeline-core/test/api/sse.test.ts`:
  - SSE connection receives task state change events

## Acceptance Criteria
- [ ] All CRUD endpoints work correctly
- [ ] Run trigger/cancel works via API
- [ ] SSE provides real-time event stream
- [ ] Error responses use consistent format
- [ ] No external HTTP framework dependencies
- [ ] Health endpoint reports scheduler status
- [ ] API server is optional (doesn't affect core execution)
- [ ] Existing tests pass

## Dependencies
- Depends on: 004, 008, 011, 013, 016
