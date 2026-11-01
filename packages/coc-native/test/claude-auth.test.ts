import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
    acquireClaudeCredential, AuthError, loadNativeClaudeAuth,
} from '../src/index';
import type { ClaudeCredentialOptions, ClaudeCredentialSnapshot } from '../src/index';

let directory: string;
let options: ClaudeCredentialOptions;
let credentialsFile: string;
beforeEach(() => {
    directory = mkdtempSync(path.join(tmpdir(), 'claude-auth-fixture-'));
    credentialsFile = path.join(directory, 'credentials.json');
    const locks = path.join(directory, 'locks');
    mkdirSync(locks, { mode: 0o700 });
    options = {
        homeDir: directory, coordinationDirectory: locks, credentialsFile,
        skipKeychain: true, timeoutMs: 100,
    };
});
afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
    vi.doUnmock('../src/loader');
    vi.resetModules();
});

const snapshot = (): ClaudeCredentialSnapshot => ({
    accessToken: 'access-fixture', expiresAt: Date.now() + 3_600_000,
    scopes: ['user:inference'], subscriptionType: 'pro', rateLimitTier: 'tier',
});
function writeCredentials() {
    const value = snapshot();
    writeFileSync(credentialsFile, JSON.stringify({
        claudeAiOauth: { ...value, refreshToken: 'private-refresh-fixture' }, mcpOAuth: { sibling: true },
    }));
    return value;
}
async function fixture(work: () => Promise<ClaudeCredentialSnapshot>) {
    const instances: SyntheticRequest[] = [];
    class SyntheticRequest {
        cancel() {}
        acquire() { return work(); }
        constructor(readonly config: ClaudeCredentialOptions) {
            vi.spyOn(this, 'cancel');
            vi.spyOn(this, 'acquire');
            instances.push(this);
        }
    }
    vi.doMock('../src/loader', async importOriginal => ({
        ...await importOriginal<typeof import('../src/loader')>(),
        loadNativeAddon: () => ({ NativeClaudeCredentialRequest: SyntheticRequest }),
    }));
    vi.resetModules();
    return { api: await import('../src/index'), instances };
}

describe('built Claude acquisition boundary with isolated files', () => {
    it('reads fresh credentials, returns frozen access metadata and keeps refresh secrets native', async () => {
        const expected = writeCredentials();
        const original = readFileSync(credentialsFile, 'utf8');
        const value = await acquireClaudeCredential(options);
        expect(value).toEqual(expected);
        expect(Object.isFrozen(value)).toBe(true);
        expect(Object.isFrozen(value.scopes)).toBe(true);
        expect(value).not.toHaveProperty('refreshToken');
        expect(JSON.stringify(value)).not.toContain('private-refresh-fixture');
        expect(readFileSync(credentialsFile, 'utf8')).toBe(original);
        // Every request rereads the source, without caching a credential or provider.
        writeFileSync(credentialsFile, '{"access_token":"second-fixture"}');
        expect(await acquireClaudeCredential(options)).toMatchObject({ accessToken: 'second-fixture', scopes: [] });
    });

    it('is one-shot and cancellation before dispatch performs no credential I/O', () => {
        const Native = loadNativeClaudeAuth().NativeClaudeCredentialRequest;
        const request = new Native(options);
        request.cancel();
        expect(() => request.acquire()).toThrow('[auth-sdk:Cancelled]');
        expect(() => request.acquire()).toThrow('[auth-sdk:InvalidConfiguration]');
    });

    it.each([
        { homeDir: 'relative' }, { coordinationDirectory: '' }, { credentialsFile: 'relative.json' },
        { credentialsFile: path.join(path.parse(process.cwd()).root, 'private\nfixture') },
        ...[0, 99, 900_001, 0.5, Number.NaN].map(timeoutMs => ({ timeoutMs })),
        { skipKeychain: 'bad' }, { credentialsFile: null },
    ])('rejects invalid configuration %# with safe errors', async patch => {
        const error = await acquireClaudeCredential({ ...options, ...patch } as ClaudeCredentialOptions).catch(e => e);
        expect(error).toBeInstanceOf(AuthError);
        expect(error.code).toBe('InvalidConfiguration');
        expect(error.cause).toBeUndefined();
        expect(String(error)).not.toContain('private');
    });

    it.each([
        ['missing', 'LoginRequired'], ['malformed', 'InvalidTokenResponse'], ['no-refresh', 'LoginRequired'],
    ])('reports %s credentials without token contents', async (mode, code) => {
        if (mode === 'malformed') writeFileSync(credentialsFile, '{private-refresh-fixture');
        if (mode === 'no-refresh') writeFileSync(credentialsFile,
            '{"claudeAiOauth":{"accessToken":"private-access-fixture","expiresAt":1}}');
        const error = await acquireClaudeCredential(options).catch(e => e);
        expect(error).toBeInstanceOf(AuthError);
        expect(error.code).toBe(code);
        expect(error.cause).toBeUndefined();
        expect(String(error)).not.toContain('private');
    });

    it('prevents token publication after Node dispatch exceeds the original deadline', async () => {
        writeCredentials();
        const pending = acquireClaudeCredential(options);
        const until = Date.now() + 150;
        while (Date.now() < until) { /* Hold Node publication beyond the 100ms native deadline. */ }
        await expect(pending).rejects.toMatchObject({ code: 'TimedOut' });
    });

    it('prevents late publication after cancellation without affecting another request', async () => {
        writeCredentials();
        const controller = new AbortController();
        const cancelled = acquireClaudeCredential(options, controller.signal);
        const survivor = acquireClaudeCredential(options);
        controller.abort();
        await expect(cancelled).rejects.toMatchObject({ code: 'Cancelled' });
        await expect(survivor).resolves.toMatchObject({ accessToken: 'access-fixture' });
    });
});

