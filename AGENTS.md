# AGENTS.md

Guidance for AI agents working in this repository. NEVER create document files unless explicitly asked.

## Key Design Choice (Maintained manually, AI should NEVER update this section)
- CoC:
    - multi-repo support is required. Never design or implement a feature that would break multi-repo scenario. 
    - copilot-sdk wrapper should NEVER add a sendFollowUp method or something similar. copilot-sdk-wrapper layer or above should NEVER try to add keep-alive/session-object cache.
    - Prefer use file path in the prompt instead of expanding the prompt with file's content.

## Monorepo Overview

Three products plus shared infrastructure, all in one npm workspaces monorepo:

| Product | Location | Runtime | Description |
|---------|----------|---------|-------------|
| **VS Code Extension** | `packages/vscode-extension/` | VS Code | Markdown review, git diff review, code review, shortcut groups, global notes, tasks viewer, YAML workflows — **FROZEN: do not modify** |
| **CoC CLI** | `packages/coc/` | Node.js | CLI for executing YAML-based AI workflows (`coc run\|validate\|list\|serve\|wipe-data`) |
| **Deep Wiki** | `packages/deep-wiki/` | Node.js | CLI that auto-generates comprehensive wikis for codebases (`deep-wiki seeds\|discover\|generate\|theme\|init`) |

| Shared Package | Location | Description |
|----------------|----------|-------------|
| **forge** | `packages/forge/` | Core AI/pipeline engine: AI SDK (CopilotSDKService, session-per-request), DAG workflow engine (executeWorkflow, compileToWorkflow), task queue, runtime policies, process store, git CLI, utilities |
| **coc-server** | `packages/coc-server/` | HTTP/WebSocket server: REST API, SSE streaming, SPA dashboard, wiki serving, process store at `~/.coc/`; per-repo data at `~/.coc/repos/<workspaceId>/` |

**Key architectural boundary:** Pure Node.js logic lives in packages (no VS Code deps). VS Code-specific wrappers live in `packages/vscode-extension/src/shortcuts/`. Example: `forge/src/ai/` = pure AI SDK; `packages/vscode-extension/src/shortcuts/ai-service/` = VS Code UI wrapper. **`packages/vscode-extension/` is frozen — do not read, edit, or reason about its code.**

## Build & Test

- **Build all:** `npm run build` · **Build extension:** `npm run compile` · **Watch:** `npm run watch`
- **Test all:** `npm run test` (extension Mocha tests, 6900+)
- **Test packages:** `npm run test:run` in any package directory (Vitest)
- **Lint:** `npm run lint` · **Package:** `npm run vsce:package` · **Publish:** `npm run vsce:publish`
- **Debug CoC:** `cd packages/coc && npm run build && npm link && cd ../..` then `coc run <path>` or `coc serve --no-open`
- **Debug Deep Wiki:** `cd packages/deep-wiki && npm run build && npm link && cd ../..` then `deep-wiki generate <repo>`

## VS Code Extension (`packages/vscode-extension/`) — FROZEN

> ⚠️ **This folder is frozen and no longer actively developed. AI agents must NOT read, edit, or reason about code in `packages/vscode-extension/`. It is not an npm workspace.**

Entry point: `packages/vscode-extension/src/extension.ts`. Feature modules under `packages/vscode-extension/src/shortcuts/`:

- **markdown-comments** — Custom Editor API for inline markdown review. Comments in `.vscode/comments/<hash>.json`.
- **git-diff-comments** — Git diff review with comment categories and resolve/reopen workflow.
- **code-review** — Review commits against rules in `.github/cr-rules/*.md`.
- **yaml-pipeline** — Workflows management UI. Workflows are directories with `pipeline.yaml` under `.vscode/workflows/`.
- **tasks-viewer** — Hierarchical task management in `.vscode/tasks/`. Recursive scanning, document grouping by suffix (plan/spec/test/notes/todo/design/impl/review/checklist/requirements/analysis).
- **ai-service** — VS Code AI wrapper: `AIProcessManager` (Memento persistence), `AIQueueService`, `CopilotCLIInvoker`. Working dir defaults to `{workspace}/src` if exists.
- **git** — VS Code git layer wrapping `forge/src/git/`.
- **skills** — Install skills from GitHub repos or local dirs to `.github/skills`.
- **shared** — Base classes: `BaseTreeDataProvider`, `FilterableTreeDataProvider`, icon/filter/error utilities.

