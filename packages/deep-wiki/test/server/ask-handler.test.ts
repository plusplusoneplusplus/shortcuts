/**
 * Tests for Ask Handler - AI Q&A endpoint with SSE streaming.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IncomingMessage, ServerResponse } from 'http';
import { Socket } from 'net';
import { handleAskRequest, buildAskPrompt, chunkText, sendSSE } from '../../src/server/ask-handler';
import { ContextBuilder } from '../../src/server/context-builder';
import { ConversationSessionManager } from '../../src/server/conversation-session-manager';
import type { ComponentGraph } from '../../src/types';
import type { AskHandlerOptions } from '../../src/server/ask-handler';

// ============================================================================
// Helpers
// ============================================================================

function createTestGraph(): ComponentGraph {
    return {
        project: {
            name: 'TestProject',
            description: 'Test project',
            language: 'TypeScript',
            buildSystem: 'npm',
        },
        categories: ['core'],
        components: [
            {
                id: 'auth',
                name: 'Auth',
                category: 'core',
                path: 'src/auth',
                purpose: 'Authentication service',
                complexity: 'medium',
                keyFiles: ['src/auth/index.ts'],
                dependencies: [],
                dependents: [],
            },
            {
                id: 'api',
                name: 'API',
                category: 'core',
                path: 'src/api',
                purpose: 'REST API endpoints',
                complexity: 'high',
                keyFiles: ['src/api/routes.ts'],
                dependencies: ['auth'],
                dependents: [],
            },
        ],
    };
}

function createContextBuilder(): ContextBuilder {
    const graph = createTestGraph();
    const markdownData = {
        'auth': '# Auth\nHandles user login with JWT tokens.',
        'api': '# API\nREST endpoints for the application.',
    };
    return new ContextBuilder(graph, markdownData);
}

/** Create a mock IncomingMessage with a JSON body */
function createMockRequest(body: string): IncomingMessage {
    const socket = new Socket();
    const req = new IncomingMessage(socket);

    // Simulate body streaming
    process.nextTick(() => {
        req.push(Buffer.from(body));
        req.push(null);
    });

    return req;
}

/** Create a mock ServerResponse that captures output */
function createMockResponse(): { res: ServerResponse; getOutput: () => string; getStatusCode: () => number; getHeaders: () => Record<string, unknown> } {
    const socket = new Socket();
    const res = new ServerResponse(new IncomingMessage(socket));

    let output = '';
    let statusCode = 200;
    const headers: Record<string, unknown> = {};

    const origWriteHead = res.writeHead.bind(res);
    res.writeHead = function (code: number, hdrs?: any) {
        statusCode = code;
        if (hdrs && typeof hdrs === 'object') {
            Object.assign(headers, hdrs);
        }
        return origWriteHead(code, hdrs);
    } as any;

    const origWrite = res.write.bind(res);
    res.write = function (chunk: any, ...args: any[]) {
        output += chunk.toString();
        return true;
    } as any;

    const origEnd = res.end.bind(res);
    res.end = function (chunk?: any, ...args: any[]) {
        if (chunk) output += chunk.toString();
        return res;
    } as any;

    return {
        res,
        getOutput: () => output,
        getStatusCode: () => statusCode,
        getHeaders: () => headers,
    };
}

function parseSSEEvents(output: string): Array<Record<string, unknown>> {
    const events: Array<Record<string, unknown>> = [];
    const lines = output.split('\n');
    for (const line of lines) {
        if (line.startsWith('data: ')) {
            try {
                events.push(JSON.parse(line.slice(6)));
            } catch { /* ignore malformed lines */ }
        }
    }
    return events;
}

// ============================================================================
// handleAskRequest Tests
// ============================================================================

