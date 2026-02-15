/**
 * Task Generation Handler Tests
 *
 * Tests for the AI-powered task generation and discovery REST API endpoints.
 * Mocks CopilotSDKService to avoid real AI calls.
 *
 * Uses port 0 (OS-assigned) for test isolation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// ============================================================================
// Mock CopilotSDKService
// ============================================================================

const mockSendMessage = vi.fn();
const mockIsAvailable = vi.fn();

vi.mock('@plusplusoneplusplus/pipeline-core', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/pipeline-core')>();
    return {
        ...actual,
        getCopilotSDKService: () => ({
            sendMessage: mockSendMessage,
            isAvailable: mockIsAvailable,
        }),
    };
});

import { createExecutionServer } from '../../src/server/index';
import { FileProcessStore } from '@plusplusoneplusplus/pipeline-core';
import type { ExecutionServer } from '../../src/server/types';

// ============================================================================
// Helpers
// ============================================================================

function request(
    url: string,
    options: { method?: string; body?: string; headers?: Record<string, string> } = {}
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const req = http.request(
            {
                hostname: parsed.hostname,
                port: parsed.port,
                path: parsed.pathname + parsed.search,
                method: options.method || 'GET',
                headers: options.headers,
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk: Buffer) => chunks.push(chunk));
                res.on('end', () => {
                    resolve({
                        status: res.statusCode || 0,
                        headers: res.headers,
                        body: Buffer.concat(chunks).toString('utf-8'),
                    });
                });
            }
        );
        req.on('error', reject);
        if (options.body) req.write(options.body);
        req.end();
    });
}

function postJSON(url: string, data: unknown) {
    return request(url, {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    });
}

/** Parse SSE events from a raw response body */
function parseSSEEvents(body: string): Array<{ event: string; data: any }> {
    const events: Array<{ event: string; data: any }> = [];
    const lines = body.split('\n');
    let currentEvent = '';
    for (const line of lines) {
        if (line.startsWith('event: ')) {
            currentEvent = line.substring(7).trim();
        } else if (line.startsWith('data: ')) {
            try {
                events.push({ event: currentEvent, data: JSON.parse(line.substring(6)) });
            } catch { /* ignore */ }
            currentEvent = '';
        }
    }
    return events;
}

// ============================================================================
// Tests
// ============================================================================

