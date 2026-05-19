/**
 * Diagrams Handler Tests
 *
 * Integration tests for the Excalidraw diagram CRUD REST API:
 *   GET    /api/workspaces/:id/diagrams            — list
 *   GET    /api/workspaces/:id/diagrams/:filename   — read
 *   PUT    /api/workspaces/:id/diagrams/:filename   — create/update
 *   DELETE /api/workspaces/:id/diagrams/:filename   — delete
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FileProcessStore, getRepoDataPath } from '@plusplusoneplusplus/forge';
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

// ============================================================================
// Sample Excalidraw scene
// ============================================================================

const SAMPLE_SCENE = {
    type: 'excalidraw',
    version: 2,
    elements: [
        {
            type: 'rectangle',
            id: 'rect1',
            x: 100,
            y: 100,
            width: 200,
            height: 100,
            strokeColor: '#000000',
            backgroundColor: '#ffffff',
        },
    ],
    appState: { viewBackgroundColor: '#ffffff' },
};

// ============================================================================
// Tests
// ============================================================================

describe('Diagrams Handler — CRUD API', { timeout: 30_000 }, () => {
    let server: ExecutionServer | undefined;
    let dataDir: string;
    let workspaceDir: string;
    let wsId: string;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'diagrams-handler-'));
        workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'diagrams-ws-'));
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

    // -------------------------------------------------------------------------
    // LIST
    // -------------------------------------------------------------------------

    it('returns empty list when no diagrams exist', async () => {
        const srv = await startServer();
        await registerWorkspace(srv);

        const res = await request(diagramUrl(srv));
        expect(res.status).toBe(200);
        const data = JSON.parse(res.body);
        expect(data.diagrams).toEqual([]);
    });

    it('lists diagrams after creation', async () => {
        const srv = await startServer();
        await registerWorkspace(srv);

        await jsonRequest(diagramUrl(srv, 'arch.excalidraw'), 'PUT', { content: SAMPLE_SCENE });
        await jsonRequest(diagramUrl(srv, 'flow.excalidraw'), 'PUT', { content: SAMPLE_SCENE });

        const res = await request(diagramUrl(srv));
        expect(res.status).toBe(200);
        const data = JSON.parse(res.body);
        expect(data.diagrams).toHaveLength(2);
        expect(data.diagrams[0].filename).toBe('arch.excalidraw');
        expect(data.diagrams[1].filename).toBe('flow.excalidraw');
        expect(data.diagrams[0].sizeBytes).toBeGreaterThan(0);
    });

    // -------------------------------------------------------------------------
    // CREATE (PUT)
    // -------------------------------------------------------------------------

    it('creates a new diagram with 201', async () => {
        const srv = await startServer();
        await registerWorkspace(srv);

        const res = await jsonRequest(diagramUrl(srv, 'new-diagram'), 'PUT', { content: SAMPLE_SCENE });
        expect(res.status).toBe(201);
        const data = JSON.parse(res.body);
        expect(data.filename).toBe('new-diagram.excalidraw');
        expect(data.created).toBe(true);
    });

    it('auto-appends .excalidraw extension when missing', async () => {
        const srv = await startServer();
        await registerWorkspace(srv);

        const res = await jsonRequest(diagramUrl(srv, 'my-flow'), 'PUT', { content: SAMPLE_SCENE });
        expect(res.status).toBe(201);
        const data = JSON.parse(res.body);
        expect(data.filename).toBe('my-flow.excalidraw');
    });

    it('accepts raw Excalidraw JSON without content wrapper', async () => {
        const srv = await startServer();
        await registerWorkspace(srv);

        const res = await jsonRequest(diagramUrl(srv, 'raw.excalidraw'), 'PUT', SAMPLE_SCENE);
        expect(res.status).toBe(201);

        // Verify by reading back
        const readRes = await request(diagramUrl(srv, 'raw.excalidraw'));
        expect(readRes.status).toBe(200);
        const readData = JSON.parse(readRes.body);
        expect(readData.content.type).toBe('excalidraw');
    });

    it('updates an existing diagram with 200', async () => {
        const srv = await startServer();
        await registerWorkspace(srv);

        // Create
        const createRes = await jsonRequest(diagramUrl(srv, 'diagram.excalidraw'), 'PUT', { content: SAMPLE_SCENE });
        expect(createRes.status).toBe(201);

        // Update
        const updatedScene = { ...SAMPLE_SCENE, version: 3 };
        const updateRes = await jsonRequest(diagramUrl(srv, 'diagram.excalidraw'), 'PUT', { content: updatedScene });
        expect(updateRes.status).toBe(200);
        const data = JSON.parse(updateRes.body);
        expect(data.created).toBe(false);
    });

    // -------------------------------------------------------------------------
    // READ (GET)
    // -------------------------------------------------------------------------

    it('reads a created diagram', async () => {
        const srv = await startServer();
        await registerWorkspace(srv);

        await jsonRequest(diagramUrl(srv, 'arch.excalidraw'), 'PUT', { content: SAMPLE_SCENE });

        const res = await request(diagramUrl(srv, 'arch.excalidraw'));
        expect(res.status).toBe(200);
        const data = JSON.parse(res.body);
        expect(data.filename).toBe('arch.excalidraw');
        expect(data.content.type).toBe('excalidraw');
        expect(data.content.elements).toHaveLength(1);
        expect(data.sizeBytes).toBeGreaterThan(0);
        expect(data.createdAt).toBeDefined();
        expect(data.updatedAt).toBeDefined();
    });

    it('returns 404 for a non-existent diagram', async () => {
        const srv = await startServer();
        await registerWorkspace(srv);

        const res = await request(diagramUrl(srv, 'does-not-exist.excalidraw'));
        expect(res.status).toBe(404);
    });

    // -------------------------------------------------------------------------
    // DELETE
    // -------------------------------------------------------------------------

    it('deletes an existing diagram', async () => {
        const srv = await startServer();
        await registerWorkspace(srv);

        await jsonRequest(diagramUrl(srv, 'to-delete.excalidraw'), 'PUT', { content: SAMPLE_SCENE });

        const delRes = await jsonRequest(diagramUrl(srv, 'to-delete.excalidraw'), 'DELETE');
        expect(delRes.status).toBe(200);
        const data = JSON.parse(delRes.body);
        expect(data.deleted).toBe(true);

        // Verify it's gone
        const readRes = await request(diagramUrl(srv, 'to-delete.excalidraw'));
        expect(readRes.status).toBe(404);
    });

    it('returns 404 when deleting a non-existent diagram', async () => {
        const srv = await startServer();
        await registerWorkspace(srv);

        const res = await jsonRequest(diagramUrl(srv, 'ghost.excalidraw'), 'DELETE');
        expect(res.status).toBe(404);
    });

    // -------------------------------------------------------------------------
    // Validation / edge cases
    // -------------------------------------------------------------------------

    it('rejects path traversal in filename', async () => {
        const srv = await startServer();
        await registerWorkspace(srv);

        const res = await jsonRequest(diagramUrl(srv, '..%2F..%2Fetc%2Fpasswd'), 'PUT', { content: SAMPLE_SCENE });
        expect(res.status).toBe(400);
    });

    it('rejects empty filename', async () => {
        const srv = await startServer();
        await registerWorkspace(srv);

        const res = await jsonRequest(diagramUrl(srv, '.excalidraw'), 'PUT', { content: SAMPLE_SCENE });
        expect(res.status).toBe(400);
    });

    it('returns 404 for non-existent workspace', async () => {
        const srv = await startServer();
        const res = await request(`${srv.url}/api/workspaces/nonexistent/diagrams`);
        expect(res.status).toBe(404);
    });

    // -------------------------------------------------------------------------
    // Feature flag — routes not registered when disabled
    // -------------------------------------------------------------------------

    it('returns 404 when excalidraw feature is disabled', async () => {
        const store = new FileProcessStore({ dataDir });
        server = await createExecutionServer({
            port: 0,
            host: '127.0.0.1',
            store,
            dataDir,
            fileConfig: { excalidraw: { enabled: false } },
        });
        const srv = server;

        // Register workspace
        const wsRes = await jsonRequest(`${srv.url}/api/workspaces`, 'POST', {
            id: wsId,
            name: 'Test Workspace',
            rootPath: workspaceDir,
        });
        expect(wsRes.status).toBe(201);

        // Diagrams endpoint should not exist
        const res = await request(`${srv.url}/api/workspaces/${wsId}/diagrams`);
        // Since routes aren't registered, the server falls through to SPA or 404
        expect(res.status).not.toBe(200);
    });
});
