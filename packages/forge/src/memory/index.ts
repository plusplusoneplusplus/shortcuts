/**
 * Memory System
 *
 * Re-exports all memory types, interfaces, store implementations,
 * and security scanner.
 */
export type {
    RawObservation,
    RawObservationMetadata,
    ConsolidatedMemory,
    MemoryIndex,
    RepoInfo,
    GitRemoteInfo,
    MemoryLevel,
    MemoryConfig,
    MemoryStoreOptions,
    MemoryStats,
    MemoryStore,
} from './types';

export { computeRepoHash } from './repo-hash';
export { BaseFileStore } from './base-file-store';

// Bounded memory store
export { BoundedMemoryStore } from './bounded-memory-store';
export type { BoundedMemoryStoreOptions, MemoryMutationResult, MemoryUsage, MemoryScanResult, ThreatPatternId } from './bounded-memory-types';
export { ENTRY_DELIMITER, DEFAULT_CHAR_LIMIT } from './bounded-memory-types';
export { scanMemoryContent } from './memory-security-scanner';
export { MemoryRetriever } from './memory-retriever';
export { createWriteMemoryTool, WriteMemoryToolOptions, WriteMemoryArgs } from './write-memory-tool';
export { MemoryAggregator, MEMORY_CONSOLIDATION_INSTRUCTIONS } from './memory-aggregator';
export type { AggregatorOptions } from './memory-aggregator';
export { withMemory } from './with-memory';
export type { WithMemoryOptions } from './with-memory';
export {
    EXTRACTION_SYSTEM_PROMPT,
    buildExtractionUserPrompt,
    parseExtractionResponse,
} from './extraction-prompts';
export type { ExtractedFact } from './extraction-prompts';

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
