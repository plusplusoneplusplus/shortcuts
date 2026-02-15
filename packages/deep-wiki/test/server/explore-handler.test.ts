/**
 * Tests for Explore Handler - on-demand deep-dive endpoint.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IncomingMessage, ServerResponse } from 'http';
import { Socket } from 'net';
import { handleExploreRequest, buildExplorePrompt } from '../../src/server/explore-handler';
import { WikiData } from '../../src/server/wiki-data';
import type { ExploreHandlerOptions } from '../../src/server/explore-handler';
import type { ComponentGraph } from '../../src/types';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

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
                name: 'Authentication',
                category: 'core',
                path: 'src/auth',
                purpose: 'JWT authentication',
                complexity: 'high',
                keyFiles: ['src/auth/jwt.ts'],
                dependencies: ['db'],
                dependents: ['api'],
            },
            {
                id: 'db',
                name: 'Database',
                category: 'core',
                path: 'src/db',
                purpose: 'Database layer',
                complexity: 'medium',
                keyFiles: ['src/db/pool.ts'],
                dependencies: [],
                dependents: ['auth'],
            },
        ],
    };
}

function setupWikiDir(): string {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deep-wiki-explore-'));
    fs.writeFileSync(path.join(tmpDir, 'component-graph.json'), JSON.stringify(createTestGraph()));
    const componentsDir = path.join(tmpDir, 'components');
    fs.mkdirSync(componentsDir, { recursive: true });
    fs.writeFileSync(path.join(componentsDir, 'auth.md'), '# Auth\nJWT token management.');
    fs.writeFileSync(path.join(componentsDir, 'db.md'), '# Database\nConnection pooling.');
    return tmpDir;
}

function createMockRequest(body: string): IncomingMessage {
    const socket = new Socket();
    const req = new IncomingMessage(socket);
    process.nextTick(() => {
        req.push(Buffer.from(body));
        req.push(null);
    });
    return req;
}

function createMockResponse(): { res: ServerResponse; getOutput: () => string; getStatusCode: () => number } {
    const socket = new Socket();
    const res = new ServerResponse(new IncomingMessage(socket));
    let output = '';
    let statusCode = 200;

    res.writeHead = function (code: number, hdrs?: any) {
        statusCode = code;
        return res;
    } as any;
    res.write = function (chunk: any) {
        output += chunk.toString();
        return true;
    } as any;
    res.end = function (chunk?: any) {
        if (chunk) output += chunk.toString();
        return res;
    } as any;

    return { res, getOutput: () => output, getStatusCode: () => statusCode };
}

function parseSSEEvents(output: string): Array<Record<string, unknown>> {
    const events: Array<Record<string, unknown>> = [];
    for (const line of output.split('\n')) {
        if (line.startsWith('data: ')) {
            try { events.push(JSON.parse(line.slice(6))); } catch { /* ignore */ }
        }
    }
    return events;
}

// ============================================================================
// handleExploreRequest Tests
// ============================================================================

