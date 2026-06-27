/**
 * Diagrams Routes Removed — Hard Cutover Regression Test
 *
 * The dedicated `/api/diagrams` CRUD routes were deleted when diagrams were
 * folded into the unified Canvas system (one tool family, one store). This test
 * locks in the cutover: GET/PUT/DELETE on `/api/workspaces/:id/diagrams*` must
 * no longer be registered and therefore fall through to the API 404 handler.
 *
 * Pre-existing `excalidraw://<workspaceId>/<filename>` links and on-disk
 * `diagrams/*.excalidraw` files are intentionally not migrated.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FileProcessStore } from '@plusplusoneplusplus/forge';
import { createExecutionServer } from '../../src/server/index';
import type { ExecutionServer } from '../../src/server/types';
import { safeRm } from '../helpers/safe-rm';

// ============================================================================
// HTTP helpers
// ============================================================================

function request(
    url: string,
    options: { method?: string; body?: string; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const req = http.request(
            {
                hostname: parsed.hostname,
                port: parsed.port,
                path: parsed.pathname + parsed.search,
                method: options.method ?? 'GET',
                headers: options.headers,
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk: Buffer) => chunks.push(chunk));
                res.on('end', () =>
                    resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf-8') }),
                );
            },
        );
        req.on('error', reject);
        if (options.body) req.write(options.body);
        req.end();
    });
}

function jsonRequest(
    url: string,
    method: string,
    data?: unknown,
): Promise<{ status: number; body: string }> {
    const body = data ? JSON.stringify(data) : undefined;
    return request(url, {
        method,
        headers: {
            'Content-Type': 'application/json',
            ...(body ? { 'Content-Length': String(Buffer.byteLength(body)) } : {}),
        },
        body,
    });
}

const SAMPLE_SCENE = {
    type: 'excalidraw',
    version: 2,
    elements: [],
    appState: { viewBackgroundColor: '#ffffff' },
};

// ============================================================================
// Tests
// ============================================================================

describe('Diagrams routes removed (canvas-consolidation hard cutover)', { timeout: 30_000 }, () => {
    let server: ExecutionServer | undefined;
    let dataDir: string;
    let workspaceDir: string;
    let wsId: string;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'diagrams-removed-'));
        workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'diagrams-removed-ws-'));
        wsId = 'test-ws-' + Date.now();
    });

    afterEach(async () => {
        if (server) {
            await server.close();
            server = undefined;
        }
        await safeRm(dataDir);
        await safeRm(workspaceDir);
    });

    async function startServer(): Promise<ExecutionServer> {
        const store = new FileProcessStore({ dataDir });
        server = await createExecutionServer({
            port: 0,
            host: '127.0.0.1',
            store,
            dataDir,
            // excalidraw.enabled was the old gate; the routes are gone regardless.
            fileConfig: { excalidraw: { enabled: true } },
        });
        return server;
    }

    async function registerWorkspace(srv: ExecutionServer): Promise<void> {
        const res = await jsonRequest(`${srv.url}/api/workspaces`, 'POST', {
            id: wsId,
            name: 'Test Workspace',
            rootPath: workspaceDir,
        });
        expect(res.status).toBe(201);
    }

    function diagramUrl(srv: ExecutionServer, filename?: string): string {
        const base = `${srv.url}/api/workspaces/${wsId}/diagrams`;
        return filename ? `${base}/${encodeURIComponent(filename)}` : base;
    }

    it('GET list endpoint is no longer registered (404)', async () => {
        const srv = await startServer();
        await registerWorkspace(srv);

        const res = await request(diagramUrl(srv));
        expect(res.status).toBe(404);
        expect(JSON.parse(res.body).error).toMatch(/route not found/i);
    });

    it('GET single-diagram endpoint is no longer registered (404)', async () => {
        const srv = await startServer();
        await registerWorkspace(srv);

        const res = await request(diagramUrl(srv, 'arch.excalidraw'));
        expect(res.status).toBe(404);
    });

    it('PUT create/update endpoint is no longer registered (404)', async () => {
        const srv = await startServer();
        await registerWorkspace(srv);

        const res = await jsonRequest(diagramUrl(srv, 'arch.excalidraw'), 'PUT', { content: SAMPLE_SCENE });
        expect(res.status).toBe(404);
    });

    it('DELETE endpoint is no longer registered (404)', async () => {
        const srv = await startServer();
        await registerWorkspace(srv);

        const res = await jsonRequest(diagramUrl(srv, 'arch.excalidraw'), 'DELETE');
        expect(res.status).toBe(404);
    });
});
