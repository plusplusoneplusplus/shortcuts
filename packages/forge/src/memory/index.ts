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

// Bounded memory store
export { BoundedMemoryStore } from './bounded-memory-store';
export type { BoundedMemoryStoreOptions, MemoryMutationResult, MemoryUsage, MemoryScanResult, ThreatPatternId } from './bounded-memory-types';
export { ENTRY_DELIMITER, DEFAULT_CHAR_LIMIT } from './bounded-memory-types';
export { scanMemoryContent, SECURITY_PATTERNS_DESCRIPTION } from './memory-security-scanner';
export { MemoryPromptBuilder, MEMORY_GUIDANCE, getMemoryGuidance } from './memory-prompt-builder';
export type { MemoryPromptBuilderOptions, MemoryPromptRecallOptions } from './memory-prompt-builder';
export { MemoryRecallIndex } from './memory-recall-index';
export type {
    MemoryRecallIndexOptions,
    MemoryRecallQuery,
    MemoryRecallResultEntry,
    MemoryRecallScope,
    MemoryRecallSyncInput,
} from './memory-recall-index';
export { createMemoryTool, MEMORY_SCHEMA, getMemorySchema } from './memory-tool';
export type {
    MemoryToolOptions,
    MemoryToolArgs,
    MemoryToolStores,
    MemoryToolMode,
    MemoryToolCandidateStores,
    MemoryToolCaptureContext,
    MemoryToolCaptureResult,
    MemoryWriteFrequency,
    MemoryCandidateCapturedCallback,
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

// Memory candidate store
export { MemoryCandidateStore } from './memory-candidate-store';
export {
    hashMemoryCandidateContent,
    normalizeMemoryCandidateContent,
} from './memory-content-normalization';
export type { MemoryCandidateStoreOptions } from './memory-candidate-store';
export type {
    MemoryCandidate,
    MemoryCandidateInput,
    MemoryCandidateStats,
    MemoryCandidateStatus,
    MemoryCandidateTarget,
} from './memory-candidate-types';
export {
    DEFAULT_MEMORY_CANDIDATE_RANKING_WEIGHTS,
    DEFAULT_MEMORY_CANDIDATE_SELECTION_POLICY,
    LOOSE_MEMORY_CANDIDATE_SELECTION_POLICY,
    rankMemoryCandidates,
} from './memory-candidate-ranking';
export type {
    MemoryCandidateRankingOptions,
    MemoryCandidateRankingWeights,
    MemoryCandidateScoreComponents,
    MemoryCandidateSelectionPolicy,
    RankedMemoryCandidate,
} from './memory-candidate-ranking';

// Raw-to-bounded reconciler
export {
    prepareReconciliationContext,
    validateProposedEntries,
    buildApplyPlan,
    applyReconciliation,
} from './raw-memory-reconciler';
export type {
    ReconciliationInput,
    ReconciliationContext,
    ReconciliationValidationResult,
    ReconciliationApplyPlan,
    RejectedEntry,
} from './raw-memory-reconciler-types';
