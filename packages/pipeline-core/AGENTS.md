# Pipeline Core — Developer Reference

Pure Node.js AI pipeline engine. No VS Code dependencies. Used by CoC CLI, Deep Wiki, and the VS Code extension.

## Source Layout

| Module | Path | Purpose |
|--------|------|---------|
| **logger** | `src/logger.ts` | Pluggable logger (`setLogger`, `getLogger`, `nullLogger`) with `LogCategory` |
| **errors** | `src/errors/` | `PipelineCoreError` with `ErrorCode` enum, `wrapError`, `toPipelineCoreError` |
| **config** | `src/config/defaults.ts` | Default constants (`DEFAULT_AI_TIMEOUT_MS`, `DEFAULT_PARALLEL_LIMIT`, etc.) |
| **runtime** | `src/runtime/` | `runWithPolicy` (timeout + retry + cancellation), `withTimeout`, `withRetry`, backoff strategies |
| **queue** | `src/queue/` | `TaskQueueManager` (priority queue) + `QueueExecutor` (concurrency control, events) |
| **ai** | `src/ai/` | AI types, CLI shell escaping, prompt builder, program utils, timeout defaults |
| **copilot-sdk** | `src/copilot-sdk-wrapper/` | `CopilotSDKService` (per-session client isolation, follow-up retry on disposed connection), `ModelRegistry`, MCP config loader, trusted folders |
| **process-store** | `src/process-store.ts`, `src/file-process-store.ts` | Abstract `ProcessStore` + `FileProcessStore` (JSON, atomic writes, 500-process cap) |
| **map-reduce** | `src/map-reduce/` | `MapReduceExecutor`, concurrency limiter, splitters, reducers, pre-built job factories |
| **pipeline** | `src/pipeline/` | YAML pipeline executor, CSV reader, template engine, filter executor, skill/prompt resolvers |
| **memory** | `src/memory/` | Persistent AI memory system (see [Memory System](#memory-system) below) |
| **tasks** | `src/tasks/` | Task scanner, parser, CRUD ops, prompt builders for task discovery |
| **discovery** | `src/discovery/` | Prompt file and skill file resolution |
| **editor** | `src/editor/` | Comment anchors, markdown parsing/rendering, file state, message transport |
| **utils** | `src/utils/` | File I/O, glob, HTTP, text matching, AI response parsing, template engine |

Entry point: `src/index.ts` — re-exports all public API from the modules above.

## Memory System

Persistent memory that lets AI interactions learn from past executions. Stores observations per-repo under `~/.coc/memory/`. Design doc: `docs/designs/coc-memory.md`.

**Storage layout:** `~/.coc/memory/system/` (global) and `~/.coc/memory/repos/<hash>/` (per-repo, hash = SHA-256 of resolved repo root, 16-char hex prefix). Each repo dir contains `raw/*.md` (timestamped observations), `consolidated.md` (AI-synthesized summary), `index.json` (metadata), and `repo-info.json`.

### Components (`src/memory/`)

| File | Export | Role |
|------|--------|------|
| `types.ts` | `MemoryStore`, `MemoryConfig`, `RawObservation`, `ConsolidatedMemory`, `MemoryIndex`, etc. | All type definitions and the store interface |
| `memory-store.ts` | `FileMemoryStore`, `computeRepoHash` | CRUD for raw observations, consolidated memory, index, repo-info. Atomic writes (tmp→rename), sequential write queue. Follows `FileProcessStore` patterns. |
| `memory-retriever.ts` | `MemoryRetriever` | Loads `consolidated.md` for a repo/system level, formats as a context block for prompt injection |
| `write-memory-tool.ts` | `createWriteMemoryTool` | Factory returning a `write_memory` tool (via `defineTool`) that AI can call organically during a session to record observations |
| `memory-aggregator.ts` | `MemoryAggregator` | Checks batch threshold, consolidates raw observations into `consolidated.md` using an AI invoker |
| `with-memory.ts` | `withMemory` | Orchestrator: retrieve context → inject `write_memory` tool → invoke AI → check aggregation threshold |

### Usage Patterns

**Simple — `withMemory()` wrapper** (single AI call):
```typescript
import { withMemory, FileMemoryStore } from 'pipeline-core';

const store = new FileMemoryStore({ baseDir: '~/.coc/memory' });
const result = await withMemory(innerInvoker, prompt, {
    store, repoHash: 'abc123...', level: 'repo',
});
```

**Complex — direct service calls** (multi-step like pipeline map-reduce or wiki):
```typescript
import { MemoryRetriever, createWriteMemoryTool, MemoryAggregator } from 'pipeline-core';

const retriever = new MemoryRetriever(store);
const context = await retriever.retrieve({ repoHash, level: 'repo' });
// Inject context into prompt...

const { tool } = createWriteMemoryTool({ store, repoHash, pipeline: 'my-pipeline' });
// Pass tool to AI session's available tools...

const aggregator = new MemoryAggregator(store, aiInvoker);
await aggregator.aggregateIfNeeded(repoHash, { threshold: 10 });
```

**Key design decisions:**
- Memory is **caller-side opt-in** — the AI invoker (`createCLIAIInvoker`) is never modified
- Capture uses a **tool** (`write_memory` via `defineTool`), not a follow-up prompt — avoids polluting session history
- Two integration patterns: `withMemory()` for simple cases, direct services for complex orchestration

## Build & Test

```bash
npm run build          # Build TypeScript
npx tsc --noEmit       # Type check only
npm run test:run       # Run all Vitest tests
npx vitest run test/memory/  # Run specific module tests
```

## Cross-Platform

Paths use `path.join()`/`path.resolve()`. Shell escaping handles platform differences. Temp files use `os.tmpdir()`. Tests use `fs.mkdtemp()` for isolation.

## See Also

- `docs/designs/coc-memory.md` — Memory system design doc
- `docs/designs/pipeline-core-extraction.md` — Package extraction design
- `src/shortcuts/ai-service/AGENTS.md` — VS Code AI service wrapper
- `src/shortcuts/yaml-pipeline/AGENTS.md` — VS Code pipeline UI
