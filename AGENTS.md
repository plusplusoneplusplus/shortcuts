# AGENTS.md

Guidance for AI agents working in this repository. NEVER create document files unless explicitly asked.

## Monorepo Overview

Three products plus shared infrastructure, all in one npm workspaces monorepo:

| Product | Location | Runtime | Description |
|---------|----------|---------|-------------|
| **VS Code Extension** | `src/` | VS Code | Markdown review, git diff review, code review, shortcut groups, global notes, tasks viewer, YAML pipelines |
| **CoC CLI** | `packages/coc/` | Node.js | CLI for executing YAML-based AI pipelines (`coc run\|validate\|list\|serve\|wipe-data`) |
| **Deep Wiki** | `packages/deep-wiki/` | Node.js | CLI that auto-generates comprehensive wikis for codebases (`deep-wiki seeds\|discover\|generate\|theme\|init`) |

| Shared Package | Location | Description |
|----------------|----------|-------------|
| **pipeline-core** | `packages/pipeline-core/` | Core AI/pipeline engine: AI SDK (CopilotSDKService, session pool), map-reduce framework, YAML pipeline executor, task queue, runtime policies, process store, git CLI, utilities |
| **coc-server** | `packages/coc-server/` | HTTP/WebSocket server: REST API, SSE streaming, SPA dashboard, wiki serving, process store at `~/.coc/` |

**Key architectural boundary:** Pure Node.js logic lives in packages (no VS Code deps). VS Code-specific wrappers live in `src/shortcuts/`. Example: `pipeline-core/src/ai/` = pure AI SDK; `src/shortcuts/ai-service/` = VS Code UI wrapper.

## Build & Test

- **Build all:** `npm run build` · **Build extension:** `npm run compile` · **Watch:** `npm run watch`
- **Test all:** `npm run test` (extension Mocha tests, 6900+)
- **Test packages:** `npm run test:run` in any package directory (Vitest)
- **Lint:** `npm run lint` · **Package:** `npm run vsce:package` · **Publish:** `npm run vsce:publish`
- **Debug CoC:** `cd packages/coc && npm run build && npm link && cd ../..` then `coc run <path>` or `coc serve --no-open`
- **Debug Deep Wiki:** `cd packages/deep-wiki && npm run build && npm link && cd ../..` then `deep-wiki generate <repo>`

## VS Code Extension (`src/`)

Entry point: `src/extension.ts`. Feature modules under `src/shortcuts/`:

- **markdown-comments** — Custom Editor API for inline markdown review. Comments in `.vscode/comments/<hash>.json`.
- **git-diff-comments** — Git diff review with comment categories and resolve/reopen workflow.
- **code-review** — Review commits against rules in `.github/cr-rules/*.md`.
- **yaml-pipeline** — Pipeline management UI. Pipelines are directories with `pipeline.yaml` under `.vscode/pipelines/`.
- **tasks-viewer** — Hierarchical task management in `.vscode/tasks/`. Recursive scanning, document grouping by suffix (plan/spec/test/notes/todo/design/impl/review/checklist/requirements/analysis).
- **ai-service** — VS Code AI wrapper: `AIProcessManager` (Memento persistence), `AIQueueService`, `CopilotCLIInvoker`. Working dir defaults to `{workspace}/src` if exists.
- **git** — VS Code git layer wrapping `pipeline-core/src/git/`.
- **skills** — Install skills from GitHub repos or local dirs to `.github/skills`.
- **shared** — Base classes: `BaseTreeDataProvider`, `FilterableTreeDataProvider`, icon/filter/error utilities.

**Configuration:** `.vscode/shortcuts.yaml` with `basePaths` (aliases like `@frontend`), `logicalGroups` (nested, items of type file/folder/command/task/note), `globalNotes`. Versioned migration system (v1→v4) in `config-migrations.ts`.

**MCP/Permissions:** `SendMessageOptions` supports `availableTools` (whitelist), `excludedTools` (blacklist), `mcpServers`, `onPermissionRequest`. MCP config auto-loaded from `~/.copilot/mcp-config.json` for every session (opt out with `loadDefaultMcpConfig: false` or `mcpServers: {}`). Without `onPermissionRequest`, operations are denied by default.

