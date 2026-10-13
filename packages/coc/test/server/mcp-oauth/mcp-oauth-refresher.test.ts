import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { nullLogger, setHomeDirectoryOverride } from '@plusplusoneplusplus/forge';
import {
    AuthError, exchangeMicrosoftRefreshToken, MicrosoftOAuthRefreshError,
    type MicrosoftOAuthRefreshRejection,
} from '@plusplusoneplusplus/coc-native';
import {
    runMcpOauthMaintenancePass, startMcpOauthMaintenanceTimer,
    aadTokenEndpoint, composeRefreshScope, sanitizeRequestScope,
} from '../../../src/server/mcp-oauth/mcp-oauth-refresher';
import { getMcpOauthCacheDir } from '../../../src/server/mcp-oauth/mcp-oauth-token-cache';

vi.mock('@plusplusoneplusplus/coc-native', async importOriginal => ({
    ...await importOriginal<typeof import('@plusplusoneplusplus/coc-native')>(),
    exchangeMicrosoftRefreshToken: vi.fn(),
}));

const AUTHORITY = 'https://login.microsoftonline.com/11111111-1111-4111-8111-111111111111';
const CLIENT_ID = '22222222-2222-4222-8222-222222222222';
const NOW = 1_700_000_000_000;
const NOW_SEC = NOW / 1000;
const SERVER_URL = 'https://mcp.example.com/v1';
const exchange = vi.mocked(exchangeMicrosoftRefreshToken);

interface SeedOptions {
    serverUrl?: string;
    hash?: string;
    expiresAt?: number;
    refreshToken?: string;
    accessToken?: string;
    scope?: string;
    authorizationServerUrl?: string;
    clientId?: string;
    skipTokens?: boolean;
    skipMeta?: boolean;
    tokensMtimeMs?: number;
}

function seed(homeDir: string, opts: SeedOptions = {}) {
    const cacheDir = getMcpOauthCacheDir(homeDir);
    fs.mkdirSync(cacheDir, { recursive: true });
    const hash = opts.hash ?? 'fixture';
    const serverUrl = opts.serverUrl ?? SERVER_URL;
    const metaPath = path.join(cacheDir, `${hash}.json`);
    const tokensPath = path.join(cacheDir, `${hash}.tokens.json`);
    if (!opts.skipMeta) {
        fs.writeFileSync(metaPath, JSON.stringify({
            serverUrl, authorizationServerUrl: opts.authorizationServerUrl ?? `${AUTHORITY}/v2.0`,
            clientId: opts.clientId ?? CLIENT_ID, resourceUrl: serverUrl,
        }));
    }
    if (!opts.skipTokens) {
        fs.writeFileSync(tokensPath, JSON.stringify({
            accessToken: opts.accessToken ?? 'old-access-token',
            expiresAt: opts.expiresAt ?? NOW_SEC + 60,
            scope: opts.scope ?? `${serverUrl}/.default`,
            refreshToken: opts.refreshToken,
        }));
        if (opts.tokensMtimeMs !== undefined) {
            const time = new Date(opts.tokensMtimeMs);
            fs.utimesSync(tokensPath, time, time);
        }
    }
    return { metaPath, tokensPath };
}

function readTokens(file: string): { accessToken: string; expiresAt: number; scope: string; refreshToken?: string } {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

let tmpHome: string;

beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-oauth-refresher-'));
    setHomeDirectoryOverride(tmpHome);
    exchange.mockReset();
    exchange.mockResolvedValue({ accessToken: 'new-access-token', tokenType: 'Bearer', expiresIn: 3600 });
});

afterEach(() => {
    vi.useRealTimers();
    setHomeDirectoryOverride(null);
    fs.rmSync(tmpHome, { recursive: true, force: true });
});

function runPass() {
    return runMcpOauthMaintenancePass({ homeDir: tmpHome, logger: nullLogger, now: () => NOW });
}

