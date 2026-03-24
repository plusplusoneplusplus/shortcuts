/**
 * Ask Handler (Deep-Wiki Standalone)
 *
 * POST /api/ask — AI Q&A endpoint with SSE streaming.
 * Thin wrapper that maps flat injected options into a ResolvedAskContext
 * and delegates to the shared `handleAskCore()`.
 *
 * Multi-turn conversation is supported in two modes:
 *   1. Session-based (preferred): Client sends `sessionId` — server reuses
 *      the same ConversationSessionManager session across turns.
 *   2. History-based (fallback): Client sends full `conversationHistory` —
 *      server embeds it in the prompt (legacy behavior).
 */

import type { IncomingMessage, ServerResponse } from 'http';
import type { ContextBuilder } from './context-builder';
import type { ConversationSessionManager } from './conversation-session-manager';
import { readBody } from './router';
import { handleAskCore, sendSSE } from './ask-handler';
import type { ConversationMessage, AskRequest } from './ask-handler';
import type { AskAIFunction } from './types';
import type { ResolvedAskContext } from './wiki-backend';

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

    const resolved: ResolvedAskContext = {
        contextBuilder: options.contextBuilder,
        sendMessage: options.sendMessage,
        model: options.model,
        workingDirectory: options.workingDirectory,
        sessionManager: options.sessionManager,
    };

    await handleAskCore(res, askReq, resolved);
}

// Re-exports for backward compatibility (canonical definitions in ask-handler.ts / types.ts)
export { sendSSE, buildAskPrompt, handleAskCore } from './ask-handler';
export type { ConversationMessage, AskRequest } from './ask-handler';
export type { AskAIFunction } from './types';
