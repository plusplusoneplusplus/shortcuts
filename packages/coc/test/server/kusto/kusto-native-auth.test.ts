import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createKustoClientRuntime } from '../../../src/server/kusto/kusto-client-runtime';
import { RustKustoCredential, type KustoAuthConfig } from '../../../src/server/kusto/kusto-credential';
import { buildKustoClient, executeKustoQuery } from '../../../src/server/kusto/kusto-exec';
import axios from 'axios';
import { AuthError } from '@plusplusoneplusplus/coc-native';

const account = 'fixture-account';
const tenant = '11111111-1111-4111-8111-111111111111';
const subscription = '22222222-2222-4222-8222-222222222222';
const clusterUrl = 'https://fixture.kusto.windows.net';
const resource = 'https://kusto.kusto.windows.net';
const config: KustoAuthConfig = { enabled: true, azureCli: { account, tenant, subscription } };
const roots: string[] = [];
const owners: Array<{ dispose(): void }> = [];
const originalPath = process.env.PATH;
afterEach(() => {
    owners.splice(0).forEach(owner => owner.dispose());
    vi.unstubAllEnvs();
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true }));
    vi.restoreAllMocks();
});

function fakeCli(lifetimeSeconds = 3600, mode: 'valid' | 'login' | 'invalid' | 'renewal-login' = 'valid') {
    const root = mkdtempSync(path.join(tmpdir(), 'kusto-native-fixture-'));
    roots.push(root);
    const log = path.join(root, 'calls.jsonl');
    const selection = path.join(root, 'selection.json');
    writeFileSync(selection, JSON.stringify({ id: subscription, tenantId: tenant,
        user: { name: account, type: 'user' } }));
    const script = path.join(root, 'cli.cjs');
    writeFileSync(script, `
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + '\\n');
if (${JSON.stringify(mode)} === 'login') { console.error('fixture-private-cli-error'); process.exit(1); }
if (${JSON.stringify(mode)} === 'invalid') { console.log('fixture-private-invalid-json'); process.exit(0); }
if (${JSON.stringify(mode)} === 'renewal-login' && args[1] === 'get-access-token'
    && fs.readFileSync(${JSON.stringify(log)}, 'utf8').trim().split('\\n')
        .map(line => JSON.parse(line)).filter(call => call[1] === 'get-access-token').length > 1) {
    console.error('fixture-private-refresh-failure'); process.exit(1);
}
if (args[0] !== 'account' || !['show', 'get-access-token'].includes(args[1])
    || (args.includes('--subscription') && args[args.indexOf('--subscription') + 1] !== ${JSON.stringify(subscription)})
    || args.includes('--tenant')) process.exit(2);
const result = args[1] === 'show'
    ? JSON.parse(fs.readFileSync(${JSON.stringify(selection)}, 'utf8'))
    : { accessToken: 'opaque-fixture', tokenType: 'Bearer',
        tenant: ${JSON.stringify(tenant)}, subscription: ${JSON.stringify(subscription)},
        expires_on: Math.floor(Date.now() / 1000) + ${lifetimeSeconds} };
console.log(JSON.stringify(result));
`);
    const executable = path.join(root, process.platform === 'win32' ? 'az.cmd' : 'az');
    writeFileSync(executable, process.platform === 'win32'
        ? `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`
        : `#!/bin/sh\nexec '${process.execPath.replace(/'/g, "'\\''")}' '${script.replace(/'/g, "'\\''")}' "$@"\n`);
    if (process.platform !== 'win32') chmodSync(executable, 0o700);
    process.env.PATH = root;
    return Object.assign(
        () => readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line) as string[]),
        { setAccount: (name: string) => writeFileSync(selection, JSON.stringify({
            id: subscription, tenantId: tenant, user: { name, type: 'user' },
        })) },
    );
}

