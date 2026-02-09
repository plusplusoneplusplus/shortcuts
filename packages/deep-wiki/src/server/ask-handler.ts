/**
 * Ask Handler
 *
 * POST /api/ask — AI Q&A endpoint with SSE streaming.
 * Takes a user question + optional conversation history, retrieves
 * relevant module context via TF-IDF, and streams an AI answer via
 * Server-Sent Events.
 *
 * Multi-turn conversation is supported: the client sends the full
 * conversation history and we include it in the AI prompt.
 */

import type { IncomingMessage, ServerResponse } from 'http';
import { ContextBuilder } from './context-builder';

// ============================================================================
// Types
// ============================================================================

/** A single message in a conversation turn. */
export interface ConversationMessage {
    role: 'user' | 'assistant';
    content: string;
}

/** Request body for POST /api/ask. */
export interface AskRequest {
    question: string;
    conversationHistory?: ConversationMessage[];
}

/** Options for the ask handler. */
export interface AskHandlerOptions {
    contextBuilder: ContextBuilder;
    sendMessage: AskAIFunction;
    model?: string;
    workingDirectory?: string;
}

/**
 * Abstraction over the AI SDK's sendMessage for testability.
 * Returns an async iterable of string chunks (streaming) or a single string.
 */
export type AskAIFunction = (prompt: string, options?: {
    model?: string;
    workingDirectory?: string;
}) => Promise<string>;

// ============================================================================
// Handler
// ============================================================================

/**
 * Handle POST /api/ask — streamed as SSE.
 *
 * SSE protocol:
 *   data: {"type":"context","moduleIds":["mod1","mod2"]}
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

        // Send context event
        sendSSE(res, {
            type: 'context',
            moduleIds: context.moduleIds,
        });

        // 2. Build prompt
        const prompt = buildAskPrompt(
            askReq.question,
            context.contextText,
            context.graphSummary,
            askReq.conversationHistory,
        );

        // 3. Call AI
        const fullResponse = await options.sendMessage(prompt, {
            model: options.model,
            workingDirectory: options.workingDirectory,
        });

        // 4. Stream the response in chunks (simulated chunking for non-streaming SDK)
        const chunks = chunkText(fullResponse, 100);
        for (const chunk of chunks) {
            sendSSE(res, { type: 'chunk', content: chunk });
        }

        // 5. Send done event
        sendSSE(res, { type: 'done', fullResponse });

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
    parts.push('Answer the user\'s question based on the provided module documentation and architecture context.');
    parts.push('If the documentation doesn\'t contain enough information to answer, say so clearly.');
    parts.push('Use markdown formatting in your response. Reference specific modules by name when relevant.');
    parts.push('');

    // Architecture overview
    parts.push('## Architecture Overview');
    parts.push('');
    parts.push(graphSummary);
    parts.push('');

    // Relevant module documentation
    if (contextText) {
        parts.push('## Relevant Module Documentation');
        parts.push('');
        parts.push(contextText);
        parts.push('');
    }

    // Conversation history
    if (conversationHistory && conversationHistory.length > 0) {
        parts.push('## Conversation History');
        parts.push('');
        for (const msg of conversationHistory) {
            const role = msg.role === 'user' ? 'User' : 'Assistant';
            parts.push(`**${role}:** ${msg.content}`);
            parts.push('');
        }
    }

    // Current question
    parts.push('## Current Question');
    parts.push('');
    parts.push(question);

    return parts.join('\n');
}

// ============================================================================
// SSE Utilities
// ============================================================================

/**
 * Send a Server-Sent Event.
 */
export function sendSSE(res: ServerResponse, data: Record<string, unknown>): void {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
}

/**
 * Chunk text into smaller pieces for streaming simulation.
 */
export function chunkText(text: string, chunkSize: number): string[] {
    if (!text) return [];
    const chunks: string[] = [];
    for (let i = 0; i < text.length; i += chunkSize) {
        chunks.push(text.slice(i, i + chunkSize));
    }
    return chunks;
}

// ============================================================================
// Body Reader
// ============================================================================

function readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', (chunk: Buffer) => {
            body += chunk.toString();
        });
        req.on('end', () => resolve(body));
        req.on('error', reject);
    });
}