describe('handleAskRequest', () => {
    let contextBuilder: ContextBuilder;
    let mockSendMessage: ReturnType<typeof vi.fn>;
    let options: AskHandlerOptions;

    beforeEach(() => {
        contextBuilder = createContextBuilder();
        mockSendMessage = vi.fn().mockResolvedValue('This is the AI response about authentication.');
        options = {
            contextBuilder,
            sendMessage: mockSendMessage,
        };
    });

    it('should return 400 for invalid JSON body', async () => {
        const req = createMockRequest('not valid json');
        const { res, getOutput, getStatusCode } = createMockResponse();

        await handleAskRequest(req, res, options);

        expect(getStatusCode()).toBe(400);
        expect(getOutput()).toContain('Invalid JSON body');
    });

    it('should return 400 for missing question field', async () => {
        const req = createMockRequest(JSON.stringify({ notQuestion: 'test' }));
        const { res, getOutput, getStatusCode } = createMockResponse();

        await handleAskRequest(req, res, options);

        expect(getStatusCode()).toBe(400);
        expect(getOutput()).toContain('Missing or invalid');
        expect(getOutput()).toContain('question');
        expect(getOutput()).toContain('field');
    });

    it('should return 400 for empty question', async () => {
        const req = createMockRequest(JSON.stringify({ question: '' }));
        const { res, getOutput, getStatusCode } = createMockResponse();

        await handleAskRequest(req, res, options);

        expect(getStatusCode()).toBe(400);
    });

    it('should return 400 for non-string question', async () => {
        const req = createMockRequest(JSON.stringify({ question: 42 }));
        const { res, getOutput, getStatusCode } = createMockResponse();

        await handleAskRequest(req, res, options);

        expect(getStatusCode()).toBe(400);
    });

    it('should stream SSE events for a valid question', async () => {
        const req = createMockRequest(JSON.stringify({ question: 'How does auth work?' }));
        const { res, getOutput, getHeaders } = createMockResponse();

        await handleAskRequest(req, res, options);

        const output = getOutput();
        const events = parseSSEEvents(output);

        // Should have context and done events
        // Note: chunk events come from onStreamingChunk callback (only if AI service produces them)
        const types = events.map(e => e.type);
        expect(types).toContain('context');
        expect(types).toContain('done');

        // SSE headers
        const headers = getHeaders();
        expect(headers['Content-Type']).toBe('text/event-stream');
        expect(headers['Cache-Control']).toBe('no-cache');
    });

    it('should include componentIds in context event', async () => {
        const req = createMockRequest(JSON.stringify({ question: 'How does authentication work?' }));
        const { res, getOutput } = createMockResponse();

        await handleAskRequest(req, res, options);

        const events = parseSSEEvents(getOutput());
        const contextEvent = events.find(e => e.type === 'context');
        expect(contextEvent).toBeDefined();
        expect(contextEvent!.componentIds).toBeDefined();
        expect(Array.isArray(contextEvent!.componentIds)).toBe(true);
    });

    it('should include full response in done event', async () => {
        const req = createMockRequest(JSON.stringify({ question: 'How does auth work?' }));
        const { res, getOutput } = createMockResponse();

        await handleAskRequest(req, res, options);

        const events = parseSSEEvents(getOutput());
        const doneEvent = events.find(e => e.type === 'done');
        expect(doneEvent).toBeDefined();
        expect(doneEvent!.fullResponse).toBe('This is the AI response about authentication.');
    });

    it('should call sendMessage with a prompt and onStreamingChunk callback', async () => {
        const req = createMockRequest(JSON.stringify({ question: 'How does auth work?' }));
        const { res } = createMockResponse();

        await handleAskRequest(req, res, options);

        expect(mockSendMessage).toHaveBeenCalledTimes(1);
        const prompt = mockSendMessage.mock.calls[0][0];
        expect(prompt).toContain('How does auth work?');
        expect(prompt).toContain('Current Question');

        // Verify onStreamingChunk callback is passed
        const callOptions = mockSendMessage.mock.calls[0][1];
        expect(callOptions).toBeDefined();
        expect(typeof callOptions.onStreamingChunk).toBe('function');
    });

    it('should include conversation history in prompt', async () => {
        const req = createMockRequest(JSON.stringify({
            question: 'Tell me more about JWT',
            conversationHistory: [
                { role: 'user', content: 'How does auth work?' },
                { role: 'assistant', content: 'Auth uses JWT tokens.' },
            ],
        }));
        const { res } = createMockResponse();

        await handleAskRequest(req, res, options);

        const prompt = mockSendMessage.mock.calls[0][0];
        expect(prompt).toContain('Conversation History');
        expect(prompt).toContain('How does auth work?');
        expect(prompt).toContain('Auth uses JWT tokens.');
        expect(prompt).toContain('Tell me more about JWT');
    });

    it('should pass model, workingDirectory, and onStreamingChunk to sendMessage', async () => {
        const optionsWithModel: AskHandlerOptions = {
            ...options,
            model: 'gpt-4',
            workingDirectory: '/test/dir',
        };

        const req = createMockRequest(JSON.stringify({ question: 'test' }));
        const { res } = createMockResponse();

        await handleAskRequest(req, res, optionsWithModel);

        expect(mockSendMessage).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({
                model: 'gpt-4',
                workingDirectory: '/test/dir',
                onStreamingChunk: expect.any(Function),
            }),
        );
    });

    it('should send error event when AI call fails', async () => {
        const failingOptions: AskHandlerOptions = {
            contextBuilder,
            sendMessage: vi.fn().mockRejectedValue(new Error('AI service unavailable')),
        };

        const req = createMockRequest(JSON.stringify({ question: 'test' }));
        const { res, getOutput } = createMockResponse();

        await handleAskRequest(req, res, failingOptions);

        const events = parseSSEEvents(getOutput());
        const errorEvent = events.find(e => e.type === 'error');
        expect(errorEvent).toBeDefined();
        expect(errorEvent!.message).toBe('AI service unavailable');
    });

    it('should handle questions with no matching context gracefully', async () => {
        const req = createMockRequest(JSON.stringify({ question: 'xyzzy quantum foobar' }));
        const { res, getOutput } = createMockResponse();

        await handleAskRequest(req, res, options);

        const events = parseSSEEvents(getOutput());
        // Should still work — just with potentially empty or few context modules
        expect(events.some(e => e.type === 'done')).toBe(true);
    });

    it('should emit SSE chunk events via onStreamingChunk callback', async () => {
        // Set up sendMessage to invoke onStreamingChunk
        const streamingSendMessage = vi.fn().mockImplementation(
            async (prompt: string, opts?: { onStreamingChunk?: (chunk: string) => void }) => {
                // Simulate streaming by calling onStreamingChunk
                if (opts?.onStreamingChunk) {
                    opts.onStreamingChunk('Hello ');
                    opts.onStreamingChunk('world');
                    opts.onStreamingChunk('!');
                }
                return 'Hello world!';
            }
        );

        const streamingOptions: AskHandlerOptions = {
            contextBuilder,
            sendMessage: streamingSendMessage,
        };

        const req = createMockRequest(JSON.stringify({ question: 'test streaming' }));
        const { res, getOutput } = createMockResponse();

        await handleAskRequest(req, res, streamingOptions);

        const events = parseSSEEvents(getOutput());

        // Should have context, 3 chunk events, and done
        const chunkEvents = events.filter(e => e.type === 'chunk');
        expect(chunkEvents.length).toBe(3);
        expect(chunkEvents[0].content).toBe('Hello ');
        expect(chunkEvents[1].content).toBe('world');
        expect(chunkEvents[2].content).toBe('!');

        const doneEvent = events.find(e => e.type === 'done');
        expect(doneEvent).toBeDefined();
        expect(doneEvent!.fullResponse).toBe('Hello world!');
    });
});

