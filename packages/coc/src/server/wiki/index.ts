/**
 * Wiki Module — Barrel Export
 *
 * Re-exports all public types, classes, and functions from the wiki data layer
 * and wiki HTTP route handlers.
 */

// Types (re-exported from coc-server — single source of truth)
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
} from '@plusplusoneplusplus/coc-server';

// WikiData (re-exported from coc-server)
export { WikiData } from '@plusplusoneplusplus/coc-server';
export type {
    ComponentSummary,
    ComponentDetail,
    SpecialPage,
    ThemeArticleContent,
    ThemeArticleDetail,
} from '@plusplusoneplusplus/coc-server';

// ContextBuilder (re-exported from coc-server — same instance as used by WikiManager)
export { ContextBuilder, tokenize } from '@plusplusoneplusplus/coc-server';
export type {
    RetrievedContext,
    ThemeContextEntry,
} from '@plusplusoneplusplus/coc-server';

// ConversationSessionManager (re-exported from coc-server — same instance as used by WikiManager)
export { ConversationSessionManager } from '@plusplusoneplusplus/coc-server';
export type {
    ConversationSession,
    ConversationSessionManagerOptions,
    SessionSendResult,
} from '@plusplusoneplusplus/coc-server';

// FileWatcher (re-exported from coc-server)
export { FileWatcher } from '@plusplusoneplusplus/coc-server';
export type {
    FileWatcherOptions,
} from '@plusplusoneplusplus/coc-server';

// WikiManager (re-exported from coc-server)
export { WikiManager } from '@plusplusoneplusplus/coc-server';
export type {
    WikiRegistration,
    WikiRuntime,
    WikiManagerOptions,
} from '@plusplusoneplusplus/coc-server';

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

// (Standalone wiki server, SPA template, WebSocket, router, and API handlers removed)
