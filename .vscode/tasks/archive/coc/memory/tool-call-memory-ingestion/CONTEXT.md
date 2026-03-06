# Context: Tool Call Memory Ingestion

## User Story
The user wants every AI call in the CoC CLI and server to automatically capture tool call Q&A pairs (what was searched, what was found) into persistent storage (`explore-cache`). The explore-cache is a self-contained system kept separate from the main memory system. Aggregation of raw entries is intentionally manual/batch — the user controls when AI consolidation runs via a button in the `#memory/config` UI.

## Goal
Wire `ToolCallCapture` into all production AI call paths so tool call Q&A entries start flowing to `~/.coc/memory/explore-cache/raw/` automatically, then expose a `POST /api/memory/aggregate-tool-calls` endpoint + SPA button to consolidate them on demand into `consolidated.json`.

## Commit Sequence
1. Add `onToolEvent` to `AIInvokerOptions` and forward in `createCLIAIInvoker`
2. Install `ToolCallCapture` directly in `createCLIAIInvoker` (capture only, no auto-aggregation)
3. Wire `ToolCallCapture` into direct `sendMessage` calls in `queue-executor-bridge`
4. Add `POST /api/memory/aggregate-tool-calls` batch aggregation endpoint
5. SPA UI — `ExploreCachePanel` component + stats endpoint in `#memory/config`

## Key Decisions
- `onToolEvent` must be added to `AIInvokerOptions` (pipeline-core) before capture works — without it, handlers are silently dropped
- Use `ToolCallCapture` directly in commit 002, NOT `withToolCallCache` — `withToolCallCache` auto-triggers AI aggregation after every call, which is explicitly not wanted
- explore-cache stays fully separate from `system/raw/*.md` (the main memory system) — no ingestion bridge between them
- Raw entries accumulate indefinitely; batch aggregation via `POST /api/memory/aggregate-tool-calls` is triggered manually
- `ToolCallCacheAggregator.aggregate()` requires an `AIInvoker` — injected into `registerMemoryRoutes` options by the `coc` CLI layer (following the wiki routes pattern)
- `createCLIAIInvoker` covers both `coc run` and server queue pipeline tasks — single wiring point
- `queue-executor-bridge.ts` has a second direct `sendMessage` path (non-pipeline "ask" tasks) handled separately in commit 003
- `FileToolCallCacheStore` and `ToolCallCapture` instantiated once per factory call, not per AI invocation (write-queue serialization)
- `createDryRunAIInvoker` must NOT be wrapped — no spurious cache entries

## Conventions
- Inline import pattern for `ToolEvent`: `import('../copilot-sdk-wrapper/types').ToolEvent` (matches existing `Tool` import in `AIInvokerOptions`)
- Compose `onToolEvent` handlers: call existing handler first, then capture handler
- New SPA component: `ExploreCachePanel.tsx` added alongside `MemoryConfigPanel.tsx`, mounted inside it
- Stats endpoint: `GET /api/memory/aggregate-tool-calls/stats` — pure filesystem read, no AI