describe('Kusto production adapter with the actual Rust addon and synthetic CLI', () => {
    it('native acquisition reports missing CLI and login/metadata errors without fallback', async () => {
        const root = mkdtempSync(path.join(tmpdir(), 'kusto-missing-cli-fixture-'));
        roots.push(root);
        process.env.PATH = root;
        if (process.platform === 'win32') {
            for (const variable of ['ProgramW6432', 'ProgramFiles', 'ProgramFiles(x86)']) {
                vi.stubEnv(variable, root);
            }
        }
        const missing = new RustKustoCredential(config, `fixture-${randomUUID()}`);
        owners.push(missing);
        await expect(missing.getToken(`${resource}/.default`)).rejects.toThrow('CliUnavailable');
        for (const mode of ['login', 'invalid'] as const) {
            const calls = fakeCli(3600, mode);
            const credential = new RustKustoCredential(config, `fixture-${randomUUID()}`);
            owners.push(credential);
            const error = await credential.getToken(`${resource}/.default`).catch((error: unknown) => error);
            expect(error).toBeInstanceOf(AuthError);
            expect(String(error)).not.toContain('fixture-private');
            expect(calls()).toHaveLength(1);
            expect(calls()[0]).toContain('--subscription');
        }
    });
    it('uses only native CLI acquisition with the explicit host identity', async () => {
        const calls = fakeCli();
        const runtime = createKustoClientRuntime(() => config, {
            diagnostic: vi.fn(),
            buildClient: async (_cluster, credential) => ({
                execute: async () => {
                    await credential!.getToken(`${resource}/.default`);
                    return { primaryResults: [{
                        columns: [{ name: 'auth_check', type: 'long' }],
                        rows: () => [{ getValueAt: () => 1 }],
                    }] };
                },
            }),
        });
        owners.push(runtime);
        await executeKustoQuery({ clusterUrl, database: 'FixtureDB', query: 'print auth_check = 1' },
            { clientFactory: runtime.clientFactory });
        const commands = calls();
        expect(commands.every(args => args.includes('--subscription'))).toBe(true);
        expect(commands.filter(args => args[1] === 'get-access-token')).toHaveLength(1);
        expect(commands.filter(args => args[1] === 'get-access-token')
            .every(args => args[args.indexOf('--subscription') + 1] === subscription)).toBe(true);
        expect(commands.every(args => !args.includes('set') && !args.includes('login') && !args.includes('logout'))).toBe(true);
    });
    it('proves Rust caching without services or credential changes', async () => {
        const calls = fakeCli();
        const diagnostic = vi.fn();
        const runtime = createKustoClientRuntime(() => config, {
            diagnostic,
            buildClient: async (_cluster, credential) => ({
                execute: async () => {
                    const token = await credential!.getToken([`${resource}/.default`]);
                    expect(token?.expiresOnTimestamp).toBeGreaterThan(Date.now() + 60_000);
                    return { primaryResults: [{
                        columns: [{ name: 'auth_check', type: 'long' }],
                        rows: () => [{ getValueAt: () => 1 }],
                    }] };
                },
            }),
        });
        owners.push(runtime);
        const counts: number[] = [];
        for (let i = 0; i < 2; i++) {
            await executeKustoQuery({ clusterUrl, database: 'FixtureDB', query: 'print auth_check = 1' },
                { clientFactory: runtime.clientFactory });
            counts.push(calls().filter(args => args[1] === 'get-access-token').length);
        }
        expect(counts).toEqual([1, 1]);
        expect(calls()).toHaveLength(3);
        const tokenRequests = calls().filter(args => args[1] === 'get-access-token');
        expect(tokenRequests.every(args => args[args.indexOf('--resource') + 1] === resource)).toBe(true);
        expect(calls().every(args => !args.includes('set') && !args.includes('login') && !args.includes('logout'))).toBe(true);
        const output = JSON.stringify(diagnostic.mock.calls);
        expect(output).toContain('client-cache-hit source=azure-cli');
        expect(output).not.toContain('opaque-fixture');
        expect(output).not.toContain(account);
    });

    it.each([
        { account: 'wrong-fixture', tenant, subscription },
        { account, tenant: '33333333-3333-4333-8333-333333333333', subscription },
    ])('wrong explicit identity fails visibly without requesting a token or fallback', async azureCli => {
        const calls = fakeCli();
        const credential = new RustKustoCredential({ ...config, azureCli }, `fixture-${randomUUID()}`);
        owners.push(credential);
        await expect(credential.getToken(`${resource}/.default`)).rejects.toThrow('AccountMismatch');
        expect(calls()).toHaveLength(1);
        expect(calls()[0][1]).toBe('show');
    });

    it('automatically renews after entering the production expiry margin', async () => {
        const calls = fakeCli(65);
        const credential = new RustKustoCredential({ enabled: true }, `fixture-${randomUUID()}`);
        owners.push(credential);
        const first = await credential.getToken(`${resource}/.default`);
        await credential.getToken(`${resource}/.default`);
        expect(calls().filter(args => args[1] === 'get-access-token')).toHaveLength(1);
        // Native production policy renews 60 seconds before expiry.
        const waitMs = Math.max(0, first.expiresOnTimestamp - Date.now() - 60_000) + 100;
        await new Promise(resolve => setTimeout(resolve, waitMs));
        await credential.getToken(`${resource}/.default`);
        expect(calls().filter(args => args[1] === 'get-access-token')).toHaveLength(2);
    }, 15_000);

    it('surfaces a native automatic renewal failure without a stale token or retry', async () => {
        const calls = fakeCli(65, 'renewal-login');
        const credential = new RustKustoCredential({ enabled: true }, `fixture-${randomUUID()}`);
        owners.push(credential);
        const first = await credential.getToken(`${resource}/.default`);
        await new Promise(resolve => setTimeout(resolve,
            Math.max(0, first.expiresOnTimestamp - Date.now() - 60_000) + 100));
        const error = await credential.getToken(`${resource}/.default`).catch((error: unknown) => error);
        expect(error).toBeInstanceOf(AuthError);
        expect(error).toMatchObject({ code: 'LoginRequired' });
        expect(String(error)).not.toContain('fixture-private');
        expect(calls().filter(args => args[1] === 'get-access-token')).toHaveLength(2);
    }, 15_000);
});

