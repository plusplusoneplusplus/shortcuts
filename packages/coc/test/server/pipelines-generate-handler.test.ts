/**
 * Pipelines Generate Handler Tests
 *
 * Tests for:
 * - extractYamlFromResponse utility function
 * - POST /api/workspaces/:id/pipelines/generate (AI pipeline generation)
 * - POST /api/workspaces/:id/pipelines with optional content field
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
import { extractYamlFromResponse } from '../../src/server/pipelines-handler';
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
// extractYamlFromResponse tests
// ============================================================================

describe('extractYamlFromResponse', () => {
    it('should extract YAML from ```yaml fences', () => {
        const input = 'Here is the pipeline:\n```yaml\nname: "Test"\ninput:\n  type: csv\n```\nDone.';
        expect(extractYamlFromResponse(input)).toBe('name: "Test"\ninput:\n  type: csv');
    });

    it('should extract YAML from ```yml fences', () => {
        const input = '```yml\nname: "Test"\n```';
        expect(extractYamlFromResponse(input)).toBe('name: "Test"');
    });

    it('should extract YAML from generic ``` fences', () => {
        const input = 'Result:\n```\nname: "Test"\nmap:\n  prompt: "Go"\n```';
        expect(extractYamlFromResponse(input)).toBe('name: "Test"\nmap:\n  prompt: "Go"');
    });

    it('should return raw YAML when no fences are present', () => {
        const input = 'name: "Test"\ninput:\n  type: csv';
        expect(extractYamlFromResponse(input)).toBe(input);
    });

    it('should trim leading/trailing whitespace', () => {
        const input = '  \n  name: "Test"  \n  ';
        expect(extractYamlFromResponse(input)).toBe('name: "Test"');
    });

    it('should extract first code block when multiple are present', () => {
        const input = '```yaml\nname: "First"\n```\n\n```yaml\nname: "Second"\n```';
        expect(extractYamlFromResponse(input)).toBe('name: "First"');
    });

    it('should prefer yaml-fenced block over generic fenced block', () => {
        const input = '```\ngeneric\n```\n```yaml\nname: "YAML"\n```';
        expect(extractYamlFromResponse(input)).toBe('name: "YAML"');
    });
});

// ============================================================================
// Integration tests — Generate endpoint & Create with content
// ============================================================================

describe('Pipelines Generate Handler', () => {
    let server: ExecutionServer | undefined;
    let dataDir: string;
    let workspaceDir: string;

    let mockService: ReturnType<typeof createMockSDKService>;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pipelines-gen-test-'));
        workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pipelines-gen-ws-'));
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
            response = 'name: "Generated"\ninput:\n  type: csv\n  path: "input.csv"\nmap:\n  prompt: "Analyze"\n  output:\n    - result\nreduce:\n  type: json',
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
    // POST /api/workspaces/:id/pipelines/generate
    // ========================================================================

    describe('POST /api/workspaces/:id/pipelines/generate', () => {
        it('should generate pipeline YAML — happy path', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);
            const yamlResponse = 'name: "Bug Classifier"\ninput:\n  type: csv\n  path: "bugs.csv"\nmap:\n  prompt: "Classify: {{title}}"\n  output:\n    - category\nreduce:\n  type: json';
            configureMockAI({ response: yamlResponse });

            const res = await postJSON(`${srv.url}/api/workspaces/${wsId}/pipelines/generate`, {
                description: 'classify bugs by category',
            });
            expect(res.status).toBe(200);

            const data = JSON.parse(res.body);
            expect(data.yaml).toBe(yamlResponse);
            expect(data.raw).toBe(yamlResponse);
            expect(data.valid).toBe(true);
            expect(data.validationError).toBeUndefined();
        });

        it('should extract YAML from fenced AI response', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);
            const innerYaml = 'name: "Test"\ninput:\n  type: csv\n  path: "in.csv"';
            const fencedResponse = 'Here is the pipeline:\n```yaml\n' + innerYaml + '\n```\nDone!';
            configureMockAI({ response: fencedResponse });

            const res = await postJSON(`${srv.url}/api/workspaces/${wsId}/pipelines/generate`, {
                description: 'test pipeline',
            });
            expect(res.status).toBe(200);

            const data = JSON.parse(res.body);
            expect(data.yaml).toBe(innerYaml);
            expect(data.raw).toBe(fencedResponse);
            expect(data.valid).toBe(true);
        });

        it('should return 400 for missing description', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);

            const res = await postJSON(`${srv.url}/api/workspaces/${wsId}/pipelines/generate`, {});
            expect(res.status).toBe(400);
            const data = JSON.parse(res.body);
            expect(data.error).toContain('description');
        });

        it('should return 400 for empty description', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);

            const res = await postJSON(`${srv.url}/api/workspaces/${wsId}/pipelines/generate`, {
                description: '   ',
            });
            expect(res.status).toBe(400);
        });

        it('should return 503 when AI service is unavailable', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);
            configureMockAI({ available: false });

            const res = await postJSON(`${srv.url}/api/workspaces/${wsId}/pipelines/generate`, {
                description: 'classify bugs',
            });
            expect(res.status).toBe(503);
        });

        it('should return 500 when AI generation fails', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);
            configureMockAI({ success: false, error: 'Model overloaded' });

            const res = await postJSON(`${srv.url}/api/workspaces/${wsId}/pipelines/generate`, {
                description: 'classify bugs',
            });
            expect(res.status).toBe(500);
            const data = JSON.parse(res.body);
            expect(data.error).toContain('Model overloaded');
        });

        it('should return valid=false when AI returns invalid YAML', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);
            configureMockAI({ response: 'This is not YAML: {{[invalid' });

            const res = await postJSON(`${srv.url}/api/workspaces/${wsId}/pipelines/generate`, {
                description: 'classify bugs',
            });
            expect(res.status).toBe(200);

            const data = JSON.parse(res.body);
            expect(data.valid).toBe(false);
            expect(data.validationError).toBeDefined();
            expect(typeof data.yaml).toBe('string');
        });

        it('should return 404 for non-existent workspace', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/workspaces/nonexistent/pipelines/generate`, {
                description: 'classify bugs',
            });
            expect(res.status).toBe(404);
        });

        it('should return 504 on timeout', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);
            configureMockAI({ throwError: new Error('Request timeout exceeded') });

            const res = await postJSON(`${srv.url}/api/workspaces/${wsId}/pipelines/generate`, {
                description: 'classify bugs',
            });
            expect(res.status).toBe(504);
        });

        it('should pass model to AI service when provided', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);
            const mockService = configureMockAI({});

            await postJSON(`${srv.url}/api/workspaces/${wsId}/pipelines/generate`, {
                description: 'classify bugs',
                model: 'gpt-4',
            });

            expect(mockService.sendMessage).toHaveBeenCalledTimes(1);
            const callArgs = mockService.sendMessage.mock.calls[0][0];
            expect(callArgs.model).toBe('gpt-4');
        });

        it('should call sendMessage with denyAllPermissions', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);
            const mockService = configureMockAI({});

            await postJSON(`${srv.url}/api/workspaces/${wsId}/pipelines/generate`, {
                description: 'classify bugs',
            });

            const callArgs = mockService.sendMessage.mock.calls[0][0];
            expect(callArgs.onPermissionRequest).toBeDefined();
            expect(callArgs.prompt).toContain('pipeline YAML generator');
            expect(callArgs.prompt).toContain('classify bugs');
        });

        it('should return suggestedName extracted from generated YAML name field', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);
            const yamlResponse = 'name: "Bug Classifier"\ninput:\n  type: csv\n  path: "bugs.csv"\nmap:\n  prompt: "Classify: {{title}}"\n  output:\n    - category\nreduce:\n  type: json';
            configureMockAI({ response: yamlResponse });

            const res = await postJSON(`${srv.url}/api/workspaces/${wsId}/pipelines/generate`, {
                description: 'classify bugs by category',
            });
            expect(res.status).toBe(200);

            const data = JSON.parse(res.body);
            expect(data.suggestedName).toBe('bug-classifier');
        });

        it('should return suggestedName as kebab-case slug', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);
            const yamlResponse = 'name: "My Cool Pipeline!"\ninput:\n  type: csv\n  path: "in.csv"\nmap:\n  prompt: "Go"\n  output:\n    - r\nreduce:\n  type: json';
            configureMockAI({ response: yamlResponse });

            const res = await postJSON(`${srv.url}/api/workspaces/${wsId}/pipelines/generate`, {
                description: 'test pipeline',
            });
            const data = JSON.parse(res.body);
            expect(data.suggestedName).toBe('my-cool-pipeline');
        });

        it('should return suggestedName undefined when YAML has no name field', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);
            configureMockAI({ response: 'input:\n  type: csv\n  path: "in.csv"' });

            const res = await postJSON(`${srv.url}/api/workspaces/${wsId}/pipelines/generate`, {
                description: 'test pipeline',
            });
            const data = JSON.parse(res.body);
            expect(data.suggestedName).toBeUndefined();
        });

        it('should succeed without name in request body', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);
            configureMockAI({});

            const res = await postJSON(`${srv.url}/api/workspaces/${wsId}/pipelines/generate`, {
                description: 'classify bugs by category',
            });
            expect(res.status).toBe(200);
            const data = JSON.parse(res.body);
            expect(data.yaml).toBeDefined();
            expect(data.suggestedName).toBeDefined();
        });

        it('should include name instruction in system prompt', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);
            const mockService = configureMockAI({});

            await postJSON(`${srv.url}/api/workspaces/${wsId}/pipelines/generate`, {
                description: 'classify bugs',
            });

            const callArgs = mockService.sendMessage.mock.calls[0][0];
            expect(callArgs.prompt).toContain('must include a top-level "name" field');
        });
    });

    // ========================================================================
    // POST /api/workspaces/:id/pipelines — Create with content
    // ========================================================================

    describe('POST /api/workspaces/:id/pipelines (content field)', () => {
        it('should create pipeline with provided content', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);

            const customYaml = 'name: "Custom"\ninput:\n  type: csv\n  path: "data.csv"\nmap:\n  prompt: "Go"\n  output:\n    - result\nreduce:\n  type: json';
            const res = await postJSON(`${srv.url}/api/workspaces/${wsId}/pipelines`, {
                name: 'content-pipe',
                content: customYaml,
            });
            expect(res.status).toBe(201);

            const data = JSON.parse(res.body);
            expect(data.name).toBe('content-pipe');
            expect(data.template).toBe('custom');

            // Verify file on disk contains provided content
            const yamlPath = path.join(workspaceDir, '.vscode', 'pipelines', 'content-pipe', 'pipeline.yaml');
            expect(fs.existsSync(yamlPath)).toBe(true);
            expect(fs.readFileSync(yamlPath, 'utf-8')).toBe(customYaml);
        });

        it('should reject invalid YAML in content', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);

            const res = await postJSON(`${srv.url}/api/workspaces/${wsId}/pipelines`, {
                name: 'bad-content-pipe',
                content: '{ bad: [yaml:',
            });
            expect(res.status).toBe(400);
            const data = JSON.parse(res.body);
            expect(data.error).toContain('Invalid YAML');
        });

        it('should fall back to template when content is not provided', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);

            const res = await postJSON(`${srv.url}/api/workspaces/${wsId}/pipelines`, {
                name: 'template-pipe',
                template: 'custom',
            });
            expect(res.status).toBe(201);

            const data = JSON.parse(res.body);
            expect(data.template).toBe('custom');

            // Verify it used the template, not empty content
            const yamlPath = path.join(workspaceDir, '.vscode', 'pipelines', 'template-pipe', 'pipeline.yaml');
            const content = fs.readFileSync(yamlPath, 'utf-8');
            expect(content).toContain('name: "My Pipeline"');
        });

        it('should fall back to template when content is empty string', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);

            const res = await postJSON(`${srv.url}/api/workspaces/${wsId}/pipelines`, {
                name: 'empty-content-pipe',
                content: '',
                template: 'data-fanout',
            });
            expect(res.status).toBe(201);

            const data = JSON.parse(res.body);
            expect(data.template).toBe('data-fanout');
        });

        it('should ignore template when content is provided', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);

            const customYaml = 'name: "Direct Content"';
            const res = await postJSON(`${srv.url}/api/workspaces/${wsId}/pipelines`, {
                name: 'override-pipe',
                content: customYaml,
                template: 'data-fanout',
            });
            expect(res.status).toBe(201);

            const yamlPath = path.join(workspaceDir, '.vscode', 'pipelines', 'override-pipe', 'pipeline.yaml');
            const content = fs.readFileSync(yamlPath, 'utf-8');
            expect(content).toBe(customYaml);
        });
    });
});
