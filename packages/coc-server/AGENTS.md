# coc-server — Developer Reference

HTTP/WebSocket server powering the AI Execution Dashboard and wiki serving. Published as `@plusplusoneplusplus/coc-server`.

## Package Structure

```
packages/coc-server/
├── src/
│   ├── index.ts              # Barrel exports (public API)
│   ├── types.ts              # Core types: ExecutionServerOptions, ExecutionServer, Route, etc.
│   ├── router.ts             # Main HTTP router — dispatches to API, static, SPA
│   ├── git-cache.ts          # In-memory GitCacheService for git API responses
│   ├── api-handler.ts        # Process/queue REST API: CRUD, git detection, pipeline discovery
│   ├── admin-handler.ts      # Admin endpoints with time-limited confirmation tokens
│   ├── data-wiper.ts         # DataWiper — deletes processes, queue files, blobs, preferences
│   ├── data-exporter.ts      # exportAllData — serializes all CoC data
│   ├── data-importer.ts      # importData — restores CoCExportPayload
│   ├── preferences-handler.ts # User preferences persistence (~/.coc/preferences.json)
│   ├── sse-handler.ts        # SSE streaming for individual process output
│   ├── websocket.ts          # ProcessWebSocketServer: real-time process/queue events
│   ├── errors.ts             # Centralized APIError class and factory helpers
│   ├── export-import-types.ts # Export/import schema, validation
│   ├── repo-utils.ts         # Git root detection, repo ID extraction
│   ├── server-logger.ts      # Pino logger injection
│   ├── image-utils.ts        # Decode base64 data-URL images to temp files
│   ├── suggest-follow-ups-tool.ts # Factory for `suggest_follow_ups` AI tool
│   ├── skill-handler.ts      # Per-workspace skill REST API
│   ├── global-skill-handler.ts # Global skill REST API
│   ├── task-types.ts         # Domain payload types and guards
│   ├── openapi.yaml          # OpenAPI 3.1 spec
│   ├── queue/                # Queue persistence and image blob store
│   ├── shared/               # Low-level router primitives
│   ├── repos/                # Repository file-explorer subsystem
│   ├── memory/               # Memory subsystem (entries, config, observations, tool-call cache)
│   ├── spa/                  # SPA dashboard client assets
│   └── wiki/                 # Wiki serving module (AI Q&A, explore, generate, deep-wiki integration)
├── test/                     # 46+ Vitest test files
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

## Architecture

### Execution Server Layer

- **api-handler.ts** — Process CRUD, queue management (`/api/processes`, `/api/queue/*`), child process retrieval (`/api/processes/:id/children`), git remote detection, git commit history (`/api/workspaces/:id/git/commits`, `/git/commits/:hash/files`, `/git/commits/:hash/diff`, `/git/commits/:hash/files/:path/content`), branch range analysis (`/api/workspaces/:id/git/branch-range`, `/branch-range/files`, `/branch-range/diff`, `/branch-range/files/:path/diff`), branch listing and status (`/api/workspaces/:id/git/branches` GET, `/git/branch-status`), branch CRUD (`/git/branches` POST create, `/git/branches/switch` POST, `/git/branches/rename` POST, `/git/branches/:name` DELETE) via `BranchService`, async git pull (`POST /git/pull` returns 202 with `jobId`, runs pull in background via `GitOpsStore`), git ops status (`GET /git/ops/latest?op=pull`, `GET /git/ops/:jobId`), pipeline discovery, directory browsing. Git endpoints for commits, commit-files, commit-diff, commit-file content, and branch-range use `GitCacheService` — mutable data invalidated via `?refresh=true`, immutable hash-keyed data cached forever. Exports `QueueExecutorBridge` for connecting queue to pipeline execution. `parseQueryParams` supports `parentProcessId` filter for child process queries. Registers `skill-handler.ts` (per-workspace `/api/workspaces/:id/skills/*`) and `global-skill-handler.ts` (global `/api/skills/*` and merged `/api/workspaces/:id/skills/all`).
- **admin-handler.ts** — Destructive operations (data wipe, export, import) guarded by time-limited crypto tokens. Delegates to `DataWiper`, `exportAllData`, and `importData`. `getQueuePersistence` option allows queue state to be restored after import.
- **preferences-handler.ts** — JSON file persistence for UI preferences at `~/.coc/preferences.json`.
- **websocket.ts** — `ProcessWebSocketServer` broadcasts process lifecycle, queue, and comment events. Supports workspace-scoped filtering and file subscriptions.
- **sse-handler.ts** — Per-process SSE streaming (`/api/processes/:id/stream`).
- **router.ts** — Dispatches incoming requests using `shared/router.ts` primitives.
- **errors.ts** — `APIError` class with helpers: `badRequest`, `notFound`, `forbidden`, `invalidJSON`, `missingFields`, `internalError`, `conflict`.

### Wiki Serving Layer (`wiki/`)

- **WikiManager** — Registry of active wikis. Each wiki gets a `WikiData`, `ContextBuilder`, `ConversationSessionManager`, and `FileWatcher`.
- **ContextBuilder** — Builds RAG-style context from wiki articles. `tokenize()` splits text for relevance scoring.
- **ConversationSessionManager** — Manages stateful AI sessions per wiki for multi-turn conversations.
- **dw-\* handlers** — Deep-wiki-specific wrappers: `dw-generate-handler.ts` orchestrates the six-phase pipeline; `dw-config-loader.ts` reads `deep-wiki.config.yaml`; `dw-admin-handlers.ts` handles wiki registration and cache management.

## Public API

The package exports from `src/index.ts`:
- **Types**: `ExecutionServerOptions`, `ExecutionServer`, `Route`, `BulkQueueRequest`, `BulkQueueResponse`, `ExportMetadata`, `UserPreferences`, `FollowUpSuggestion`, etc.
- **Task Types** (from `task-types.ts`): `TaskType` (`'chat' | 'run-workflow' | 'run-script'`), `ChatMode` (`'ask' | 'plan' | 'autopilot'`), `ChatContext`, `ChatPayload`, `RunWorkflowPayload`, `RunScriptPayload`, guards (`isChatPayload`, `hasTaskGenerationContext`, `hasResolveCommentsContext`, `hasReplicationContext`)
- **Tools**: `createSuggestFollowUpsTool` — factory for a `suggest_follow_ups` custom tool (passthrough handler, 2–3 follow-up questions)
- **Router**: `createRequestHandler`, `readJsonBody`, `sendJson`, `send404`, `send400`, `send500`; shared: `createRouter`, `serveStaticFile`, `readBody`
- **API**: `registerApiRoutes`, `sendJSON`, `sendError`, `parseBody`, `QueueExecutorBridge`
- **Admin**: `registerAdminRoutes`, `DataWiper`, `exportAllData`, `importData`
- **Queue Persistence**: `QueuePersistence`, `getRepoQueueFilePath`, `ImageBlobStore`, `PersistedQueueState`
- **WebSocket**: `ProcessWebSocketServer`, `toProcessSummary`, `toCommentSummary`
- **SSE**: `handleProcessStream`
- **Errors**: `APIError`, `handleAPIError`, `badRequest`, `notFound`, etc.
- **Server Logger**: `setServerLogger`, `getServerLogger`, `createRequestLogger`, `createWSLogger`, `createQueueLogger` — Pino logger injection
- **Image Utils**: `parseDataUrl`, `saveImagesToTempFiles`, `cleanupTempDir`
- **Git Cache**: `GitCacheService`, `gitCache` — in-memory cache for git API responses
- **Skills**: `registerSkillRoutes`, `sortSkillsByUsage` (per-workspace), `registerGlobalSkillRoutes` (global)
- **Repos**: `RepoInfo`, `TreeEntry`, `TreeListResult`, `RepoTreeService`, `registerRepoRoutes` — file explorer API
- **Export/Import**: `EXPORT_SCHEMA_VERSION`, `validateExportPayload`
- **Repo Utils**: `extractRepoId`, `findGitRoot`, `normalizeRepoPath`, `getWorkingDirectory`
- **Wiki** (via `wiki/index.ts`): `WikiData`, `WikiManager`, `ContextBuilder`, `ConversationSessionManager`, `FileWatcher`, route handlers, WebSocket

## Configuration

- `ExecutionServerOptions` — port (default 4000), host, dataDir (`~/.coc/`), theme, wiki options, AI service injection
- `WikiServerOptions` — enabled flag, initial wiki registrations, AI feature toggle
- Preferences stored at `~/.coc/preferences.json`
- Wiki config loaded from `deep-wiki.config.yaml` via `dw-config-loader.ts`

## Dependencies

- `@plusplusoneplusplus/pipeline-core` — ProcessStore, CopilotSDKService, TaskQueueManager, defineTool
- `ws` — WebSocket server
- `pino` — Structured JSON logger (injected via `server-logger.ts`)
- `js-yaml` — YAML config parsing

## Testing

46 Vitest test files plus helpers covering: error factories, export/import validation, repo utilities, server scaffold, SSE replay, SSE concurrent sessions, SSE reconnect, SSE token usage, SSE pipeline/item events, WebSocket file subscriptions, WebSocket git-changed events, shared router, git commit API endpoints, git branch range API endpoints, git branch listing/status/CRUD API endpoints, git cache unit and integration tests, git working-tree diff, child process API routes, **queue persistence restore/save**, **data wiper dry-run and wipe operations**, server logger injection, image utilities, suggest-follow-ups tool, skill handler (per-workspace and global), task types and guards, swagger/OpenAPI routes, memory subsystem (routes, store, config, tool-call aggregation), request logging, parse-body, normalize-remote-url, wiki router utils, MCP config API, skills config API, API handler batch/images/summaries.

Run with `npm run test:run` in `packages/coc-server/`.

## See Also

- `packages/pipeline-core/AGENTS.md` — AI SDK and process storage
- `packages/coc/AGENTS.md` — CoC CLI (consumes this package)
- `packages/deep-wiki/AGENTS.md` — Wiki generator (wiki served by this package)
