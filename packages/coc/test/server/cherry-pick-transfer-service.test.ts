import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { CocApiError } from '@plusplusoneplusplus/coc-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CherryPickTransferService, TransferHttpError } from '../../src/server/servers/cherry-pick-transfer-service';
import { DevTunnelConnector } from '../../src/server/servers/devtunnel-connector';
import { RemoteServerRuntimeService } from '../../src/server/servers/remote-server-runtime-service';
import { RemoteServerStore } from '../../src/server/servers/remote-server-store';

interface StartedServer {
    server: http.Server;
    baseUrl: string;
}

function start(server: http.Server): Promise<StartedServer> {
    return new Promise((resolve, reject) => {
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const addr = server.address() as { port: number };
            resolve({ server, baseUrl: `http://127.0.0.1:${addr.port}` });
        });
    });
}

function stop(server: http.Server): Promise<void> {
    return new Promise(resolve => server.close(() => resolve()));
}

async function startHealthServer(label: string, healthStatus = 200): Promise<StartedServer> {
    const server = http.createServer((req, res) => {
        if (req.url === '/api/health') {
            res.writeHead(healthStatus, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'ok', uptime: 1, processCount: 1 }));
            return;
        }
        if (req.url === '/api/admin/version') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ version: '1.0.0', commit: 'abc123' }));
            return;
        }
        if (req.url === '/api/admin/config') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ hostname: label }));
            return;
        }
        res.writeHead(404);
        res.end();
    });
    return start(server);
}