## CoC CLI (`packages/coc/`)

Standalone CLI for YAML AI pipelines. Consumes `pipeline-core` and `coc-server`.

**Commands:** `coc run <path>` (execute pipeline), `coc validate <path>`, `coc list [dir]`, `coc serve` (AI dashboard + wiki serving), `coc wipe-data`.

**Key `run` flags:** `-m` model, `-p` parallel, `-o` output format (table/json/csv/markdown), `-f` output file, `--param key=value`, `--dry-run`, `--approve-permissions`, `--timeout`, `-v` verbose.

**Key `serve` flags:** `-p` port (default 4000), `-H` host, `-d` data-dir (`~/.coc`), `--theme`, `--no-open`.

**Configuration:** `~/.coc/config.yaml` (legacy: `~/.coc.yaml`). CLI flags > config file > defaults. Exit codes: 0=success, 1=error, 2=config, 3=AI unavailable, 130=SIGINT.

**Architecture:** `src/cli.ts` (Commander setup) → `src/commands/` (run, validate, list, serve, wipe-data) → `src/server/` (HTTP router, API handler, WebSocket, SSE, queue, scheduling, tasks, wiki integration, SPA dashboard).

**Testing:** 114+ Vitest test files covering CLI, commands, server handlers, queue, wiki, SPA, e2e.

## Deep Wiki (`packages/deep-wiki/`)

CLI that generates comprehensive wikis via a six-phase AI pipeline. Consumes `pipeline-core`.

**Commands:** `deep-wiki seeds <repo>` (theme seeds), `deep-wiki discover <repo>` (Phase 1 only), `deep-wiki generate <repo>` (full pipeline), `deep-wiki theme <repo> [name]` (cross-cutting theme articles), `deep-wiki init` (template config).

**Six-Phase Pipeline:**
1. **Seeds** (optional) — AI identifies key themes/domains. Heuristic fallback from directory names.
2. **Discovery** — AI with MCP tools produces `ComponentGraph` JSON. Large repo support (3000+ files): multi-round or iterative breadth-first using seeds.
3. **Consolidation** — Rule-based + AI clustering to merge/refine components. Skip with `--no-cluster`.
4. **Analysis** — Per-component deep analysis with MCP tools. Incremental via git-hash caching.
5. **Writing** — Article generation + reduce/synthesis for overviews.
6. **Website** — Static HTML with themes (light/dark/auto), Mermaid zoom/pan support.

**Key concepts:** Components (smallest code unit, always present), Domains (top-level dirs, large repos only), Themes (cross-cutting concerns spanning components).

**Theme pipeline:** `deep-wiki theme` runs: Probe → Outline → Analysis → Articles → Wiki Integration (updates `module-graph.json`, cross-links).

**Key flags:** `--output`, `--model`, `--concurrency`, `--depth` (shallow/normal/deep), `--seeds` (auto or file), `--phase` (start from N), `--force`, `--use-cache`, `--skip-website`, `--no-cluster`.

**Caching:** `.wiki-cache/` with git-hash invalidation. Per-phase: seeds, probes, discovery, consolidation, analysis, articles. `--force` bypasses; `--use-cache` ignores hash.

**Testing:** 64 Vitest test files covering all phases, theme module, cache, commands, rendering.

## pipeline-core (`packages/pipeline-core/`)

Pure Node.js AI engine — no VS Code deps. Published as `@plusplusoneplusplus/pipeline-core`.

**Key modules:** Logger (pluggable), Errors (`PipelineCoreError` with codes), Runtime policies (timeout/retry/cancellation via `runWithPolicy`), Task queue (`TaskQueueManager` + `QueueExecutor`), AI SDK (`CopilotSDKService`, session pool, MCP config, model registry), Map-reduce (executor, splitters, reducers, concurrency limiter), Pipeline (YAML executor, CSV reader, template engine, filters), Process store (`FileProcessStore` — JSON persistence, atomic writes, 500-process retention), Git CLI (`@plusplusoneplusplus/pipeline-core/git` subpath), Editor (anchor, parsing, rendering), Tasks (scanner, parser, operations), Memory (see below), Utilities (file I/O, glob, HTTP, text matching, AI response parsing, template engine).