describe('actual Kusto SDK credential interface without network', () => {
    it('runs empty-config Kusto queries through native active selection and rejects an account change', async () => {
        const calls = fakeCli();
        const { CloudSettings } = await import('azure-kusto-data');
        vi.spyOn(CloudSettings, 'getCloudInfoForCluster').mockResolvedValue(CloudSettings.defaultCloudInfo);
        const post = vi.spyOn(axios.Axios.prototype, 'post').mockResolvedValue({
            status: 200,
            data: [{
                FrameType: 'DataTable', TableKind: 'PrimaryResult', TableId: 0,
                TableName: 'PrimaryResult', Columns: [{ ColumnName: 'auth_check', ColumnType: 'long' }],
                Rows: [[1]],
            }],
        });
        const runtime = createKustoClientRuntime(() => ({ enabled: true }), { diagnostic: vi.fn() });
        owners.push(runtime);
        const params = { clusterUrl, database: 'FixtureDB', query: 'print auth_check = 1' };
        for (let i = 0; i < 2; i++) {
            expect(await executeKustoQuery(params, { clientFactory: runtime.clientFactory }))
                .toMatchObject({ rows: [[1]], rowCount: 1 });
        }
        expect(calls().filter(args => args[1] === 'get-access-token')).toHaveLength(1);
        expect(calls().some(args => args[1] === 'show' && !args.includes('--subscription'))).toBe(true);
        calls.setAccount('other-fixture');
        await expect(executeKustoQuery(params, { clientFactory: runtime.clientFactory }))
            .rejects.toMatchObject({ code: 'AccountMismatch' });
        expect(post).toHaveBeenCalledTimes(2);
        expect(calls().filter(args => args[1] === 'get-access-token')).toHaveLength(1);
        expect(calls().every(args => !args.includes('set') && !args.includes('login') && !args.includes('logout'))).toBe(true);
    });

    it('the SDK builder refuses a missing credential rather than creating another auth path', async () => {
        await expect(buildKustoClient(clusterUrl, undefined!)).rejects.toThrow('requires the host Rust credential');
    });
    it.each([
        { audience: resource, mfa: false },
        { audience: resource, mfa: true },
        { audience: 'https://kusto.kusto.usgovcloudapi.net', mfa: false },
    ])('resolves metadata audience $audience (MFA=$mfa) on every credential request', async ({ audience, mfa }) => {
        const { CloudSettings } = await import('azure-kusto-data');
        const cloudInfo = {
            ...CloudSettings.defaultCloudInfo, KustoServiceResourceId: audience, LoginMfaRequired: mfa,
        };
        vi.spyOn(CloudSettings, 'getCloudInfoForCluster').mockResolvedValue(cloudInfo);
        const post = vi.spyOn(axios.Axios.prototype, 'post').mockResolvedValue({
            status: 200,
            data: [{
                FrameType: 'DataTable', TableKind: 'PrimaryResult', TableId: 0,
                TableName: 'PrimaryResult', Columns: [{ ColumnName: 'auth_check', ColumnType: 'long' }],
                Rows: [[1]],
            }],
        });
        const getToken = vi.fn(async () => ({ token: 'opaque-fixture', expiresOnTimestamp: Date.now() + 120_000 }));
        const client = await buildKustoClient(clusterUrl, { getToken });
        owners.push({ dispose: () => client.close?.() });
        const params = { clusterUrl, database: 'FixtureDB', query: 'print auth_check = 1' };
        for (let i = 0; i < 2; i++) {
            expect(await executeKustoQuery(params, { clientFactory: () => client })).toMatchObject({ rows: [[1]], rowCount: 1 });
        }
        const expected = mfa ? audience.replace('.kusto.', '.kustomfa.') : audience;
        expect(getToken).toHaveBeenCalledTimes(2);
        expect(getToken.mock.calls[0]).toEqual([
            [`${expected}/.default`], { requestOptions: { timeout: undefined }, tenantId: undefined },
        ]);
        expect(post).toHaveBeenCalledTimes(2);
    });
});
