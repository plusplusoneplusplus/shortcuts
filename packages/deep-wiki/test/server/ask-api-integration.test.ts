/**
 * Integration tests for POST /api/ask endpoint.
 *
 * Tests the wiring between api-handlers.ts, ask-handler.ts, and context-builder.ts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { ModuleGraph } from '../../src/types';
import { createServer } from '../../src/server/index';
import type { WikiServer } from '../../src/server/index';

// ============================================================================
// Fixtures
// ============================================================================

function createTestGraph(): ModuleGraph {
    return {
        project: {
            name: 'TestProject',
            description: 'Test project for AI Q&A integration',
            language: 'TypeScript',
            buildSystem: 'npm',
        },
        categories: ['core', 'ui'],
        modules: [
            {
                id: 'auth',
                name: 'Authentication',
                category: 'core',
                path: 'src/auth',
                purpose: 'JWT authentication system',
                complexity: 'high',
                keyFiles: ['src/auth/jwt.ts'],
                dependencies: [],
                dependents: ['api'],
            },
            {
                id: 'api',
                name: 'API',
                category: 'core',
                path: 'src/api',
                purpose: 'REST API endpoints',
                complexity: 'medium',
                keyFiles: ['src/api/routes.ts'],
                dependencies: ['auth'],
                dependents: [],
            },
        ],
    };
}

function setupWikiDir(): string {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deep-wiki-ask-test-'));

    // Write module graph
    fs.writeFileSync(
        path.join(tmpDir, 'module-graph.json'),
        JSON.stringify(createTestGraph()),
    );

    // Write markdown files
    const articlesDir = path.join(tmpDir, 'articles');
    fs.mkdirSync(articlesDir, { recursive: true });
    fs.writeFileSync(
        path.join(articlesDir, 'auth.md'),
        '# Authentication\n\nThis module handles JWT token creation and validation.\n',
    );
    fs.writeFileSync(
        path.join(articlesDir, 'api.md'),
        '# API Routes\n\nREST endpoints with Express middleware.\n',
    );

    return tmpDir;
}

function makeRequest(
    port: number,
    method: string,
    path: string,
    body?: unknown,
): Promise<{ statusCode: number; body: string; headers: http.IncomingHttpHeaders }> {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'localhost',
            port,
            path,
            method,
            headers: body ? { 'Content-Type': 'application/json' } : {},
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk.toString());
            res.on('end', () => resolve({ statusCode: res.statusCode!, body: data, headers: res.headers }));
        });

        req.on('error', reject);
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

function parseSSEEvents(body: string): Array<Record<string, unknown>> {
    const events: Array<Record<string, unknown>> = [];
    const lines = body.split('\n');
    for (const line of lines) {
        if (line.startsWith('data: ')) {
            try {
                events.push(JSON.parse(line.slice(6)));
            } catch { /* ignore */ }
        }
    }
    return events;
}

// ============================================================================
// Tests
// ============================================================================

