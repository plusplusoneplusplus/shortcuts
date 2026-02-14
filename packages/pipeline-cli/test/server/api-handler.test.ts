/**
 * API Handler Tests
 *
 * Comprehensive tests for the Process REST API endpoints:
 * workspace registration, process CRUD, filtering, pagination,
 * cancel, bulk delete, stats, and helper functions.
 *
 * Uses port 0 (OS-assigned) for test isolation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import { createExecutionServer } from '../../src/server/index';
import { sendJSON, sendError, parseQueryParams } from '../../src/server/api-handler';
import { FileProcessStore } from '@plusplusoneplusplus/pipeline-core';
import type { ExecutionServer } from '../../src/server/types';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// ============================================================================
// Helpers
// ============================================================================

/** Make an HTTP request and return status, headers, and body. */
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

/** POST JSON helper. */
function postJSON(url: string, data: unknown) {
    return request(url, {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    });
}

/** PATCH JSON helper. */
function patchJSON(url: string, data: unknown) {
    return request(url, {
        method: 'PATCH',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    });
}

/** Create a minimal process body for POST /api/processes. */
function makeProcess(overrides: Record<string, any> = {}) {
    return {
        id: `proc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        promptPreview: 'Test prompt',
        fullPrompt: 'Full test prompt text',
        status: 'running',
        startTime: new Date().toISOString(),
        type: 'clarification',
        ...overrides,
    };
}

// ============================================================================
// Tests
// ============================================================================

describe('API Handler', () => {
    let server: ExecutionServer | undefined;
    let dataDir: string;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'api-handler-test-'));
    });

    afterEach(async () => {
        if (server) {
            await server.close();
            server = undefined;
        }
        // Clean up temp data dir
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    async function startServer(): Promise<ExecutionServer> {
        const store = new FileProcessStore({ dataDir });
        server = await createExecutionServer({ port: 0, host: 'localhost', store, dataDir });
        return server;
    }

    // ========================================================================
    // sendJSON / sendError helpers
    // ========================================================================

    describe('sendJSON / sendError helpers', () => {
        it('should send JSON with correct status code and Content-Type', async () => {
            const srv = await startServer();
            // The server already has routes; test via an actual endpoint
            const res = await request(`${srv.url}/api/workspaces`);
            expect(res.status).toBe(200);
            expect(res.headers['content-type']).toContain('application/json');
        });

        it('should send error envelope with correct shape', async () => {
            const srv = await startServer();
            const res = await request(`${srv.url}/api/processes/nonexistent-id-12345`);
            expect(res.status).toBe(404);
            const body = JSON.parse(res.body);
            expect(body).toHaveProperty('error');
            expect(body.error).toBe('Process not found');
        });
    });

    // ========================================================================
    // parseQueryParams
    // ========================================================================

    describe('parseQueryParams', () => {
        it('should parse workspace param', () => {
            const filter = parseQueryParams('/api/processes?workspace=ws-1');
            expect(filter.workspaceId).toBe('ws-1');
        });

        it('should parse comma-separated status', () => {
            const filter = parseQueryParams('/api/processes?status=running,completed');
            expect(filter.status).toEqual(['running', 'completed']);
        });

        it('should ignore invalid status values', () => {
            const filter = parseQueryParams('/api/processes?status=running,invalid,failed');
            expect(filter.status).toEqual(['running', 'failed']);
        });

        it('should parse type param', () => {
            const filter = parseQueryParams('/api/processes?type=code-review');
            expect(filter.type).toBe('code-review');
        });

        it('should parse since as ISO date', () => {
            const iso = '2026-01-01T00:00:00.000Z';
            const filter = parseQueryParams(`/api/processes?since=${iso}`);
            expect(filter.since).toEqual(new Date(iso));
        });

        it('should ignore invalid since dates', () => {
            const filter = parseQueryParams('/api/processes?since=not-a-date');
            expect(filter.since).toBeUndefined();
        });

        it('should parse limit and offset', () => {
            const filter = parseQueryParams('/api/processes?limit=10&offset=20');
            expect(filter.limit).toBe(10);
            expect(filter.offset).toBe(20);
        });

        it('should return empty filter for no params', () => {
            const filter = parseQueryParams('/api/processes');
            expect(filter).toEqual({});
        });

        it('should ignore empty string values', () => {
            const filter = parseQueryParams('/api/processes?workspace=&status=');
            expect(filter.workspaceId).toBeUndefined();
            expect(filter.status).toBeUndefined();
        });
    });

    // ========================================================================
    // Workspace endpoints
    // ========================================================================

    describe('Workspace endpoints', () => {
        it('should register a workspace and list it', async () => {
            const srv = await startServer();

            // POST workspace
            const createRes = await postJSON(`${srv.url}/api/workspaces`, {
                id: 'ws-1',
                name: 'frontend',
                rootPath: '/home/user/frontend',
                color: '#ff0000',
            });
            expect(createRes.status).toBe(201);
            const created = JSON.parse(createRes.body);
            expect(created.id).toBe('ws-1');
            expect(created.name).toBe('frontend');
            expect(created.color).toBe('#ff0000');

            // GET workspaces
            const listRes = await request(`${srv.url}/api/workspaces`);
            expect(listRes.status).toBe(200);
            const listed = JSON.parse(listRes.body);
            expect(listed.workspaces).toHaveLength(1);
            expect(listed.workspaces[0].id).toBe('ws-1');
        });

        it('should return 400 when required fields are missing', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/workspaces`, { id: 'ws-1' });
            expect(res.status).toBe(400);
            expect(JSON.parse(res.body).error).toContain('Missing required fields');
        });

        it('should return 400 on invalid JSON', async () => {
            const srv = await startServer();

            const res = await request(`${srv.url}/api/workspaces`, {
                method: 'POST',
                body: 'not json',
                headers: { 'Content-Type': 'application/json' },
            });
            expect(res.status).toBe(400);
        });
    });

    // ========================================================================
    // Process CRUD lifecycle
    // ========================================================================

    describe('Process CRUD lifecycle', () => {
        it('should create, get, update, list, and delete a process', async () => {
            const srv = await startServer();

            // Create
            const proc = makeProcess({ id: 'p-lifecycle' });
            const createRes = await postJSON(`${srv.url}/api/processes`, proc);
            expect(createRes.status).toBe(201);
            const created = JSON.parse(createRes.body);
            expect(created.id).toBe('p-lifecycle');

            // Get by ID
            const getRes = await request(`${srv.url}/api/processes/p-lifecycle`);
            expect(getRes.status).toBe(200);
            const fetched = JSON.parse(getRes.body);
            expect(fetched.process.id).toBe('p-lifecycle');

            // Update via PATCH
            const patchRes = await patchJSON(`${srv.url}/api/processes/p-lifecycle`, {
                status: 'completed',
                result: 'Done!',
                endTime: new Date().toISOString(),
            });
            expect(patchRes.status).toBe(200);
            const updated = JSON.parse(patchRes.body);
            expect(updated.process.status).toBe('completed');
            expect(updated.process.result).toBe('Done!');

            // List all
            const listRes = await request(`${srv.url}/api/processes`);
            expect(listRes.status).toBe(200);
            const listed = JSON.parse(listRes.body);
            expect(listed.processes.length).toBeGreaterThanOrEqual(1);

            // Delete
            const delRes = await request(`${srv.url}/api/processes/p-lifecycle`, { method: 'DELETE' });
            expect(delRes.status).toBe(204);

            // Verify 404 on re-fetch
            const reGetRes = await request(`${srv.url}/api/processes/p-lifecycle`);
            expect(reGetRes.status).toBe(404);
        });
    });

    // ========================================================================
    // Workspace filtering
    // ========================================================================

    describe('Workspace filtering', () => {
        it('should filter processes by workspace', async () => {
            const srv = await startServer();

            await postJSON(`${srv.url}/api/processes`, makeProcess({ id: 'ws1-p1', workspaceId: 'ws-1' }));
            await postJSON(`${srv.url}/api/processes`, makeProcess({ id: 'ws1-p2', workspaceId: 'ws-1' }));
            await postJSON(`${srv.url}/api/processes`, makeProcess({ id: 'ws2-p1', workspaceId: 'ws-2' }));

            const res = await request(`${srv.url}/api/processes?workspace=ws-1`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.processes).toHaveLength(2);
            expect(body.total).toBe(2);
            body.processes.forEach((p: any) => {
                expect(p.metadata?.workspaceId).toBe('ws-1');
            });
        });
    });

    // ========================================================================
    // Pagination
    // ========================================================================

    describe('Pagination', () => {
        it('should paginate with limit and offset', async () => {
            const srv = await startServer();

            // Create 10 processes
            for (let i = 0; i < 10; i++) {
                await postJSON(`${srv.url}/api/processes`, makeProcess({ id: `pag-${i}` }));
            }

            // First page
            const page1 = await request(`${srv.url}/api/processes?limit=3&offset=0`);
            const body1 = JSON.parse(page1.body);
            expect(body1.processes).toHaveLength(3);
            expect(body1.total).toBe(10);
            expect(body1.limit).toBe(3);
            expect(body1.offset).toBe(0);

            // Second page
            const page2 = await request(`${srv.url}/api/processes?limit=3&offset=3`);
            const body2 = JSON.parse(page2.body);
            expect(body2.processes).toHaveLength(3);
            expect(body2.total).toBe(10);
            expect(body2.offset).toBe(3);
        });

        it('should default to limit=50 offset=0', async () => {
            const srv = await startServer();
            await postJSON(`${srv.url}/api/processes`, makeProcess());

            const res = await request(`${srv.url}/api/processes`);
            const body = JSON.parse(res.body);
            expect(body.limit).toBe(50);
            expect(body.offset).toBe(0);
        });
    });

    // ========================================================================
    // Status filtering
    // ========================================================================

    describe('Status filtering', () => {
        it('should filter by comma-separated statuses', async () => {
            const srv = await startServer();

            await postJSON(`${srv.url}/api/processes`, makeProcess({ id: 'sf-run', status: 'running' }));
            await postJSON(`${srv.url}/api/processes`, makeProcess({ id: 'sf-done', status: 'completed' }));
            await postJSON(`${srv.url}/api/processes`, makeProcess({ id: 'sf-fail', status: 'failed' }));

            const res = await request(`${srv.url}/api/processes?status=running,failed`);
            const body = JSON.parse(res.body);
            expect(body.total).toBe(2);
            const statuses = body.processes.map((p: any) => p.status);
            expect(statuses).toContain('running');
            expect(statuses).toContain('failed');
            expect(statuses).not.toContain('completed');
        });
    });

    // ========================================================================
    // Type filtering
    // ========================================================================

    describe('Type filtering', () => {
        it('should filter by process type', async () => {
            const srv = await startServer();

            await postJSON(`${srv.url}/api/processes`, makeProcess({ id: 'tf-cr', type: 'code-review' }));
            await postJSON(`${srv.url}/api/processes`, makeProcess({ id: 'tf-cl', type: 'clarification' }));

            const res = await request(`${srv.url}/api/processes?type=code-review`);
            const body = JSON.parse(res.body);
            expect(body.total).toBe(1);
            expect(body.processes[0].type).toBe('code-review');
        });
    });

    // ========================================================================
    // Since filtering
    // ========================================================================

    describe('Since filtering', () => {
        it('should filter by start time', async () => {
            const srv = await startServer();

            const old = new Date('2025-01-01T00:00:00Z').toISOString();
            const recent = new Date('2026-06-01T00:00:00Z').toISOString();

            await postJSON(`${srv.url}/api/processes`, makeProcess({ id: 'since-old', startTime: old }));
            await postJSON(`${srv.url}/api/processes`, makeProcess({ id: 'since-new', startTime: recent }));

            const res = await request(`${srv.url}/api/processes?since=2026-01-01T00:00:00Z`);
            const body = JSON.parse(res.body);
            expect(body.total).toBe(1);
            expect(body.processes[0].id).toBe('since-new');
        });
    });

    // ========================================================================
    // Cancel endpoint
    // ========================================================================

    describe('Cancel endpoint', () => {
        it('should cancel a running process', async () => {
            const srv = await startServer();

            await postJSON(`${srv.url}/api/processes`, makeProcess({ id: 'cancel-1', status: 'running' }));

            const res = await postJSON(`${srv.url}/api/processes/cancel-1/cancel`, {});
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.process.status).toBe('cancelled');
            expect(body.process.endTime).toBeDefined();
        });

        it('should return 409 for already-completed process', async () => {
            const srv = await startServer();

            await postJSON(`${srv.url}/api/processes`, makeProcess({ id: 'cancel-2', status: 'completed' }));

            const res = await postJSON(`${srv.url}/api/processes/cancel-2/cancel`, {});
            expect(res.status).toBe(409);
            expect(JSON.parse(res.body).error).toContain('terminal state');
        });

        it('should return 409 for already-cancelled process', async () => {
            const srv = await startServer();

            await postJSON(`${srv.url}/api/processes`, makeProcess({ id: 'cancel-3', status: 'cancelled' }));

            const res = await postJSON(`${srv.url}/api/processes/cancel-3/cancel`, {});
            expect(res.status).toBe(409);
        });

        it('should return 409 for failed process', async () => {
            const srv = await startServer();

            await postJSON(`${srv.url}/api/processes`, makeProcess({ id: 'cancel-4', status: 'failed' }));

            const res = await postJSON(`${srv.url}/api/processes/cancel-4/cancel`, {});
            expect(res.status).toBe(409);
        });

        it('should return 404 for nonexistent process', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/processes/nonexistent/cancel`, {});
            expect(res.status).toBe(404);
        });
    });

    // ========================================================================
    // Bulk delete
    // ========================================================================

    describe('Bulk delete', () => {
        it('should delete processes by status', async () => {
            const srv = await startServer();

            await postJSON(`${srv.url}/api/processes`, makeProcess({ id: 'bd-run', status: 'running' }));
            await postJSON(`${srv.url}/api/processes`, makeProcess({ id: 'bd-done1', status: 'completed' }));
            await postJSON(`${srv.url}/api/processes`, makeProcess({ id: 'bd-done2', status: 'completed' }));

            const res = await request(`${srv.url}/api/processes?status=completed`, { method: 'DELETE' });
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.removed).toBe(2);

            // Verify running process still exists
            const remaining = await request(`${srv.url}/api/processes`);
            expect(JSON.parse(remaining.body).total).toBe(1);
        });

        it('should return 400 when no status param is provided', async () => {
            const srv = await startServer();

            const res = await request(`${srv.url}/api/processes`, { method: 'DELETE' });
            expect(res.status).toBe(400);
            expect(JSON.parse(res.body).error).toContain('status');
        });
    });

    // ========================================================================
    // Error responses
    // ========================================================================

    describe('Error responses', () => {
        it('should return 404 for nonexistent process GET', async () => {
            const srv = await startServer();
            const res = await request(`${srv.url}/api/processes/does-not-exist`);
            expect(res.status).toBe(404);
            expect(JSON.parse(res.body).error).toBe('Process not found');
        });

        it('should return 400 for process creation with missing fields', async () => {
            const srv = await startServer();
            const res = await postJSON(`${srv.url}/api/processes`, { id: 'missing-fields' });
            expect(res.status).toBe(400);
            expect(JSON.parse(res.body).error).toContain('Missing required fields');
        });

        it('should return 404 for PATCH on nonexistent process', async () => {
            const srv = await startServer();
            const res = await patchJSON(`${srv.url}/api/processes/nope`, { status: 'completed' });
            expect(res.status).toBe(404);
        });

        it('should return 404 for DELETE on nonexistent process', async () => {
            const srv = await startServer();
            const res = await request(`${srv.url}/api/processes/nope`, { method: 'DELETE' });
            expect(res.status).toBe(404);
        });

        it('should return 400 for invalid JSON body on process create', async () => {
            const srv = await startServer();
            const res = await request(`${srv.url}/api/processes`, {
                method: 'POST',
                body: '{invalid',
                headers: { 'Content-Type': 'application/json' },
            });
            expect(res.status).toBe(400);
        });
    });

    // ========================================================================
    // Stats endpoint
    // ========================================================================

    describe('Stats endpoint', () => {
        it('should return correct aggregate statistics', async () => {
            const srv = await startServer();

            // Register workspaces
            await postJSON(`${srv.url}/api/workspaces`, { id: 'ws-1', name: 'frontend', rootPath: '/f' });
            await postJSON(`${srv.url}/api/workspaces`, { id: 'ws-2', name: 'backend', rootPath: '/b' });

            // Create processes
            await postJSON(`${srv.url}/api/processes`, makeProcess({ id: 'st1', status: 'running', workspaceId: 'ws-1' }));
            await postJSON(`${srv.url}/api/processes`, makeProcess({ id: 'st2', status: 'running', workspaceId: 'ws-1' }));
            await postJSON(`${srv.url}/api/processes`, makeProcess({ id: 'st3', status: 'completed', workspaceId: 'ws-2' }));
            await postJSON(`${srv.url}/api/processes`, makeProcess({ id: 'st4', status: 'failed', workspaceId: 'ws-2' }));
            await postJSON(`${srv.url}/api/processes`, makeProcess({ id: 'st5', status: 'cancelled', workspaceId: 'ws-1' }));

            const res = await request(`${srv.url}/api/stats`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);

            expect(body.totalProcesses).toBe(5);
            expect(body.byStatus.running).toBe(2);
            expect(body.byStatus.completed).toBe(1);
            expect(body.byStatus.failed).toBe(1);
            expect(body.byStatus.cancelled).toBe(1);
            expect(body.byStatus.queued).toBe(0);

            expect(body.byWorkspace).toHaveLength(2);
            const ws1 = body.byWorkspace.find((w: any) => w.workspaceId === 'ws-1');
            const ws2 = body.byWorkspace.find((w: any) => w.workspaceId === 'ws-2');
            expect(ws1.count).toBe(3);
            expect(ws1.name).toBe('frontend');
            expect(ws2.count).toBe(2);
            expect(ws2.name).toBe('backend');
        });

        it('should return zeros when no processes exist', async () => {
            const srv = await startServer();
            const res = await request(`${srv.url}/api/stats`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.totalProcesses).toBe(0);
            expect(body.byStatus.running).toBe(0);
            expect(body.byWorkspace).toEqual([]);
        });
    });
});
