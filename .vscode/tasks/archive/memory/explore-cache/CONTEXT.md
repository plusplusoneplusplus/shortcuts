# Context: Tool Call Cache (Explore Cache)

## User Story
Pipeline runs (coc run, deep-wiki generate) frequently spawn explore-style tool calls (grep, glob, view, task-explore) that repeat across runs on the same repo. Build a caching layer that captures these tool call Q&A pairs, consolidates them via AI, and enables retrieval — saving tokens and latency on repeated explorations.

## Goal
Build a generic **Tool Call Cache** infrastructure in pipeline-core's memory module, with "explore cache" as the first preset filter instance, enabling automatic capture, AI-driven aggregation, and keyword-based retrieval of tool call results.

## Commit Sequence
1. Tool Call Cache Types & Store — data types + FileToolCallCacheStore persistence
2. Tool Call Capture — passive onToolEvent listener with arg normalization
3. Tool Call Cache Aggregation — AI-driven consolidation mirroring MemoryAggregator
4. Tool Call Cache Retrieval & Staleness — Jaccard similarity lookup + git-hash staleness
5. Orchestrator, Presets & Integration — withToolCallCache(), EXPLORE_FILTER, barrel exports, PipelineConfig extension

## Key Decisions
- Generic `ToolCallFilter` predicate makes the system reusable beyond explore (e.g., write-tracking, bash-caching)
- JSON storage (not markdown frontmatter) for raw entries — structured data needs structured format
- Safety-first aggregation: write consolidated BEFORE deleting raw entries (mirrors MemoryAggregator)
- v1 retrieval is pure algorithmic (Jaccard on word tokens, threshold 0.4) — no AI dependency in the read path
- v1 does capture + aggregation only in the orchestrator; pre-execution retrieval requires a future onBeforeToolExecution SDK hook
- Staleness strategies: skip / warn / revalidate (revalidate = warn in v1)

## Conventions
- All classes in `packages/pipeline-core/src/memory/` — no VS Code dependencies
- Follows existing memory module patterns: FileMemoryStore (atomic writes, write queue), MemoryAggregator (safety ordering), withMemory (orchestrator shape)
- Tests use Vitest with real temp dirs for store, mocked stores for higher layers
- File naming: `<timestamp_ms>-<sanitized_tool>.json` under `explore-cache/raw/`
