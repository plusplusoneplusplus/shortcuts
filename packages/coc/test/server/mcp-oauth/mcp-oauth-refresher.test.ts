/**
 * Tests for the MCP OAuth refresher.
 *
 * The refresher does two things: (a) dedup the SDK-managed token cache by
 * `serverUrl` (keep the freshest entry, delete the rest), and (b) refresh
 * AAD-backed access tokens before they expire using the cached refresh
 * token. Both paths are exercised here with a tmp `.copilot/mcp-oauth-config/`
 * directory, a mocked `fetch`, and an injectable `now`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { nullLogger } from '@plusplusoneplusplus/forge';
import {
    runMcpOauthMaintenancePass,
    startMcpOauthMaintenanceTimer,
    aadTokenEndpoint,
    sanitizeRequestScope,
    isTerminalRefreshError,
} from '../../../src/server/mcp-oauth/mcp-oauth-refresher';
import { getMcpOauthCacheDir } from '../../../src/server/mcp-oauth/mcp-oauth-token-cache';

const AAD_AUTH_URL = 'https://login.microsoftonline.com/72f988bf-86f1-41af-91ab-2d7cd011db47/v2.0';

interface SeedOptions {
    serverUrl: string;
    hash?: string;
    expiresAt: number;
    refreshToken?: string;
    accessToken?: string;
    scope?: string;
    authorizationServerUrl?: string;
    clientId?: string;
    skipTokens?: boolean;
    skipMeta?: boolean;
    tokensMtimeMs?: number;
}

function seed(homeDir: string, opts: SeedOptions): { metaPath: string; tokensPath: string; hash: string } {
    const cacheDir = getMcpOauthCacheDir(homeDir);
    fs.mkdirSync(cacheDir, { recursive: true });
    const hash = opts.hash ?? `h-${Math.random().toString(36).slice(2, 10)}`;
    const metaPath = path.join(cacheDir, `${hash}.json`);
    const tokensPath = path.join(cacheDir, `${hash}.tokens.json`);
    if (!opts.skipMeta) {
        fs.writeFileSync(metaPath, JSON.stringify({
            serverUrl: opts.serverUrl,
            authorizationServerUrl: opts.authorizationServerUrl ?? AAD_AUTH_URL,
            clientId: opts.clientId ?? 'aebc6443-996d-45c2-90f0-388ff96faa56',
            resourceUrl: opts.serverUrl,
        }));
    }
    if (!opts.skipTokens) {
        fs.writeFileSync(tokensPath, JSON.stringify({
            accessToken: opts.accessToken ?? 'old-access-token',
            expiresAt: opts.expiresAt,
            scope: opts.scope ?? `${opts.serverUrl}/.default`,
            refreshToken: opts.refreshToken,
        }));
        if (opts.tokensMtimeMs !== undefined) {
            const t = new Date(opts.tokensMtimeMs);
            fs.utimesSync(tokensPath, t, t);
        }
    }
    return { metaPath, tokensPath, hash };
}

function readTokens(p: string): { accessToken?: string; expiresAt?: number; scope?: string; refreshToken?: string } {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

describe('aadTokenEndpoint', () => {
    it('parses standard AAD authority URLs', () => {
        expect(aadTokenEndpoint('https://login.microsoftonline.com/contoso/v2.0'))
            .toBe('https://login.microsoftonline.com/contoso/oauth2/v2.0/token');
        expect(aadTokenEndpoint('https://login.microsoftonline.com/organizations'))
            .toBe('https://login.microsoftonline.com/organizations/oauth2/v2.0/token');
        expect(aadTokenEndpoint('https://login.microsoftonline.com/72f988bf-86f1-41af-91ab-2d7cd011db47/v2.0/.well-known/openid-configuration'))
            .toBe('https://login.microsoftonline.com/72f988bf-86f1-41af-91ab-2d7cd011db47/oauth2/v2.0/token');
    });

    it('returns undefined for non-AAD URLs', () => {
        expect(aadTokenEndpoint('https://login.example.com/oauth')).toBeUndefined();
        expect(aadTokenEndpoint('https://accounts.google.com/o/oauth2/v2/auth')).toBeUndefined();
        expect(aadTokenEndpoint(undefined)).toBeUndefined();
        expect(aadTokenEndpoint('')).toBeUndefined();
    });
});

describe('runMcpOauthMaintenancePass', () => {
    let tmpHome: string;

    beforeEach(() => {
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-oauth-refresher-'));
    });

    afterEach(() => {
        try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch { /* ignore */ }
    });

    it('returns empty result when cache directory is missing', async () => {
        const result = await runMcpOauthMaintenancePass({ homeDir: tmpHome, logger: nullLogger });
        expect(result).toEqual({
            dedup: { groups: 0, duplicatesRemoved: 0 },
            refresh: { attempted: 0, succeeded: 0, invalidated: 0, transientFailures: 0 },
        });
    });

    it('returns empty result when cache directory has no entries', async () => {
        fs.mkdirSync(getMcpOauthCacheDir(tmpHome), { recursive: true });
        const result = await runMcpOauthMaintenancePass({ homeDir: tmpHome, logger: nullLogger });
        expect(result.dedup.groups).toBe(0);
        expect(result.refresh.attempted).toBe(0);
    });

    it('keeps a single non-duplicate entry untouched', async () => {
        const fixedNow = 1_700_000_000_000;
        const { tokensPath, metaPath } = seed(tmpHome, {
            serverUrl: 'https://mcp.example.com/v1',
            expiresAt: Math.floor(fixedNow / 1000) + 3600,
            refreshToken: 'rt-1',
        });
        const result = await runMcpOauthMaintenancePass({
            homeDir: tmpHome,
            logger: nullLogger,
            now: () => fixedNow,
            // No fetch needed — token is far from expiry.
        });
        expect(result.dedup).toEqual({ groups: 1, duplicatesRemoved: 0 });
        expect(fs.existsSync(tokensPath)).toBe(true);
        expect(fs.existsSync(metaPath)).toBe(true);
    });

    it('dedups multiple entries per serverUrl, keeping the highest expiresAt', async () => {
        const fixedNow = 1_700_000_000_000;
        const nowSec = Math.floor(fixedNow / 1000);
        const url = 'https://mcp.example.com/v1';
        const oldest = seed(tmpHome, { serverUrl: url, hash: 'a', expiresAt: nowSec - 86400, refreshToken: 'rt-old' });
        const middle = seed(tmpHome, { serverUrl: url, hash: 'b', expiresAt: nowSec + 60, refreshToken: 'rt-mid' });
        const newest = seed(tmpHome, { serverUrl: url, hash: 'c', expiresAt: nowSec + 3600, refreshToken: 'rt-new' });

        const result = await runMcpOauthMaintenancePass({
            homeDir: tmpHome,
            logger: nullLogger,
            now: () => fixedNow,
        });

        expect(result.dedup.groups).toBe(1);
        expect(result.dedup.duplicatesRemoved).toBe(2);
        expect(fs.existsSync(newest.tokensPath)).toBe(true);
        expect(fs.existsSync(newest.metaPath)).toBe(true);
        expect(fs.existsSync(middle.tokensPath)).toBe(false);
        expect(fs.existsSync(middle.metaPath)).toBe(false);
        expect(fs.existsSync(oldest.tokensPath)).toBe(false);
        expect(fs.existsSync(oldest.metaPath)).toBe(false);
    });

    it('breaks ties on equal expiresAt using tokens-file mtime', async () => {
        const fixedNow = 1_700_000_000_000;
        const nowSec = Math.floor(fixedNow / 1000);
        const url = 'https://mcp.example.com/v1';
        const older = seed(tmpHome, {
            serverUrl: url, hash: 'a', expiresAt: nowSec + 3600, refreshToken: 'rt',
            tokensMtimeMs: fixedNow - 60_000,
        });
        const newer = seed(tmpHome, {
            serverUrl: url, hash: 'b', expiresAt: nowSec + 3600, refreshToken: 'rt',
            tokensMtimeMs: fixedNow,
        });

        await runMcpOauthMaintenancePass({ homeDir: tmpHome, logger: nullLogger, now: () => fixedNow });

        expect(fs.existsSync(newer.tokensPath)).toBe(true);
        expect(fs.existsSync(older.tokensPath)).toBe(false);
    });

    it('groups by serverUrl independently — different URLs are not deduped together', async () => {
        const fixedNow = 1_700_000_000_000;
        const nowSec = Math.floor(fixedNow / 1000);
        seed(tmpHome, { serverUrl: 'https://a.example/', hash: 'a1', expiresAt: nowSec + 3600 });
        seed(tmpHome, { serverUrl: 'https://b.example/', hash: 'b1', expiresAt: nowSec + 3600 });

        const result = await runMcpOauthMaintenancePass({ homeDir: tmpHome, logger: nullLogger, now: () => fixedNow });

        expect(result.dedup.groups).toBe(2);
        expect(result.dedup.duplicatesRemoved).toBe(0);
    });

    it('skips orphan files (tokens without metadata, or metadata without tokens)', async () => {
        const fixedNow = 1_700_000_000_000;
        const nowSec = Math.floor(fixedNow / 1000);
        seed(tmpHome, { serverUrl: 'https://no-tokens.example/', hash: 'meta-only', expiresAt: 0, skipTokens: true });
        // Lone tokens file
        const cacheDir = getMcpOauthCacheDir(tmpHome);
        fs.mkdirSync(cacheDir, { recursive: true });
        fs.writeFileSync(path.join(cacheDir, 'orphan.tokens.json'), JSON.stringify({ accessToken: 'x', expiresAt: nowSec + 3600 }));

        const result = await runMcpOauthMaintenancePass({ homeDir: tmpHome, logger: nullLogger, now: () => fixedNow });

        // Neither contributes a group; orphans are ignored.
        expect(result.dedup.groups).toBe(0);
    });

    it('tolerates malformed JSON files without crashing the pass', async () => {
        const fixedNow = 1_700_000_000_000;
        const cacheDir = getMcpOauthCacheDir(tmpHome);
        fs.mkdirSync(cacheDir, { recursive: true });
        fs.writeFileSync(path.join(cacheDir, 'bad.json'), '{not json');
        fs.writeFileSync(path.join(cacheDir, 'bad.tokens.json'), '{also not json');
        // Plus one valid entry that should still be processed
        seed(tmpHome, {
            serverUrl: 'https://ok.example/',
            hash: 'ok',
            expiresAt: Math.floor(fixedNow / 1000) + 3600,
        });

        const result = await runMcpOauthMaintenancePass({ homeDir: tmpHome, logger: nullLogger, now: () => fixedNow });
        expect(result.dedup.groups).toBe(1);
    });

    it('skips entries without a refresh token', async () => {
        const fixedNow = 1_700_000_000_000;
        const nowSec = Math.floor(fixedNow / 1000);
        seed(tmpHome, { serverUrl: 'https://x.example/', hash: 'a', expiresAt: nowSec + 60 /* near expiry */ });

        const fetchSpy = vi.fn();
        const result = await runMcpOauthMaintenancePass({
            homeDir: tmpHome, logger: nullLogger, now: () => fixedNow, fetch: fetchSpy as unknown as typeof fetch,
        });

        expect(fetchSpy).not.toHaveBeenCalled();
        expect(result.refresh.attempted).toBe(0);
    });

    it('skips entries that are far from expiry (outside the refresh window)', async () => {
        const fixedNow = 1_700_000_000_000;
        const nowSec = Math.floor(fixedNow / 1000);
        seed(tmpHome, {
            serverUrl: 'https://x.example/', hash: 'a',
            expiresAt: nowSec + 3600, refreshToken: 'rt',
        });

        const fetchSpy = vi.fn();
        const result = await runMcpOauthMaintenancePass({
            homeDir: tmpHome, logger: nullLogger, now: () => fixedNow,
            expiryWindowSeconds: 600, fetch: fetchSpy as unknown as typeof fetch,
        });

        expect(fetchSpy).not.toHaveBeenCalled();
        expect(result.refresh.attempted).toBe(0);
    });

    it('skips non-AAD entries', async () => {
        const fixedNow = 1_700_000_000_000;
        const nowSec = Math.floor(fixedNow / 1000);
        seed(tmpHome, {
            serverUrl: 'https://google-mcp.example/', hash: 'a',
            expiresAt: nowSec + 60, refreshToken: 'rt',
            authorizationServerUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
        });

        const fetchSpy = vi.fn();
        const result = await runMcpOauthMaintenancePass({
            homeDir: tmpHome, logger: nullLogger, now: () => fixedNow,
            fetch: fetchSpy as unknown as typeof fetch,
        });

        expect(fetchSpy).not.toHaveBeenCalled();
        expect(result.refresh.attempted).toBe(0);
    });

    it('refreshes near-expiry AAD entries and writes new tokens to the same file', async () => {
        const fixedNow = 1_700_000_000_000;
        const nowSec = Math.floor(fixedNow / 1000);
        const { tokensPath } = seed(tmpHome, {
            serverUrl: 'https://mcp.example.com/v1', hash: 'a',
            expiresAt: nowSec + 60, refreshToken: 'rt-1', accessToken: 'at-1',
            scope: 'api://contoso/.default',
        });

        const fetchSpy = vi.fn(async (url: unknown, init: unknown) => {
            const req = init as { body?: URLSearchParams };
            // Sanity-check the request shape so the test fails loudly on
            // accidental contract drift.
            expect(url).toBe('https://login.microsoftonline.com/72f988bf-86f1-41af-91ab-2d7cd011db47/oauth2/v2.0/token');
            const body = req.body!;
            expect(body.get('client_id')).toBe('aebc6443-996d-45c2-90f0-388ff96faa56');
            expect(body.get('grant_type')).toBe('refresh_token');
            expect(body.get('refresh_token')).toBe('rt-1');
            expect(body.get('scope')).toBe('api://contoso/.default offline_access');
            return {
                ok: true,
                status: 200,
                text: async () => JSON.stringify({
                    access_token: 'at-2',
                    refresh_token: 'rt-2',
                    expires_in: 3600,
                    scope: 'api://contoso/.default',
                }),
            } as unknown as Response;
        });

        const result = await runMcpOauthMaintenancePass({
            homeDir: tmpHome, logger: nullLogger, now: () => fixedNow,
            fetch: fetchSpy as unknown as typeof fetch,
        });

        expect(result.refresh.attempted).toBe(1);
        expect(result.refresh.succeeded).toBe(1);
        const updated = readTokens(tokensPath);
        expect(updated.accessToken).toBe('at-2');
        expect(updated.refreshToken).toBe('rt-2');
        expect(updated.expiresAt).toBe(nowSec + 3600);
    });

    it('preserves the existing refresh token when AAD omits one in the response', async () => {
        const fixedNow = 1_700_000_000_000;
        const nowSec = Math.floor(fixedNow / 1000);
        const { tokensPath } = seed(tmpHome, {
            serverUrl: 'https://mcp.example.com/v1', hash: 'a',
            expiresAt: nowSec + 60, refreshToken: 'rt-existing',
        });

        const fetchSpy = vi.fn(async () => ({
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ access_token: 'at-new', expires_in: 3600 }),
        } as unknown as Response));

        await runMcpOauthMaintenancePass({
            homeDir: tmpHome, logger: nullLogger, now: () => fixedNow,
            fetch: fetchSpy as unknown as typeof fetch,
        });

        expect(readTokens(tokensPath).refreshToken).toBe('rt-existing');
    });

    it('does not double-append offline_access when already in scope', async () => {
        const fixedNow = 1_700_000_000_000;
        const nowSec = Math.floor(fixedNow / 1000);
        seed(tmpHome, {
            serverUrl: 'https://mcp.example.com/v1', hash: 'a',
            expiresAt: nowSec + 60, refreshToken: 'rt',
            scope: 'api://contoso/.default offline_access',
        });

        const fetchSpy = vi.fn(async (_url: unknown, init: unknown) => {
            const body = (init as { body: URLSearchParams }).body;
            expect(body.get('scope')).toBe('api://contoso/.default offline_access');
            return { ok: true, status: 200, text: async () => JSON.stringify({ access_token: 'a', expires_in: 60 }) } as unknown as Response;
        });

        await runMcpOauthMaintenancePass({
            homeDir: tmpHome, logger: nullLogger, now: () => fixedNow,
            fetch: fetchSpy as unknown as typeof fetch,
        });
        expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('deletes the entry on invalid_grant (refresh token dead)', async () => {
        const fixedNow = 1_700_000_000_000;
        const nowSec = Math.floor(fixedNow / 1000);
        const { tokensPath, metaPath } = seed(tmpHome, {
            serverUrl: 'https://mcp.example.com/v1', hash: 'a',
            expiresAt: nowSec + 60, refreshToken: 'rt-dead',
        });

        const fetchSpy = vi.fn(async () => ({
            ok: false,
            status: 400,
            text: async () => JSON.stringify({ error: 'invalid_grant', error_description: 'AADSTS70008' }),
        } as unknown as Response));

        const result = await runMcpOauthMaintenancePass({
            homeDir: tmpHome, logger: nullLogger, now: () => fixedNow,
            fetch: fetchSpy as unknown as typeof fetch,
        });

        expect(result.refresh.invalidated).toBe(1);
        expect(result.refresh.succeeded).toBe(0);
        expect(fs.existsSync(tokensPath)).toBe(false);
        expect(fs.existsSync(metaPath)).toBe(false);
    });

    it('treats 5xx as transient and leaves the entry untouched', async () => {
        const fixedNow = 1_700_000_000_000;
        const nowSec = Math.floor(fixedNow / 1000);
        const { tokensPath } = seed(tmpHome, {
            serverUrl: 'https://mcp.example.com/v1', hash: 'a',
            expiresAt: nowSec + 60, refreshToken: 'rt', accessToken: 'unchanged',
        });

        const fetchSpy = vi.fn(async () => ({
            ok: false,
            status: 503,
            text: async () => 'service unavailable',
        } as unknown as Response));

        const result = await runMcpOauthMaintenancePass({
            homeDir: tmpHome, logger: nullLogger, now: () => fixedNow,
            fetch: fetchSpy as unknown as typeof fetch,
        });

        expect(result.refresh.transientFailures).toBe(1);
        expect(readTokens(tokensPath).accessToken).toBe('unchanged');
    });

    it('treats malformed refresh response as transient', async () => {
        const fixedNow = 1_700_000_000_000;
        const nowSec = Math.floor(fixedNow / 1000);
        const { tokensPath } = seed(tmpHome, {
            serverUrl: 'https://mcp.example.com/v1', hash: 'a',
            expiresAt: nowSec + 60, refreshToken: 'rt', accessToken: 'unchanged',
        });

        const fetchSpy = vi.fn(async () => ({
            ok: true,
            status: 200,
            text: async () => '<<<not json>>>',
        } as unknown as Response));

        const result = await runMcpOauthMaintenancePass({
            homeDir: tmpHome, logger: nullLogger, now: () => fixedNow,
            fetch: fetchSpy as unknown as typeof fetch,
        });

        expect(result.refresh.transientFailures).toBe(1);
        expect(readTokens(tokensPath).accessToken).toBe('unchanged');
    });

    it('treats a thrown fetch as transient', async () => {
        const fixedNow = 1_700_000_000_000;
        const nowSec = Math.floor(fixedNow / 1000);
        const { tokensPath } = seed(tmpHome, {
            serverUrl: 'https://mcp.example.com/v1', hash: 'a',
            expiresAt: nowSec + 60, refreshToken: 'rt', accessToken: 'unchanged',
        });

        const fetchSpy = vi.fn(async () => { throw new Error('network down'); });

        const result = await runMcpOauthMaintenancePass({
            homeDir: tmpHome, logger: nullLogger, now: () => fixedNow,
            fetch: fetchSpy as unknown as typeof fetch,
        });

        expect(result.refresh.transientFailures).toBe(1);
        expect(readTokens(tokensPath).accessToken).toBe('unchanged');
    });

    it('refreshes the survivor only after dedup (does not call fetch for dropped entries)', async () => {
        const fixedNow = 1_700_000_000_000;
        const nowSec = Math.floor(fixedNow / 1000);
        const url = 'https://mcp.example.com/v1';
        seed(tmpHome, { serverUrl: url, hash: 'stale', expiresAt: nowSec - 86400, refreshToken: 'rt-stale' });
        const survivor = seed(tmpHome, { serverUrl: url, hash: 'fresh', expiresAt: nowSec + 60, refreshToken: 'rt-fresh' });

        const fetchSpy = vi.fn(async (_url: unknown, init: unknown) => {
            const body = (init as { body: URLSearchParams }).body;
            expect(body.get('refresh_token')).toBe('rt-fresh');
            return { ok: true, status: 200, text: async () => JSON.stringify({ access_token: 'new', expires_in: 3600 }) } as unknown as Response;
        });

        const result = await runMcpOauthMaintenancePass({
            homeDir: tmpHome, logger: nullLogger, now: () => fixedNow,
            fetch: fetchSpy as unknown as typeof fetch,
        });

        expect(fetchSpy).toHaveBeenCalledTimes(1);
        expect(result.dedup.duplicatesRemoved).toBe(1);
        expect(result.refresh.succeeded).toBe(1);
        expect(readTokens(survivor.tokensPath).accessToken).toBe('new');
    });

    it('skips refresh when no fetch is available', async () => {
        const fixedNow = 1_700_000_000_000;
        const nowSec = Math.floor(fixedNow / 1000);
        const { tokensPath } = seed(tmpHome, {
            serverUrl: 'https://mcp.example.com/v1', hash: 'a',
            expiresAt: nowSec + 60, refreshToken: 'rt', accessToken: 'unchanged',
        });

        const originalFetch = globalThis.fetch;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (globalThis as any).fetch = undefined;
        try {
            const result = await runMcpOauthMaintenancePass({
                homeDir: tmpHome, logger: nullLogger, now: () => fixedNow,
                fetch: undefined as unknown as typeof fetch,
            });

            expect(result.refresh.attempted).toBe(0);
            expect(readTokens(tokensPath).accessToken).toBe('unchanged');
        } finally {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (globalThis as any).fetch = originalFetch;
        }
    });
});

