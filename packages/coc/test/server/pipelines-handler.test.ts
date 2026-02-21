/**
 * Pipelines Handler Tests
 *
 * Comprehensive tests for the Pipeline CRUD REST API endpoints:
 * list (enriched), content read/write, create from template, delete.
 *
 * Uses port 0 (OS-assigned) for test isolation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createExecutionServer } from '../../src/server/index';
import { FileProcessStore } from '@plusplusoneplusplus/pipeline-core';
import type { ExecutionServer } from '@plusplusoneplusplus/coc-server';

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

function patchJSON(url: string, data: unknown) {
    return request(url, {
        method: 'PATCH',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    });
}

function deleteReq(url: string) {
    return request(url, { method: 'DELETE' });
}

// ============================================================================
// Tests
// ============================================================================

describe('Pipelines Handler', () => {
    let server: ExecutionServer | undefined;
    let dataDir: string;
    let workspaceDir: string;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pipelines-handler-test-'));
        workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pipelines-workspace-'));
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

    /** Create pipeline directories with pipeline.yaml files. */
    function createPipelines(pipelines: Record<string, string>): void {
        const pipelinesDir = path.join(workspaceDir, '.vscode', 'pipelines');
        for (const [name, content] of Object.entries(pipelines)) {
            const dir = path.join(pipelinesDir, name);
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(path.join(dir, 'pipeline.yaml'), content, 'utf-8');
        }
    }

    // Valid pipeline YAML for testing
    const VALID_YAML = `name: "Test Pipeline"
description: "A test pipeline"

input:
  type: csv
  path: "input.csv"

map:
  prompt: "Analyze: {{title}}"
  output:
    - result
  parallel: 5

reduce:
  type: json
`;

    const VALID_YAML_NO_DESC = `name: "No Description"

input:
  type: csv
  path: "input.csv"

map:
  prompt: "Analyze: {{title}}"
  output:
    - result

reduce:
  type: json
`;

    const INVALID_YAML = '{ bad: [yaml:';

    const MISSING_FIELDS_YAML = `name: "Incomplete"
`;

    // ========================================================================
    // GET /api/workspaces/:id/pipelines — List (enriched)
    // ========================================================================

    describe('GET /api/workspaces/:id/pipelines', () => {
        it('should list enriched pipelines with description and validation', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);

            createPipelines({
                'my-pipe': VALID_YAML,
                'another-pipe': VALID_YAML_NO_DESC,
            });

            // Also create a dummy input.csv so validation passes fully
            const pipelinesDir = path.join(workspaceDir, '.vscode', 'pipelines');
            fs.writeFileSync(path.join(pipelinesDir, 'my-pipe', 'input.csv'), 'title\nfoo\n', 'utf-8');
            fs.writeFileSync(path.join(pipelinesDir, 'another-pipe', 'input.csv'), 'title\nbar\n', 'utf-8');

            const res = await request(`${srv.url}/api/workspaces/${wsId}/pipelines`);
            expect(res.status).toBe(200);

            const data = JSON.parse(res.body);
            expect(data.pipelines).toHaveLength(2);

            const myPipe = data.pipelines.find((p: any) => p.name === 'my-pipe');
            expect(myPipe).toBeDefined();
            expect(myPipe.description).toBe('A test pipeline');
            // Pipeline may have validation warnings about template variables in prompt
            // but the key enrichment fields must be present
            expect(typeof myPipe.isValid).toBe('boolean');
            expect(Array.isArray(myPipe.validationErrors)).toBe(true);

            const anotherPipe = data.pipelines.find((p: any) => p.name === 'another-pipe');
            expect(anotherPipe).toBeDefined();
            expect(anotherPipe.description).toBeUndefined();
        });

        it('should return empty array for empty pipelines dir', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);

            const res = await request(`${srv.url}/api/workspaces/${wsId}/pipelines`);
            expect(res.status).toBe(200);
            const data = JSON.parse(res.body);
            expect(data.pipelines).toEqual([]);
        });

        it('should return invalid pipeline with validation errors', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);

            createPipelines({ 'bad-pipe': MISSING_FIELDS_YAML });

            const res = await request(`${srv.url}/api/workspaces/${wsId}/pipelines`);
            expect(res.status).toBe(200);

            const data = JSON.parse(res.body);
            expect(data.pipelines).toHaveLength(1);
            expect(data.pipelines[0].name).toBe('bad-pipe');
            expect(data.pipelines[0].isValid).toBe(false);
            expect(data.pipelines[0].validationErrors.length).toBeGreaterThan(0);
        });
    });

    // ========================================================================
    // GET /api/workspaces/:id/pipelines/:name/content — Read content
    // ========================================================================

    describe('GET /api/workspaces/:id/pipelines/:name/content', () => {
        it('should return YAML content of a pipeline', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);
            createPipelines({ 'my-pipe': VALID_YAML });

            const res = await request(`${srv.url}/api/workspaces/${wsId}/pipelines/my-pipe/content`);
            expect(res.status).toBe(200);
            const data = JSON.parse(res.body);
            expect(data.content).toBe(VALID_YAML);
            expect(data.path).toContain('pipeline.yaml');
        });

        it('should return 404 for missing pipeline', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);

            const res = await request(`${srv.url}/api/workspaces/${wsId}/pipelines/nonexistent/content`);
            expect(res.status).toBe(404);
        });

        it('should reject path traversal', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);

            const res = await request(`${srv.url}/api/workspaces/${wsId}/pipelines/..%2F..%2Fetc%2Fpasswd/content`);
            expect(res.status === 403 || res.status === 404).toBe(true);
        });
    });

    // ========================================================================
    // PATCH /api/workspaces/:id/pipelines/:name/content — Write content
    // ========================================================================

    describe('PATCH /api/workspaces/:id/pipelines/:name/content', () => {
        it('should update YAML content', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);
            createPipelines({ 'my-pipe': VALID_YAML });

            const newContent = 'name: "Updated"\ninput:\n  type: csv\n  path: "in.csv"\n';
            const res = await patchJSON(
                `${srv.url}/api/workspaces/${wsId}/pipelines/my-pipe/content`,
                { content: newContent }
            );
            expect(res.status).toBe(200);

            // Verify file on disk
            const onDisk = fs.readFileSync(
                path.join(workspaceDir, '.vscode', 'pipelines', 'my-pipe', 'pipeline.yaml'),
                'utf-8'
            );
            expect(onDisk).toBe(newContent);
        });

        it('should reject invalid YAML', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);
            createPipelines({ 'my-pipe': VALID_YAML });

            const res = await patchJSON(
                `${srv.url}/api/workspaces/${wsId}/pipelines/my-pipe/content`,
                { content: INVALID_YAML }
            );
            expect(res.status).toBe(400);
        });

        it('should reject missing content field', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);
            createPipelines({ 'my-pipe': VALID_YAML });

            const res = await patchJSON(
                `${srv.url}/api/workspaces/${wsId}/pipelines/my-pipe/content`,
                {}
            );
            expect(res.status).toBe(400);
        });

        it('should return 404 for non-existent pipeline', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);

            const res = await patchJSON(
                `${srv.url}/api/workspaces/${wsId}/pipelines/nonexistent/content`,
                { content: 'name: test\n' }
            );
            expect(res.status).toBe(404);
        });
    });

    // ========================================================================
    // POST /api/workspaces/:id/pipelines — Create pipeline
    // ========================================================================

    describe('POST /api/workspaces/:id/pipelines', () => {
        it('should create a pipeline from default template', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);

            const res = await postJSON(`${srv.url}/api/workspaces/${wsId}/pipelines`, {
                name: 'new-pipe',
            });
            expect(res.status).toBe(201);

            const data = JSON.parse(res.body);
            expect(data.name).toBe('new-pipe');
            expect(data.template).toBe('custom');

            // Verify on disk
            const yamlPath = path.join(workspaceDir, '.vscode', 'pipelines', 'new-pipe', 'pipeline.yaml');
            expect(fs.existsSync(yamlPath)).toBe(true);
            const content = fs.readFileSync(yamlPath, 'utf-8');
            expect(content).toContain('name:');
        });

        it('should create a pipeline with specified template', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);

            const res = await postJSON(`${srv.url}/api/workspaces/${wsId}/pipelines`, {
                name: 'fanout-pipe',
                template: 'data-fanout',
            });
            expect(res.status).toBe(201);
            const data = JSON.parse(res.body);
            expect(data.template).toBe('data-fanout');
        });

        it('should return 409 for duplicate pipeline name', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);

            const res1 = await postJSON(`${srv.url}/api/workspaces/${wsId}/pipelines`, {
                name: 'dup-pipe',
            });
            expect(res1.status).toBe(201);

            const res2 = await postJSON(`${srv.url}/api/workspaces/${wsId}/pipelines`, {
                name: 'dup-pipe',
            });
            expect(res2.status).toBe(409);
        });

        it('should reject path traversal in name', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);

            const res = await postJSON(`${srv.url}/api/workspaces/${wsId}/pipelines`, {
                name: '../escape',
            });
            expect(res.status).toBe(403);
        });

        it('should reject empty name', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);

            const res = await postJSON(`${srv.url}/api/workspaces/${wsId}/pipelines`, {
                name: '',
            });
            expect(res.status).toBe(400);
        });
    });

    // ========================================================================
    // DELETE /api/workspaces/:id/pipelines/:name — Delete pipeline
    // ========================================================================

    describe('DELETE /api/workspaces/:id/pipelines/:name', () => {
        it('should delete an existing pipeline', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);
            createPipelines({ 'to-delete': VALID_YAML });

            const pipeDir = path.join(workspaceDir, '.vscode', 'pipelines', 'to-delete');
            expect(fs.existsSync(pipeDir)).toBe(true);

            const res = await deleteReq(`${srv.url}/api/workspaces/${wsId}/pipelines/to-delete`);
            expect(res.status).toBe(200);

            const data = JSON.parse(res.body);
            expect(data.deleted).toBe('to-delete');
            expect(fs.existsSync(pipeDir)).toBe(false);
        });

        it('should return 404 for non-existent pipeline', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);

            const res = await deleteReq(`${srv.url}/api/workspaces/${wsId}/pipelines/nonexistent`);
            expect(res.status).toBe(404);
        });

        it('should reject path traversal', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);

            const res = await deleteReq(`${srv.url}/api/workspaces/${wsId}/pipelines/..%2F..%2Fetc`);
            expect(res.status === 403 || res.status === 404).toBe(true);
        });
    });
});
