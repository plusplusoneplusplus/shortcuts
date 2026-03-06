# Explore Cache — User Requirement & High-Level Plan

## Problem Statement

During a Copilot SDK round (e.g. a `coc run` pipeline execution or a `deep-wiki generate` run),
the AI frequently spawns **explore-style tool calls** — grep, glob, view, task(explore) — to
discover facts about the codebase. These explorations are expensive (token cost + latency) and
often **repeat across runs**: different pipelines ask the same or very similar questions about the
same repo.

The existing memory system (`pipeline-core/src/memory/`) captures **declarative knowledge**
(conventions, architecture patterns, gotchas) via the `write_memory` tool and consolidates it
into `consolidated.md`. It does **not** capture the structured Q&A pairs that tool calls produce.

## Goal

Build an **Explore Cache** layer that:

1. **Captures** every explore-like tool invocation's input (the "ask") and output (the "answer")
   as raw Q&A entries during SDK rounds.
2. **Aggregates** raw entries into a searchable semantic index using AI-driven consolidation.
3. **Retrieves** cached answers for future explore-like calls before they execute, avoiding
   redundant exploration when a sufficiently similar question has already been answered.

## Scope

### In Scope
- Capture tool call Q&A pairs from `onToolEvent` / `SDKInvocationResult.toolCalls`
- Persist raw Q&A entries to disk (per-repo and system level, mirroring existing memory layout)
- AI-driven aggregation of raw Q&A pairs into a consolidated index
- Retrieval / lookup before tool execution (semantic similarity via AI or keyword matching)
- Integration with the existing `withMemory()` orchestrator
- Git-hash awareness for cache invalidation (code changes may invalidate answers)

### Out of Scope (v1)
- Cross-repo knowledge transfer
- Real-time streaming interception (we capture post-hoc from completed tool calls)
- Custom similarity thresholds exposed to end users
- UI/dashboard for browsing cached explorations

## User Stories

### US-1: Automatic Capture
> As a pipeline author, when my pipeline runs and the AI uses tools to explore the codebase,
> I want every tool call's question and answer to be automatically saved so that knowledge
> accumulates without any manual effort.

### US-2: AI Aggregation
> As a system, after enough raw Q&A entries accumulate (threshold), I want an AI pass to
> deduplicate, cluster, and build a semantic index (question→answer mapping with topic tags)
> so that retrieval is fast and precise.

### US-3: Cache Hit on Re-explore
> As a pipeline author, when my pipeline (or a different pipeline on the same repo) triggers
> an explore-like tool call, I want the system to check the cache first and return the cached
> answer if a sufficiently similar question was already answered — saving tokens and time.

### US-4: Staleness Awareness
> As a pipeline author, I want the cache to be aware of code changes (git hash) so that
> answers about files that have changed since the cache entry are either invalidated or
> flagged as potentially stale.

## Data Model

### Raw Q&A Entry (on disk, one file per captured tool call)
```
~/.coc/memory/
  repos/<hash>/
    explore-cache/
      raw/
        <timestamp>-<tool-name>.md    ← YAML frontmatter + Q&A body
```

**Frontmatter fields:**
- `tool`: tool name (e.g. `grep`, `view`, `task-explore`, `glob`)
- `timestamp`: ISO 8601
- `gitHash`: HEAD commit hash at capture time
- `repo`: repo identifier
- `parentToolCallId`: if this was a sub-agent call, link to parent

**Body:**
```markdown
## Question
<tool args / prompt summarized as a natural-language question>

## Answer
<tool result / AI response>
```

### Consolidated Explore Index (AI-generated)
```
~/.coc/memory/
  repos/<hash>/
    explore-cache/
      index.json          ← metadata (counts, last aggregation, git hash)
      consolidated.json   ← array of { question, answer, topics[], gitHash, confidence }
```

Each entry in `consolidated.json`:
```json
{
  "id": "unique-id",
  "question": "What authentication library does this project use?",
  "answer": "The project uses passport.js with JWT strategy...",
  "topics": ["auth", "dependencies"],
  "gitHash": "abc1234",
  "toolSources": ["grep", "view"],
  "createdAt": "2026-03-01T...",
  "hitCount": 0
}
```

## High-Level Implementation Plan

