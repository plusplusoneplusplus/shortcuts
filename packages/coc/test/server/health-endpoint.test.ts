/**
 * Verifies GET /api/health uses getProcessCount() instead of
 * loading all processes into memory.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import * as http from 'http';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const nativeStatuses = vi.hoisted(() => ({
    file: vi.fn(() => ({ loaded: true, binaryPath: '/native/current.node' })),
    notes: vi.fn(() => ({ loaded: false, binaryPath: '/native/stale.node', reason: 'missing Notes capability' })),
    git: vi.fn(() => ({ loaded: true, binaryPath: '/native/current.node' })),
}));

vi.mock('@plusplusoneplusplus/coc-native', () => ({
    nativeRepoFilesStatus: nativeStatuses.file,
    nativeNotesIndexStatus: nativeStatuses.notes,
    nativeGitStatus: nativeStatuses.git,
}));

import { createRequestHandler } from '../../src/server/router';
import { getOrCreateServerIdentity } from '../../src/server/servers/server-identity';
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
    let dataDir: string;
    let serverIdentity: string;

    beforeAll(async () => {
        store = createMockStore(42);
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-health-identity-'));
        serverIdentity = getOrCreateServerIdentity(dataDir);
        const routes: Route[] = [];
        const handler = createRequestHandler({ routes, spaHtml: '<html></html>', store, serverIdentity });
        server = http.createServer(handler);
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
        const addr = server.address() as { port: number };
        baseUrl = `http://127.0.0.1:${addr.port}`;
    });

    afterAll(async () => {
        await new Promise<void>((resolve) => server.close(() => resolve()));
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    it('returns processCount from getProcessCount()', async () => {
        const resp = await request(`${baseUrl}/api/health`);
        expect(resp.status).toBe(200);
        const body = JSON.parse(resp.body);
        expect(body.status).toBe('ok');
        expect(body.serverIdentity).toBe(serverIdentity);
        expect(body.processCount).toBe(42);
        expect(typeof body.uptime).toBe('number');
        expect(body.nativeFileIndex).toEqual({ loaded: true, binaryPath: '/native/current.node' });
        expect(body.nativeNotesIndex).toEqual({
            loaded: false,
            binaryPath: '/native/stale.node',
            reason: 'missing Notes capability',
        });
        expect(body.nativeContentSearch).toEqual({ loaded: true, binaryPath: '/native/current.node' });
        expect(body.nativeGit).toEqual({ loaded: true, binaryPath: '/native/current.node' });
        expect(nativeStatuses.file).toHaveBeenCalledOnce();
        expect(nativeStatuses.notes).toHaveBeenCalledOnce();
        expect(nativeStatuses.git).toHaveBeenCalledOnce();
    });

    it('reports an unusable repo-files capability for both repository search fields', async () => {
        const unavailable = { loaded: false, binaryPath: '/native/stale.node', reason: 'missing repo files' };
        nativeStatuses.file.mockReturnValueOnce(unavailable);
        const resp = await request(`${baseUrl}/api/health`);
        expect(resp.status).toBe(200);
        const body = JSON.parse(resp.body);
        expect(body.nativeFileIndex).toEqual(unavailable);
        expect(body.nativeContentSearch).toEqual(unavailable);
    });

    it('calls getProcessCount instead of getAllProcesses', async () => {
        (store.getProcessCount as ReturnType<typeof vi.fn>).mockClear();
        await request(`${baseUrl}/api/health`);
        expect(store.getProcessCount).toHaveBeenCalledOnce();
        expect(store.getAllProcesses).not.toHaveBeenCalled();
    });

    it('advertises the same identity when served through a different port', async () => {
        const other = http.createServer(createRequestHandler({
            routes: [], spaHtml: '', store, serverIdentity: getOrCreateServerIdentity(dataDir),
        }));
        await new Promise<void>((resolve) => other.listen(0, '127.0.0.1', resolve));
        try {
            const port = (other.address() as { port: number }).port;
            expect(`http://127.0.0.1:${port}`).not.toBe(baseUrl);
            const original = JSON.parse((await request(`${baseUrl}/api/health`)).body);
            const reconnected = JSON.parse((await request(`http://127.0.0.1:${port}/api/health`)).body);
            expect(reconnected.serverIdentity).toBe(original.serverIdentity);
        } finally {
            await new Promise<void>((resolve) => other.close(() => resolve()));
        }
    });
});