// ============================================================================
// buildAskPrompt Tests
// ============================================================================

describe('buildAskPrompt', () => {
    it('should include the question in the prompt', () => {
        const prompt = buildAskPrompt('How does authentication work?', '', '', undefined);
        expect(prompt).toContain('How does authentication work?');
        expect(prompt).toContain('Current Question');
    });

    it('should include context text when provided', () => {
        const context = '## Module: auth\n\nHandles JWT tokens.';
        const prompt = buildAskPrompt('test', context, '', undefined);
        expect(prompt).toContain('Relevant Component Documentation');
        expect(prompt).toContain('Handles JWT tokens.');
    });

    it('should include graph summary', () => {
        const summary = 'Project: Test\nModules: 5';
        const prompt = buildAskPrompt('test', '', summary, undefined);
        expect(prompt).toContain('Architecture Overview');
        expect(prompt).toContain('Project: Test');
    });

    it('should include conversation history', () => {
        const history = [
            { role: 'user' as const, content: 'What is auth?' },
            { role: 'assistant' as const, content: 'It handles login.' },
        ];
        const prompt = buildAskPrompt('Tell me more', '', '', history);
        expect(prompt).toContain('Conversation History');
        expect(prompt).toContain('**User:** What is auth?');
        expect(prompt).toContain('**Assistant:** It handles login.');
    });

    it('should not include conversation history section when empty', () => {
        const prompt = buildAskPrompt('test', '', '', []);
        expect(prompt).not.toContain('Conversation History');
    });

    it('should not include conversation history section when undefined', () => {
        const prompt = buildAskPrompt('test', '', '', undefined);
        expect(prompt).not.toContain('Conversation History');
    });

    it('should include system instructions', () => {
        const prompt = buildAskPrompt('test', '', '', undefined);
        expect(prompt).toContain('knowledgeable assistant');
        expect(prompt).toContain('markdown formatting');
    });
});

