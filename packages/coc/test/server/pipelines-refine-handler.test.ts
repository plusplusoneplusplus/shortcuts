/**
 * Pipelines Refine Handler Tests
 *
 * Tests for POST /api/workspaces/:id/pipelines/refine (AI pipeline refinement).
 *
 * Uses port 0 (OS-assigned) for test isolation.
 * Mocks getCopilotSDKService to avoid real AI calls.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { createExecutionServer } from '../../src/server/index';
import { FileProcessStore } from '@plusplusoneplusplus/pipeline-core';
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

describe('Pipelines Refine Handler', () => {
    let server: ExecutionServer | undefined;
    let dataDir: string;
    let workspaceDir: string;

    let mockService: ReturnType<typeof createMockSDKService>;

    const VALID_YAML = 'name: "My Pipeline"\ninput:\n  type: csv\n  path: "input.csv"\nmap:\n  prompt: "Analyze: {{title}}"\n  output:\n    - result\nreduce:\n  type: json';

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pipelines-refine-test-'));
        workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pipelines-refine-ws-'));
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
            response = 'name: "Modified Pipeline"\ninput:\n  type: csv\n  path: "input.csv"\nmap:\n  prompt: "Analyze: {{title}}"\n  output:\n    - result\n  parallel: 10\nreduce:\n  type: json',
            error,
            throwError,
        } = options;

        mockService.mockIsAvailable.mockResolvedValue({ available });
        mockService.mockSendMessage.mockImplementation(async () => {
            if (throwError) { throw throwError; }
            return { success, response, error };
        });
        return mockService.service;
    }

    // ========================================================================
    // POST /api/workspaces/:id/pipelines/refine
    // ========================================================================

    describe('POST /api/workspaces/:id/pipelines/refine', () => {
        it('should refine pipeline YAML — happy path', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);
            const refinedYaml = 'name: "My Pipeline"\ninput:\n  type: csv\n  path: "input.csv"\nmap:\n  prompt: "Analyze: {{title}}"\n  output:\n    - result\n  parallel: 10\nreduce:\n  type: json';
            configureMockAI({ response: refinedYaml });

            const res = await postJSON(`${srv.url}/api/workspaces/${wsId}/pipelines/refine`, {
                currentYaml: VALID_YAML,
                instruction: 'increase parallelism to 10',
            });
            expect(res.status).toBe(200);

            const data = JSON.parse(res.body);
            expect(data.yaml).toBe(refinedYaml);
            expect(data.raw).toBe(refinedYaml);
            expect(data.valid).toBe(true);
            expect(data.validationError).toBeUndefined();
        });

        it('should strip fences from AI response', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);
            const innerYaml = 'name: "Refined"\ninput:\n  type: csv\n  path: "in.csv"';
            const fencedResponse = 'Here is the modified pipeline:\n```yaml\n' + innerYaml + '\n```\nDone!';
            configureMockAI({ response: fencedResponse });

            const res = await postJSON(`${srv.url}/api/workspaces/${wsId}/pipelines/refine`, {
                currentYaml: VALID_YAML,
                instruction: 'simplify',
            });
            expect(res.status).toBe(200);

            const data = JSON.parse(res.body);
            expect(data.yaml).toBe(innerYaml);
            expect(data.raw).toBe(fencedResponse);
        });

        it('should return 400 for missing currentYaml', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);

            const res = await postJSON(`${srv.url}/api/workspaces/${wsId}/pipelines/refine`, {
                instruction: 'add retry logic',
            });
            expect(res.status).toBe(400);
            const data = JSON.parse(res.body);
            expect(data.error).toContain('currentYaml');
        });

        it('should return 400 for missing instruction', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);

            const res = await postJSON(`${srv.url}/api/workspaces/${wsId}/pipelines/refine`, {
                currentYaml: VALID_YAML,
            });
            expect(res.status).toBe(400);
            const data = JSON.parse(res.body);
            expect(data.error).toContain('instruction');
        });

        it('should return 400 for empty currentYaml', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);

            const res = await postJSON(`${srv.url}/api/workspaces/${wsId}/pipelines/refine`, {
                currentYaml: '   ',
                instruction: 'add retry logic',
            });
            expect(res.status).toBe(400);
        });

        it('should return 400 for empty instruction', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);

            const res = await postJSON(`${srv.url}/api/workspaces/${wsId}/pipelines/refine`, {
                currentYaml: VALID_YAML,
                instruction: '   ',
            });
            expect(res.status).toBe(400);
        });

        it('should return 400 for invalid currentYaml', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);

            const res = await postJSON(`${srv.url}/api/workspaces/${wsId}/pipelines/refine`, {
                currentYaml: '{ bad: [yaml:',
                instruction: 'fix this pipeline',
            });
            expect(res.status).toBe(400);
            const data = JSON.parse(res.body);
            expect(data.error).toContain('Invalid YAML');
        });

        it('should return valid=false when AI returns invalid YAML', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);
            configureMockAI({ response: 'This is not YAML: {{[invalid' });

            const res = await postJSON(`${srv.url}/api/workspaces/${wsId}/pipelines/refine`, {
                currentYaml: VALID_YAML,
                instruction: 'make it better',
            });
            expect(res.status).toBe(200);

            const data = JSON.parse(res.body);
            expect(data.valid).toBe(false);
            expect(data.validationError).toBeDefined();
            expect(typeof data.yaml).toBe('string');
        });

        it('should return 503 when AI service is unavailable', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);
            configureMockAI({ available: false });

            const res = await postJSON(`${srv.url}/api/workspaces/${wsId}/pipelines/refine`, {
                currentYaml: VALID_YAML,
                instruction: 'add retry logic',
            });
            expect(res.status).toBe(503);
        });

        it('should return 500 when AI refinement fails', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);
            configureMockAI({ success: false, error: 'Model overloaded' });

            const res = await postJSON(`${srv.url}/api/workspaces/${wsId}/pipelines/refine`, {
                currentYaml: VALID_YAML,
                instruction: 'add retry logic',
            });
            expect(res.status).toBe(500);
            const data = JSON.parse(res.body);
            expect(data.error).toContain('Model overloaded');
        });

        it('should return 504 on timeout', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);
            configureMockAI({ throwError: new Error('Request timeout exceeded') });

            const res = await postJSON(`${srv.url}/api/workspaces/${wsId}/pipelines/refine`, {
                currentYaml: VALID_YAML,
                instruction: 'add retry logic',
            });
            expect(res.status).toBe(504);
        });

        it('should return 404 for unknown workspace', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/workspaces/nonexistent/pipelines/refine`, {
                currentYaml: VALID_YAML,
                instruction: 'add retry logic',
            });
            expect(res.status).toBe(404);
        });

        it('should forward model to AI service when provided', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);
            const svc = configureMockAI({});

            await postJSON(`${srv.url}/api/workspaces/${wsId}/pipelines/refine`, {
                currentYaml: VALID_YAML,
                instruction: 'add retry logic',
                model: 'gpt-4',
            });

            expect(svc.sendMessage).toHaveBeenCalledTimes(1);
            const callArgs = svc.sendMessage.mock.calls[0][0];
            expect(callArgs.model).toBe('gpt-4');
        });

        it('should call sendMessage with denyAllPermissions', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);
            const svc = configureMockAI({});

            await postJSON(`${srv.url}/api/workspaces/${wsId}/pipelines/refine`, {
                currentYaml: VALID_YAML,
                instruction: 'add retry logic',
            });

            const callArgs = svc.sendMessage.mock.calls[0][0];
            expect(callArgs.onPermissionRequest).toBeDefined();
        });

        it('should include currentYaml, instruction and schema reference in prompt', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);
            const svc = configureMockAI({});

            await postJSON(`${srv.url}/api/workspaces/${wsId}/pipelines/refine`, {
                currentYaml: VALID_YAML,
                instruction: 'increase parallelism to 10',
            });

            const callArgs = svc.sendMessage.mock.calls[0][0];
            expect(callArgs.prompt).toContain(VALID_YAML.trim());
            expect(callArgs.prompt).toContain('increase parallelism to 10');
            expect(callArgs.prompt).toContain('Pipeline YAML Schema Reference');
        });
    });
});
