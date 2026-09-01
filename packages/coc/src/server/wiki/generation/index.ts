/**
 * Generation lifecycle split away from HTTP:
 *   - WikiGenerationRegistry  — per-wiki state, cancellation tokens
 *   - DeepWikiAdapter         — the only place deep-wiki is imported
 *   - runWikiGeneration       — five-phase state machine
 *   - runComponentRegeneration— single-article path, same primitives
 *   - WikiCacheStatusService  — cache inspection
 *
 * HTTP handlers in generate-handler.ts are thin adapters over these.
 */

export type {
    GenerationEvent,
    GenerationEventSink,
    GenerationStatusEvent,
    GenerationLogEvent,
    GenerationPhaseCompleteEvent,
    GenerationErrorEvent,
    GenerationDoneEvent,
} from './events';
export { createSseEventSink, createRecordingEventSink } from './events';

export type {
    DeepWikiAdapter,
    AIAvailability,
    AIInvokeResult,
    PhaseModule,
    CacheModule,
    ArticleWriteModule,
} from './deep-wiki-adapter';
export { defaultDeepWikiAdapter } from './deep-wiki-adapter';

export type { GenerationState, GenerationHandle } from './generation-registry';
export { WikiGenerationRegistry, defaultGenerationRegistry } from './generation-registry';

export type { RunWikiGenerationOptions } from './generation-runner';
export { runWikiGeneration, reloadWikiData } from './generation-runner';

export type { RunComponentRegenerationOptions } from './component-regeneration-runner';
export { runComponentRegeneration } from './component-regeneration-runner';

export type {
    CacheEntryStatus,
    PhaseCacheStatus,
    CacheMetadataStats,
    CacheStatusWiki,
} from './cache-status-service';
export {
    WikiCacheStatusService,
    defaultCacheStatusService,
    collectCacheMetadata,
    checkCacheFileStatus,
    checkWebsiteCacheStatus,
    getComponentArticleCacheStatus,
} from './cache-status-service';
