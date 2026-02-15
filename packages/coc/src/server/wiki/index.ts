/**
 * Wiki Module — Barrel Export
 *
 * Re-exports all public types, classes, and functions from the wiki data layer.
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
