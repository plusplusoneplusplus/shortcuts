/**
 * Explore Handler
 *
 * POST /api/explore/:componentId — On-demand deep-dive into a component.
 * Creates a focused AI session that analyzes the component in depth,
 * optionally answering a specific user question.
 *
 * Streams the result as SSE events:
 *   data: {"type":"status","message":"Analyzing component..."}
 *   data: {"type":"chunk","text":"## Deep Analysis\n\n..."}
 *   data: {"type":"done","fullResponse":"..."}
 *   data: {"type":"error","message":"Something went wrong"}
 */

import type { IncomingMessage, ServerResponse } from 'http';
import type { WikiData } from './wiki-data';
import { sendSSE } from './dw-ask-handler';
import type { AskAIFunction } from './dw-ask-handler';
import { readBody } from './router';
import { buildExplorePrompt } from './explore-handler';
import type { ExploreRequest } from './explore-handler';

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
    // Parse body
    const body = await readBody(req);
    let exploreReq: ExploreRequest = {};
    if (body.trim()) {
        try {
            exploreReq = JSON.parse(body);
        } catch {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid JSON body' }));
            return;
        }
    }

    // Validate component exists
    const graph = options.wikiData.graph;
    const mod = graph.components.find(m => m.id === componentId);
    if (!mod) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Component not found: ${componentId}` }));
        return;
    }

    // Set SSE headers
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
    });

    try {
        // 1. Send status
        sendSSE(res, { type: 'status', message: `Analyzing ${mod.name} component...` });

        // 2. Load existing analysis
        const detail = options.wikiData.getComponentDetail(componentId);
        const existingMarkdown = detail?.markdown || '';

        // 3. Build explore prompt
        const prompt = buildExplorePrompt(mod, existingMarkdown, graph, exploreReq);

        // 4. Call AI with native streaming — chunks are sent as SSE events in real-time
        const fullResponse = await options.sendMessage(prompt, {
            model: options.model,
            workingDirectory: options.workingDirectory,
            onStreamingChunk: (chunk) => {
                sendSSE(res, { type: 'chunk', text: chunk });
            },
        });

        // 5. Done
        sendSSE(res, { type: 'done', fullResponse });

    } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        sendSSE(res, { type: 'error', message });
    }

    res.end();
}