**Configuration:** `.vscode/shortcuts.yaml` with `basePaths` (aliases like `@frontend`), `logicalGroups` (nested, items of type file/folder/command/task/note), `globalNotes`. Versioned migration system (v1→v4) in `config-migrations.ts`.

**MCP/Permissions:** `SendMessageOptions` supports `availableTools` (whitelist), `excludedTools` (blacklist), `mcpServers`, `onPermissionRequest`. MCP config auto-loaded from `~/.copilot/mcp-config.json` for every session (opt out with `loadDefaultMcpConfig: false` or `mcpServers: {}`). Without `onPermissionRequest`, operations are denied by default.

## CoC CLI (`packages/coc/`)

Standalone CLI for YAML AI workflows. Consumes `forge` and `coc-server`.

**Commands:** `coc run <path>` (execute workflow), `coc validate <path>`, `coc list [dir]`, `coc serve` (AI dashboard + wiki serving), `coc wipe-data`.

**Key `run` flags:** `-m` model, `-p` parallel, `-o` output format (table/json/csv/markdown), `-f` output file, `--param key=value`, `--dry-run`, `--approve-permissions`, `--timeout`, `-v` verbose.

**Key `serve` flags:** `-p` port (default 4000), `-H` host, `-d` data-dir (`~/.coc`), `--theme`, `--no-open`.

**Configuration:** `~/.coc/config.yaml` (legacy: `~/.coc.yaml`). CLI flags > config file > defaults. Exit codes: 0=success, 1=error, 2=config, 3=AI unavailable, 130=SIGINT.

**Architecture:** `src/cli.ts` (Commander setup) → `src/commands/` (run, validate, list, serve, wipe-data) → `src/server/` (HTTP router, API handler, WebSocket, SSE, queue, scheduling, tasks, wiki integration, SPA dashboard).

**Testing:** 114+ Vitest test files covering CLI, commands, server handlers, queue, wiki, SPA, e2e.

## Deep Wiki (`packages/deep-wiki/`)

CLI that generates comprehensive wikis via a six-phase AI pipeline. Consumes `forge`.

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

## forge (`packages/forge/`)

Pure Node.js AI engine — no VS Code deps. Published as `@plusplusoneplusplus/forge`.

**Key modules:** Logger (pluggable), Errors (`PipelineCoreError` with codes), Runtime policies (timeout/retry/cancellation via `runWithPolicy`), Task queue (`TaskQueueManager` + `QueueExecutor`), AI SDK (`CopilotSDKService`, session-per-request, MCP config, model registry), Workflow engine (DAG executor, compiler, node executors, concurrency limiter, result adapter), Map-Reduce (`MapReduceExecutor`, splitters, reducers), Pipeline types (YAML config types, CSV reader, template engine, filters), Process store (`FileProcessStore` — JSON persistence, atomic writes, 500-process retention), Git CLI (`@plusplusoneplusplus/forge/git` subpath), Editor (anchor, parsing, rendering), Tasks (scanner, parser, operations), Memory (see below), Templates (commit replication), ADO (Azure DevOps work items + PRs), Skills (scanner, installer, bundled provider), Utilities (file I/O, glob, HTTP, text matching, AI response parsing, template engine).

**Workflow execution:** `compileToWorkflow(yamlContent)` converts legacy pipeline YAML or native workflow YAML to `WorkflowConfig`, then `executeWorkflow(config, options)` runs the DAG. Use `flattenWorkflowResult(result)` for flat display output.

**Testing:** 61 Vitest test files.