describe('handleExploreRequest', () => {
    let tmpDir: string;
    let wikiData: WikiData;
    let mockSendMessage: ReturnType<typeof vi.fn>;
    let options: ExploreHandlerOptions;

    beforeEach(() => {
        tmpDir = setupWikiDir();
        wikiData = new WikiData(tmpDir);
        wikiData.load();
        mockSendMessage = vi.fn().mockResolvedValue('Deep analysis of the auth module...');
        options = { wikiData, sendMessage: mockSendMessage };
    });

    it('should return 404 for non-existent component', async () => {
        const req = createMockRequest('{}');
        const { res, getOutput, getStatusCode } = createMockResponse();

        await handleExploreRequest(req, res, 'nonexistent', options);

        expect(getStatusCode()).toBe(404);
        expect(getOutput()).toContain('Component not found');
    });

    it('should return 400 for invalid JSON body', async () => {
        const req = createMockRequest('bad json');
        const { res, getOutput, getStatusCode } = createMockResponse();

        await handleExploreRequest(req, res, 'auth', options);

        expect(getStatusCode()).toBe(400);
        expect(getOutput()).toContain('Invalid JSON body');
    });

    it('should accept empty body', async () => {
        const req = createMockRequest('');
        const { res, getOutput } = createMockResponse();

        await handleExploreRequest(req, res, 'auth', options);

        const events = parseSSEEvents(getOutput());
        expect(events.some(e => e.type === 'done')).toBe(true);
    });

    it('should stream SSE events for valid explore request', async () => {
        const req = createMockRequest(JSON.stringify({ depth: 'deep' }));
        const { res, getOutput } = createMockResponse();

        await handleExploreRequest(req, res, 'auth', options);

        const events = parseSSEEvents(getOutput());
        const types = events.map(e => e.type);
        expect(types).toContain('status');
        expect(types).toContain('done');
    });

    it('should emit SSE chunk events via onStreamingChunk callback', async () => {
        // Set up sendMessage to invoke onStreamingChunk
        const streamingSendMessage = vi.fn().mockImplementation(
            async (prompt: string, opts?: { onStreamingChunk?: (chunk: string) => void }) => {
                if (opts?.onStreamingChunk) {
                    opts.onStreamingChunk('Deep ');
                    opts.onStreamingChunk('analysis');
                }
                return 'Deep analysis';
            }
        );

        const streamingOptions: ExploreHandlerOptions = {
            wikiData,
            sendMessage: streamingSendMessage,
        };

        const req = createMockRequest(JSON.stringify({ depth: 'deep' }));
        const { res, getOutput } = createMockResponse();

        await handleExploreRequest(req, res, 'auth', streamingOptions);

        const events = parseSSEEvents(getOutput());

        // Should have status, 2 chunk events, and done
        const chunkEvents = events.filter(e => e.type === 'chunk');
        expect(chunkEvents.length).toBe(2);
        expect(chunkEvents[0].text).toBe('Deep ');
        expect(chunkEvents[1].text).toBe('analysis');

        const doneEvent = events.find(e => e.type === 'done');
        expect(doneEvent).toBeDefined();
        expect(doneEvent!.fullResponse).toBe('Deep analysis');
    });

    it('should include component name in status message', async () => {
        const req = createMockRequest('{}');
        const { res, getOutput } = createMockResponse();

        await handleExploreRequest(req, res, 'auth', options);

        const events = parseSSEEvents(getOutput());
        const statusEvent = events.find(e => e.type === 'status');
        expect(statusEvent?.message).toContain('Authentication');
    });

    it('should include full response in done event', async () => {
        const req = createMockRequest('{}');
        const { res, getOutput } = createMockResponse();

        await handleExploreRequest(req, res, 'auth', options);

        const events = parseSSEEvents(getOutput());
        const doneEvent = events.find(e => e.type === 'done');
        expect(doneEvent?.fullResponse).toBe('Deep analysis of the auth module...');
    });

    it('should call sendMessage with explore prompt', async () => {
        const req = createMockRequest(JSON.stringify({ question: 'How does retry work?' }));
        const { res } = createMockResponse();

        await handleExploreRequest(req, res, 'auth', options);

        expect(mockSendMessage).toHaveBeenCalledTimes(1);
        const prompt = mockSendMessage.mock.calls[0][0];
        expect(prompt).toContain('Authentication');
        expect(prompt).toContain('How does retry work?');
    });

    it('should pass model, workingDirectory, and onStreamingChunk options', async () => {
        const optWithModel: ExploreHandlerOptions = {
            ...options,
            model: 'gpt-4',
            workingDirectory: '/test',
        };
        const req = createMockRequest('{}');
        const { res } = createMockResponse();

        await handleExploreRequest(req, res, 'auth', optWithModel);

        expect(mockSendMessage).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({
                model: 'gpt-4',
                workingDirectory: '/test',
                onStreamingChunk: expect.any(Function),
            }),
        );
    });

    it('should send error event when AI fails', async () => {
        const failOptions: ExploreHandlerOptions = {
            wikiData,
            sendMessage: vi.fn().mockRejectedValue(new Error('AI timeout')),
        };
        const req = createMockRequest('{}');
        const { res, getOutput } = createMockResponse();

        await handleExploreRequest(req, res, 'auth', failOptions);

        const events = parseSSEEvents(getOutput());
        const errorEvent = events.find(e => e.type === 'error');
        expect(errorEvent).toBeDefined();
        expect(errorEvent?.message).toBe('AI timeout');
    });

    it('should include existing markdown in prompt', async () => {
        const req = createMockRequest('{}');
        const { res } = createMockResponse();

        await handleExploreRequest(req, res, 'auth', options);

        const prompt = mockSendMessage.mock.calls[0][0];
        expect(prompt).toContain('Existing Analysis');
        expect(prompt).toContain('JWT token management');
    });
});

// ============================================================================
// buildExplorePrompt Tests
// ============================================================================

describe('buildExplorePrompt', () => {
    const mod = {
        id: 'auth',
        name: 'Auth',
        category: 'core',
        path: 'src/auth',
        purpose: 'Authentication',
        keyFiles: ['jwt.ts'],
        dependencies: ['db'],
        dependents: ['api'],
    };
    const graph = {
        project: { name: 'Test', description: 'test', language: 'TS' },
        components: [{ id: 'auth', name: 'Auth', purpose: 'Auth', dependencies: ['db'] }],
    };

    it('should include component information', () => {
        const prompt = buildExplorePrompt(mod, '', graph, {});
        expect(prompt).toContain('Auth');
        expect(prompt).toContain('src/auth');
        expect(prompt).toContain('Authentication');
    });

    it('should include user question when provided', () => {
        const prompt = buildExplorePrompt(mod, '', graph, { question: 'How does JWT work?' });
        expect(prompt).toContain('User Question');
        expect(prompt).toContain('How does JWT work?');
    });

    it('should include deep analysis task for deep depth', () => {
        const prompt = buildExplorePrompt(mod, '', graph, { depth: 'deep' });
        expect(prompt).toContain('Deep Analysis Task');
        expect(prompt).toContain('architecture');
        expect(prompt).toContain('algorithms');
    });

    it('should include focused analysis for normal depth', () => {
        const prompt = buildExplorePrompt(mod, '', graph, { depth: 'normal' });
        expect(prompt).toContain('Analysis Task');
        expect(prompt).toContain('focused analysis');
    });

    it('should include existing markdown when available', () => {
        const prompt = buildExplorePrompt(mod, '# Auth\nExisting content.', graph, {});
        expect(prompt).toContain('Existing Analysis');
        expect(prompt).toContain('Existing content.');
    });

    it('should not include existing analysis section when empty', () => {
        const prompt = buildExplorePrompt(mod, '', graph, {});
        expect(prompt).not.toContain('Existing Analysis');
    });

    it('should include project architecture', () => {
        const prompt = buildExplorePrompt(mod, '', graph, {});
        expect(prompt).toContain('Project Architecture');
        expect(prompt).toContain('Test');
    });

    it('should include dependencies and dependents', () => {
        const prompt = buildExplorePrompt(mod, '', graph, {});
        expect(prompt).toContain('db');
        expect(prompt).toContain('api');
    });
});
