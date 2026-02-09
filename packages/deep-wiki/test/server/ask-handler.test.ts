/**
 * Tests for Ask Handler - AI Q&A endpoint with SSE streaming.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IncomingMessage, ServerResponse } from 'http';
import { Socket } from 'net';
import { handleAskRequest, buildAskPrompt, chunkText, sendSSE } from '../../src/server/ask-handler';
import { ContextBuilder } from '../../src/server/context-builder';
import type { ModuleGraph } from '../../src/types';
import type { AskHandlerOptions } from '../../src/server/ask-handler';

// ============================================================================
// Helpers
// ============================================================================

function createTestGraph(): ModuleGraph {
    return {
        project: {
            name: 'TestProject',
            description: 'Test project',
            language: 'TypeScript',
            buildSystem: 'npm',
        },
        categories: ['core'],
        modules: [
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

        // Should have context, chunk(s), and done events
        const types = events.map(e => e.type);
        expect(types).toContain('context');
        expect(types).toContain('chunk');
        expect(types).toContain('done');

        // SSE headers
        const headers = getHeaders();
        expect(headers['Content-Type']).toBe('text/event-stream');
        expect(headers['Cache-Control']).toBe('no-cache');
    });

    it('should include moduleIds in context event', async () => {
        const req = createMockRequest(JSON.stringify({ question: 'How does authentication work?' }));
        const { res, getOutput } = createMockResponse();

        await handleAskRequest(req, res, options);

        const events = parseSSEEvents(getOutput());
        const contextEvent = events.find(e => e.type === 'context');
        expect(contextEvent).toBeDefined();
        expect(contextEvent!.moduleIds).toBeDefined();
        expect(Array.isArray(contextEvent!.moduleIds)).toBe(true);
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

    it('should call sendMessage with a prompt', async () => {
        const req = createMockRequest(JSON.stringify({ question: 'How does auth work?' }));
        const { res } = createMockResponse();

        await handleAskRequest(req, res, options);

        expect(mockSendMessage).toHaveBeenCalledTimes(1);
        const prompt = mockSendMessage.mock.calls[0][0];
        expect(prompt).toContain('How does auth work?');
        expect(prompt).toContain('Current Question');
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

    it('should pass model and workingDirectory options to sendMessage', async () => {
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
            expect.objectContaining({ model: 'gpt-4', workingDirectory: '/test/dir' }),
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
        expect(prompt).toContain('Relevant Module Documentation');
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

        sendSSE(mockRes, { type: 'context', moduleIds: ['a', 'b'] });

        expect(written).toBe('data: {"type":"context","moduleIds":["a","b"]}\n\n');
    });
});
