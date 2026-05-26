/**
 * @plusplusoneplusplus/coc-memory
 *
 * Core memory system for CoC: types, store interfaces, embedding provider
 * abstraction, safety scanning, and extraction contracts.
 *
 * This package is pure Node.js/TypeScript — no UI code, no VS Code deps.
 * UI lives in packages/coc. SQLite store implementations also live in
 * packages/coc-memory/src/store-impl/ (added in AC-02/AC-03).
 */

// Core types
export type {
    MemoryScope,
    MemoryFactStatus,
    MemoryFactSource,
    MemoryFact,
    MemoryFactInput,
    MemoryEpisodeEventType,
    MemoryProvenance,
    MemoryEpisode,
    MemoryEpisodeInput,
    MemorySearchQuery,
    MemorySearchResult,
    MemoryFactFilter,
    MemoryEpisodeFilter,
} from './types';

export {
    FEATURE_FLAG_COC_MEMORY,
    GLOBAL_MEMORY_SUBDIR,
    WORKSPACE_MEMORY_SUBDIR,
} from './types';

// Embedding provider
export type { EmbeddingVector, EmbeddingProvider } from './embedding-provider';
export { EmbeddingProviderRegistry } from './embedding-provider';

// Store interfaces
export type {
    IMemoryFactStore,
    IMemoryEpisodeStore,
    MemoryStoreHandle,
} from './store-interface';

// Safety scanner
export type { ThreatPatternId, MemoryScanResult } from './safety-scanner';
export {
    scanMemoryContent,
    redactSensitiveValues,
    SECURITY_PATTERNS_DESCRIPTION,
} from './safety-scanner';

// Extraction contracts
export type {
    ExtractionContext,
    ExtractedFactCandidate,
    ExtractionResult,
    IMemoryExtractor,
} from './extraction-contract';
export { DEFAULT_CONFIDENCE_THRESHOLD } from './extraction-contract';

// SQLite store implementations (AC-02)
export { SqliteFactStore } from './store-impl/sqlite-fact-store';
export { SqliteEpisodeStore } from './store-impl/sqlite-episode-store';
export type { CloseableMemoryStoreHandle } from './store-impl/store-factory';
export { createMemoryStores } from './store-impl/store-factory';

// Scope resolver (AC-02)
export type { WorkspaceMemoryConfig } from './scope-resolver';
export { MemoryScopeResolver } from './scope-resolver';

// Vector search utilities (AC-03)
export {
    encodeEmbedding,
    decodeEmbedding,
    cosineSimilarity,
    normalise,
    recencyScore,
} from './vector-ranker';
export type { HybridSearchOptions } from './hybrid-search';
export { HybridSearchEngine } from './hybrid-search';
export type { BackfillResult } from './embedding-indexer';
export { EmbeddingBackfillService } from './embedding-indexer';

// Capture service (AC-04)
export type { CaptureExplicitInput, CaptureFromTurnResult } from './capture-service';
export {
    MemoryCaptureService,
    isTurnEligibleForExtraction,
    noopExtractor,
    createFnExtractor,
} from './capture-service';
