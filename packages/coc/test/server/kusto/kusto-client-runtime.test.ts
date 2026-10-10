import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthError, type MicrosoftTokenProviderOptions } from '@plusplusoneplusplus/coc-native';
import { createKustoClientRuntime } from '../../../src/server/kusto/kusto-client-runtime';
import { KustoCredentialError, RustKustoCredential, type KustoAuthConfig } from '../../../src/server/kusto/kusto-credential';
import { executeKustoQuery, type KustoClientLike } from '../../../src/server/kusto/kusto-exec';
import { CanvasStore } from '../../../src/server/canvas/canvas-store';
import { createKustoTools } from '../../../src/server/llm-tools/kusto-tools';
import { buildKustoToolsAddon } from '../../../src/server/executors/prompt-builder';
import { runKustoCanvas } from '../../../src/server/kusto/kusto-service';
import { createEmptyKustoState, serializeKustoState, parseKustoState } from '../../../src/server/canvas/kusto-state';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const account = 'fixture-account';
const tenant = '11111111-1111-4111-8111-111111111111';
const subscription = '22222222-2222-4222-8222-222222222222';
const resource = 'https://kusto.kusto.windows.net';
const clusterUrl = 'https://fixture.kusto.windows.net';
const params = { clusterUrl, database: 'FixtureDB', query: 'print auth_check = 1' };
const response = {
    primaryResults: [{
        columns: [{ name: 'auth_check', type: 'long' }],
        rows: () => [{ getValueAt: () => 1 }],
    }],
};
const owners: Array<ReturnType<typeof createKustoClientRuntime>> = [];
const directories: string[] = [];
afterEach(() => {
    owners.splice(0).forEach(owner => owner.dispose());
    directories.splice(0).forEach(directory => rmSync(directory, { recursive: true, force: true }));
    vi.restoreAllMocks();
});

function fixture(enabled = true) {
    let config: KustoAuthConfig = {
        enabled,
        azureCli: { account, tenant, subscription },
    };
    const providers: Array<{
        getToken: ReturnType<typeof vi.fn>;
        cancelOutstanding: ReturnType<typeof vi.fn>;
        dispose: ReturnType<typeof vi.fn>;
    }> = [];
    const createProvider = vi.fn((options: MicrosoftTokenProviderOptions) => {
        if (options.source !== 'azure-cli') throw new Error('Unexpected source');
        const cli = options.azureCli;
        const selected = 'selection' in cli ? { id: account, tenant } : cli.account;
        const provider = {
            getToken: vi.fn(async () => ({
                source: 'azure-cli' as const, tokenType: 'Bearer', accessToken: 'opaque-fixture',
                expiresAt: Date.now() + 3_600_000, target: cli.resource, account: selected,
            })),
            cancelOutstanding: vi.fn(), dispose: vi.fn(),
        };
        providers.push(provider);
        return provider;
    });
    const execute = vi.fn(async () => response);
    const close = vi.fn();
    const buildClient = vi.fn(async (_cluster: string, credential?: import('@azure/identity').TokenCredential): Promise<KustoClientLike> => ({
        execute: async (db, query) => {
            if (credential) await credential.getToken([`${resource}/.default`]);
            return execute(db, query);
        },
        close,
    }));
    const diagnostic = vi.fn();
    const runtime = createKustoClientRuntime(() => config, { createProvider, buildClient, diagnostic });
    owners.push(runtime);
    return { runtime, providers, createProvider, buildClient, execute, close, diagnostic,
        setConfig: (next: KustoAuthConfig) => { config = next; },
        getConfig: () => config };
}

