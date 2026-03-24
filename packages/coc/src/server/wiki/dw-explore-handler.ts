/**
 * Explore Handler (Deep-Wiki Standalone)
 *
 * POST /api/explore/:componentId — On-demand deep-dive into a component.
 * Thin wrapper that maps flat injected options into a ResolvedExploreContext
 * and delegates to the shared `handleExploreCore()`.
 *
 * Streams the result as SSE events:
 *   data: {"type":"status","message":"Analyzing component..."}
 *   data: {"type":"chunk","text":"## Deep Analysis\n\n..."}
 *   data: {"type":"done","fullResponse":"..."}
 *   data: {"type":"error","message":"Something went wrong"}
 */

import type { IncomingMessage, ServerResponse } from 'http';
import type { WikiData } from './wiki-data';
import type { AskAIFunction } from './dw-ask-handler';
import { handleExploreCore } from './explore-handler';
import type { ExploreRequest } from './explore-handler';
import type { ResolvedExploreContext } from './wiki-backend';

export type { ExploreRequest } from './explore-handler';
export { buildExplorePrompt } from './explore-handler';

/** Options for the explore handler. */
export interface ExploreHandlerOptions {
    wikiData: WikiData;
    sendMessage: AskAIFunction;
    model?: string;
    workingDirectory?: string;
}

// ============================================================================
// Handler
// ============================================================================

/**
 * Handle POST /api/explore/:componentId — streamed as SSE.
 */
export async function handleExploreRequest(
    req: IncomingMessage,
    res: ServerResponse,
    componentId: string,
    options: ExploreHandlerOptions,
): Promise<void> {
    const resolved: ResolvedExploreContext = {
        wikiData: options.wikiData,
        sendMessage: options.sendMessage,
        model: options.model,
        workingDirectory: options.workingDirectory,
    };

    await handleExploreCore(req, res, componentId, resolved);
}
