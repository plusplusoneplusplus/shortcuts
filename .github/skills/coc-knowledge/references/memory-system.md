# Memory System

Bounded, file-backed persistence layer that lets AI chat sessions learn from past interactions. The AI writes `memory` tool calls (add/replace/remove), which are applied to `MEMORY.md`; the frozen snapshot is injected into subsequent prompts.

## Storage Layout

- Per-repo: `~/.coc/repos/<workspaceId>/memory/MEMORY.md`
- System: `~/.coc/memory/system/MEMORY.md`
- `MemoryLevel` = `'repo' | 'system' | 'git-remote' | 'both'`
- Memory V2 global store: `~/.coc/memory/global/`
- Memory V2 isolated workspace store: `~/.coc/repos/<workspaceId>/memory/`

## Core Components (`packages/forge/src/memory/`)

| File | Export | Role |
|------|--------|------|
| `types.ts` | `MemoryStore`, `MemoryConfig`, `MemoryLevel` | Core type definitions and store interface |
| `bounded-memory-types.ts` | `BoundedMemoryStoreOptions`, `MemoryMutationResult`, `ENTRY_DELIMITER`, `DEFAULT_CHAR_LIMIT` | Types and constants for bounded memory |
| `bounded-memory-store.ts` | `BoundedMemoryStore` | File-backed store with add/replace/remove, appendEntries (promotion), normalized duplicate checks, substring matching, char limits, `§` delimiters, mkdir-based file locking |
| `memory-security-scanner.ts` | `scanMemoryContent` | Stateless security scanner for injection/exfiltration threats and invisible Unicode |
| `memory-prompt-builder.ts` | `MemoryPromptBuilder`, `MEMORY_GUIDANCE` | Frozen snapshot builder: reads store at construction, renders `═══`-separated blocks with usage headers |
| `memory-tool.ts` | `createMemoryTool` | Factory returning AI-callable `memory` tool; supports `bounded` mode (direct MEMORY.md mutation) and `capture` mode (candidate append) |
| `memory-candidate-store.ts` | `MemoryCandidateStore` | SQLite candidate lifecycle: pending/promoted/dropped/ignored statuses, signal counts, provenance, explicit intent |
| `memory-candidate-ranking.ts` | `rankMemoryCandidates` | Pure deterministic ranking: frequency, relevance, diversity, recency, consolidation, explicit intent |
| `repo-hash.ts` | `computeRepoHash` | Stable 16-char hex hash for repository paths |

## Usage Pattern

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

## Capture Mode

In capture mode, `add` operations append durable candidate rows in `memory/raw-memory.db` instead of mutating `MEMORY.md` directly. Candidates are scored based on:
- `explicitMemoryIntent` — user explicitly asked to remember
- `writeFrequency` — how often similar facts are written
- Signal counts and provenance tracking

Duplicate normalized facts strengthen the same candidate via signal counts.

## Candidate Ranking

`rankMemoryCandidates` uses deterministic policy:
1. Frequency signal (how often the fact appears)
2. Relevance signal (explicit memory intent satisfies this)
3. Diversity sanity check (minimal)
4. Recency (newer candidates preferred)
5. Consolidation (conceptual tag grouping)

## Promotion Pipeline

Promotion runs through:
1. Manual repo memory API/UI action
2. Explicit `memory-promote` queue tasks
3. Opt-in per-repo auto-promotion (disabled by default)

Auto-promotion requires both `features.autoMemoryPromotion` AND `boundedMemory.autoPromote.mode` enabled. Threshold mode enqueues one low-priority `memory-promote` task when pending candidates reach configured count.

`memory-promote` tasks:
- Acquire `memory/promote.lock`
- Rank pending candidates with forge's ranking policy
- Optional AI normalization (disabled by default)
- Append selected clean fact text to `MEMORY.md` (no rewrite)
- Use normalized content hashes to skip already-covered facts
- Finalize each candidate as promoted/dropped/ignored/pending

## Recall Index

`MemoryRecallIndex` (SQLite-backed FTS5) enables relevant memory retrieval:
- Syncs clean `MEMORY.md` entries into `memory_recall_entries`
- BM25 search for relevant entries given a user prompt
- Always keeps protected entries
- Records recall events/counts for future promotion signals

## Memory V2

Memory V2 stores durable facts and compact episodes in SQLite via the `@plusplusoneplusplus/coc-memory` package. Facts have scope (`global` or `workspace`), status (`active`, `review`, `rejected`, `archived`), importance, confidence, tags, source metadata, and optional source process/turn links. Episodes summarize completed interactions and link back to their source process/Ralph context.

Workspace preferences control the runtime scope:
- `memoryV2.enabled` gates all Memory V2 prompt injection, tools, and REST routes.
- `memoryV2.isolated` selects the per-workspace store under `~/.coc/repos/<workspaceId>/memory/`; otherwise the workspace uses the shared global store under `~/.coc/memory/global/`.
- `memoryV2.frozenSnapshotLimit` and `memoryV2.recallLimit` tune prompt snapshot and recall behavior.

The dashboard Memory route uses `MemoryV2Panel` with Facts, Review, and Episodes tabs. It calls `@plusplusoneplusplus/coc-client` through the `memoryV2` domain client for listing/searching facts, creating/editing/deleting facts, approving/rejecting review facts, listing episodes, exporting JSON, and wiping the active scope.

## Server Integration (`packages/coc/src/server/`)

`buildBoundedMemoryAddon()` in `executors/bounded-memory-addon.ts`:
- Creates per-request repo/system `BoundedMemoryStore` instances
- Builds `MemoryPromptBuilder` snapshot for system prompt injection
- Creates AI-callable write-side `memory` tool
- Gated by `PerRepoPreferences.boundedMemory.enabled` (opt-in per repo)

`buildMemoryReadToolsAddon()` creates opt-in read-side tools:
- `memory_search` — FTS5 search over bounded memory entries
- `memory_get` — exact entry resolution by id or ordinal
- Gated by `boundedMemory.readTools.enabled` (disabled by default)

`buildMemoryV2Addon()` in `executors/memory-v2-addon.ts`:
- Resolves global vs isolated workspace scope from `PerRepoPreferences.memoryV2`
- Opens Memory V2 fact/episode stores for each request and closes them after use
- Builds frozen fact snapshots and recall blocks for prompt injection
- Registers Memory V2 write/capture tools
- Returns the empty addon when dataDir, workspaceId, or `memoryV2.enabled` is missing

`registerMemoryV2Routes()` in `server/memory/memory-v2-routes.ts` exposes workspace-scoped Memory V2 REST endpoints under `/api/workspaces/:id/memory/v2/*`. The shared `@plusplusoneplusplus/coc-client` package exposes the matching typed `MemoryV2Client` as `coc.memoryV2`.

## Key Design Decisions

- Memory is **caller-side opt-in** — the AI invoker is never modified
- Capture uses a **tool** (`memory` via `defineTool`), not a follow-up prompt
- `MemoryPromptBuilder` preserves LLM prefix cache stability (frozen snapshot)
- `appendEntries()` is the trusted promotion path; `setEntries()` is explicit rewrite