describe('host-owned Kusto credential/cache rollout', () => {
    it('Kusto without an auth switch always constructs the Rust credential', async () => {
        const f = fixture();
        await executeKustoQuery(params, { clientFactory: f.runtime.clientFactory });
        expect(f.buildClient.mock.calls[0][1]).toBeInstanceOf(RustKustoCredential);
        expect(f.createProvider).toHaveBeenCalledTimes(1);
    });

    it('shares concurrent construction and cached client but invokes the provider for every query', async () => {
        const f = fixture();
        const [a, b] = await Promise.all([
            f.runtime.clientFactory(params),
            f.runtime.clientFactory({ ...params, database: 'OtherDB' }),
        ]);
        expect(a).toBe(b);
        await a.execute(params.database, params.query);
        await b.execute('OtherDB', params.query);
        expect(f.buildClient).toHaveBeenCalledTimes(1);
        expect(f.buildClient.mock.calls[0][1]).toBeInstanceOf(RustKustoCredential);
        expect(f.createProvider).toHaveBeenCalledTimes(1);
        expect(f.providers[0].getToken).toHaveBeenCalledTimes(2);
        expect(f.diagnostic.mock.calls.flat()).toContain('client-cache-hit source=azure-cli');
    });

    it.each(['account', 'tenant', 'subscription'] as const)('rebuilds and disposes on %s changes, rejects old clients without replay', async key => {
        const f = fixture();
        const old = await f.runtime.clientFactory(params);
        await old.execute(params.database, params.query);
        const next = { ...f.getConfig(), azureCli: {
            account, tenant, subscription,
            [key]: key === 'account' ? 'other-fixture' : '33333333-3333-4333-8333-333333333333',
        } };
        f.setConfig(next);
        f.runtime.syncConfig();
        expect(f.providers[0].dispose).toHaveBeenCalledTimes(1);
        await expect(old.execute(params.database, params.query)).rejects.toThrow('configuration changed');
        const fresh = await f.runtime.clientFactory(params);
        await fresh.execute(params.database, params.query);
        expect(f.createProvider).toHaveBeenCalledTimes(2);
        const options = f.createProvider.mock.calls[1][0];
        expect(options).toMatchObject({ azureCli: {
            account: { id: next.azureCli.account, tenant: next.azureCli.tenant },
            subscription: next.azureCli.subscription,
        } });
        expect(f.execute).toHaveBeenCalledTimes(2);
        expect(f.close).toHaveBeenCalledTimes(1);
    });

    it('isolates targets, server hosts and flag transitions', async () => {
        const f = fixture();
        const g = fixture();
        await executeKustoQuery(params, { clientFactory: f.runtime.clientFactory });
        await executeKustoQuery({ ...params, clusterUrl: 'https://other.kusto.windows.net' }, { clientFactory: f.runtime.clientFactory });
        await executeKustoQuery(params, { clientFactory: g.runtime.clientFactory });
        const namespaces = [...f.createProvider.mock.calls, ...g.createProvider.mock.calls]
            .map(([options]) => options.source === 'azure-cli' && options.azureCli.namespace);
        expect(new Set(namespaces).size).toBe(3);
        f.setConfig({ ...f.getConfig(), enabled: false });
        f.runtime.syncConfig();
        await expect(f.runtime.clientFactory(params)).rejects.toThrow('disabled on the server host');
        expect(f.providers.every(provider => provider.dispose.mock.calls.length === 1)).toBe(true);
        f.setConfig({ ...f.getConfig(), enabled: true });
        await executeKustoQuery(params, { clientFactory: f.runtime.clientFactory });
        expect(f.createProvider).toHaveBeenCalledTimes(3);
    });

    it('partial/invalid host config and untrusted URLs fail before SDK or provider work', async () => {
        const f = fixture();
        f.setConfig({ enabled: true, azureCli: { account } });
        await expect(f.runtime.clientFactory(params)).rejects.toThrow('set kusto.azureCli');
        f.setConfig({ enabled: true, azureCli: { account, tenant: 'invalid', subscription } });
        await expect(f.runtime.clientFactory(params)).rejects.toThrow('invalid host configuration');
        f.setConfig({ enabled: true, azureCli: { account, tenant, subscription } });
        await expect(f.runtime.clientFactory({ ...params, clusterUrl: 'https://fixture.example' })).rejects.toThrow('requires an HTTPS');
        expect(f.buildClient).not.toHaveBeenCalled();
        expect(f.createProvider).not.toHaveBeenCalled();
    });

    it('failed builds are evicted without legacy credential fallback', async () => {
        const f = fixture();
        f.buildClient.mockRejectedValueOnce(new Error('fixture-private-build-payload'));
        await expect(f.runtime.clientFactory(params)).rejects.toThrow('SDK client construction failed');
        await executeKustoQuery(params, { clientFactory: f.runtime.clientFactory });
        expect(f.buildClient).toHaveBeenCalledTimes(2);
        expect(f.buildClient.mock.calls.every(([, credential]) => credential instanceof RustKustoCredential)).toBe(true);
    });

    it('wrapped AccountMismatch is visible and never retries a potentially mutating query', async () => {
        const f = fixture();
        await executeKustoQuery(params, { clientFactory: f.runtime.clientFactory });
        f.providers[0].getToken.mockRejectedValue(new AuthError('AccountMismatch'));
        await expect(executeKustoQuery({ ...params, query: '.set-or-append FixtureTable <| print value=1' },
            { clientFactory: f.runtime.clientFactory })).rejects.toThrow('AccountMismatch');
        expect(f.providers[0].getToken).toHaveBeenCalledTimes(2);
        expect(f.execute).toHaveBeenCalledTimes(1);
        expect(f.buildClient).toHaveBeenCalledTimes(1);
    });

    it('unwraps only sanitized credential errors from the SDK authentication envelope', async () => {
        const f = fixture();
        f.buildClient.mockImplementationOnce(async () => ({
            execute: async () => {
                const inner = new KustoCredentialError('Kusto Rust auth: AccountMismatch.');
                const error = new Error('fixture-private-wrapper');
                error.name = 'KustoAuthenticationError';
                Object.assign(error, { inner });
                throw error;
            },
        }));
        await expect(executeKustoQuery(params, { clientFactory: f.runtime.clientFactory })).rejects.toThrow('AccountMismatch');
        await expect(executeKustoQuery(params, { clientFactory: f.runtime.clientFactory })).rejects.not.toThrow('fixture-private');
    });

    it('passes the native refresh error through the SDK envelope without translation or replay', async () => {
        const f = fixture();
        const refreshError = new AuthError('InteractionRequired');
        const sdkExecute = vi.fn(async () => {
            const error = new Error('fixture-private-sdk-payload');
            error.name = 'KustoAuthenticationError';
            Object.assign(error, { inner: refreshError });
            throw error;
        });
        f.buildClient.mockResolvedValueOnce({ execute: sdkExecute });
        await expect(executeKustoQuery(params, { clientFactory: f.runtime.clientFactory })).rejects.toBe(refreshError);
        expect(sdkExecute).toHaveBeenCalledTimes(1);
        expect(f.buildClient).toHaveBeenCalledTimes(1);
    });

    it('sanitizes an unknown SDK auth payload without selecting another credential', async () => {
        const f = fixture();
        f.buildClient.mockResolvedValueOnce({
            execute: async () => {
                const error = new Error('fixture-private-wrapper');
                error.name = 'KustoAuthenticationError';
                Object.assign(error, { inner: new Error('fixture-private-token') });
                throw error;
            },
        });
        await expect(executeKustoQuery(params, { clientFactory: f.runtime.clientFactory })).rejects.toThrow('credential acquisition failed');
        expect(f.buildClient).toHaveBeenCalledTimes(1);
    });

    it('closes a late build after owner disposal and rejects future calls', async () => {
        const f = fixture();
        let resolve!: (client: KustoClientLike) => void;
        f.buildClient.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
        const pending = f.runtime.clientFactory(params);
        await Promise.resolve();
        f.runtime.dispose();
        resolve({ execute: async () => response, close: f.close });
        await expect(pending).rejects.toThrow('configuration changed');
        expect(f.close).toHaveBeenCalledTimes(1);
        await expect(f.runtime.clientFactory(params)).rejects.toThrow('owner is closed');
    });

    describe('explicit Azure CLI identity', () => {
        it.each([undefined, {}, { account: '', tenant: '', subscription: '' }])(
            'uses native active-account selection when identity settings are empty', async azureCli => {
                const f = fixture();
                f.setConfig({ enabled: true, azureCli });
                await executeKustoQuery(params, { clientFactory: f.runtime.clientFactory });
                await executeKustoQuery(params, { clientFactory: f.runtime.clientFactory });
                expect(f.createProvider).toHaveBeenCalledTimes(1);
                expect(f.createProvider.mock.calls[0][0]).toMatchObject({
                    source: 'azure-cli', refresh: 'auto',
                    azureCli: { selection: 'active-account', resource },
                });
                expect(f.providers[0].getToken).toHaveBeenCalledTimes(2);
            });

        it('revokes cached credentials when switching from explicit to native active selection', async () => {
            const f = fixture();
            const old = await f.runtime.clientFactory(params);
            await old.execute(params.database, params.query);
            f.setConfig({ enabled: true });
            await expect(old.execute(params.database, params.query)).rejects.toThrow('configuration changed');
            expect(f.providers[0].dispose).toHaveBeenCalledTimes(1);
            expect(f.execute).toHaveBeenCalledTimes(1);
            await executeKustoQuery(params, { clientFactory: f.runtime.clientFactory });
            expect(f.createProvider.mock.calls[1][0]).toMatchObject({ azureCli: { selection: 'active-account' } });
        });

        it('rejects a late client build when explicit configuration changes', async () => {
            const f = fixture();
            const pending = f.runtime.clientFactory(params);
            f.setConfig({ ...f.getConfig(), azureCli: { account: 'other-fixture', tenant, subscription } });
            await expect(pending).rejects.toThrow('configuration changed');
            expect(f.close).toHaveBeenCalledTimes(1);
            expect(f.createProvider).not.toHaveBeenCalled();
        });
    });

    it('mock queries retain their bypass without acquiring credentials', async () => {
        const f = fixture();
        f.setConfig({ enabled: true });
        expect(await executeKustoQuery({ ...params, query: 'mock:big: 2' }, { clientFactory: f.runtime.clientFactory }))
            .toMatchObject({ rowCount: 2 });
        expect(f.buildClient).not.toHaveBeenCalled();
    });
});

