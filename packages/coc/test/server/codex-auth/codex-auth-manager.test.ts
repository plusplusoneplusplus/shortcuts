/**
 * Tests for CodexAuthManager — OAuth flow orchestration.
 *
 * Uses a mock `tokenExchanger` and `authUrl` pointing to a local test server
 * so no real network requests are made.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CodexAuthStore } from '../../../src/server/codex-auth/codex-auth-store';
import { CodexAuthManager, type TokenExchanger } from '../../../src/server/codex-auth/codex-auth-manager';

function tmpDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'codex-auth-mgr-test-'));
}

function nowSec(): number {
    return Math.floor(Date.now() / 1000);
}

function makeMockExchanger(result?: Partial<{ accessToken: string; refreshToken: string; expiresIn: number }>, rejectWith?: Error): TokenExchanger {
    return vi.fn(async () => {
        if (rejectWith) throw rejectWith;
        return {
            accessToken: result?.accessToken ?? 'tok-test',
            refreshToken: result?.refreshToken,
            expiresIn: result?.expiresIn ?? 3600,
        };
    });
}

describe('CodexAuthManager', () => {
    let dir: string;
    let store: CodexAuthStore;
    const managers: CodexAuthManager[] = [];

    function makeManager(overrides?: Omit<ConstructorParameters<typeof CodexAuthManager>[0], 'store'>): CodexAuthManager {
        const mgr = new CodexAuthManager({ store, ...overrides });
        managers.push(mgr);
        return mgr;
    }

    beforeEach(() => {
        dir = tmpDir();
        store = new CodexAuthStore(dir);
    });

    afterEach(() => {
        // Dispose all managers created in this test to close HTTP servers
        for (const mgr of managers.splice(0)) {
            try { mgr.dispose(); } catch { /* ignore */ }
        }
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    });

    describe('getAuthInfo()', () => {
        it('delegates to the store', () => {
            const mgr = makeManager();
            expect(mgr.getAuthInfo().status).toBe('unauthenticated');

            store.write({ accessToken: 'tok', expiresAt: nowSec() + 3600, createdAt: nowSec() });
            expect(mgr.getAuthInfo().status).toBe('authenticated');
        });
    });

    describe('startFlow()', () => {
        it('returns a requestId, authUrl, and callbackPort', async () => {
            const mgr = makeManager({
                authUrl: 'https://example.com/oauth/authorize',
                tokenExchanger: makeMockExchanger(),
            });
            const result = await mgr.startFlow();

            expect(result.requestId).toBeTruthy();
            expect(result.authUrl).toContain('https://example.com/oauth/authorize');
            expect(result.callbackPort).toBeGreaterThan(0);
        });

        it('includes PKCE parameters in the authUrl', async () => {
            const mgr = makeManager({
                authUrl: 'https://example.com/oauth/authorize',
                tokenExchanger: makeMockExchanger(),
            });
            const result = await mgr.startFlow();

            expect(result.authUrl).toContain('code_challenge=');
            expect(result.authUrl).toContain('code_challenge_method=S256');
            expect(result.authUrl).toContain('redirect_uri=');
        });

        it('sets flow status to pending after start', async () => {
            const mgr = makeManager({
                authUrl: 'https://example.com/oauth/authorize',
                tokenExchanger: makeMockExchanger(),
            });
            const { requestId } = await mgr.startFlow();

            expect(mgr.getFlowStatus(requestId)?.status).toBe('pending');
        });

        it('completes the flow when the callback server receives a valid code', async () => {
            const exchanger = makeMockExchanger({ accessToken: 'granted-token', expiresIn: 7200 });
            const mgr = makeManager({
                authUrl: 'https://example.com/oauth/authorize',
                tokenExchanger: exchanger,
            });

            const { requestId, authUrl, callbackPort } = await mgr.startFlow();

            // Extract state from the authUrl
            const url = new URL(authUrl);
            const state = url.searchParams.get('state')!;
            expect(state).toBeTruthy();

            // Simulate the OAuth callback by hitting the local callback server
            await fetch(`http://127.0.0.1:${callbackPort}/callback?code=test-code-123&state=${state}`);

            // Wait for the async token exchange to finish
            await vi.waitFor(
                () => {
                    const status = mgr.getFlowStatus(requestId);
                    if (status?.status !== 'completed') throw new Error('not done yet');
                },
                { timeout: 3000 },
            );

            expect(exchanger).toHaveBeenCalledWith(
                expect.objectContaining({ code: 'test-code-123' }),
            );
            expect(store.readInfo().status).toBe('authenticated');
            expect(store.readTokens()?.accessToken).toBe('granted-token');
        });

        it('marks flow as failed on state mismatch', async () => {
            const mgr = makeManager({
                authUrl: 'https://example.com/oauth/authorize',
                tokenExchanger: makeMockExchanger(),
            });

            const { requestId, callbackPort } = await mgr.startFlow();

            // Send wrong state
            const resp = await fetch(`http://127.0.0.1:${callbackPort}/callback?code=abc&state=wrong-state`);
            expect(resp.status).toBe(400);

            await vi.waitFor(
                () => {
                    const s = mgr.getFlowStatus(requestId);
                    if (s?.status !== 'failed') throw new Error('still pending');
                },
                { timeout: 2000 },
            );

            expect(store.readInfo().status).toBe('unauthenticated');
        });

        it('marks flow as failed when the OAuth provider returns an error', async () => {
            const mgr = makeManager({
                authUrl: 'https://example.com/oauth/authorize',
                tokenExchanger: makeMockExchanger(),
            });

            const { requestId, callbackPort } = await mgr.startFlow();

            await fetch(`http://127.0.0.1:${callbackPort}/callback?error=access_denied`);

            await vi.waitFor(
                () => {
                    const s = mgr.getFlowStatus(requestId);
                    if (s?.status !== 'failed') throw new Error('still pending');
                },
                { timeout: 2000 },
            );
        });

        it('marks flow as failed when token exchanger rejects', async () => {
            const exchanger = makeMockExchanger(undefined, new Error('network error'));
            const mgr = makeManager({
                authUrl: 'https://example.com/oauth/authorize',
                tokenExchanger: exchanger,
            });

            const { requestId, authUrl, callbackPort } = await mgr.startFlow();
            const state = new URL(authUrl).searchParams.get('state')!;

            await fetch(`http://127.0.0.1:${callbackPort}/callback?code=bad&state=${state}`);

            await vi.waitFor(
                () => {
                    const s = mgr.getFlowStatus(requestId);
                    if (s?.status !== 'failed') throw new Error('still pending');
                },
                { timeout: 3000 },
            );

            expect(mgr.getFlowStatus(requestId)?.error).toContain('network error');
            expect(store.readInfo().status).toBe('unauthenticated');
        });
    });

    describe('clearAuth()', () => {
        it('removes stored tokens', () => {
            store.write({ accessToken: 'tok', expiresAt: nowSec() + 3600, createdAt: nowSec() });
            const mgr = makeManager();
            expect(mgr.clearAuth()).toBe(true);
            expect(store.readInfo().status).toBe('unauthenticated');
        });

        it('returns false when no tokens stored', () => {
            const mgr = makeManager();
            expect(mgr.clearAuth()).toBe(false);
        });
    });

    describe('getFlowStatus()', () => {
        it('returns undefined for unknown requestId', () => {
            const mgr = makeManager();
            expect(mgr.getFlowStatus('no-such-id')).toBeUndefined();
        });
    });

    describe('dispose()', () => {
        it('shuts down without error when no flows are pending', () => {
            const mgr = makeManager();
            expect(() => mgr.dispose()).not.toThrow();
        });

        it('aborts pending flows on dispose', async () => {
            const mgr = makeManager({
                authUrl: 'https://example.com/oauth/authorize',
                tokenExchanger: makeMockExchanger(),
            });
            await mgr.startFlow();
            expect(() => mgr.dispose()).not.toThrow();
        });
    });
});
