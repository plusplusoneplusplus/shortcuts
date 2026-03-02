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
