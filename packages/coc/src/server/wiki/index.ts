// Types
export type {
    // Domain types
    ProjectInfo,
    ComponentInfo,
    CategoryInfo,
    DomainInfo,
    ComponentGraph,
    ComponentAnalysis,
    ThemeMeta,
    KeyConcept,
    PublicAPIEntry,
    CodeExample,
    InternalDependency,
    ExternalDependency,
    AskAIFunction,
    WikiServeCommandOptions,
} from './types';

// WikiData
export { WikiData } from './wiki-data';
export type {
    ComponentSummary,
    ComponentDetail,
    SpecialPage,
    ThemeArticleContent,
    ThemeArticleDetail,
} from './wiki-data';

// ContextBuilder
export { ContextBuilder, tokenize } from './context-builder';
export type {
    RetrievedContext,
    ThemeContextEntry,
} from './context-builder';

// ConversationSessionManager
export { ConversationSessionManager } from './conversation-session-manager';
export type {
    ConversationSession,
    ConversationSessionManagerOptions,
    SessionSendResult,
} from './conversation-session-manager';

// FileWatcher
export { FileWatcher } from './file-watcher';
export type {
    FileWatcherOptions,
} from './file-watcher';

// WikiManager
export { WikiManager } from './wiki-manager';
export type {
    WikiRegistration,
    WikiRuntime,
    WikiManagerOptions,
} from './wiki-manager';

// Wiki Routes
export { registerWikiRoutes } from './wiki-routes';
export type { WikiRouteOptions, WikiRouteHelpers } from './wiki-routes';

// Wiki Handlers (SSE utility shared across handlers)
export { sendSSE, readBody, buildAskPrompt, handleAskCore } from './ask-handler';
export type { AskRequest, ConversationMessage, WikiAskHandlerOptions } from './ask-handler';
export { buildExplorePrompt, handleExploreCore } from './explore-handler';
export type { ExploreRequest, WikiExploreHandlerOptions } from './explore-handler';
export { getGenerationState, resetGenerationState, resetAllGenerationStates } from './generate-handler';
export type { GenerateRequest, GenerateHandlerDeps } from './generate-handler';

// Wiki Generation domain layer (registry, runners, deep-wiki adapter, cache status)
export {
    WikiGenerationRegistry,
    defaultGenerationRegistry,
    WikiCacheStatusService,
    defaultCacheStatusService,
    defaultDeepWikiAdapter,
    runWikiGeneration,
    runComponentRegeneration,
    collectCacheMetadata,
    createSseEventSink,
    createRecordingEventSink,
} from './generation';
export type {
    GenerationEvent,
    GenerationEventSink,
    GenerationState,
    GenerationHandle,
    DeepWikiAdapter,
    CacheMetadataStats,
    PhaseCacheStatus,
} from './generation';

// Wiki Backend (shared types for handler deduplication)
export type { ResolvedAskContext, ResolvedExploreContext, GenerateWiki, WikiProvider } from './wiki-backend';
export { createSingleWikiProvider } from './wiki-backend';

// WebSocket (standalone wiki WebSocket, distinct from process WebSocket)
export { WebSocketServer as WikiWebSocketServer } from './websocket';
export type { WSClient, WSMessage } from './websocket';

// Router
export { createRequestHandler, sendJson, send404, send400, send500, readBody as readBodyRaw } from './router';
export type { RouterOptions } from './router';

// API Handlers
export { handleApiRequest } from './api-handlers';
export type { ApiHandlerContext } from './api-handlers';