**YAML Pipeline phases:** input (CSV) → optional filter (rule/ai/hybrid) → map (parallel AI, optional `batchSize` + `{{ITEMS}}`) → reduce (list/table/json/csv/ai). Filter operators: equals, not_equals, in, not_in, contains, not_contains, greater_than, less_than, gte, lte, matches.

**Testing:** 61 Vitest test files.

## coc-server (`packages/coc-server/`)

HTTP/WebSocket server for AI dashboard and wiki serving. Published as `@plusplusoneplusplus/coc-server`.

**Execution layer:** Process CRUD API, queue management, admin (time-limited crypto tokens for destructive ops), preferences (`~/.coc/preferences.json`), WebSocket (workspace-scoped events, file subscriptions), SSE per-process streaming, export/import.

**Wiki layer:** `WikiManager` registry, `WikiData` in-memory store, `ContextBuilder` (RAG-style retrieval), `ConversationSessionManager` (multi-turn AI), `FileWatcher`, deep-wiki integration (`dw-*` handlers for generation/exploration/ask).

**Memory layer:** `FileMemoryStore` (entry CRUD with `id`, `tags`, `summary`, `source` fields), `MemoryConfig` (`storageDir`, `backend`, `maxEntries`, `ttlDays`, `autoInject`). REST API registered by `registerMemoryRoutes()`: `GET/PUT /api/memory/config`, `GET/POST /api/memory/entries`, `GET/PATCH/DELETE /api/memory/entries/:id`, `GET /api/memory/aggregate-tool-calls/stats`, `POST /api/memory/aggregate-tool-calls`. Dashboard UI: `MemoryView` → `MemoryEntriesPanel` + `MemoryConfigPanel` + `ExploreCachePanel`.

**Testing:** 7+ Vitest test files.

## Memory System (`packages/pipeline-core/src/memory/`)

Opt-in, two-level persistence layer that lets AI pipelines learn from past sessions. After each AI call the AI writes `write_memory` tool calls; those facts are periodically consolidated by an AI aggregation step into `consolidated.md`, which is injected into subsequent prompts.

**Storage layout:** `~/.coc/memory/system/` (cross-repo) and `~/.coc/memory/repos/<16-char-sha256>/` (per-repo), each with `raw/*.md`, `consolidated.md`, `index.json`.

**Key symbols in `pipeline-core`:**

| Symbol | Role |
|--------|------|
| `MemoryStore` (interface) | Full CRUD contract |
| `FileMemoryStore` | File-backed impl; atomic tmp→rename writes; write-queue serialization |
| `MemoryRetriever` | Loads `consolidated.md` → formats markdown context block for prompt injection |
| `createWriteMemoryTool()` | Factory returning an AI-callable `write_memory` tool + `getWrittenFacts()` accessor |
| `MemoryAggregator` | Batch-threshold check; triggers AI consolidation when `rawCount >= 5` |
| `withMemory()` | One-liner orchestrator: retrieve → inject tool → invoke AI → aggregate |

**Tool Call Cache** (secondary subsystem in same folder): `ToolCallCapture`, `FileToolCallCacheStore`, `ToolCallCacheAggregator`, `ToolCallCacheRetriever`, `withToolCallCache()` — caches AI tool call Q&A pairs for replay/reuse across runs.

**Integration:** Features opt in by wrapping AI calls with `withMemory()`. Wiki Ask/Explore handlers in coc-server combine TF-IDF context + memory context. Config precedence: CLI flag > pipeline YAML `memory:` field > `~/.coc/config.yaml` > default (disabled).

**Implementation status:** Core pipeline-core modules, server routes, and dashboard UI are complete. CLI `coc memory` subcommands and pipeline YAML `memory:` wiring are not yet implemented.

## Development Notes

- TypeScript, webpack bundling, VS Code API ≥ 1.95.0
- Format on save and import organization enabled
- Tree data providers: extend `BaseTreeDataProvider` or `FilterableTreeDataProvider`
- Commands registered centrally in `src/shortcuts/commands.ts`
- Cross-platform: Linux, macOS, Windows