// ============================================================================
// chunkText Tests
// ============================================================================

describe('chunkText', () => {
    it('should chunk text into specified sizes', () => {
        const chunks = chunkText('abcdefghij', 3);
        expect(chunks).toEqual(['abc', 'def', 'ghi', 'j']);
    });

    it('should return single chunk for short text', () => {
        const chunks = chunkText('hi', 10);
        expect(chunks).toEqual(['hi']);
    });

    it('should return empty array for empty text', () => {
        expect(chunkText('', 10)).toEqual([]);
    });

    it('should handle exact chunk size division', () => {
        const chunks = chunkText('abcdef', 3);
        expect(chunks).toEqual(['abc', 'def']);
    });

    it('should handle chunk size of 1', () => {
        const chunks = chunkText('abc', 1);
        expect(chunks).toEqual(['a', 'b', 'c']);
    });
});

// ============================================================================
// sendSSE Tests
// ============================================================================

describe('sendSSE', () => {
    it('should write data in SSE format', () => {
        let written = '';
        const mockRes = {
            write: (data: string) => { written += data; },
        } as unknown as ServerResponse;

        sendSSE(mockRes, { type: 'chunk', content: 'hello' });

        expect(written).toBe('data: {"type":"chunk","content":"hello"}\n\n');
    });

    it('should handle complex objects', () => {
        let written = '';
        const mockRes = {
            write: (data: string) => { written += data; },
        } as unknown as ServerResponse;

        sendSSE(mockRes, { type: 'context', componentIds: ['a', 'b'] });

        expect(written).toBe('data: {"type":"context","componentIds":["a","b"]}\n\n');
    });
});

// ============================================================================
// Session-based conversation tests
// ============================================================================

