/**
 * Memory System
 *
 * Re-exports all memory types, interfaces, store implementations,
 * and security scanner.
 */
export type {
    RepoInfo,
    GitRemoteInfo,
    MemoryLevel,
} from './types';

export { computeRepoHash } from './repo-hash';
export { BaseFileStore } from './base-file-store';

// Memory security scanner
export { scanMemoryContent, SECURITY_PATTERNS_DESCRIPTION } from './memory-security-scanner';
export type { MemoryScanResult, ThreatPatternId } from './memory-security-scanner';

// Memory tool
export { createMemoryTool, MEMORY_SCHEMA, getMemorySchema } from './memory-tool';
export type {
    MemoryToolOptions,
    MemoryToolArgs,
    MemoryToolMode,
    MemoryToolCaptureContext,
    MemoryToolCaptureResult,
    MemoryWriteFrequency,
    MemoryCandidateCapturedCallback,
    CapturedCandidate,
} from './memory-tool';

// Tool call cache
export type {
    ToolCallFilter,
    ToolCallQAEntry,
    ToolCallCacheIndex,
    ConsolidatedToolCallEntry,
    ConsolidatedIndexEntry,
    ToolCallCacheConfig,
    ToolCallCacheLevel,
    ToolCallCacheStoreOptions,
    ToolCallCacheStats,
    ToolCallCacheStore,
} from './tool-call-cache-types';

export { FileToolCallCacheStore, resolveToolCallCacheOptions } from './tool-call-cache-store';

export { ToolCallCapture } from './tool-call-capture';
export type { ToolCallCaptureOptions } from './tool-call-capture';

export { ToolCallCacheAggregator, TOOL_CALL_CACHE_CONSOLIDATION_INSTRUCTIONS } from './tool-call-cache-aggregator';
export type { ToolCallCacheAggregatorOptions } from './tool-call-cache-aggregator';

export { ToolCallCacheRetriever } from './tool-call-cache-retriever';
export type { ToolCallCacheRetrieverOptions } from './tool-call-cache-retriever';
export type { ToolCallCacheLookupResult, StalenessStrategy } from './tool-call-cache-types';

export { withToolCallCache } from './with-tool-call-cache';
export type { WithToolCallCacheOptions } from './with-tool-call-cache';
export { TASK_FILTER, ALL_TOOLS_FILTER, createToolNameFilter } from './tool-call-cache-presets';
