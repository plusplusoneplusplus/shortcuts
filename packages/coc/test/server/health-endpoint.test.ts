/**
 * Health Endpoint Tests
 *
 * Verifies GET /api/health uses getProcessCount() instead of
 * loading all processes into memory.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import * as http from 'http';
import { createRequestHandler } from '../../src/server/router';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import type { Route } from '../../src/server/types';

function createMockStore(processCount: number): ProcessStore {
    return {
        addProcess: vi.fn(),
        updateProcess: vi.fn(),
        getProcess: vi.fn(),
        getAllProcesses: vi.fn(async () => { throw new Error('should not be called'); }),
        removeProcess: vi.fn(),
        clearProcesses: vi.fn(),
        getWorkspaces: vi.fn(),
        registerWorkspace: vi.fn(),
        removeWorkspace: vi.fn(),
        updateWorkspace: vi.fn(),
        getWikis: vi.fn(),
        registerWiki: vi.fn(),
        removeWiki: vi.fn(),
        updateWiki: vi.fn(),
        clearAllWorkspaces: vi.fn(),
        clearAllWikis: vi.fn(),
        getProcessCount: vi.fn(async () => processCount),
        getStorageStats: vi.fn(),
        onProcessOutput: vi.fn(() => () => {}),
        emitProcessOutput: vi.fn(),
        emitProcessComplete: vi.fn(),
        emitProcessEvent: vi.fn(),
        appendConversationTurn: vi.fn(),
        upsertStreamingTurn: vi.fn(),
        updateTurnContent: vi.fn(),
    } as unknown as ProcessStore;
}

function request(url: string): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const req = http.request(
            { hostname: parsed.hostname, port: parsed.port, path: parsed.pathname, method: 'GET' },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (c: Buffer) => chunks.push(c));
                res.on('end', () => resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString('utf-8') }));
            },
        );
        req.on('error', reject);
        req.end();
    });
}

describe('GET /api/health', () => {
    let server: http.Server;
    let baseUrl: string;
    let store: ProcessStore;

    beforeAll(async () => {
        store = createMockStore(42);
        const routes: Route[] = [];
        const handler = createRequestHandler({ routes, spaHtml: '<html></html>', store });
        server = http.createServer(handler);
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
        const addr = server.address() as { port: number };
        baseUrl = `http://127.0.0.1:${addr.port}`;
    });

    afterAll(async () => {
        await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    it('returns processCount from getProcessCount()', async () => {
        const resp = await request(`${baseUrl}/api/health`);
        expect(resp.status).toBe(200);
        const body = JSON.parse(resp.body);
        expect(body.status).toBe('ok');
        expect(body.processCount).toBe(42);
        expect(typeof body.uptime).toBe('number');
    });

    it('calls getProcessCount instead of getAllProcesses', async () => {
        (store.getProcessCount as ReturnType<typeof vi.fn>).mockClear();
        await request(`${baseUrl}/api/health`);
        expect(store.getProcessCount).toHaveBeenCalledOnce();
        expect(store.getAllProcesses).not.toHaveBeenCalled();
    });
});
