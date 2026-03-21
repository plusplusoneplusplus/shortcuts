/**
 * Ask Handler
 *
 * POST /api/ask — AI Q&A endpoint with SSE streaming.
 * Takes a user question + optional conversation history, retrieves
 * relevant component context via TF-IDF, and streams an AI answer via
 * Server-Sent Events.
 *
 * Multi-turn conversation is supported in two modes:
 *   1. Session-based (preferred): Client sends `sessionId` — server reuses
 *      the same ConversationSessionManager session across turns.
 *   2. History-based (fallback): Client sends full `conversationHistory` —
 *      server embeds it in the prompt (legacy behavior).
 */

import type { IncomingMessage, ServerResponse } from 'http';
import { ContextBuilder } from './context-builder';
import type { ConversationSessionManager } from './conversation-session-manager';
import { readBody } from './router';
import { buildAskPrompt, sendSSE } from './ask-handler';
import type { ConversationMessage, AskRequest } from './ask-handler';
import type { AskAIFunction } from './types';

// ============================================================================
// Types
// ============================================================================

/** Options for the ask handler. */
export interface AskHandlerOptions {
    contextBuilder: ContextBuilder;
    sendMessage: AskAIFunction;
    model?: string;
    workingDirectory?: string;
    /** Session manager for multi-turn conversations. */
    sessionManager?: ConversationSessionManager;
}

// ============================================================================
// Handler
// ============================================================================

/**
 * Handle POST /api/ask — streamed as SSE.
 *
 * SSE protocol:
 *   data: {"type":"context","componentIds":["mod1","mod2"]}
 *   data: {"type":"chunk","content":"Some partial answer..."}
 *   data: {"type":"done","fullResponse":"Full answer text"}
 *   data: {"type":"error","message":"Something went wrong"}
 */
export async function handleAskRequest(
    req: IncomingMessage,
    res: ServerResponse,
    options: AskHandlerOptions,
): Promise<void> {
    // Parse body
    const body = await readBody(req);
    let askReq: AskRequest;
    try {
        askReq = JSON.parse(body);
    } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON body' }));
        return;
    }

    if (!askReq.question || typeof askReq.question !== 'string') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing or invalid "question" field' }));
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
        // 1. Retrieve context
        const context = options.contextBuilder.retrieve(askReq.question);

        // Send context event (include theme info alongside componentIds)
        sendSSE(res, {
            type: 'context',
            componentIds: context.componentIds,
            ...(context.themeContexts.length > 0 ? {
                themeIds: context.themeContexts.map(t => `${t.themeId}/${t.slug}`),
            } : {}),
        });

        // 2. Determine session mode vs legacy mode
        const sessionManager = options.sessionManager;
        let sessionId = askReq.sessionId;
        let isSessionMode = false;

        if (sessionManager) {
            if (sessionId) {
                // Try to reuse existing session
                const existing = sessionManager.get(sessionId);
                if (existing) {
                    isSessionMode = true;
                } else {
                    // Session expired/not found — create a new one
                    sessionId = undefined;
                }
            }

            if (!sessionId) {
                // Create new session
                const newSession = sessionManager.create();
                if (newSession) {
                    sessionId = newSession.sessionId;
                    isSessionMode = true;
                }
                // If null (max reached), fall back to stateless mode
            }
        }

        let fullResponse: string;

        if (isSessionMode && sessionManager && sessionId) {
            // Session mode: build prompt WITHOUT conversation history (SDK retains context)
            const prompt = buildAskPrompt(
                askReq.question,
                context.contextText,
                context.graphSummary,
                undefined, // No history needed — session retains context
            );

            const result = await sessionManager.send(sessionId, prompt, {
                model: options.model,
                workingDirectory: options.workingDirectory,
                onStreamingChunk: (chunk) => {
                    sendSSE(res, { type: 'chunk', content: chunk });
                },
            });

            fullResponse = result.response;
        } else {
            // Legacy stateless mode: embed conversation history in prompt
            const prompt = buildAskPrompt(
                askReq.question,
                context.contextText,
                context.graphSummary,
                askReq.conversationHistory,
            );

            fullResponse = await options.sendMessage(prompt, {
                model: options.model,
                workingDirectory: options.workingDirectory,
                onStreamingChunk: (chunk) => {
                    sendSSE(res, { type: 'chunk', content: chunk });
                },
            });
        }

        // 3. Send done event (include sessionId so client can reuse it)
        sendSSE(res, {
            type: 'done',
            fullResponse,
            ...(sessionId ? { sessionId } : {}),
        });

    } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        sendSSE(res, { type: 'error', message });
    }

    res.end();
}

// Re-exports for backward compatibility (canonical definitions in ask-handler.ts / types.ts)
export { sendSSE, buildAskPrompt } from './ask-handler';
export type { ConversationMessage, AskRequest } from './ask-handler';
export type { AskAIFunction } from './types';