describe('CherryPickTransferService', () => {
    let dataDir: string;
    let servers: http.Server[];

    const patchExport = {
        sourceWorkspace: { id: 'source-ws', name: 'Source Repo' },
        sourceCommit: {
            hash: 'abc123def456',
            subject: 'Move feature',
            author: { name: 'Patch Author', email: 'patch-author@example.test', date: '2026-06-04T00:00:00+00:00' },
        },
        normalizedSourceRemoteUrl: 'example.test/org/repo',
        patch: { format: 'format-patch' as const, body: 'From abc123def456 Mon Sep 17 00:00:00 2001\n' },
    };

    const patchApply = {
        success: true as const,
        targetWorkspace: { id: 'target-ws', name: 'Target Repo' },
        targetBranch: 'main',
        targetHead: 'def456abc789',
        newCommitHash: 'def456abc789',
        stashed: false,
        operation: {
            id: 'op-1',
            workspaceId: 'target-ws',
            op: 'cherry-pick-transfer',
            status: 'success',
            startedAt: '2026-06-04T00:00:01.000Z',
        },
    };

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cherry-pick-transfer-service-'));
        servers = [];
    });

    afterEach(async () => {
        await Promise.all(servers.map(server => server.listening ? stop(server) : Promise.resolve()));
        fs.rmSync(dataDir, { recursive: true, force: true });
        vi.restoreAllMocks();
    });

    function createService(options?: {
        getLocalBaseUrl?: () => string | undefined;
        clientFactory?: (baseUrl: string, timeoutMs: number) => any;
    }): { store: RemoteServerStore; service: CherryPickTransferService } {
        const store = new RemoteServerStore(dataDir);
        const runtime = new RemoteServerRuntimeService({
            store,
            connector: new DevTunnelConnector(),
        });
        const service = new CherryPickTransferService({
            runtime,
            getLocalBaseUrl: options?.getLocalBaseUrl,
            requestTimeoutMs: 2_000,
            clientFactory: options?.clientFactory,
        });
        return { store, service };
    }

    it('exports from one remote server and applies on another remote server', async () => {
        const sourceHealth = await startHealthServer('source-coc');
        const targetHealth = await startHealthServer('target-coc');
        servers.push(sourceHealth.server, targetHealth.server);

        const exportCommitPatches = vi.fn().mockResolvedValue(patchExport);
        const applyCommitPatch = vi.fn().mockResolvedValue(patchApply);
        const clients = new Map<string, any>([
            [sourceHealth.baseUrl, { git: { exportCommitPatches, applyCommitPatch: vi.fn() } }],
            [targetHealth.baseUrl, { git: { exportCommitPatches: vi.fn(), applyCommitPatch } }],
        ]);
        const { store, service } = createService({
            clientFactory: baseUrl => {
                const client = clients.get(baseUrl);
                if (!client) throw new Error(`Unexpected client base URL: ${baseUrl}`);
                return client;
            },
        });
        const sourceServer = store.create({ kind: 'url', label: 'Source Server', url: sourceHealth.baseUrl });
        const targetServer = store.create({ kind: 'url', label: 'Target Server', url: targetHealth.baseUrl });

        const result = await service.run({
            source: { serverId: sourceServer.id, workspaceId: 'source-ws', commitHash: 'abc123def456' },
            target: { serverId: targetServer.id, workspaceId: 'target-ws', stashAndContinue: true },
        });

        expect(result).toMatchObject({
            success: true,
            source: {
                server: { id: sourceServer.id, label: 'Source Server' },
                workspace: { id: 'source-ws', name: 'Source Repo' },
                commit: { hash: 'abc123def456', subject: 'Move feature' },
                normalizedRemoteUrl: 'example.test/org/repo',
            },
            target: {
                server: { id: targetServer.id, label: 'Target Server' },
                workspace: { id: 'target-ws', name: 'Target Repo' },
                branch: 'main',
                head: 'def456abc789',
            },
        });
        expect(exportCommitPatches).toHaveBeenCalledWith('source-ws', ['abc123def456']);
        expect(applyCommitPatch).toHaveBeenCalledWith('target-ws', expect.objectContaining({
            patch: patchExport.patch,
            stashAndContinue: true,
            sourceServer: { id: sourceServer.id, label: 'Source Server' },
            sourceWorkspace: patchExport.sourceWorkspace,
            sourceCommit: patchExport.sourceCommit,
            sourceCommits: [patchExport.sourceCommit],
            normalizedSourceRemoteUrl: 'example.test/org/repo',
        }));
    });

    it('rejects invalid commitHashes before resolving endpoints', async () => {
        const { service } = createService();

        await expect(service.run({
            source: { workspaceId: 'source-ws', commitHashes: ['abc123def456', 'not a hash'] },
            target: { workspaceId: 'target-ws' },
        })).rejects.toMatchObject({
            statusCode: 400,
            body: { error: 'source.commitHashes must all be git commit hashes' },
        } satisfies Partial<TransferHttpError>);
    });

    it('returns a clear 503 when a registered remote server is offline', async () => {
        const offlineHealth = await startHealthServer('offline-coc', 500);
        servers.push(offlineHealth.server);
        const { store, service } = createService({ getLocalBaseUrl: () => 'http://127.0.0.1:1' });
        const sourceServer = store.create({ kind: 'url', label: 'Offline Server', url: offlineHealth.baseUrl });

        await expect(service.run({
            source: { serverId: sourceServer.id, workspaceId: 'source-ws', commitHash: 'abc123def456' },
            target: { workspaceId: 'target-ws' },
        })).rejects.toMatchObject({
            statusCode: 503,
            body: {
                server: { id: sourceServer.id, label: 'Offline Server' },
                status: 'offline',
            },
        } satisfies Partial<TransferHttpError>);
    });

    it('propagates remote apply conflicts with phase and server metadata', async () => {
        const sourceHealth = await startHealthServer('source-coc');
        const targetHealth = await startHealthServer('target-coc');
        servers.push(sourceHealth.server, targetHealth.server);
        const applyError = new CocApiError({
            status: 409,
            statusText: 'Conflict',
            url: `${targetHealth.baseUrl}/api/workspaces/target-ws/git/patch/apply`,
            message: 'Patch apply stopped with conflicts',
            body: {
                error: 'Patch apply stopped with conflicts',
                conflicts: true,
                gitState: { operation: 'cherry-pick', gitOperation: 'am', conflictFiles: ['shared.txt'] },
            },
        });
        const clients = new Map<string, any>([
            [sourceHealth.baseUrl, { git: { exportCommitPatches: vi.fn().mockResolvedValue(patchExport), applyCommitPatch: vi.fn() } }],
            [targetHealth.baseUrl, { git: { exportCommitPatches: vi.fn(), applyCommitPatch: vi.fn().mockRejectedValue(applyError) } }],
        ]);
        const { store, service } = createService({
            clientFactory: baseUrl => {
                const client = clients.get(baseUrl);
                if (!client) throw new Error(`Unexpected client base URL: ${baseUrl}`);
                return client;
            },
        });
        const sourceServer = store.create({ kind: 'url', label: 'Source Server', url: sourceHealth.baseUrl });
        const targetServer = store.create({ kind: 'url', label: 'Target Server', url: targetHealth.baseUrl });

        await expect(service.run({
            source: { serverId: sourceServer.id, workspaceId: 'source-ws', commitHash: 'abc123def456' },
            target: { serverId: targetServer.id, workspaceId: 'target-ws' },
        })).rejects.toMatchObject({
            statusCode: 409,
            body: {
                error: 'Patch apply stopped with conflicts',
                conflicts: true,
                phase: 'apply',
                server: { id: targetServer.id, label: 'Target Server' },
                gitState: { operation: 'cherry-pick', gitOperation: 'am', conflictFiles: ['shared.txt'] },
            },
        } satisfies Partial<TransferHttpError>);
    });

    it('requires the initiating server base URL for local transfer endpoints', async () => {
        const { service } = createService();

        await expect(service.run({
            source: { workspaceId: 'source-ws', commitHash: 'abc123def456' },
            target: { workspaceId: 'target-ws' },
        })).rejects.toMatchObject({
            statusCode: 503,
            body: {
                server: { id: 'local', label: 'Current CoC' },
                status: 'offline',
            },
        } satisfies Partial<TransferHttpError>);
    });
});
