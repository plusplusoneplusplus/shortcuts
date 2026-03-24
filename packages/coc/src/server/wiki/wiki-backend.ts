/**
 * Wiki Backend Types
 *
 * Shared interfaces used by the unified ask/explore/generate handlers.
 * Each interface represents a "resolved context" — the dependencies a handler
 * needs after the caller has determined which wiki backend is being used.
 *
 * - NativeWikiBackend: resolves from WikiManager (multi-tenant)
 * - DeepWikiBackend: resolves from flat injected options (single-wiki)
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import type { ContextBuilder } from './context-builder';
import type { ConversationSessionManager } from './conversation-session-manager';
import type { AskAIFunction } from './types';
import type { WikiData } from './wiki-data';

// ============================================================================
// Ask Context
// ============================================================================

/** Resolved context for the ask handler core logic. */
export interface ResolvedAskContext {
    contextBuilder: ContextBuilder;
    sendMessage: AskAIFunction;
    model?: string;
    workingDirectory?: string;
    sessionManager?: ConversationSessionManager;
}

// ============================================================================
// Explore Context
// ============================================================================

/** Resolved context for the explore handler core logic. */
export interface ResolvedExploreContext {
    wikiData: WikiData;
    sendMessage: AskAIFunction;
    model?: string;
    workingDirectory?: string;
}

// ============================================================================
// Generate Provider
// ============================================================================

/**
 * Minimal wiki object required by the generate handler.
 * WikiManager's WikiRuntime satisfies this interface.
 */
export interface GenerateWiki {
    registration: {
        repoPath?: string;
        wikiDir: string;
    };
    wikiData: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        graph: any;
        reload: () => void;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        getComponentDetail: (id: string) => any;
    };
}

/**
 * Provider interface for looking up wikis by ID.
 * WikiManager satisfies this interface natively via its `get()` method.
 */
export interface WikiProvider {
    get(wikiId: string): GenerateWiki | undefined;
}

/**
 * Create a WikiProvider that always returns a single wiki regardless of wikiId.
 * Used by the deep-wiki standalone server where there is only one wiki.
 */
export function createSingleWikiProvider(wiki: GenerateWiki): WikiProvider {
    return {
        get: () => wiki,
    };
}
