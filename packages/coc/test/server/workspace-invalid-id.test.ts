/**
 * Workspace Invalid ID Tests — Section 4
 *
 * Guards against error-handler regressions where a missing workspace causes
 * an unhandled exception (500) instead of a clean 404.
 *
 * Every endpoint that accepts a workspace ID must return 404 NOT 500 when the
 * workspace does not exist.
 *
 * Uses port 0 (OS-assigned) for test isolation.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createExecutionServer } from '../../src/server/index';
import { FileProcessStore } from '@plusplusoneplusplus/forge';
import type { ExecutionServer } from '@plusplusoneplusplus/coc-server';

// ============================================================================
// Helpers
// ============================================================================

function request(
    url: string,
    options: { method?: string; body?: string; headers?: Record<string, string> } = {}
): Promise<{ status: number; body: string }> {
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
                    resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString('utf-8') });
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

// ============================================================================
// Tests
// ============================================================================

describe('Invalid Workspace ID → 404 NOT 500', () => {
    let server: ExecutionServer;
    let dataDir: string;
    const nonexistent = 'nonexistent-ws-id';

    beforeAll(async () => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-invalid-id-'));
        const store = new FileProcessStore({ dataDir });
        server = await createExecutionServer({ port: 0, host: 'localhost', store, dataDir });
    });

    afterAll(async () => {
        await server.close();
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    // Helper that asserts exactly 404 (not 500, not 400)
    async function assert404(method: string, url: string, body?: unknown) {
        const res = body !== undefined
            ? await postJSON(url, body)
            : await request(url, { method });
        expect(
            res.status,
            `Expected 404 but got ${res.status} for ${method} ${url}\nBody: ${res.body}`
        ).toBe(404);
        expect(res.status).not.toBe(500);
    }

    it('GET /api/workspaces/:id/git/commits → 404', async () => {
        await assert404('GET', `${server.url}/api/workspaces/${nonexistent}/git/commits`);
    });

    it('GET /api/workspaces/:id/git/branches → 404', async () => {
        await assert404('GET', `${server.url}/api/workspaces/${nonexistent}/git/branches`);
    });

    it('GET /api/workspaces/:id/git-info → 404', async () => {
        await assert404('GET', `${server.url}/api/workspaces/${nonexistent}/git-info`);
    });

    it('GET /api/workspaces/:id/tasks → 404', async () => {
        await assert404('GET', `${server.url}/api/workspaces/${nonexistent}/tasks`);
        const res = await request(`${server.url}/api/workspaces/${nonexistent}/tasks`);
        const body = JSON.parse(res.body);
        expect(body.error).toBeDefined();
    });

    it('POST /api/workspaces/:id/tasks/generate → 404', async () => {
        const res = await postJSON(`${server.url}/api/workspaces/${nonexistent}/tasks/generate`, { scope: {} });
        expect(res.status).toBe(404);
        expect(res.status).not.toBe(500);
    });

    it('GET /api/workspaces/:id/schedules → not 500 (200 or 404 depending on implementation)', async () => {
        // Schedules use a namespace-style store that accepts any workspace ID,
        // so this may return 200 with an empty list OR 404 — but never 500.
        const res = await request(`${server.url}/api/workspaces/${nonexistent}/schedules`);
        expect(res.status).not.toBe(500);
    });

    it('POST /api/workspaces/:id/queue/generate → 404', async () => {
        const res = await postJSON(`${server.url}/api/workspaces/${nonexistent}/queue/generate`, {
            prompt: 'test',
        });
        expect(res.status).toBe(404);
        expect(res.status).not.toBe(500);
    });

    it('GET /api/workspaces/:id/mcp-config → 404', async () => {
        await assert404('GET', `${server.url}/api/workspaces/${nonexistent}/mcp-config`);
    });

    it('GET /api/comments/:wsId/path for nonexistent workspace → 200 with empty array or 404 (not 500)', async () => {
        const res = await request(`${server.url}/api/comments/${nonexistent}/path/to/file.md`);
        // Comments for a non-registered workspace should gracefully return
        // either 404 or empty array — never 500
        expect(res.status).not.toBe(500);
        if (res.status === 200) {
            const body = JSON.parse(res.body);
            expect(Array.isArray(body.comments)).toBe(true);
        } else {
            expect(res.status).toBe(404);
        }
    });

    it('All invalid-workspace 404 responses have a defined error field (workspace-validated endpoints)', async () => {
        // Only endpoints that require workspace registration should return 404
        const endpoints = [
            { method: 'GET', path: `/api/workspaces/${nonexistent}/tasks` },
            { method: 'GET', path: `/api/workspaces/${nonexistent}/git-info` },
        ];

        for (const ep of endpoints) {
            const res = await request(`${server.url}${ep.path}`, { method: ep.method });
            expect(res.status).toBe(404);
            let body: any;
            try {
                body = JSON.parse(res.body);
            } catch {
                // If body is not JSON, that's also acceptable as long as it's not 500
                continue;
            }
            expect(body.error).toBeDefined();
        }
    });
});
