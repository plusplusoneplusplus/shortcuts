# Pipeline Core — Developer Reference

Pure Node.js AI pipeline engine. No VS Code dependencies. Published to npm as `@plusplusoneplusplus/forge` (public access, MIT license). Used by CoC CLI and Deep Wiki as a runtime dependency (`^1.0.0`). Requires Node.js ≥ 24.

## Source Layout

| Module | Path | Purpose |
|--------|------|---------|
| **logger** | `src/logger.ts` | Pluggable logger (`setLogger`, `getLogger`, `nullLogger`) with `LogCategory` |
| **errors** | `src/errors/` | `PipelineCoreError` with `ErrorCode` enum, `wrapError`, `toPipelineCoreError` |
| **config** | `src/config/defaults.ts` | Default constants (`DEFAULT_AI_TIMEOUT_MS`, `DEFAULT_PARALLEL_LIMIT`, etc.) |
| **runtime** | `src/runtime/` | `runWithPolicy` (timeout + retry + cancellation), `withTimeout`, `withRetry`, backoff strategies |
| **queue** | `src/queue/` | `TaskQueueManager` (priority queue) + `QueueExecutor` (concurrency control, events) |
| **ai** | `src/ai/` | AI types (`AIInvoker`, `ProcessTracker`, `PromptItem`, `JobProgress`), CLI shell escaping, prompt builder, program utils, timeout defaults, token usage aggregation, and Copilot token-pricing helpers |
| **copilot-sdk** | `src/copilot-sdk-wrapper/` | `CopilotSDKService` (singleton, session-per-request pattern with error recovery, `createClient`/`sendMessage`/`abortSession`/`transform`), `ModelRegistry`, MCP config loader, SDK availability detection, trusted folders. `StreamingSession` gates settlement on SDK background tasks (`session.idle` with `backgroundTasks` field, `background_tasks_changed` event) — defers `settleWithResult()` until all agents/shells drain to zero. |
| **process-store** | `src/process-store.ts`, `src/file-process-store.ts`, `src/sqlite-process-store.ts` | Abstract `ProcessStore` + `FileProcessStore` (per-repo directory layout, 500-process cap) + `SqliteProcessStore` (schema version 6, FTS5 `conversation_search` index on `conversation_turns.content` with sync triggers). `lastEventAt` is set on `addProcess` (= `startTime`) and updated to current time on `appendConversationTurn`. Pin/archive state stored on `processes` table (`pinned_at TEXT`, `archived INTEGER`); convenience methods `pinProcess`, `unpinProcess`, `archiveProcess`, `unarchiveProcess`, `archiveProcesses`, `unarchiveProcesses`, `getPinnedProcesses`. |
| **pipeline types** | `src/workflow/pipeline-compat.ts`, `src/pipeline-types.ts` | Legacy pipeline YAML config types (used by compiler) and pipeline phase/event types (used by process-store). The `pipeline/` directory has been deleted. |
| **workflow** | `src/workflow/` | DAG-based workflow engine: `executeWorkflow`, graph builder, scheduler, validator, compiler (`compileToWorkflow` — pipeline→workflow format conversion, types in `pipeline-compat.ts`), node executors (load/map/ai/reduce/filter/script/merge/transform), `ConcurrencyLimiter`, result adapter (`flattenWorkflowResult`). Supports `WorkflowSettings` (model/concurrency/timeout/workingDirectory/toolCallCache), `parameters` (template substitution), `skill`/`skills` (per-node single or multi-skill resolution), `AbortSignal` cancellation before/after node and AI invocations, structured `WorkflowProgressEvent`, per-item `WorkflowItemProcessEvent` |
| **map-reduce** | `src/map-reduce/` | `MapReduceExecutor`, `MapReduceJob`, splitters (File/Chunk/Rule), reducers (AI/Deterministic/Hybrid), prompt templates, concurrency limiter |
| **memory** | `src/memory/` | Persistent AI memory system (see [Memory System](#memory-system) below) |
| **tasks** | `src/tasks/` | Task scanner, parser, CRUD ops, prompt builders for task discovery |
| **discovery** | `src/discovery/` | Prompt file and skill file resolution |
| **editor** | `src/editor/` | Comment anchors, markdown parsing/rendering, opt-in HTML embed title parsing, file state, message transport |
| **utils** | `src/utils/` | File I/O, glob, HTTP, text matching, AI response parsing, template engine, CSV reader (`csv-reader.ts`), prompt resolver (`prompt-resolver.ts`), pipeline template (`pipeline-template.ts`), filter executor (`filter-executor.ts`), input generator (`input-generator.ts`) |
| **git** | `src/git/` | `BranchService` (pull/push/fetch/merge/stash), `GitLogService`, `GitRangeService`, `WorkingTreeService`, `GitOpsStore` (background git op tracking, file-persisted to `~/.coc/git-ops/`), exec helpers, remote URL detection |
| **templates** | `src/templates/` | `replicateCommit()`, prompt builder, result parser — commit template replication service |
| **ado** | `src/ado/` | Azure DevOps integration: `AdoConnectionFactory` (PAT + Azure CLI bearer token auth), `AdoWorkItemsService`, `AdoPullRequestsService` |
| **skills** | `src/skills/` | Skill management: source detector, skill scanner, skill installer, bundled skills provider (`getBundledSkillsRegistry`, `parseBundledSkillVersion`, `parseSkillVersionFromFile`), skill updater (`autoUpdateBundledSkills` — version-aware auto-update of globally-installed skills), skill resolver (`skill-resolver.ts` — resolves and loads skill prompts from `.github/skills/`). Version is read from each skill's `SKILL.md` frontmatter `metadata.version` at runtime (no hardcoded versions in the registry). |

Entry point: `src/index.ts` — re-exports all public API from the modules above.

## Memory System

Bounded, file-backed memory lets AI chat sessions learn from past interactions. Direct bounded memory actions mutate `MEMORY.md`; chat-time capture mode upserts durable candidate rows instead of rewriting bounded memory. Candidate ranking is deterministic and explainable from stored metadata. The frozen bounded-memory snapshot is injected into subsequent prompts.

**Storage layout:** `~/.coc/repos/<workspaceId>/memory/MEMORY.md` (per-repo), `~/.coc/memory/system/MEMORY.md` (global system). `MemoryLevel` = `'repo' | 'system' | 'git-remote' | 'both'`.

### Components (`src/memory/`)

| File | Export | Role |
|------|--------|------|
| `types.ts` | `MemoryStore`, `MemoryConfig`, `RepoInfo`, `GitRemoteInfo`, `MemoryLevel` | Core type definitions and store interface |
| `bounded-memory-types.ts` | `BoundedMemoryStoreOptions`, `MemoryMutationResult`, `MemoryUsage`, `MemoryScanResult`, `ThreatPatternId`, `ENTRY_DELIMITER`, `DEFAULT_CHAR_LIMIT` | Types and constants for the bounded memory system, including append-only mutation metadata |
| `bounded-memory-store.ts` | `BoundedMemoryStore` | File-backed store with add/replace/remove, append-only promotion (`appendEntries` returns the entries actually appended), substring matching, char limits, `§` delimiters, mkdir-based file locking, atomic writes. Extends `BaseFileStore`. |
| `memory-security-scanner.ts` | `scanMemoryContent` | Stateless security scanner detecting prompt injection, exfiltration, persistence threats, and invisible Unicode characters |
| `repo-hash.ts` | `computeRepoHash` | Stable 16-char hex hash for repository paths |
| `memory-prompt-builder.ts` | `MemoryPromptBuilder`, `MEMORY_GUIDANCE`, `ENTRY_DELIMITER` | Frozen snapshot prompt builder: reads `BoundedMemoryStore` entries at construction, renders immutable `═══`-separated block with usage header + behavioral guidance for system prompt injection. Preserves LLM prefix cache stability. |
| `memory-tool.ts` | `createMemoryTool` | Factory returning a `memory` tool with add/replace/remove actions against `BoundedMemoryStore`; capture mode routes `add` into durable memory candidates without mutating `MEMORY.md` and preserves explicit memory intent metadata. |
| `memory-candidate-store.ts` | `MemoryCandidateStore` | SQLite candidate lifecycle store with `pending/promoted/dropped/ignored` statuses, normalized-content dedupe, signal counts, provenance, explicit intent, and one-time migration from pending legacy raw records. |
| `memory-candidate-ranking.ts` | `rankMemoryCandidates` | Pure deterministic ranking and selection policy for pending candidates using frequency, relevance, diversity, recency, consolidation, conceptual tags, and explicit memory intent. |

### Usage Pattern

```typescript
import { MemoryPromptBuilder, BoundedMemoryStore, createMemoryTool } from 'forge';

const repoStore = new BoundedMemoryStore({ filePath: '~/.coc/repos/<id>/memory/MEMORY.md' });
const sysStore = new BoundedMemoryStore({ filePath: '~/.coc/memory/system/MEMORY.md' });
await repoStore.load();
const builder = new MemoryPromptBuilder({ store: repoStore, systemStore: sysStore });
const block = builder.getSystemPromptBlock(); // inject into system prompt

const { tool } = createMemoryTool({ memory: repoStore, system: sysStore });
// Pass tool to AI session's available tools...
```

**Key design decisions:**
- Memory is **caller-side opt-in** — the AI invoker is never modified
- Capture uses a **tool** (`write_memory` via `defineTool`), not a follow-up prompt — avoids polluting session history

## Build & Test

```bash
npm run build          # Build TypeScript
npx tsc --noEmit       # Type check only
npm run test:run       # Run all Vitest tests
npx vitest run test/memory/  # Run specific module tests
```

## Publishing

Published via `@changesets/cli` (see root `AGENTS.md`). The `files` field includes `dist` and `resources/` (bundled skills). `publishConfig.access` is `"public"`. Versioning is independent — forge can be bumped without bumping consumers, and `updateInternalDependencies: "patch"` in changesets config auto-bumps `coc`/`deep-wiki` when forge changes.

## Cross-Platform

Paths use `path.join()`/`path.resolve()`. Shell escaping handles platform differences. Temp files use `os.tmpdir()`. Tests use `fs.mkdtemp()` for isolation.

## See Also

- `docs/designs/forge-extraction.md` — Package extraction design