describe('aadTokenEndpoint', () => {
    it('parses AAD authority URLs', () => {
        expect(aadTokenEndpoint(`${AUTHORITY}/v2.0/.well-known/openid-configuration`))
            .toBe(`${AUTHORITY}/oauth2/v2.0/token`);
        expect(aadTokenEndpoint('https://login.microsoftonline.com/organizations'))
            .toBe('https://login.microsoftonline.com/organizations/oauth2/v2.0/token');
    });

    it.each([undefined, '', 'https://login.example.com/oauth', 'https://accounts.google.com/o/oauth2/v2/auth'])
    ('skips non-AAD authority %s', value => {
        expect(aadTokenEndpoint(value)).toBeUndefined();
    });
});

describe('runMcpOauthMaintenancePass', () => {
    it('never deduplicates or refreshes the native Teams resource', async () => {
        fs.mkdirSync(path.join(tmpHome, '.copilot'), { recursive: true });
        fs.writeFileSync(path.join(tmpHome, '.copilot', 'mcp-config.json'), JSON.stringify({
            mcpServers: { 'Microsoft Teams': { type: 'http', url: SERVER_URL } },
        }));
        const first = seed(tmpHome, { hash: 'native-one', refreshToken: 'fixture-one' });
        const second = seed(tmpHome, { hash: 'native-two', refreshToken: 'fixture-two' });
        const result = await runPass();
        expect(result.dedup).toEqual({ groups: 0, duplicatesRemoved: 0 });
        expect(result.refresh.attempted).toBe(0);
        expect(exchange).not.toHaveBeenCalled();
        expect(fs.existsSync(first.tokensPath)).toBe(true);
        expect(fs.existsSync(second.tokensPath)).toBe(true);
    });

    it.each([false, true])('returns empty results for an empty cache (directory exists: %s)', async exists => {
        if (exists) fs.mkdirSync(getMcpOauthCacheDir(tmpHome), { recursive: true });
        expect(await runPass()).toEqual({
            dedup: { groups: 0, duplicatesRemoved: 0 },
            refresh: { attempted: 0, succeeded: 0, invalidated: 0, transientFailures: 0 },
        });
        expect(exchange).not.toHaveBeenCalled();
    });

    it('keeps a single far-from-expiry entry untouched', async () => {
        const entry = seed(tmpHome, { expiresAt: NOW_SEC + 3600, refreshToken: 'fixture-refresh' });
        const before = fs.readFileSync(entry.tokensPath, 'utf8');
        expect((await runPass()).dedup).toEqual({ groups: 1, duplicatesRemoved: 0 });
        expect(fs.readFileSync(entry.tokensPath, 'utf8')).toBe(before);
        expect(fs.existsSync(entry.metaPath)).toBe(true);
        expect(exchange).not.toHaveBeenCalled();
    });

    it('deduplicates by expiry before refreshing only the survivor', async () => {
        const oldest = seed(tmpHome, { hash: 'oldest', expiresAt: NOW_SEC - 86400, refreshToken: 'oldest-refresh' });
        const middle = seed(tmpHome, { hash: 'middle', expiresAt: NOW_SEC, refreshToken: 'middle-refresh' });
        const survivor = seed(tmpHome, { hash: 'survivor', refreshToken: 'survivor-refresh' });
        const result = await runPass();
        expect(result.dedup).toEqual({ groups: 1, duplicatesRemoved: 2 });
        for (const entry of [oldest, middle]) {
            expect(fs.existsSync(entry.tokensPath)).toBe(false);
            expect(fs.existsSync(entry.metaPath)).toBe(false);
        }
        expect(exchange).toHaveBeenCalledExactlyOnceWith({
            authority: AUTHORITY, clientId: CLIENT_ID, scopes: [`${SERVER_URL}/.default`, 'offline_access'],
        }, 'survivor-refresh');
        expect(readTokens(survivor.tokensPath).accessToken).toBe('new-access-token');
    });

    it('breaks expiry ties using tokens-file mtime', async () => {
        const older = seed(tmpHome, { hash: 'older', expiresAt: NOW_SEC + 3600, tokensMtimeMs: NOW - 60_000 });
        const newer = seed(tmpHome, { hash: 'newer', expiresAt: NOW_SEC + 3600, tokensMtimeMs: NOW });
        await runPass();
        expect(fs.existsSync(older.tokensPath)).toBe(false);
        expect(fs.existsSync(newer.tokensPath)).toBe(true);
    });

    it('does not deduplicate different server URLs together', async () => {
        seed(tmpHome, { hash: 'one', serverUrl: 'https://one.example.com', expiresAt: NOW_SEC + 3600 });
        seed(tmpHome, { hash: 'two', serverUrl: 'https://two.example.com', expiresAt: NOW_SEC + 3600 });
        expect((await runPass()).dedup).toEqual({ groups: 2, duplicatesRemoved: 0 });
    });

    it('ignores orphan and malformed cache files', async () => {
        seed(tmpHome, { hash: 'metadata-only', skipTokens: true });
        seed(tmpHome, { hash: 'tokens-only', skipMeta: true });
        const cache = getMcpOauthCacheDir(tmpHome);
        fs.writeFileSync(path.join(cache, 'bad.json'), '{not json');
        fs.writeFileSync(path.join(cache, 'bad.tokens.json'), '{not json');
        seed(tmpHome, { hash: 'valid', expiresAt: NOW_SEC + 3600 });
        expect((await runPass()).dedup.groups).toBe(1);
        expect(exchange).not.toHaveBeenCalled();
    });

    it.each([
        { refreshToken: undefined },
        { refreshToken: 'fixture-refresh', expiresAt: NOW_SEC + 601 },
        { refreshToken: 'fixture-refresh', authorizationServerUrl: 'https://login.example.com/oauth' },
        { refreshToken: 'fixture-refresh', clientId: '' },
    ])('skips ineligible entries: %j', async options => {
        seed(tmpHome, options);
        expect((await runPass()).refresh.attempted).toBe(0);
        expect(exchange).not.toHaveBeenCalled();
    });

    it('refreshes at the expiry-window boundary and persists rotated tokens and returned scopes', async () => {
        const entry = seed(tmpHome, { expiresAt: NOW_SEC + 600, refreshToken: 'old-refresh', scope: 'api://fixture/.default' });
        exchange.mockResolvedValue({
            accessToken: 'new-access', tokenType: 'Bearer', expiresIn: 3600,
            refreshToken: 'new-refresh', scope: 'api://fixture/read',
        });
        const result = await runPass();
        expect(result.refresh).toEqual({ attempted: 1, succeeded: 1, invalidated: 0, transientFailures: 0 });
        expect(exchange).toHaveBeenCalledExactlyOnceWith({
            authority: AUTHORITY, clientId: CLIENT_ID, scopes: ['api://fixture/.default', 'offline_access'],
        }, 'old-refresh');
        expect(readTokens(entry.tokensPath)).toEqual({
            accessToken: 'new-access', expiresAt: NOW_SEC + 3600,
            refreshToken: 'new-refresh', scope: 'api://fixture/read',
        });
        expect(fs.existsSync(entry.metaPath)).toBe(true);
    });

    it.each([undefined, ''])('preserves cached refresh token and scope when response omits replacements (%s)', async refreshToken => {
        const entry = seed(tmpHome, { refreshToken: 'existing-refresh' });
        exchange.mockResolvedValue({ accessToken: 'new-access', tokenType: 'Bearer', expiresIn: 3600, refreshToken });
        await runPass();
        expect(readTokens(entry.tokensPath)).toMatchObject({
            refreshToken: 'existing-refresh', scope: `${SERVER_URL}/.default`,
        });
    });

    it.each([
        ['api://fixture/read api://fixture/.default', ['api://fixture/read', 'offline_access']],
        ['api://fixture/.default offline_access', ['api://fixture/.default', 'offline_access']],
        ['', ['offline_access']],
    ])('passes sanitized scopes for %s', async (scope, scopes) => {
        seed(tmpHome, { refreshToken: 'fixture-refresh', scope });
        expect((await runPass()).refresh.succeeded).toBe(1);
        expect(exchange).toHaveBeenCalledWith({ authority: AUTHORITY, clientId: CLIENT_ID, scopes }, 'fixture-refresh');
    });

    it.each<MicrosoftOAuthRefreshRejection>(['invalid_grant', 'interaction_required', 'consent_required'])
    ('deletes cached credentials only on terminal rejection %s', async rejection => {
        const entry = seed(tmpHome, { refreshToken: 'fixture-refresh' });
        exchange.mockRejectedValue(new MicrosoftOAuthRefreshError('InteractionRequired', 400, rejection));
        expect((await runPass()).refresh).toEqual({ attempted: 1, succeeded: 0, invalidated: 1, transientFailures: 0 });
        expect(fs.existsSync(entry.tokensPath)).toBe(false);
        expect(fs.existsSync(entry.metaPath)).toBe(false);
    });

    it.each([
        ['invalid_request/invalid_scope', new MicrosoftOAuthRefreshError('InvalidTokenResponse', 400)],
        ['malformed response', new MicrosoftOAuthRefreshError('InvalidTokenResponse', 200)],
        ['server failure', new MicrosoftOAuthRefreshError('InvalidTokenResponse', 503)],
        ['server failure with rejection', new MicrosoftOAuthRefreshError('InteractionRequired', 503, 'invalid_grant')],
        ['missing HTTP status', new MicrosoftOAuthRefreshError('InteractionRequired', undefined, 'invalid_grant')],
        ['broad interaction code', new AuthError('InteractionRequired')],
        ['timeout', new AuthError('TimedOut')],
        ['cancellation', new AuthError('Cancelled')],
        ['network failure', new Error('sensitive-provider-body')],
    ])('preserves cache on %s', async (_name, error) => {
        const entry = seed(tmpHome, { refreshToken: 'fixture-refresh' });
        const original = fs.readFileSync(entry.tokensPath, 'utf8');
        exchange.mockRejectedValue(error);
        const warn = vi.fn();
        const result = await runMcpOauthMaintenancePass({
            homeDir: tmpHome, now: () => NOW, logger: { ...nullLogger, warn },
        });
        expect(result.refresh).toEqual({ attempted: 1, succeeded: 0, invalidated: 0, transientFailures: 1 });
        expect(fs.readFileSync(entry.tokensPath, 'utf8')).toBe(original);
        expect(fs.existsSync(entry.metaPath)).toBe(true);
        expect(warn).toHaveBeenCalled();
        const logged = warn.mock.calls.flat().join(' ');
        expect(logged).not.toContain('sensitive-provider-body');
        expect(logged).not.toContain('fixture-refresh');
        expect(logged).not.toContain('old-access-token');
    });

    it('logs safe native status and rejection without tokens', async () => {
        seed(tmpHome, { refreshToken: 'fixture-refresh' });
        exchange.mockRejectedValue(new MicrosoftOAuthRefreshError('InteractionRequired', 400, 'consent_required'));
        const warn = vi.fn();
        await runMcpOauthMaintenancePass({ homeDir: tmpHome, now: () => NOW, logger: { ...nullLogger, warn } });
        const logged = warn.mock.calls.flat().join(' ');
        expect(logged).toContain('code=InteractionRequired status=400 rejection=consent_required');
        expect(logged).not.toContain('fixture-refresh');
    });

    it('supports an injected native exchange without invoking the default', async () => {
        seed(tmpHome, { refreshToken: 'fixture-refresh' });
        const injected = vi.fn<typeof exchangeMicrosoftRefreshToken>().mockResolvedValue({
            accessToken: 'injected-access', tokenType: 'Bearer', expiresIn: 3600,
        });
        expect((await runMcpOauthMaintenancePass({
            homeDir: tmpHome, now: () => NOW, logger: nullLogger, exchangeRefreshToken: injected,
        })).refresh.succeeded).toBe(1);
        expect(injected).toHaveBeenCalledTimes(1);
        expect(exchange).not.toHaveBeenCalled();
    });
});