describe('Task Generation Handler', () => {
    let server: ExecutionServer | undefined;
    let dataDir: string;
    let workspaceDir: string;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-gen-handler-test-'));
        workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-gen-workspace-'));
        vi.clearAllMocks();

        // Default: AI available and returns success
        mockIsAvailable.mockResolvedValue({ available: true });
        mockSendMessage.mockResolvedValue({
            success: true,
            response: 'Task generated successfully.',
        });
    });

    afterEach(async () => {
        if (server) {
            await server.close();
            server = undefined;
        }
        fs.rmSync(dataDir, { recursive: true, force: true });
        fs.rmSync(workspaceDir, { recursive: true, force: true });
    });

    async function startServer(): Promise<ExecutionServer> {
        const store = new FileProcessStore({ dataDir });
        server = await createExecutionServer({ port: 0, host: 'localhost', store, dataDir });
        return server;
    }

    async function registerWorkspace(srv: ExecutionServer, rootPath: string): Promise<string> {
        const id = 'test-ws-' + Date.now();
        const res = await postJSON(`${srv.url}/api/workspaces`, {
            id,
            name: 'Test Workspace',
            rootPath,
        });
        expect(res.status).toBe(201);
        return id;
    }

    // ========================================================================
    // POST /api/workspaces/:id/tasks/generate
    // ========================================================================

    describe('POST /api/workspaces/:id/tasks/generate', () => {
        it('should return 404 for unknown workspace', async () => {
            const srv = await startServer();
            const res = await postJSON(`${srv.url}/api/workspaces/nonexistent/tasks/generate`, {
                prompt: 'Create a task',
            });
            expect(res.status).toBe(404);
            const body = JSON.parse(res.body);
            expect(body.error).toBe('Workspace not found');
        });

        it('should return 400 when prompt is missing', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);
            const res = await postJSON(`${srv.url}/api/workspaces/${wsId}/tasks/generate`, {});
            expect(res.status).toBe(400);
            const body = JSON.parse(res.body);
            expect(body.error).toContain('prompt');
        });

        it('should return 400 for empty prompt string', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);
            const res = await postJSON(`${srv.url}/api/workspaces/${wsId}/tasks/generate`, {
                prompt: '   ',
            });
            expect(res.status).toBe(400);
        });

        it('should return SSE stream with progress and done events on success', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);

            const res = await postJSON(`${srv.url}/api/workspaces/${wsId}/tasks/generate`, {
                prompt: 'Build a REST API',
            });

            // SSE returns 200 via the stream headers
            expect(res.status).toBe(200);
            expect(res.headers['content-type']).toContain('text/event-stream');

            const events = parseSSEEvents(res.body);
            const eventTypes = events.map(e => e.event);
            expect(eventTypes).toContain('progress');
            expect(eventTypes).toContain('done');

            const doneEvent = events.find(e => e.event === 'done');
            expect(doneEvent?.data.success).toBe(true);
        });

        it('should forward model parameter to AI invoker', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);

            await postJSON(`${srv.url}/api/workspaces/${wsId}/tasks/generate`, {
                prompt: 'Task with model',
                model: 'gpt-4',
            });

            expect(mockSendMessage).toHaveBeenCalledWith(
                expect.objectContaining({ model: 'gpt-4' })
            );
        });

        it('should create target folder if it does not exist', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);

            await postJSON(`${srv.url}/api/workspaces/${wsId}/tasks/generate`, {
                prompt: 'New task',
                targetFolder: 'my-feature',
            });

            const expectedDir = path.join(workspaceDir, '.vscode/tasks/my-feature');
            expect(fs.existsSync(expectedDir)).toBe(true);
        });

        it('should send error event when AI is unavailable', async () => {
            mockIsAvailable.mockResolvedValue({ available: false, error: 'No SDK' });

            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);

            const res = await postJSON(`${srv.url}/api/workspaces/${wsId}/tasks/generate`, {
                prompt: 'Test prompt',
            });

            expect(res.status).toBe(200); // SSE stream still opens
            const events = parseSSEEvents(res.body);
            const errorEvent = events.find(e => e.event === 'error');
            expect(errorEvent).toBeDefined();
            expect(errorEvent?.data.message).toContain('unavailable');
        });

        it('should send error event when AI returns failure', async () => {
            mockSendMessage.mockResolvedValue({
                success: false,
                error: 'Rate limited',
            });

            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);

            const res = await postJSON(`${srv.url}/api/workspaces/${wsId}/tasks/generate`, {
                prompt: 'Test prompt',
            });

            const events = parseSSEEvents(res.body);
            const errorEvent = events.find(e => e.event === 'error');
            expect(errorEvent?.data.message).toContain('Rate limited');
        });

        it('should use from-feature mode when specified', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);

            // Create feature context files
            const featureDir = path.join(workspaceDir, '.vscode/tasks');
            fs.mkdirSync(featureDir, { recursive: true });
            fs.writeFileSync(path.join(featureDir, 'plan.md'), '# Plan\nBuild auth');

            await postJSON(`${srv.url}/api/workspaces/${wsId}/tasks/generate`, {
                prompt: 'implement authentication',
                mode: 'from-feature',
            });

            expect(mockSendMessage).toHaveBeenCalled();
            const promptUsed = mockSendMessage.mock.calls[0][0].prompt;
            expect(promptUsed).toContain('implement authentication');
        });
    });

    // ========================================================================
    // POST /api/workspaces/:id/tasks/discover
    // ========================================================================

    describe('POST /api/workspaces/:id/tasks/discover', () => {
        it('should return 404 for unknown workspace', async () => {
            const srv = await startServer();
            const res = await postJSON(`${srv.url}/api/workspaces/nonexistent/tasks/discover`, {
                featureDescription: 'Auth module',
            });
            expect(res.status).toBe(404);
        });

        it('should return 400 when featureDescription is missing', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);
            const res = await postJSON(`${srv.url}/api/workspaces/${wsId}/tasks/discover`, {});
            expect(res.status).toBe(400);
            const body = JSON.parse(res.body);
            expect(body.error).toContain('featureDescription');
        });

        it('should return items array on successful discovery', async () => {
            mockSendMessage.mockResolvedValue({
                success: true,
                response: JSON.stringify([
                    { name: 'auth.ts', path: 'src/auth.ts', type: 'file', category: 'source', relevance: 90, reason: 'Auth module' },
                ]),
            });

            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);

            const res = await postJSON(`${srv.url}/api/workspaces/${wsId}/tasks/discover`, {
                featureDescription: 'User authentication',
            });

            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.items).toHaveLength(1);
            expect(body.items[0].name).toBe('auth.ts');
            expect(body.items[0].type).toBe('file');
        });

        it('should return empty items array when AI returns no results', async () => {
            mockSendMessage.mockResolvedValue({
                success: true,
                response: '[]',
            });

            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);

            const res = await postJSON(`${srv.url}/api/workspaces/${wsId}/tasks/discover`, {
                featureDescription: 'Something obscure',
            });

            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.items).toEqual([]);
        });

        it('should return 503 when AI is unavailable', async () => {
            mockIsAvailable.mockResolvedValue({ available: false });

            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);

            const res = await postJSON(`${srv.url}/api/workspaces/${wsId}/tasks/discover`, {
                featureDescription: 'Auth',
            });

            expect(res.status).toBe(503);
        });

        it('should pass keywords to the discovery prompt', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);

            await postJSON(`${srv.url}/api/workspaces/${wsId}/tasks/discover`, {
                featureDescription: 'Auth system',
                keywords: ['jwt', 'oauth'],
            });

            expect(mockSendMessage).toHaveBeenCalled();
            const promptUsed = mockSendMessage.mock.calls[0][0].prompt;
            expect(promptUsed).toContain('jwt');
            expect(promptUsed).toContain('oauth');
        });

        it('should ignore invalid keywords gracefully', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);

            const res = await postJSON(`${srv.url}/api/workspaces/${wsId}/tasks/discover`, {
                featureDescription: 'Auth',
                keywords: [123, null, 'valid'],
            });

            // Should still succeed
            expect(res.status).toBe(200);
        });

        it('should return 500 when AI discovery fails', async () => {
            mockSendMessage.mockResolvedValue({
                success: false,
                error: 'Model overloaded',
            });

            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);

            const res = await postJSON(`${srv.url}/api/workspaces/${wsId}/tasks/discover`, {
                featureDescription: 'Something',
            });

            expect(res.status).toBe(500);
            const body = JSON.parse(res.body);
            expect(body.error).toContain('Model overloaded');
        });
    });
});