describe('workspace consumers', () => {
    it('two workspaces share only host credentials, while canvas/tool writes stay workspace-owned', async () => {
        const f = fixture();
        const directory = mkdtempSync(path.join(tmpdir(), 'kusto-host-fixture-'));
        directories.push(directory);
        const store = new CanvasStore(directory);
        for (const workspaceId of ['workspace-a', 'workspace-b']) {
            const canvas = store.createCanvas({
                workspaceId, title: 'Auth fixture', type: 'kusto',
                content: serializeKustoState(createEmptyKustoState(params)),
            });
            const outcome = await runKustoCanvas(store, workspaceId, canvas.id, { clientFactory: f.runtime.clientFactory });
            expect(outcome.ok).toBe(true);
            expect(parseKustoState(store.getCanvas(workspaceId, canvas.id)!.content).lastRun?.status).toBe('success');
            expect(store.getCanvas(workspaceId === 'workspace-a' ? 'workspace-b' : 'workspace-a', canvas.id)).toBeNull();
            const addon = buildKustoToolsAddon(directory, undefined, workspaceId, undefined, { enabled: true, runtime: f.runtime });
            const result = await addon.tools[0].handler!(params);
            expect(result).toMatchObject({ success: true });
        }
        expect(f.createProvider).toHaveBeenCalledTimes(1);
        expect(f.providers[0].getToken).toHaveBeenCalledTimes(4);
        expect(store.listCanvases('workspace-a')).toHaveLength(2);
        expect(store.listCanvases('workspace-b')).toHaveLength(2);
    });

    it('an already-built tool uses current host auth config and persists host execution errors', async () => {
        const f = fixture();
        const directory = mkdtempSync(path.join(tmpdir(), 'kusto-live-fixture-'));
        directories.push(directory);
        const tool = createKustoTools({
            workspaceId: 'fixture-ws', dataDir: directory,
            clientFactory: f.runtime.clientFactory,
        }).kustoQuery;
        f.setConfig({ ...f.getConfig(), azureCli: { account: 'other-fixture', tenant, subscription } });
        expect(await tool.handler!(params)).toMatchObject({ success: true });
        expect(f.createProvider.mock.calls[0][0]).toMatchObject({ azureCli: { account: { id: 'other-fixture' } } });
        f.setConfig({ ...f.getConfig(), enabled: false });
        expect(await tool.handler!(params)).toMatchObject({ success: false, error: 'Kusto is disabled on the server host.' });
        expect(f.execute).toHaveBeenCalledTimes(1);
        const store = new CanvasStore(directory);
        const canvases = store.listCanvases('fixture-ws');
        expect(canvases).toHaveLength(2);
        expect(canvases.some(canvas => parseKustoState(
            store.getCanvas('fixture-ws', canvas.id)!.content,
        ).lastRun?.error === 'Kusto is disabled on the server host.')).toBe(true);
    });
});
