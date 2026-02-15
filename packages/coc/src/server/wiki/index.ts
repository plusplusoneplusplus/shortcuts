/**
 * Wiki Module — Barrel Export
 *
 * Re-exports all public types, classes, and functions from the wiki data layer
 * and wiki HTTP route handlers.
 */

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
export type { WikiRouteOptions } from './wiki-routes';

// Wiki Handlers (SSE utility shared across handlers)
export { sendSSE, readBody, buildAskPrompt } from './ask-handler';
export type { AskRequest, ConversationMessage, WikiAskHandlerOptions } from './ask-handler';
export { buildExplorePrompt } from './explore-handler';
export type { ExploreRequest, WikiExploreHandlerOptions } from './explore-handler';
export { getGenerationState, resetGenerationState, resetAllGenerationStates } from './generate-handler';
export type { GenerateRequest } from './generate-handler';
