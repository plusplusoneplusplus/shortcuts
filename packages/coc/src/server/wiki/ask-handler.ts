/**
 * Wiki Ask Handler
 *
 * POST /api/wikis/:wikiId/ask — AI Q&A endpoint with SSE streaming.
 * Adapted from deep-wiki's ask-handler for multi-wiki CoC server.
 *
 * The shared core logic lives in `handleAskCore()`, which is also used by
 * the deep-wiki standalone handler (`dw-ask-handler.ts`).
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import type { IncomingMessage, ServerResponse } from 'http';
import type { WikiManager } from './wiki-manager';
import type { AskAIFunction } from './types';
import type { ResolvedAskContext } from './wiki-backend';
import { send400, readJsonBody } from '../shared/router';

// ============================================================================
// Types
// ============================================================================

/** A single message in a conversation turn. */
export interface ConversationMessage {
    role: 'user' | 'assistant';
    content: string;
}

/** Request body for POST /api/wikis/:wikiId/ask. */
export interface AskRequest {
    question: string;
    sessionId?: string;
    conversationHistory?: ConversationMessage[];
}

/** Options for the ask handler. */
export interface WikiAskHandlerOptions {
    wikiManager: WikiManager;
    aiSendMessage?: AskAIFunction;
    aiModel?: string;
    aiWorkingDirectory?: string;
}

// ============================================================================
// Handler
// ============================================================================

/**
 * Handle POST /api/wikis/:wikiId/ask — streamed as SSE.
 */
export async function handleWikiAskRequest(
    req: IncomingMessage,
    res: ServerResponse,
    wikiId: string,
    options: WikiAskHandlerOptions,
): Promise<void> {
    const wiki = options.wikiManager.get(wikiId);
    if (!wiki) {
        send400(res, `Wiki not found: ${wikiId}`);
        return;
    }

    if (!wiki.registration.aiEnabled) {
        send400(res, 'AI features are not enabled for this wiki.');
        return;
    }

    const sendMessage = options.aiSendMessage;
    if (!sendMessage) {
        send400(res, 'AI service is not configured.');
        return;
    }

    let askReq: AskRequest;
    try {
        askReq = await readJsonBody<AskRequest>(req);
    } catch {
        send400(res, 'Invalid JSON body');
        return;
    }

    if (!askReq.question || typeof askReq.question !== 'string') {
        send400(res, 'Missing or invalid "question" field');
        return;
    }

    const resolvedContext: ResolvedAskContext = {
        contextBuilder: options.wikiManager.ensureContextBuilder(wikiId),
        sendMessage,
        model: options.aiModel ?? wiki.registration.aiModel,
        workingDirectory: options.aiWorkingDirectory ?? wiki.registration.repoPath,
        sessionManager: wiki.sessionManager ?? undefined,
    };

    await handleAskCore(res, askReq, resolvedContext);
}

// ============================================================================
// Core Ask Logic (shared by native and dw handlers)
// ============================================================================

/**
 * Core ask handler logic — shared between the multi-wiki handler
 * (`handleWikiAskRequest`) and the standalone deep-wiki handler
 * (`handleAskRequest` in `dw-ask-handler.ts`).
 *
 * The caller is responsible for:
 *   - Resolving the context (WikiManager lookup or flat injection)
 *   - Parsing and validating the request body
 *
 * This function handles:
 *   - SSE header setup
 *   - Context retrieval via ContextBuilder
 *   - Session management (create/reuse/fallback)
 *   - Prompt building and AI invocation
 *   - SSE streaming (context, chunks, done, error events)
 *   - `res.end()`
 */
export async function handleAskCore(
    res: ServerResponse,
    askReq: AskRequest,
    context: ResolvedAskContext,
): Promise<void> {
    // Set SSE headers (CORS is handled by the router/middleware layer)
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
    });

    try {
        // Retrieve context
        const retrieved = context.contextBuilder.retrieve(askReq.question);
        sendSSE(res, {
            type: 'context',
            componentIds: retrieved.componentIds,
            ...(retrieved.themeContexts.length > 0 ? {
                themeIds: retrieved.themeContexts.map((t: { themeId: string; slug: string }) => `${t.themeId}/${t.slug}`),
            } : {}),
        });

        // Determine session mode vs legacy mode
        const sessionManager = context.sessionManager;
        let sessionId = askReq.sessionId;
        let isSessionMode = false;

        if (sessionManager) {
            if (sessionId) {
                const existing = sessionManager.get(sessionId);
                if (existing) {
                    isSessionMode = true;
                } else {
                    sessionId = undefined;
                }
            }
            if (!sessionId) {
                const newSession = sessionManager.create();
                if (newSession) {
                    sessionId = newSession.sessionId;
                    isSessionMode = true;
                }
            }
        }

        let fullResponse: string;
        const { model, workingDirectory, sendMessage } = context;

        if (isSessionMode && sessionManager && sessionId) {
            const prompt = buildAskPrompt(
                askReq.question,
                retrieved.contextText,
                retrieved.graphSummary,
                undefined,
            );
            const result = await sessionManager.send(sessionId, prompt, {
                model,
                workingDirectory,
                onStreamingChunk: (chunk: string) => {
                    sendSSE(res, { type: 'chunk', content: chunk });
                },
            });
            fullResponse = result.response;
        } else {
            const prompt = buildAskPrompt(
                askReq.question,
                retrieved.contextText,
                retrieved.graphSummary,
                askReq.conversationHistory,
            );
            fullResponse = await sendMessage(prompt, {
                model,
                workingDirectory,
                onStreamingChunk: (chunk: string) => {
                    sendSSE(res, { type: 'chunk', content: chunk });
                },
            });
        }

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

// ============================================================================
// Prompt Building
// ============================================================================

/**
 * Build the AI prompt for Q&A.
 */
export function buildAskPrompt(
    question: string,
    contextText: string,
    graphSummary: string,
    conversationHistory?: ConversationMessage[],
): string {
    const parts: string[] = [];

    parts.push('You are a knowledgeable assistant for a software project wiki.');
    parts.push('Answer the user\'s question based on the provided component documentation and architecture context.');
    parts.push('If the documentation doesn\'t contain enough information to answer, say so clearly.');
    parts.push('Use markdown formatting in your response. Reference specific components by name when relevant.');
    parts.push('');

    parts.push('## Architecture Overview');
    parts.push('');
    parts.push(graphSummary);
    parts.push('');

    if (contextText) {
        parts.push('## Relevant Component Documentation');
        parts.push('');
        parts.push(contextText);
        parts.push('');
    }

    if (conversationHistory && conversationHistory.length > 0) {
        parts.push('## Conversation History');
        parts.push('');
        for (const msg of conversationHistory) {
            const role = msg.role === 'user' ? 'User' : 'Assistant';
            parts.push(`**${role}:** ${msg.content}`);
            parts.push('');
        }
    }

    parts.push('## Current Question');
    parts.push('');
    parts.push(question);

    return parts.join('\n');
}

// ============================================================================
// SSE Utilities (shared — imported by explore-handler and generate-handler)
// ============================================================================

/**
 * Send a Server-Sent Event.
 * Returns false if the response stream is no longer writable (client disconnected).
 */
export function sendSSE(res: ServerResponse, data: Record<string, unknown>): boolean {
    if (res.destroyed || res.writableEnded) {
        return false;
    }
    try {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
        return true;
    } catch {
        return false;
    }
}

/** Read the raw request body as a string. */
export function readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        req.on('end', () => resolve(body));
        req.on('error', reject);
    });
}
