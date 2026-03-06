# Context: Memory Services (Phase 2)

## User Story
With MemoryStore done, build the three core services that make memory usable: retrieval (inject knowledge into prompts), capture (AI-driven via write_memory tool), and aggregation (consolidate raw observations). Plus a `withMemory()` helper that composes all three. These are standalone pipeline-core modules — no CLI, config, or server changes.

## Goal
Implement MemoryRetriever, createWriteMemoryTool, MemoryAggregator, and withMemory() in pipeline-core so any CoC feature can opt in to memory via caller-side composition.

## Commit Sequence
1. MemoryRetriever — load and format consolidated memory
2. createWriteMemoryTool — tool factory for AI-driven capture
3. MemoryAggregator — batch consolidation of raw observations
4. withMemory() helper and exports wiring

## Key Decisions
- Capture is tool-based (write_memory tool), not follow-up prompt — no session pollution
- Caller-side composition, not invoker middleware — AI invoker stays untouched
- Services are stateless — constructed with MemoryStore, AIInvoker passed per-call
- createWriteMemoryTool follows existing defineTool/createResolveCommentTool pattern
- Aggregation is all-or-nothing: if AI fails, raw files preserved
- withMemory() may extend AIInvokerOptions with optional `tools` field

## Conventions
- All services in `packages/pipeline-core/src/memory/`
- Tool types from `../copilot-sdk-wrapper/types`
- AIInvoker type from `../map-reduce/types`
- Tests mock MemoryStore and AIInvoker with `vi.fn()`
