/**
 * Memory System
 *
 * Re-exports all memory types, interfaces, and the FileMemoryStore implementation.
 */
export type {
    RawObservation,
    RawObservationMetadata,
    ConsolidatedMemory,
    MemoryIndex,
    RepoInfo,
    MemoryLevel,
    MemoryConfig,
    MemoryStoreOptions,
    MemoryStats,
    MemoryStore,
} from './types';

export { FileMemoryStore, computeRepoHash } from './memory-store';
export { MemoryRetriever } from './memory-retriever';
export { createWriteMemoryTool, WriteMemoryToolOptions, WriteMemoryArgs } from './write-memory-tool';
export { MemoryAggregator } from './memory-aggregator';
export type { AggregatorOptions } from './memory-aggregator';
export { withMemory } from './with-memory';
export type { WithMemoryOptions } from './with-memory';

// Tool call cache
export type {
    ToolCallFilter,
    ToolCallQAEntry,
    ToolCallCacheIndex,
    ConsolidatedToolCallEntry,
    ToolCallCacheConfig,
    ToolCallCacheStoreOptions,
    ToolCallCacheStats,
    ToolCallCacheStore,
} from './tool-call-cache-types';

export { FileToolCallCacheStore } from './tool-call-cache-store';

export { ToolCallCapture } from './tool-call-capture';
export type { ToolCallCaptureOptions } from './tool-call-capture';

export { ToolCallCacheAggregator } from './tool-call-cache-aggregator';
export type { ToolCallCacheAggregatorOptions } from './tool-call-cache-aggregator';

export { ToolCallCacheRetriever } from './tool-call-cache-retriever';
export type { ToolCallCacheRetrieverOptions } from './tool-call-cache-retriever';
export type { ToolCallCacheLookupResult, StalenessStrategy } from './tool-call-cache-types';

export { withToolCallCache } from './with-tool-call-cache';
export type { WithToolCallCacheOptions } from './with-tool-call-cache';
export { TASK_FILTER, ALL_TOOLS_FILTER, createToolNameFilter } from './tool-call-cache-presets';