describe('POST /api/ask integration', () => {
    let tmpDir: string;
    let wikiServer: WikiServer;

    beforeEach(async () => {
        tmpDir = setupWikiDir();
    });

    afterEach(async () => {
        if (wikiServer) {
            await wikiServer.close();
        }
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('should return 400 when AI is not enabled', async () => {
        wikiServer = await createServer({
            wikiDir: tmpDir,
            port: 0,
            aiEnabled: false,
        });

        const { statusCode, body } = await makeRequest(
            wikiServer.port, 'POST', '/api/ask',
            { question: 'test' },
        );

        expect(statusCode).toBe(400);
        expect(body).toContain('AI features are not enabled');
    });

    it('should return 400 when AI enabled but no sendMessage function', async () => {
        wikiServer = await createServer({
            wikiDir: tmpDir,
            port: 0,
            aiEnabled: true,
            // no aiSendMessage provided
        });

        const { statusCode, body } = await makeRequest(
            wikiServer.port, 'POST', '/api/ask',
            { question: 'test' },
        );

        expect(statusCode).toBe(400);
        expect(body).toContain('AI service is not configured');
    });

    it('should stream SSE response when AI is properly configured', async () => {
        const mockSendMessage = vi.fn().mockResolvedValue('The auth module uses JWT tokens for session management.');

        wikiServer = await createServer({
            wikiDir: tmpDir,
            port: 0,
            aiEnabled: true,
            aiSendMessage: mockSendMessage,
        });

        const { statusCode, body, headers } = await makeRequest(
            wikiServer.port, 'POST', '/api/ask',
            { question: 'How does authentication work?' },
        );

        expect(statusCode).toBe(200);
        expect(headers['content-type']).toBe('text/event-stream');

        const events = parseSSEEvents(body);
        const types = events.map(e => e.type);

        expect(types).toContain('context');
        expect(types).toContain('done');

        // The done event should have the full AI response
        const doneEvent = events.find(e => e.type === 'done');
        expect(doneEvent!.fullResponse).toBe('The auth module uses JWT tokens for session management.');
    });

    it('should build context builder when AI is enabled', async () => {
        const mockSendMessage = vi.fn().mockResolvedValue('Test response');

        wikiServer = await createServer({
            wikiDir: tmpDir,
            port: 0,
            aiEnabled: true,
            aiSendMessage: mockSendMessage,
        });

        expect(wikiServer.contextBuilder).toBeDefined();
        expect(wikiServer.contextBuilder!.documentCount).toBe(2);
    });

    it('should not build context builder when AI is disabled', async () => {
        wikiServer = await createServer({
            wikiDir: tmpDir,
            port: 0,
            aiEnabled: false,
        });

        expect(wikiServer.contextBuilder).toBeUndefined();
    });

    it('should include context module IDs from TF-IDF in SSE', async () => {
        const mockSendMessage = vi.fn().mockResolvedValue('Auth uses JWT.');

        wikiServer = await createServer({
            wikiDir: tmpDir,
            port: 0,
            aiEnabled: true,
            aiSendMessage: mockSendMessage,
        });

        const { body } = await makeRequest(
            wikiServer.port, 'POST', '/api/ask',
            { question: 'JWT authentication tokens' },
        );

        const events = parseSSEEvents(body);
        const contextEvent = events.find(e => e.type === 'context');
        expect(contextEvent).toBeDefined();
        expect(contextEvent!.moduleIds).toBeDefined();
        expect(Array.isArray(contextEvent!.moduleIds)).toBe(true);
        // auth module should be in context since question matches
        expect(contextEvent!.moduleIds).toContain('auth');
    });

    it('should handle invalid JSON body', async () => {
        const mockSendMessage = vi.fn().mockResolvedValue('test');

        wikiServer = await createServer({
            wikiDir: tmpDir,
            port: 0,
            aiEnabled: true,
            aiSendMessage: mockSendMessage,
        });

        // Send raw invalid JSON
        const { statusCode, body } = await new Promise<{ statusCode: number; body: string }>((resolve, reject) => {
            const req = http.request({
                hostname: 'localhost',
                port: wikiServer.port,
                path: '/api/ask',
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
            }, (res) => {
                let data = '';
                res.on('data', (chunk) => data += chunk.toString());
                res.on('end', () => resolve({ statusCode: res.statusCode!, body: data }));
            });
            req.on('error', reject);
            req.write('not valid json');
            req.end();
        });

        expect(statusCode).toBe(400);
        expect(body).toContain('Invalid JSON body');
    });

    it('should handle AI service errors gracefully', async () => {
        const mockSendMessage = vi.fn().mockRejectedValue(new Error('AI provider timeout'));

        wikiServer = await createServer({
            wikiDir: tmpDir,
            port: 0,
            aiEnabled: true,
            aiSendMessage: mockSendMessage,
        });

        const { body } = await makeRequest(
            wikiServer.port, 'POST', '/api/ask',
            { question: 'How does auth work?' },
        );

        const events = parseSSEEvents(body);
        const errorEvent = events.find(e => e.type === 'error');
        expect(errorEvent).toBeDefined();
        expect(errorEvent!.message).toBe('AI provider timeout');
    });

    it('should pass model option to AI sendMessage', async () => {
        const mockSendMessage = vi.fn().mockResolvedValue('test response');

        wikiServer = await createServer({
            wikiDir: tmpDir,
            port: 0,
            aiEnabled: true,
            aiSendMessage: mockSendMessage,
            aiModel: 'gpt-4',
        });

        await makeRequest(
            wikiServer.port, 'POST', '/api/ask',
            { question: 'test' },
        );

        expect(mockSendMessage).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({ model: 'gpt-4' }),
        );
    });

    it('should support conversation history for multi-turn (legacy mode without sessionManager)', async () => {
        // Test legacy mode — send conversationHistory, no sessionId
        // When sessionManager creates a new session, history is NOT embedded.
        // But the question should still be in the prompt.
        const mockSendMessage = vi.fn().mockResolvedValue('More details about JWT...');

        wikiServer = await createServer({
            wikiDir: tmpDir,
            port: 0,
            aiEnabled: true,
            aiSendMessage: mockSendMessage,
        });

        const { body } = await makeRequest(
            wikiServer.port, 'POST', '/api/ask',
            {
                question: 'Tell me more about tokens',
                conversationHistory: [
                    { role: 'user', content: 'How does auth work?' },
                    { role: 'assistant', content: 'It uses JWT tokens.' },
                ],
            },
        );

        const prompt = mockSendMessage.mock.calls[0][0];
        expect(prompt).toContain('Tell me more about tokens');

        // Session-based mode: done event should include sessionId
        const events = parseSSEEvents(body);
        const doneEvent = events.find(e => e.type === 'done');
        expect(doneEvent).toBeDefined();
        expect(doneEvent!.sessionId).toBeDefined();
        expect(typeof doneEvent!.sessionId).toBe('string');
    });

    it('should return sessionId in done event for new conversations', async () => {
        const mockSendMessage = vi.fn().mockResolvedValue('Test response');

        wikiServer = await createServer({
            wikiDir: tmpDir,
            port: 0,
            aiEnabled: true,
            aiSendMessage: mockSendMessage,
        });

        const { body } = await makeRequest(
            wikiServer.port, 'POST', '/api/ask',
            { question: 'How does auth work?' },
        );

        const events = parseSSEEvents(body);
        const doneEvent = events.find(e => e.type === 'done');
        expect(doneEvent).toBeDefined();
        expect(doneEvent!.sessionId).toBeDefined();
        expect(typeof doneEvent!.sessionId).toBe('string');
    });

    it('should reuse session for follow-up questions', async () => {
        const mockSendMessage = vi.fn()
            .mockResolvedValueOnce('Auth uses JWT tokens.')
            .mockResolvedValueOnce('More details about JWT...');

        wikiServer = await createServer({
            wikiDir: tmpDir,
            port: 0,
            aiEnabled: true,
            aiSendMessage: mockSendMessage,
        });

        // First question — get sessionId
        const { body: body1 } = await makeRequest(
            wikiServer.port, 'POST', '/api/ask',
            { question: 'How does auth work?' },
        );
        const events1 = parseSSEEvents(body1);
        const sessionId = (events1.find(e => e.type === 'done') as any)?.sessionId;
        expect(sessionId).toBeDefined();

        // Second question — reuse session
        const { body: body2 } = await makeRequest(
            wikiServer.port, 'POST', '/api/ask',
            { question: 'Tell me more about tokens', sessionId },
        );
        const events2 = parseSSEEvents(body2);
        const doneEvent2 = events2.find(e => e.type === 'done');
        expect(doneEvent2).toBeDefined();
        expect(doneEvent2!.sessionId).toBe(sessionId);

        // Verify the second call did NOT include conversation history in prompt
        const secondPrompt = mockSendMessage.mock.calls[1][0];
        expect(secondPrompt).not.toContain('Conversation History');
        expect(secondPrompt).toContain('Tell me more about tokens');
    });

    it('should destroy session via DELETE endpoint', async () => {
        const mockSendMessage = vi.fn().mockResolvedValue('Test response');

        wikiServer = await createServer({
            wikiDir: tmpDir,
            port: 0,
            aiEnabled: true,
            aiSendMessage: mockSendMessage,
        });

        // Create a session
        const { body } = await makeRequest(
            wikiServer.port, 'POST', '/api/ask',
            { question: 'test' },
        );
        const events = parseSSEEvents(body);
        const sessionId = (events.find(e => e.type === 'done') as any)?.sessionId;
        expect(sessionId).toBeDefined();

        // Destroy it
        const deleteResult = await makeRequest(
            wikiServer.port, 'DELETE', `/api/ask/session/${sessionId}`,
        );
        expect(deleteResult.statusCode).toBe(200);
        const deleteBody = JSON.parse(deleteResult.body);
        expect(deleteBody.destroyed).toBe(true);

        // Verify it's gone — next request should create new session
        const { body: body2 } = await makeRequest(
            wikiServer.port, 'POST', '/api/ask',
            { question: 'follow up', sessionId },
        );
        const events2 = parseSSEEvents(body2);
        const doneEvent2 = events2.find(e => e.type === 'done');
        expect(doneEvent2!.sessionId).toBeDefined();
        expect(doneEvent2!.sessionId).not.toBe(sessionId);
    });
});
