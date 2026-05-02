/**
 * Workspace Description Field API Tests
 *
 * Tests for the description field on PATCH /api/workspaces/:id.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import * as http from 'http';
import { createRouter } from '../../src/server/shared/router';
import { registerApiRoutes } from '../../src/server/core/api-handler';
import type { Route } from '../../src/server/types';
import { createMockProcessStore } from './helpers/mock-process-store';

function request(
    url: string,
    options: { method?: string; body?: string; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: string; json: () => any }> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const req = http.request(
            {
                hostname: parsed.hostname,
                port: parsed.port,
                path: parsed.pathname + parsed.search,
                method: options.method || 'GET',
                headers: { 'Content-Type': 'application/json', ...options.headers },
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk) => chunks.push(chunk));
                res.on('end', () => {
                    const bodyStr = Buffer.concat(chunks).toString('utf-8');
                    resolve({
                        status: res.statusCode || 0,
                        body: bodyStr,
                        json: () => JSON.parse(bodyStr),
                    });
                });
            },
        );
        req.on('error', reject);
        if (options.body) { req.write(options.body); }
        req.end();
    });
}

describe('PATCH /api/workspaces/:id — description field', () => {
    let server: http.Server;
    let port: number;
    let mockStore: ReturnType<typeof createMockProcessStore>;

    const WORKSPACE_ID = 'ws-desc-test';

    beforeAll(async () => {
        mockStore = createMockProcessStore({
            initialWorkspaces: [{ id: WORKSPACE_ID, name: 'My Project', rootPath: '/projects/my' }],
        });

        const routes: Route[] = [];
        registerApiRoutes(routes, mockStore);
        const handleRequest = createRouter({ routes, spaHtml: '<html></html>' });
        server = http.createServer(handleRequest);
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        port = (server.address() as any).port;
    });

    afterAll(async () => {
        await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    beforeEach(() => {
        (mockStore.getWorkspaces as any).mockResolvedValue([
            { id: WORKSPACE_ID, name: 'My Project', rootPath: '/projects/my' },
        ]);
        (mockStore.updateWorkspace as any).mockImplementation(async (id: string, updates: any) => {
            return { id, name: 'My Project', rootPath: '/projects/my', ...updates };
        });
    });

    const base = () => `http://127.0.0.1:${port}`;

    it('saves description via PATCH and returns the updated workspace', async () => {
        const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}`, {
            method: 'PATCH',
            body: JSON.stringify({ description: 'Team ownership: backend infra' }),
        });
        expect(res.status).toBe(200);
        const data = res.json();
        expect(data.workspace.description).toBe('Team ownership: backend infra');
    });

    it('clears description when empty string is sent', async () => {
        const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}`, {
            method: 'PATCH',
            body: JSON.stringify({ description: '' }),
        });
        expect(res.status).toBe(200);
        const data = res.json();
        expect(data.workspace.description).toBe('');
    });

    it('does not modify description when field is absent from the body', async () => {
        const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}`, {
            method: 'PATCH',
            body: JSON.stringify({ name: 'Renamed' }),
        });
        expect(res.status).toBe(200);
        const data = res.json();
        expect(data.workspace).not.toHaveProperty('description');
    });

    it('returns 404 for unknown workspace id', async () => {
        (mockStore.updateWorkspace as any).mockResolvedValue(null);
        const res = await request(`${base()}/api/workspaces/unknown-ws`, {
            method: 'PATCH',
            body: JSON.stringify({ description: 'anything' }),
        });
        expect(res.status).toBe(404);
    });
});
