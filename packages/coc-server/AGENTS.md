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
│   ├── admin-handler.ts      # Admin endpoints: data wipe with time-limited confirmation tokens
│   ├── preferences-handler.ts # User preferences persistence (~/.coc/preferences.json)
│   ├── sse-handler.ts        # SSE streaming for individual process output
│   ├── websocket.ts          # ProcessWebSocketServer: real-time process/queue events
│   ├── errors.ts             # Centralized APIError class and factory helpers
│   ├── export-import-types.ts # Export/import schema, validation, CoCExportPayload
│   ├── repo-utils.ts         # Git root detection, repo ID extraction, path normalization
│   ├── shared/
│   │   └── router.ts         # Low-level router primitives (createRouter, serveStaticFile, readBody)
│   ├── spa/
│   │   └── client/           # SPA dashboard client assets (compiled)
│   └── wiki/                 # Wiki serving module
│       ├── index.ts          # Barrel exports for wiki sub-module
│       ├── types.ts          # Wiki domain types: ComponentGraph, ComponentAnalysis, ThemeMeta
│       ├── dw-types.ts       # Deep-wiki pipeline types (ArticleType, GenerateOptions, etc.)
│       ├── router.ts         # Wiki-specific HTTP router (API + static file serving)
│       ├── wiki-routes.ts    # Register wiki REST endpoints on a parent router
│       ├── wiki-manager.ts   # Per-wiki runtime lifecycle (WikiData, ContextBuilder, FileWatcher)
│       ├── wiki-data.ts      # In-memory wiki data store (components, articles, themes)
│       ├── context-builder.ts # RAG-style context retrieval with tokenization
│       ├── conversation-session-manager.ts # Manages AI conversation sessions per wiki
│       ├── file-watcher.ts   # Watches wiki output directory for changes, triggers reload
│       ├── ask-handler.ts    # POST /api/wiki/:id/ask — conversational AI Q&A with SSE
│       ├── explore-handler.ts # POST /api/wiki/:id/explore — AI-guided codebase exploration
│       ├── generate-handler.ts # POST /api/wiki/:id/generate — trigger wiki regeneration
│       ├── api-handlers.ts   # General wiki API: components, articles, search, stats
│       ├── admin-handlers.ts # Wiki admin: register/unregister, cache clear
│       ├── websocket.ts      # Wiki-specific WebSocket server (distinct from process WS)
│       ├── dw-ask-handler.ts       # Deep-wiki ask handler (delegates to wiki ask)
│       ├── dw-explore-handler.ts   # Deep-wiki explore handler
│       ├── dw-generate-handler.ts  # Deep-wiki generate handler (six-phase pipeline)
│       ├── dw-admin-handlers.ts    # Deep-wiki admin (register, config, cache)
│       └── dw-config-loader.ts     # Load deep-wiki.config.yaml for wiki settings
├── test/
│   ├── errors.test.ts
│   ├── export-import-types.test.ts
│   ├── git-api.test.ts
│   ├── git-branches-api.test.ts
│   ├── git-branch-range-api.test.ts
│   ├── process-children-api.test.ts
│   ├── repo-utils.test.ts
│   ├── scaffold.test.ts
│   ├── sse-replay.test.ts
│   ├── websocket-file-subscribe.test.ts
│   ├── helpers/
│   │   └── mock-process-store.ts
│   └── shared/
│       └── router.test.ts
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

## Architecture

### Execution Server Layer

- **api-handler.ts** — Process CRUD, queue management (`/api/processes`, `/api/queue/*`), child process retrieval (`/api/processes/:id/children`), git remote detection, git commit history (`/api/workspaces/:id/git/commits`, `/git/commits/:hash/files`, `/git/commits/:hash/diff`), branch range analysis (`/api/workspaces/:id/git/branch-range`, `/branch-range/files`, `/branch-range/diff`, `/branch-range/files/:path/diff`), branch listing and status (`/api/workspaces/:id/git/branches` GET, `/git/branch-status`), branch CRUD (`/git/branches` POST create, `/git/branches/switch` POST, `/git/branches/rename` POST, `/git/branches/:name` DELETE) via `BranchService`, pipeline discovery, directory browsing. Git endpoints for commits, commit-files, commit-diff, and branch-range use `GitCacheService` — mutable data invalidated via `?refresh=true`, immutable hash-keyed data cached forever. Exports `QueueExecutorBridge` for connecting queue to pipeline execution. `parseQueryParams` supports `parentProcessId` filter for child process queries.
- **admin-handler.ts** — Destructive operations (data wipe) guarded by time-limited crypto tokens.
- **preferences-handler.ts** — JSON file persistence for UI preferences at `~/.coc/preferences.json`.
- **websocket.ts** — `ProcessWebSocketServer` broadcasts process lifecycle, queue, and comment events. Supports workspace-scoped filtering and file subscriptions.
- **sse-handler.ts** — Per-process SSE streaming (`/api/processes/:id/stream`).
- **router.ts** — Dispatches incoming requests using `shared/router.ts` primitives.
- **errors.ts** — `APIError` class with helpers: `badRequest`, `notFound`, `forbidden`, `invalidJSON`, `missingFields`, `internalError`.

### Wiki Serving Layer (`wiki/`)

- **WikiManager** — Registry of active wikis. Each wiki gets a `WikiData`, `ContextBuilder`, `ConversationSessionManager`, and `FileWatcher`.
- **ContextBuilder** — Builds RAG-style context from wiki articles. `tokenize()` splits text for relevance scoring.
- **ConversationSessionManager** — Manages stateful AI sessions per wiki for multi-turn conversations.
- **dw-\* handlers** — Deep-wiki-specific wrappers: `dw-generate-handler.ts` orchestrates the six-phase pipeline; `dw-config-loader.ts` reads `deep-wiki.config.yaml`; `dw-admin-handlers.ts` handles wiki registration and cache management.

## Public API

The package exports from `src/index.ts`:
- **Types**: `ExecutionServerOptions`, `ExecutionServer`, `Route`, `BulkQueueRequest`, `BulkQueueResponse`, `ExportMetadata`, `UserPreferences`, `FollowUpSuggestion`, etc.
- **Tools**: `createSuggestFollowUpsTool` — factory for a `suggest_follow_ups` custom tool (passthrough handler, 2–3 follow-up questions)
- **Router**: `createRequestHandler`, `readJsonBody`, `sendJson`, `send404`, `send400`, `send500`; shared: `createRouter`, `serveStaticFile`, `readBody`
- **API**: `registerApiRoutes`, `sendJSON`, `sendError`, `parseBody`, `QueueExecutorBridge`
- **WebSocket**: `ProcessWebSocketServer`, `toProcessSummary`, `toCommentSummary`
- **SSE**: `handleProcessStream`
- **Errors**: `APIError`, `handleAPIError`, `badRequest`, `notFound`, etc.
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
- `js-yaml` — YAML config parsing

## Testing

17 Vitest test files plus helpers covering: error factories, export/import validation, repo utilities, server scaffold, SSE replay, WebSocket file subscriptions, shared router, git commit API endpoints, git branch range API endpoints, git branch listing/status/CRUD API endpoints, git cache unit and integration tests, child process API routes.

Run with `npm run test:run` in `packages/coc-server/`.

## See Also

- `packages/pipeline-core/AGENTS.md` — AI SDK and process storage
- `packages/coc/AGENTS.md` — CoC CLI (consumes this package)
- `packages/deep-wiki/AGENTS.md` — Wiki generator (wiki served by this package)
