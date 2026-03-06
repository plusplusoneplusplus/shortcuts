# Context: CoC Memory — Storage & Write Path

## User Story
The user wants CoC pipelines to learn from past executions. Memory should have two levels (repo-specific and system-wide) and be updated asynchronously — raw observations written during execution, then consolidated in the background later.

## Goal
Implement the storage layer and write path for CoC's two-level memory system, enabling pipelines to capture observations from AI interactions and persist them as raw markdown files under `~/.coc/memory/`.

## Commit Sequence
1. Memory types and PipelineConfig extension
2. MemoryStore — file-based storage layer
3. MemoryCapture — observation extraction via AI follow-up
4. Pipeline integration — wire capture into executor
5. Update AGENTS.md for memory module

## Key Decisions
- All memory stored under `~/.coc/memory/` (not in repo), keyed by repo path hash
- Pipeline opt-in via `memory: true | MemoryConfig` in pipeline YAML
- Observation capture uses AI follow-up ("what did you learn?"), not raw response storage
- Capture is non-blocking — pipeline returns immediately, capture completes in background
- Map-reduce pipelines capture once after reduce, not per-item
- Follows existing FileProcessStore patterns: atomic writes, serialized write queue

## Conventions
- All new code in `packages/pipeline-core/src/memory/`
- Tests in `packages/pipeline-core/test/memory/` using Vitest + real FS with temp dirs
- Reuse `ensureDataDir`, atomic tmp→rename, enqueueWrite patterns from FileProcessStore
- Design doc at `docs/designs/coc-memory.md`