### Layer 1: Capture (hook into SDK tool event flow)

**Where:** `packages/pipeline-core/src/memory/`

- Create `ExploreCapture` class that subscribes to `onToolEvent` callbacks
- On `tool-complete` events, extract the tool name, args (the "question"), and result (the "answer")
- Filter to explore-relevant tools: `grep`, `glob`, `view`, `task` (with explore agent_type), `bash` (read-only commands)
- Normalize tool args into a natural-language question string
- Write raw Q&A file via existing `MemoryStore.writeRaw()` pattern (new `explore-cache/raw/` subdirectory)
- Wire into `withMemory()` or provide a parallel `withExploreCache()` orchestrator

**Key design:** The capture is a **passive listener** on `onToolEvent` — it does not modify the tool execution flow.

### Layer 2: Aggregation (AI-driven index building)

**Where:** `packages/pipeline-core/src/memory/`

- Create `ExploreCacheAggregator` (mirrors `MemoryAggregator` pattern)
- When raw Q&A count exceeds threshold, invoke AI to:
  - Deduplicate near-identical questions
  - Cluster related Q&As by topic
  - Normalize question phrasing for better future matching
  - Produce `consolidated.json` array
- Track git hash per entry so staleness can be detected
- Aggregation runs post-pipeline (non-blocking, same as current memory aggregation)

### Layer 3: Retrieval (cache lookup before tool execution)

**Where:** `packages/pipeline-core/src/memory/` + integration in SDK service

- Create `ExploreCacheRetriever` class
- Before an explore-like tool executes, check the consolidated index for a matching question
- Matching strategies (progressively more sophisticated):
  - **v1:** Exact keyword overlap / simple text similarity
  - **v2:** AI-driven similarity check (send candidate question + top-N index entries to AI, ask "is this already answered?")
- If cache hit: return cached answer, increment `hitCount`, skip tool execution
- If cache miss: let tool execute normally, capture result (Layer 1)

**Integration point:** This requires a hook in the tool execution path, likely via a custom tool wrapper or by extending `SendMessageOptions` with an `onBeforeToolExecution` callback.

### Layer 4: Staleness & Invalidation

- On capture, record `gitHash` (HEAD at time of answer)
- On retrieval, compare stored `gitHash` with current HEAD
- If files referenced in the answer have changed (git diff), mark entry as stale
- Stale entries can be: skipped, returned with a warning, or re-validated via a lightweight AI check

### Integration Points

| Component | Integration |
|-----------|------------|
| `withMemory()` | Extend or create parallel `withExploreCache()` that wires capture + retrieval |
| `CopilotSDKService` | Use existing `onToolEvent` callback for capture; potentially add `onBeforeToolExecution` for retrieval |
| `FileMemoryStore` | Extend with `explore-cache/` subdirectory support, or create a separate `ExploreCacheStore` |
| `MemoryAggregator` | Mirror pattern for `ExploreCacheAggregator` |
| Pipeline YAML | Add `explore_cache: true/false` config option alongside existing `memory:` |

### Suggested Implementation Order

1. **Types & Store** — Define `ExploreQAEntry`, `ExploreCacheIndex` types; extend `FileMemoryStore` or create `FileExploreCacheStore`
2. **Capture** — `ExploreCapture` class + integration with `onToolEvent`
3. **Aggregation** — `ExploreCacheAggregator` with AI consolidation prompt
4. **Retrieval** — `ExploreCacheRetriever` with simple text matching (v1)
5. **Orchestrator** — `withExploreCache()` function wiring capture + retrieval
6. **Staleness** — Git-hash comparison and invalidation logic
7. **Tests** — Unit tests for each layer, integration test for full flow

## Open Questions

1. **Tool filtering:** Which tool names should be considered "explore-like"? Initial set: `grep`, `glob`, `view`, `task` (explore type). Should `bash`/`shell` commands be included?
2. **Granularity:** Should we cache individual tool calls or aggregate multi-tool exploration sequences (a `task(explore)` that internally calls grep+view+glob)?
3. **Matching precision:** How strict should cache matching be? Exact args match only, or fuzzy/semantic?
4. **Storage budget:** Should there be a max size for the explore cache per repo?
5. **Privacy:** Some tool results may contain sensitive code. Should there be an opt-out mechanism?