describe('Claude typed wrapper with trusted native injection', () => {
    it('marshals configuration, freezes metadata, and cleans its listener on success', async () => {
        const expected = snapshot();
        const { api, instances } = await fixture(async () => expected);
        const controller = new AbortController();
        const remove = vi.spyOn(controller.signal, 'removeEventListener');
        const result = await api.acquireClaudeCredential(options, controller.signal);
        expect(result).toEqual(expected);
        expect(instances[0].config).toEqual(options);
        expect(instances[0].acquire).toHaveBeenCalledOnce();
        expect(instances[0].cancel).toHaveBeenCalledOnce();
        expect(remove).toHaveBeenCalledOnce();
        expect(Object.isFrozen(result.scopes)).toBe(true);
    });

    it('does not construct a request for pre-cancelled or invalid input', async () => {
        const { api, instances } = await fixture(async () => snapshot());
        const controller = new AbortController();
        controller.abort();
        await expect(api.acquireClaudeCredential(options, controller.signal)).rejects.toMatchObject({ code: 'Cancelled' });
        await expect(api.acquireClaudeCredential(undefined as unknown as ClaudeCredentialOptions))
            .rejects.toMatchObject({ code: 'InvalidConfiguration' });
        expect(instances).toHaveLength(0);
    });

    it('waits for native cancellation settlement and removes the exact listener', async () => {
        let resolve!: (value: ClaudeCredentialSnapshot) => void;
        const { api, instances } = await fixture(() => new Promise(r => { resolve = r; }));
        const controller = new AbortController();
        const add = vi.spyOn(controller.signal, 'addEventListener');
        const remove = vi.spyOn(controller.signal, 'removeEventListener');
        let settled = false;
        const pending = api.acquireClaudeCredential(options, controller.signal);
        void pending.then(() => { settled = true; }, () => { settled = true; });
        controller.abort();
        await Promise.resolve();
        expect(settled).toBe(false);
        expect(instances[0].cancel).toHaveBeenCalledOnce();
        resolve(snapshot());
        await expect(pending).rejects.toMatchObject({ code: 'Cancelled' });
        expect(remove).toHaveBeenCalledWith('abort', add.mock.calls[0][1]);
    });

    it.each([
        ['InteractionRequired', 400, 'invalid_grant'], ['AccessDenied', 403, ''],
        ['InvalidTokenResponse', 500, ''], ['TimedOut', undefined, ''], ['StorageDenied', undefined, ''],
    ] as const)('preserves safe metadata %s/%s/%s and removes raw diagnostics', async (code, status, rejection) => {
        const { api } = await fixture(async () => {
            throw new Error(`[auth-refresh:${code}:${status ?? ''}:${rejection}] private-refresh-fixture`);
        });
        const error = await api.acquireClaudeCredential(options).catch(e => e);
        expect(error).toBeInstanceOf(api.ClaudeCredentialError);
        expect(error).toBeInstanceOf(api.AuthError);
        expect(error).toMatchObject({ code, status, rejection: rejection || undefined });
        expect(error.cause).toBeUndefined();
        expect(String(error)).not.toContain('private-refresh-fixture');
    });

    it.each(['private-refresh-fixture', '[auth-refresh:Unknown:400:invalid_grant] private',
        '[auth-refresh:InteractionRequired:400:unknown] private'])('sanitizes unknown failures %#', async message => {
        const { api } = await fixture(async () => { throw new Error(message); });
        const error = await api.acquireClaudeCredential(options).catch(e => e);
        expect(error).toMatchObject({ code: 'InvalidConfiguration' });
        expect(error.rejection).toBeUndefined();
        expect(error.cause).toBeUndefined();
        expect(String(error)).not.toContain('private');
    });

    it.each(['missing', 'acquire', 'cancel'])('requires complete native capability: %s', async missing => {
        class Incomplete { acquire() {} cancel() {} }
        if (missing !== 'missing') Reflect.deleteProperty(Incomplete.prototype, missing);
        vi.doMock('../src/loader', async importOriginal => ({
            ...await importOriginal<typeof import('../src/loader')>(),
            loadNativeAddon: () => missing === 'missing' ? {} : { NativeClaudeCredentialRequest: Incomplete },
        }));
        vi.resetModules();
        const api = await import('../src/index');
        await expect(api.acquireClaudeCredential(options)).rejects.toThrow('missing Claude authentication capability');
    });

    it('preserves loader failures without attempting fallback', async () => {
        vi.doMock('../src/loader', async importOriginal => {
            const actual = await importOriginal<typeof import('../src/loader')>();
            return { ...actual, loadNativeAddon: () => { throw new actual.NativeAddonLoadError('fixture unavailable'); } };
        });
        vi.resetModules();
        const api = await import('../src/index');
        await expect(api.acquireClaudeCredential(options)).rejects.toThrow('fixture unavailable');
    });
});
