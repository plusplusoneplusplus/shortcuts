import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AuthError, loadNativeAuth, MicrosoftOAuthSignIn, MicrosoftTokenProvider } from '../src/auth';
import type { MicrosoftOAuthOptions, MicrosoftTokenProviderOptions } from '../src/auth';

const tenant = '11111111-1111-4111-8111-111111111111';
const subscription = '44444444-4444-4444-8444-444444444444';
const directories: string[] = [];
const originalPath = process.env.PATH;
afterEach(() => {
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function directory(): string {
    const value = mkdtempSync(path.join(tmpdir(), 'auth-sdk-fixture-'));
    directories.push(value);
    return value;
}

function oauth(): MicrosoftOAuthOptions {
    return {
        namespace: 'isolated-fixture', authority: `https://login.microsoftonline.com/${tenant}`,
        clientId: '33333333-3333-4333-8333-333333333333',
        scopes: ['openid', 'offline_access', 'fixture.scope'],
        target: 'https://resource.example', coordinationDirectory: directory(),
    };
}
function cli(refresh: 'auto' | 'never' = 'auto'): MicrosoftTokenProviderOptions {
    return {
        source: 'azure-cli', refresh,
        azureCli: {
            namespace: directory(), account: { id: 'fixture-account', tenant },
            subscription, resource: 'https://resource.example',
        },
    };
}

function fakeCli(mode: 'valid' | 'malformed' | 'mismatch' | 'hang' | 'login' = 'valid'): void {
    const root = directory();
    const account = JSON.stringify({
        id: subscription, tenantId: tenant,
        user: { name: mode === 'mismatch' ? 'other-fixture' : 'fixture-account', type: 'user' },
    });
    const token = JSON.stringify({
        accessToken: 'opaque-fixture', tokenType: 'Bearer', tenant, subscription,
        expires_on: Math.floor(Date.now() / 1000) + 3600,
    });
    const script = process.platform === 'win32'
        ? [
            '@echo off',
            ...(mode === 'hang' ? ['"%SystemRoot%\\System32\\ping.exe" -n 60 127.0.0.1 >nul'] : []),
            ...(mode === 'login' ? ['echo fixture-private 1>&2', 'exit /b 1'] : [
                'if "%~2"=="show" (',
                `echo ${account}`,
                ') else (',
                `echo ${mode === 'malformed' ? 'fixture-private-invalid-json' : token}`,
                ')',
                'exit /b 0',
            ]),
        ].join('\r\n')
        : [
            '#!/bin/sh',
            ...(mode === 'hang' ? ['sleep 60'] : []),
            ...(mode === 'login' ? ['echo fixture-private >&2', 'exit 1'] : [
                'if [ "$2" = "show" ]; then',
                `printf '%s\\n' '${account}'`,
                'else',
                `printf '%s\\n' '${mode === 'malformed' ? 'fixture-private-invalid-json' : token}'`,
                'fi',
            ]),
        ].join('\n');
    const file = path.join(root, process.platform === 'win32' ? 'az.cmd' : 'az');
    writeFileSync(file, script);
    if (process.platform !== 'win32') chmodSync(file, 0o700);
    process.env.PATH = mode === 'hang' && process.platform !== 'win32'
        ? `${root}${path.delimiter}/usr/bin${path.delimiter}/bin`
        : root;
}

describe('built authentication addon', () => {
    it('exports complete async capabilities and validates without starting work', () => {
        expect(loadNativeAuth().NativeMicrosoftTokenProvider).toBeTypeOf('function');
        process.env.PATH = directory();
        const provider = new MicrosoftTokenProvider(cli());
        provider.dispose();
        const signIn = new MicrosoftOAuthSignIn(oauth());
        signIn.dispose();
    });

    it('requires source and refresh and rejects unsafe configuration with typed redacted errors', () => {
        for (const options of [
            { ...cli(), source: undefined },
            { ...cli(), refresh: undefined },
            { ...cli(), timeoutMs: -1 },
            { ...cli(), expiryMarginSeconds: 0.5 },
            { source: 'oauth', refresh: 'auto', oauth: { ...oauth(), clientId: 'fixture-private' },
                account: { id: subscription, tenant } },
        ]) {
            expect(() => new MicrosoftTokenProvider(options as MicrosoftTokenProviderOptions))
                .toThrow(AuthError);
            try { new MicrosoftTokenProvider(options as MicrosoftTokenProviderOptions); }
            catch (error) {
                expect(error).toMatchObject({ code: 'InvalidConfiguration' });
                expect(String(error)).not.toContain('fixture-private');
            }
        }
    });

    it('returns opaque tokens, trusted CLI metadata and Unix millisecond expiry', async () => {
        fakeCli();
        const provider = new MicrosoftTokenProvider(cli());
        try {
            const pending = provider.getToken();
            expect(pending).toBeInstanceOf(Promise);
            const token = await pending;
            expect(token).toMatchObject({
                accessToken: 'opaque-fixture', tokenType: 'Bearer', source: 'azure-cli',
                target: 'https://resource.example', account: { id: 'fixture-account', tenant },
            });
            expect(token.expiresAt).toBeGreaterThan(Date.now() + 60_000);
            expect(token.grantedScopes).toBeUndefined();
            await expect(provider.getToken()).resolves.toEqual(token);
            await expect(provider.getToken({ forceRefresh: true })).resolves.toMatchObject({ accessToken: 'opaque-fixture' });
            await provider.invalidate();
            await expect(provider.getToken()).resolves.toMatchObject({ source: 'azure-cli' });
        } finally { provider.dispose(); }
    });

    it('never rejects forced renewal and invalidation cannot reset its acquired state', async () => {
        fakeCli();
        const provider = new MicrosoftTokenProvider(cli('never'));
        try {
            await expect(provider.getToken({ forceRefresh: true })).rejects.toMatchObject({ code: 'RefreshDisabled' });
            await provider.getToken();
            await provider.invalidate();
            await expect(provider.getToken()).rejects.toMatchObject({ code: 'RefreshDisabled' });
        } finally { provider.dispose(); }
    });

    it('distinguishes unavailable CLI, login, malformed output and account mismatch', async () => {
        process.env.PATH = directory();
        const missing = new MicrosoftTokenProvider(cli('never'));
        await expect(missing.getToken()).rejects.toMatchObject({ code: 'CliUnavailable' });
        // A failed initial attempt does not consume never's one successful acquisition.
        fakeCli();
        await expect(missing.getToken()).resolves.toMatchObject({ source: 'azure-cli' });
        missing.dispose();
        for (const [mode, code] of [
            ['login', 'LoginRequired'], ['malformed', 'InvalidTokenResponse'], ['mismatch', 'AccountMismatch'],
        ] as const) {
            fakeCli(mode);
            const provider = new MicrosoftTokenProvider(cli());
            try {
                const error = await provider.getToken().catch(error => error);
                expect(error).toBeInstanceOf(AuthError);
                expect(error).toMatchObject({ code });
                expect(String(error)).not.toContain('fixture-private');
            } finally { provider.dispose(); }
        }
    });

    it('cancels and disposes in-flight processes and enforces operation timeout', async () => {
        for (const mode of ['cancel', 'dispose', 'timeout'] as const) {
            fakeCli('hang');
            const options = cli();
            const provider = new MicrosoftTokenProvider({ ...options, timeoutMs: mode === 'timeout' ? 100 : 5000 });
            const pending = provider.getToken();
            if (mode !== 'timeout') {
                await new Promise(resolve => setTimeout(resolve, 50));
                if (mode === 'cancel') provider.cancelOutstanding();
                else provider.dispose();
            }
            await expect(pending).rejects.toMatchObject({
                code: mode === 'cancel' ? 'Cancelled' : mode === 'dispose' ? 'Disposed' : 'TimedOut',
            });
            provider.dispose();
            await expect(provider.getToken()).rejects.toMatchObject({ code: 'Disposed' });
            await expect(provider.invalidate()).rejects.toMatchObject({ code: 'Disposed' });
        }
    });

    it('captures cancellation before Tokio starts a newly submitted request', async () => {
        fakeCli('hang');
        const provider = new MicrosoftTokenProvider(cli());
        const pending = provider.getToken();
        provider.cancelOutstanding();
        await expect(pending).rejects.toMatchObject({ code: 'Cancelled' });
        provider.dispose();
    });

    it('explicit sign-in cancel/dispose never starts interactive auth', async () => {
        const signIn = new MicrosoftOAuthSignIn(oauth());
        signIn.cancel();
        await expect(signIn.beginDevice()).rejects.toMatchObject({ code: 'Cancelled' });
        await expect(signIn.wait()).rejects.toMatchObject({ code: 'Cancelled' });
        signIn.dispose();
        await expect(signIn.beginBrowser()).rejects.toMatchObject({ code: 'Disposed' });
        await expect(signIn.wait()).rejects.toMatchObject({ code: 'Disposed' });
    });
});

describe('authentication capability guard', () => {
    it('reports an addon without auth as an explicit load failure', async () => {
        vi.doMock('../src/loader', async importOriginal => {
            const actual = await importOriginal<typeof import('../src/loader')>();
            return { ...actual, loadNativeAddon: () => ({}) };
        });
        vi.resetModules();
        try {
            const { loadNativeAuth: missing } = await import('../src/auth');
            expect(missing).toThrow('missing Microsoft authentication capability');
        } finally {
            vi.doUnmock('../src/loader');
            vi.resetModules();
        }
    });
});