## coc-server (`packages/coc-server/`)

HTTP/WebSocket server for AI dashboard and wiki serving. Published as `@plusplusoneplusplus/coc-server`.

**Execution layer:** Process CRUD API, queue management, admin (time-limited crypto tokens for destructive ops), WebSocket (workspace-scoped events, file subscriptions), SSE per-process streaming, export/import.

**Storage layout — `~/.coc/` (top-level, global):**
- `config.yaml` — server configuration
- `processes.json` — cross-repo process store (500-process retention)
- `preferences.json` — global UI preferences (theme, etc.)
- `memory/` — cross-repo and system memory (see Memory System section)
- `skills/` — global skill definitions

**Storage layout — `~/.coc/repos/<workspaceId>/` (per-repo):**
- `queues.json` — queue state
- `schedules.json` — schedule definitions
- `schedule-runs.json` — schedule run history
- `git-ops.json` — background git operations
- `preferences.json` — per-repo UI preferences
- `tasks/` — task and plan files

Use `getRepoDataPath(dataDir, workspaceId, filename)` (exported from `@plusplusoneplusplus/coc-server`) as the canonical helper for building any per-repo file path. Do **not** construct these paths manually.

**Convention — repo-scoped data:** All runtime data that is specific to a single repository must live under `~/.coc/repos/<workspaceId>/`. Do **NOT** add new top-level directories under `~/.coc/` for per-repo data. Use `getRepoDataPath(dataDir, workspaceId, filename)` from `@plusplusoneplusplus/coc-server` to resolve the path.

**Wiki layer:** `WikiManager` registry, `WikiData` in-memory store, `ContextBuilder` (RAG-style retrieval), `ConversationSessionManager` (multi-turn AI), `FileWatcher`, deep-wiki integration (`dw-*` handlers for generation/exploration/ask).

**Memory layer:** `FileMemoryStore` (entry CRUD with `id`, `tags`, `summary`, `source` fields), `MemoryConfig` (`storageDir`, `backend`, `maxEntries`, `ttlDays`, `autoInject`). REST API registered by `registerMemoryRoutes()`: `GET/PUT /api/memory/config`, `GET/POST /api/memory/entries`, `GET/PATCH/DELETE /api/memory/entries/:id`, `GET /api/memory/aggregate-tool-calls/stats`, `POST /api/memory/aggregate-tool-calls`, `GET /api/memory/observations/levels` (3-level overview), `GET /api/memory/observations` (list files at a level), `GET /api/memory/observations/:filename` (read observation). Dashboard UI: `MemoryView` → `MemoryEntriesPanel` + `MemoryFilesPanel` (3-level file browser) + `MemoryConfigPanel` + `ExploreCachePanel`.

**Testing:** 7+ Vitest test files.

## Memory System (`packages/forge/src/memory/`)

Opt-in, two-level persistence layer that lets AI pipelines learn from past sessions. After each AI call the AI writes `write_memory` tool calls; those facts are periodically consolidated by an AI aggregation step into `consolidated.md`, which is injected into subsequent prompts.

**Storage layout:** `~/.coc/memory/system/` (cross-repo), `~/.coc/memory/repos/<16-char-sha256>/` (per-repo), and `~/.coc/memory/git-remotes/<16-char-sha256>/` (per-git-remote), each with `raw/*.md`, `consolidated.md`, `index.json`. `MemoryLevel` = `'repo' | 'system' | 'git-remote' | 'both'`.

**Key symbols in `forge`:**

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

**Implementation status:** Core forge modules, server routes, and dashboard UI are complete. CLI `coc memory` subcommands and pipeline YAML `memory:` wiring are not yet implemented.

## Development Notes

- TypeScript, webpack bundling, VS Code API ≥ 1.95.0
- Format on save and import organization enabled
- Tree data providers: extend `BaseTreeDataProvider` or `FilterableTreeDataProvider`
- Commands registered centrally in `src/shortcuts/commands.ts`
- Cross-platform: Linux, macOS, Windows