describe('handleAskRequest with sessionManager', () => {
    let contextBuilder: ContextBuilder;
    let mockSendMessage: ReturnType<typeof vi.fn>;
    let sessionManager: ConversationSessionManager;

    beforeEach(() => {
        contextBuilder = createContextBuilder();
        mockSendMessage = vi.fn().mockResolvedValue('Session-based AI response.');
        sessionManager = new ConversationSessionManager({
            sendMessage: mockSendMessage,
            cleanupIntervalMs: 60000,
        });
    });

    afterEach(() => {
        sessionManager.destroyAll();
    });

    it('should create a new session and return sessionId in done event', async () => {
        const options: AskHandlerOptions = {
            contextBuilder,
            sendMessage: mockSendMessage,
            sessionManager,
        };

        const req = createMockRequest(JSON.stringify({ question: 'How does auth work?' }));
        const { res, getOutput } = createMockResponse();

        await handleAskRequest(req, res, options);

        const events = parseSSEEvents(getOutput());
        const doneEvent = events.find(e => e.type === 'done');
        expect(doneEvent).toBeDefined();
        expect(doneEvent!.sessionId).toBeDefined();
        expect(typeof doneEvent!.sessionId).toBe('string');
        expect(doneEvent!.fullResponse).toBe('Session-based AI response.');
    });

    it('should reuse existing session when sessionId is provided', async () => {
        const options: AskHandlerOptions = {
            contextBuilder,
            sendMessage: mockSendMessage,
            sessionManager,
        };

        // First question
        const req1 = createMockRequest(JSON.stringify({ question: 'First question' }));
        const { res: res1, getOutput: getOutput1 } = createMockResponse();
        await handleAskRequest(req1, res1, options);

        const events1 = parseSSEEvents(getOutput1());
        const sessionId = (events1.find(e => e.type === 'done') as any)?.sessionId;
        expect(sessionId).toBeDefined();

        // Second question with sessionId
        mockSendMessage.mockResolvedValue('Follow-up response.');
        const req2 = createMockRequest(JSON.stringify({
            question: 'Follow-up question',
            sessionId,
        }));
        const { res: res2, getOutput: getOutput2 } = createMockResponse();
        await handleAskRequest(req2, res2, options);

        const events2 = parseSSEEvents(getOutput2());
        const doneEvent2 = events2.find(e => e.type === 'done');
        expect(doneEvent2!.sessionId).toBe(sessionId);
        expect(doneEvent2!.fullResponse).toBe('Follow-up response.');

        // Verify session turn count increased
        const session = sessionManager.get(sessionId);
        expect(session!.turnCount).toBe(2);
    });

    it('should not include conversation history in prompt for session mode', async () => {
        const options: AskHandlerOptions = {
            contextBuilder,
            sendMessage: mockSendMessage,
            sessionManager,
        };

        const req = createMockRequest(JSON.stringify({
            question: 'Follow-up question',
            conversationHistory: [
                { role: 'user', content: 'Previous question' },
                { role: 'assistant', content: 'Previous answer' },
            ],
        }));
        const { res } = createMockResponse();
        await handleAskRequest(req, res, options);

        // Session mode: history should NOT be embedded in prompt
        const prompt = mockSendMessage.mock.calls[0][0];
        expect(prompt).not.toContain('Conversation History');
        expect(prompt).not.toContain('Previous question');
        expect(prompt).toContain('Follow-up question');
    });

    it('should fall back to new session when sessionId is invalid', async () => {
        const options: AskHandlerOptions = {
            contextBuilder,
            sendMessage: mockSendMessage,
            sessionManager,
        };

        const req = createMockRequest(JSON.stringify({
            question: 'Test question',
            sessionId: 'invalid-session-id',
        }));
        const { res, getOutput } = createMockResponse();
        await handleAskRequest(req, res, options);

        const events = parseSSEEvents(getOutput());
        const doneEvent = events.find(e => e.type === 'done');
        expect(doneEvent).toBeDefined();
        expect(doneEvent!.sessionId).toBeDefined();
        // Should get a NEW session ID, not the invalid one
        expect(doneEvent!.sessionId).not.toBe('invalid-session-id');
    });

    it('should fall back to stateless mode when no sessionManager', async () => {
        const options: AskHandlerOptions = {
            contextBuilder,
            sendMessage: mockSendMessage,
            // No sessionManager
        };

        const req = createMockRequest(JSON.stringify({
            question: 'Test',
            conversationHistory: [
                { role: 'user', content: 'Q1' },
                { role: 'assistant', content: 'A1' },
            ],
        }));
        const { res, getOutput } = createMockResponse();
        await handleAskRequest(req, res, options);

        // Should use legacy mode with conversation history in prompt
        const prompt = mockSendMessage.mock.calls[0][0];
        expect(prompt).toContain('Conversation History');
        expect(prompt).toContain('Q1');
        expect(prompt).toContain('A1');

        // No sessionId in response
        const events = parseSSEEvents(getOutput());
        const doneEvent = events.find(e => e.type === 'done');
        expect(doneEvent!.sessionId).toBeUndefined();
    });
});