describe('startMcpOauthMaintenanceTimer', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(NOW);
        seed(tmpHome, { refreshToken: 'fixture-refresh' });
        exchange.mockResolvedValue({ accessToken: 'new-access', tokenType: 'Bearer', expiresIn: 60 });
    });

    it('runs on startup by default', async () => {
        const handle = startMcpOauthMaintenanceTimer({ homeDir: tmpHome, logger: nullLogger });
        try {
            await vi.advanceTimersByTimeAsync(1);
            expect(exchange).toHaveBeenCalledTimes(1);
        } finally { handle.stop(); }
    });

    it('refreshes on the five-minute interval without a Copilot session and stops further ticks', async () => {
        const handle = startMcpOauthMaintenanceTimer({ homeDir: tmpHome, logger: nullLogger, runOnStart: false });
        try {
            await vi.advanceTimersByTimeAsync(299_999);
            expect(exchange).not.toHaveBeenCalled();
            await vi.advanceTimersByTimeAsync(1);
            expect(exchange).toHaveBeenCalledTimes(1);
            await vi.advanceTimersByTimeAsync(300_000);
            expect(exchange).toHaveBeenCalledTimes(2);
            handle.stop();
            await vi.advanceTimersByTimeAsync(900_000);
            expect(exchange).toHaveBeenCalledTimes(2);
        } finally { handle.stop(); }
    });

    it('clamps small intervals to 60 seconds', async () => {
        const handle = startMcpOauthMaintenanceTimer({
            homeDir: tmpHome, logger: nullLogger, intervalMs: 1, runOnStart: false,
        });
        try {
            await vi.advanceTimersByTimeAsync(59_999);
            expect(exchange).not.toHaveBeenCalled();
            await vi.advanceTimersByTimeAsync(1);
            expect(exchange).toHaveBeenCalledTimes(1);
        } finally { handle.stop(); }
    });

    it('skips overlapping passes while the native exchange is in flight', async () => {
        let finish!: () => void;
        const pending = new Promise<void>(resolve => { finish = resolve; });
        exchange.mockImplementation(async () => {
            await pending;
            return { accessToken: 'new-access', tokenType: 'Bearer', expiresIn: 60 };
        });
        const handle = startMcpOauthMaintenanceTimer({ homeDir: tmpHome, logger: nullLogger, runOnStart: false });
        try {
            const first = handle.runNow();
            expect((await handle.runNow()).refresh.attempted).toBe(0);
            finish();
            expect((await first).refresh.succeeded).toBe(1);
            expect(exchange).toHaveBeenCalledTimes(1);
        } finally { finish(); handle.stop(); }
    });

    it('stop is idempotent', () => {
        const handle = startMcpOauthMaintenanceTimer({ homeDir: tmpHome, logger: nullLogger, runOnStart: false });
        handle.stop();
        expect(() => handle.stop()).not.toThrow();
    });
});

describe('scope policy', () => {
    it('drops .default only when a specific scope for the same resource is present', () => {
        expect(sanitizeRequestScope('api://fixture/read api://fixture/.default api://other/.default'))
            .toBe('api://fixture/read api://other/.default');
        expect(sanitizeRequestScope('https://resource.example/read https://resource.example/.default'))
            .toBe('https://resource.example/read');
        expect(sanitizeRequestScope('api://fixture/.default')).toBe('api://fixture/.default');
    });

    it('deduplicates scopes and appends offline_access once', () => {
        expect(composeRefreshScope('api://fixture/read api://fixture/read offline_access'))
            .toBe('api://fixture/read offline_access');
        expect(composeRefreshScope(undefined)).toBe('offline_access');
    });
});