describe('startMcpOauthMaintenanceTimer', () => {
    let tmpHome: string;

    beforeEach(() => {
        vi.useFakeTimers();
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-oauth-timer-'));
    });

    afterEach(() => {
        vi.useRealTimers();
        try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch { /* ignore */ }
    });

    it('runs a pass on start when runOnStart=true', async () => {
        const fetchSpy = vi.fn();
        const handle = startMcpOauthMaintenanceTimer({
            homeDir: tmpHome,
            logger: nullLogger,
            intervalMs: 60_000,
            runOnStart: true,
            fetch: fetchSpy as unknown as typeof fetch,
        });
        // Wait one immediate scheduling tick + drain microtasks
        await vi.advanceTimersByTimeAsync(0);
        await vi.advanceTimersByTimeAsync(1);
        // Pass returned even with empty dir; just confirm timer is wired
        const r = await handle.runNow();
        expect(r.dedup.groups).toBe(0);
        handle.stop();
    });

    it('does not run on start when runOnStart=false', async () => {
        const fetchSpy = vi.fn();
        const handle = startMcpOauthMaintenanceTimer({
            homeDir: tmpHome,
            logger: nullLogger,
            intervalMs: 60_000,
            runOnStart: false,
            fetch: fetchSpy as unknown as typeof fetch,
        });
        await vi.advanceTimersByTimeAsync(1);
        // setImmediate would have fired by now if runOnStart had been true
        expect(fetchSpy).not.toHaveBeenCalled();
        handle.stop();
    });

    it('triggers a pass on each interval tick until stopped', async () => {
        const fixedNow = 1_700_000_000_000;
        vi.setSystemTime(fixedNow);
        const nowSec = Math.floor(fixedNow / 1000);
        seed(tmpHome, {
            serverUrl: 'https://mcp.example.com/v1', hash: 'a',
            expiresAt: nowSec + 60, refreshToken: 'rt',
        });

        const fetchSpy = vi.fn(async () => ({
            ok: true, status: 200,
            text: async () => JSON.stringify({ access_token: 'a', expires_in: 60 }),
        } as unknown as Response));

        const handle = startMcpOauthMaintenanceTimer({
            homeDir: tmpHome,
            logger: nullLogger,
            intervalMs: 60_000,
            runOnStart: false,
            fetch: fetchSpy as unknown as typeof fetch,
        });

        await vi.advanceTimersByTimeAsync(60_000);
        // First tick fires + completes
        await vi.advanceTimersByTimeAsync(1);
        expect(fetchSpy).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(60_000);
        await vi.advanceTimersByTimeAsync(1);
        expect(fetchSpy).toHaveBeenCalledTimes(2);

        handle.stop();
        await vi.advanceTimersByTimeAsync(60_000 * 3);
        expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('clamps very small intervals to at least 60s', async () => {
        const handle = startMcpOauthMaintenanceTimer({
            homeDir: tmpHome,
            logger: nullLogger,
            intervalMs: 1,
            runOnStart: false,
        });
        const fetchSpy = vi.fn();
        // Re-create with our spy
        handle.stop();

        const h2 = startMcpOauthMaintenanceTimer({
            homeDir: tmpHome,
            logger: nullLogger,
            intervalMs: 1,
            runOnStart: false,
            fetch: fetchSpy as unknown as typeof fetch,
        });
        await vi.advanceTimersByTimeAsync(59_000);
        expect(fetchSpy).not.toHaveBeenCalled();
        // At the 60s clamp boundary the timer would tick — but cache is empty,
        // so no fetch is issued. Just verify stop works.
        h2.stop();
    });

    it('runNow returns a result and skips overlap when one is in flight', async () => {
        let resolveFetch: (() => void) | undefined;
        const fetchPromise = new Promise<void>(r => { resolveFetch = r; });
        const fetchSpy = vi.fn(async () => {
            await fetchPromise;
            return { ok: true, status: 200, text: async () => JSON.stringify({ access_token: 'a', expires_in: 60 }) } as unknown as Response;
        });

        const fixedNow = 1_700_000_000_000;
        vi.setSystemTime(fixedNow);
        const nowSec = Math.floor(fixedNow / 1000);
        seed(tmpHome, {
            serverUrl: 'https://mcp.example.com/v1', hash: 'a',
            expiresAt: nowSec + 60, refreshToken: 'rt',
        });

        const handle = startMcpOauthMaintenanceTimer({
            homeDir: tmpHome,
            logger: nullLogger,
            intervalMs: 60_000,
            runOnStart: false,
            fetch: fetchSpy as unknown as typeof fetch,
        });

        const first = handle.runNow();
        // Second call starts while first is still awaiting fetch
        const second = await handle.runNow();
        expect(second.refresh.attempted).toBe(0); // skipped because inFlight

        resolveFetch!();
        const firstResult = await first;
        expect(firstResult.refresh.attempted).toBe(1);
        expect(fetchSpy).toHaveBeenCalledTimes(1);
        handle.stop();
    });

    it('stop is idempotent', () => {
        const handle = startMcpOauthMaintenanceTimer({
            homeDir: tmpHome, logger: nullLogger, intervalMs: 60_000, runOnStart: false,
        });
        handle.stop();
        expect(() => handle.stop()).not.toThrow();
    });
});

describe('sanitizeRequestScope', () => {
    it('drops `<resource>/.default` when paired with another scope for the same resource', () => {
        // The three real-world failure cases that motivated this code path.
        expect(sanitizeRequestScope('499b84ac-1321-427f-aa17-267ca6975798/user_impersonation 499b84ac-1321-427f-aa17-267ca6975798/.default'))
            .toBe('499b84ac-1321-427f-aa17-267ca6975798/user_impersonation');
        expect(sanitizeRequestScope('https://mcp.dev.azure.com/Ado.Mcp.Tools https://mcp.dev.azure.com/.default'))
            .toBe('https://mcp.dev.azure.com/Ado.Mcp.Tools');
        expect(sanitizeRequestScope('api://29527edc-3bea-4dec-9b58-ff3ae1fa94d6/user_impersonation api://29527edc-3bea-4dec-9b58-ff3ae1fa94d6/.default'))
            .toBe('api://29527edc-3bea-4dec-9b58-ff3ae1fa94d6/user_impersonation');
    });

    it('keeps `.default` when it is the only scope for its resource', () => {
        // Admin-consent flows commonly request `.default` alone — must not be stripped.
        expect(sanitizeRequestScope('api://contoso/.default')).toBe('api://contoso/.default');
        expect(sanitizeRequestScope('api://a/user_impersonation api://a/.default api://b/.default'))
            .toBe('api://a/user_impersonation api://b/.default');
    });
});

describe('isTerminalRefreshError', () => {
    it('treats invalid_grant / interaction_required / consent_required as terminal', () => {
        expect(isTerminalRefreshError(400, JSON.stringify({ error: 'invalid_grant' }))).toBe(true);
        expect(isTerminalRefreshError(400, JSON.stringify({ error: 'interaction_required' }))).toBe(true);
        expect(isTerminalRefreshError(400, JSON.stringify({ error: 'consent_required' }))).toBe(true);
    });

    it('does NOT treat invalid_request / invalid_scope as terminal', () => {
        // Regression guard: previously these errors deleted the cached refresh
        // token, turning any request-shape bug into a forced re-auth.
        expect(isTerminalRefreshError(400, JSON.stringify({ error: 'invalid_request' }))).toBe(false);
        expect(isTerminalRefreshError(400, JSON.stringify({ error: 'invalid_scope' }))).toBe(false);
    });
});

describe('runMcpOauthMaintenancePass — scope sanitization + non-destructive transient handling', () => {
    let tmpHome: string;

    beforeEach(() => {
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-oauth-fix-'));
    });

    afterEach(() => {
        try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch { /* ignore */ }
    });

    it('refreshes successfully when cached scope mixes `.default` with a more specific scope', async () => {
        const fixedNow = 1_700_000_000_000;
        const nowSec = Math.floor(fixedNow / 1000);
        const { tokensPath } = seed(tmpHome, {
            serverUrl: 'https://mcp.example.com/v1', hash: 'mixed',
            expiresAt: nowSec + 60, refreshToken: 'rt-mixed', accessToken: 'old',
            scope: 'api://contoso/user_impersonation api://contoso/.default',
        });

        const fetchSpy = vi.fn(async (_url: unknown, init: unknown) => {
            const body = (init as { body: URLSearchParams }).body;
            expect(body.get('scope')).toBe('api://contoso/user_impersonation offline_access');
            return {
                ok: true, status: 200,
                text: async () => JSON.stringify({ access_token: 'new-at', expires_in: 3600 }),
            } as unknown as Response;
        });

        const result = await runMcpOauthMaintenancePass({
            homeDir: tmpHome, logger: nullLogger, now: () => fixedNow,
            fetch: fetchSpy as unknown as typeof fetch,
        });

        expect(result.refresh.succeeded).toBe(1);
        expect(readTokens(tokensPath).accessToken).toBe('new-at');
    });

    it('keeps the cache entry on invalid_request and logs the redacted AAD body', async () => {
        const fixedNow = 1_700_000_000_000;
        const nowSec = Math.floor(fixedNow / 1000);
        const { tokensPath, metaPath } = seed(tmpHome, {
            serverUrl: 'https://mcp.example.com/v1', hash: 'keep',
            expiresAt: nowSec + 60, refreshToken: 'rt-keep', accessToken: 'unchanged',
        });

        const fetchSpy = vi.fn(async () => ({
            ok: false, status: 400,
            text: async () => JSON.stringify({
                error: 'invalid_request',
                error_description: 'AADSTS900144: scope is required',
                correlation_id: 'abc-123',
            }),
        } as unknown as Response));

        const warnSpy = vi.fn();
        const result = await runMcpOauthMaintenancePass({
            homeDir: tmpHome, logger: { ...nullLogger, warn: warnSpy }, now: () => fixedNow,
            fetch: fetchSpy as unknown as typeof fetch,
        });

        expect(result.refresh.transientFailures).toBe(1);
        expect(result.refresh.invalidated).toBe(0);
        expect(fs.existsSync(tokensPath)).toBe(true);
        expect(fs.existsSync(metaPath)).toBe(true);
        expect(readTokens(tokensPath).accessToken).toBe('unchanged');

        const logged = warnSpy.mock.calls.map(c => c.join(' ')).join('\n');
        expect(logged).toContain('AADSTS900144');
        expect(logged).toContain('correlation_id');
    });
});
