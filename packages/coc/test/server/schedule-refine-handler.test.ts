/**
 * Schedule Instruction Refine Handler Tests
 *
 * Tests for POST /api/workspaces/:id/schedules/refine (AI prompt-instruction
 * refinement used by the New/Edit Prompt Routine form).
 *
 * Uses port 0 (OS-assigned) for test isolation.
 * Mocks the SDK service to avoid real AI calls.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { createExecutionServer } from '../../src/server/index';
import { FileProcessStore } from '@plusplusoneplusplus/forge';
import type { ExecutionServer } from '@plusplusoneplusplus/coc-server';
import { createMockSDKService } from '../helpers/mock-sdk-service';

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
        if (options.body) {
            req.write(options.body);
        }
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

// ============================================================================
// Integration tests — Refine endpoint
// ============================================================================

describe('Schedule Instruction Refine Handler', () => {
    let server: ExecutionServer | undefined;
    let dataDir: string;
    let workspaceDir: string;
    let mockService: ReturnType<typeof createMockSDKService>;

    const ROUGH_INSTRUCTIONS = 'check prs and tell me whats broken';

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sched-refine-test-'));
        workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sched-refine-ws-'));
        mockService = createMockSDKService();
        vi.clearAllMocks();
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
        server = await createExecutionServer({ port: 0, host: 'localhost', store, dataDir, aiService: mockService.service as any });
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

    function configureMockAI(options: {
        available?: boolean;
        success?: boolean;
        response?: string;
        error?: string;
        throwError?: Error;
    }) {
        const {
            available = true,
            success = true,
            response = 'Review all open pull requests and report any that have failing checks, merge conflicts, or unresolved review comments.',
            error,
            throwError,
        } = options;

        mockService.mockIsAvailable.mockResolvedValue({ available });
        mockService.service.sendMessage.mockClear();
        mockService.mockSendMessage.mockClear();
        mockService.mockSendMessage.mockImplementation(async () => {
            if (throwError) { throw throwError; }
            return { success, response, error };
        });
        return mockService.service;
    }

    describe('POST /api/workspaces/:id/schedules/refine', () => {
        it('refines instructions — happy path', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);
            const refined = 'Review all open pull requests and summarize any blockers.';
            configureMockAI({ response: refined });

            const res = await postJSON(`${srv.url}/api/workspaces/${wsId}/schedules/refine`, {
                instructions: ROUGH_INSTRUCTIONS,
            });
            expect(res.status).toBe(200);

            const data = JSON.parse(res.body);
            expect(data.refined).toBe(refined);
            expect(data.raw).toBe(refined);
        });

        it('strips markdown code fences from the AI response', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);
            const inner = 'Review open PRs and report blockers.';
            const fenced = 'Here you go:\n```\n' + inner + '\n```\nDone!';
            configureMockAI({ response: fenced });

            const res = await postJSON(`${srv.url}/api/workspaces/${wsId}/schedules/refine`, {
                instructions: ROUGH_INSTRUCTIONS,
            });
            expect(res.status).toBe(200);

            const data = JSON.parse(res.body);
            expect(data.refined).toBe(inner);
            expect(data.raw).toBe(fenced);
        });

        it('returns 400 when instructions are missing', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);

            const res = await postJSON(`${srv.url}/api/workspaces/${wsId}/schedules/refine`, {});
            expect(res.status).toBe(400);
            expect(JSON.parse(res.body).error).toContain('instructions');
        });

        it('returns 400 when instructions are blank', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);

            const res = await postJSON(`${srv.url}/api/workspaces/${wsId}/schedules/refine`, {
                instructions: '   ',
            });
            expect(res.status).toBe(400);
        });

        it('returns 503 when the AI service is unavailable', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);
            configureMockAI({ available: false });

            const res = await postJSON(`${srv.url}/api/workspaces/${wsId}/schedules/refine`, {
                instructions: ROUGH_INSTRUCTIONS,
            });
            expect(res.status).toBe(503);
        });

        it('returns 500 when refinement fails', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);
            configureMockAI({ success: false, error: 'Model overloaded' });

            const res = await postJSON(`${srv.url}/api/workspaces/${wsId}/schedules/refine`, {
                instructions: ROUGH_INSTRUCTIONS,
            });
            expect(res.status).toBe(500);
            expect(JSON.parse(res.body).error).toContain('Model overloaded');
        });

        it('returns 504 on timeout', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);
            configureMockAI({ throwError: new Error('Request timeout exceeded') });

            const res = await postJSON(`${srv.url}/api/workspaces/${wsId}/schedules/refine`, {
                instructions: ROUGH_INSTRUCTIONS,
            });
            expect(res.status).toBe(504);
        });

        it('forwards the model to the AI service when provided', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);
            const svc = configureMockAI({});

            await postJSON(`${srv.url}/api/workspaces/${wsId}/schedules/refine`, {
                instructions: ROUGH_INSTRUCTIONS,
                model: 'gpt-4',
            });

            expect(svc.sendMessage).toHaveBeenCalledTimes(1);
            expect(svc.sendMessage.mock.calls[0][0].model).toBe('gpt-4');
        });

        it('calls sendMessage with denyAllPermissions', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);
            const svc = configureMockAI({});

            await postJSON(`${srv.url}/api/workspaces/${wsId}/schedules/refine`, {
                instructions: ROUGH_INSTRUCTIONS,
            });

            expect(svc.sendMessage.mock.calls[0][0].onPermissionRequest).toBeDefined();
        });

        it('includes the instructions and hint in the prompt', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);
            const svc = configureMockAI({});

            await postJSON(`${srv.url}/api/workspaces/${wsId}/schedules/refine`, {
                instructions: ROUGH_INSTRUCTIONS,
                hint: 'make it more specific',
            });

            const prompt = svc.sendMessage.mock.calls[0][0].prompt;
            expect(prompt).toContain(ROUGH_INSTRUCTIONS);
            expect(prompt).toContain('make it more specific');
        });
    });
});
