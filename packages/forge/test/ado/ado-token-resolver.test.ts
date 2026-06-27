import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../src/utils/exec-utils', () => ({
    execAsync: vi.fn(),
}));

vi.mock('../../src/ado/ado-session-cache', async (importOriginal) => {
    const original = await importOriginal<typeof import('../../src/ado/ado-session-cache')>();
    return {
        ...original,
        readAdoSessionCache: vi.fn(),
        writeAdoSessionCache: vi.fn(),
    };
});

import {
    resolveAdoAccessToken,
    resolveAdoAccessTokenValue,
    resetAdoTokenResolverForTests,
    ADO_RESOURCE_ID,
} from '../../src/ado/ado-token-resolver';
import { readAdoSessionCache, writeAdoSessionCache } from '../../src/ado/ado-session-cache';

const mockedReadCache = vi.mocked(readAdoSessionCache);
const mockedWriteCache = vi.mocked(writeAdoSessionCache);

const NOW = 1_700_000_000_000;
const VALID_EXPIRY = NOW + 60 * 60 * 1000; // 1 hour from now
const TOKEN_JSON = JSON.stringify({
    token: 'fresh-token-123',
    expiresOn: new Date(VALID_EXPIRY).toISOString(),
});
const ACCOUNT_JSON = JSON.stringify({ upn: 'user@example.com', displayName: 'Test User' });

describe('ado-token-resolver', () => {
    beforeEach(() => {
        resetAdoTokenResolverForTests();
        vi.clearAllMocks();
        vi.useFakeTimers();
        vi.setSystemTime(NOW);
        mockedReadCache.mockResolvedValue(null);
        mockedWriteCache.mockResolvedValue(undefined);
    });

    afterEach(() => {
        resetAdoTokenResolverForTests();
        vi.useRealTimers();
    });

    describe('cache hit', () => {
        it('returns cached token without calling az CLI', async () => {
            const runner = vi.fn();
            mockedReadCache.mockResolvedValueOnce({
                token: 'cached-token',
                expiresAt: NOW + 10 * 60 * 1000,
                account: { upn: 'user@example.com', displayName: 'Test User', adoId: null },
            });

            const result = await resolveAdoAccessToken({ runAzCli: runner });

            expect(result).toEqual({
                token: 'cached-token',
                expiresAt: NOW + 10 * 60 * 1000,
                account: { upn: 'user@example.com', displayName: 'Test User', adoId: null },
            });
            expect(runner).not.toHaveBeenCalled();
        });
    });

    describe('cache miss — single token refresh', () => {
        it('fetches token via az CLI and writes cache', async () => {
            const runner = vi.fn()
                .mockResolvedValueOnce({ stdout: TOKEN_JSON, stderr: '' })
                .mockResolvedValueOnce({ stdout: ACCOUNT_JSON, stderr: '' });

            const result = await resolveAdoAccessToken({ runAzCli: runner });

            expect(result).toEqual({
                token: 'fresh-token-123',
                expiresAt: VALID_EXPIRY,
                account: { upn: 'user@example.com', displayName: 'Test User', adoId: null },
            });
            expect(runner).toHaveBeenCalledWith(
                expect.stringContaining('az account get-access-token'),
            );
            expect(mockedWriteCache).toHaveBeenCalledOnce();
        });

        it('returns null when az CLI returns empty token', async () => {
            const runner = vi.fn().mockResolvedValueOnce({
                stdout: JSON.stringify({ token: '', expiresOn: new Date().toISOString() }),
                stderr: '',
            });

            const result = await resolveAdoAccessToken({ runAzCli: runner });

            expect(result).toBeNull();
        });

        it('returns null when az CLI fails', async () => {
            const runner = vi.fn().mockRejectedValueOnce(new Error('az: not found'));

            const result = await resolveAdoAccessToken({ runAzCli: runner });

            expect(result).toBeNull();
        });

        it('still succeeds when account show fails', async () => {
            const runner = vi.fn()
                .mockResolvedValueOnce({ stdout: TOKEN_JSON, stderr: '' })
                .mockRejectedValueOnce(new Error('account show failed'));

            const result = await resolveAdoAccessToken({ runAzCli: runner });

            expect(result).toEqual({
                token: 'fresh-token-123',
                expiresAt: VALID_EXPIRY,
                account: null,
            });
        });

        it('still succeeds when cache write fails', async () => {
            const runner = vi.fn()
                .mockResolvedValueOnce({ stdout: TOKEN_JSON, stderr: '' })
                .mockResolvedValueOnce({ stdout: ACCOUNT_JSON, stderr: '' });
            mockedWriteCache.mockRejectedValueOnce(new Error('disk full'));

            const result = await resolveAdoAccessToken({ runAzCli: runner });

            expect(result?.token).toBe('fresh-token-123');
        });
    });

    describe('single-flight deduplication', () => {
        it('concurrent cache misses call az CLI only once', async () => {
            let resolveToken: (v: { stdout: string; stderr: string }) => void;
            const tokenPromise = new Promise<{ stdout: string; stderr: string }>((r) => { resolveToken = r; });
            const runner = vi.fn()
                .mockReturnValueOnce(tokenPromise)
                .mockResolvedValue({ stdout: ACCOUNT_JSON, stderr: '' });

            // Launch multiple concurrent requests.
            const p1 = resolveAdoAccessToken({ runAzCli: runner });
            const p2 = resolveAdoAccessToken({ runAzCli: runner });
            const p3 = resolveAdoAccessToken({ runAzCli: runner });

            // Resolve the token.
            resolveToken!({ stdout: TOKEN_JSON, stderr: '' });

            const [r1, r2, r3] = await Promise.all([p1, p2, p3]);

            expect(r1?.token).toBe('fresh-token-123');
            expect(r2?.token).toBe('fresh-token-123');
            expect(r3?.token).toBe('fresh-token-123');
            // az account get-access-token should be called only once.
            expect(runner).toHaveBeenCalledTimes(2); // token + account show
        });

        it('clears in-flight promise after failure so retry works', async () => {
            const runner = vi.fn()
                .mockRejectedValueOnce(new Error('first failure'))
                .mockResolvedValueOnce({ stdout: TOKEN_JSON, stderr: '' })
                .mockResolvedValueOnce({ stdout: ACCOUNT_JSON, stderr: '' });

            const r1 = await resolveAdoAccessToken({ runAzCli: runner });
            expect(r1).toBeNull();

            const r2 = await resolveAdoAccessToken({ runAzCli: runner });
            expect(r2?.token).toBe('fresh-token-123');
        });
    });

    describe('queue prevents concurrent CLI commands', () => {
        it('serializes token refreshes for different data dirs', async () => {
            vi.useRealTimers();
            const callOrder: string[] = [];
            const runner = vi.fn().mockImplementation(async (cmd: string) => {
                if (cmd.includes('get-access-token')) {
                    callOrder.push('start-token');
                    await new Promise((r) => setTimeout(r, 10));
                    callOrder.push('end-token');
                    return { stdout: TOKEN_JSON, stderr: '' };
                }
                return { stdout: ACCOUNT_JSON, stderr: '' };
            });

            // Use different dataDirs to avoid single-flight sharing.
            const p1 = resolveAdoAccessToken({ dataDir: '/dir1', runAzCli: runner });
            const p2 = resolveAdoAccessToken({ dataDir: '/dir2', runAzCli: runner });

            await Promise.all([p1, p2]);

            // The queue should serialize: start-token, end-token, start-token, end-token
            expect(callOrder).toEqual(['start-token', 'end-token', 'start-token', 'end-token']);
        });
    });

    describe('cache populated by concurrent refresh', () => {
        it('uses cache written by another refresh when re-checking', async () => {
            let firstCall = true;
            mockedReadCache.mockImplementation(async () => {
                if (firstCall) {
                    firstCall = false;
                    return null;
                }
                // Second call: cache populated by another refresh.
                return {
                    token: 'other-refresh-token',
                    expiresAt: NOW + 10 * 60 * 1000,
                    account: null,
                };
            });

            const runner = vi.fn();
            const result = await resolveAdoAccessToken({ runAzCli: runner });

            expect(result?.token).toBe('other-refresh-token');
            expect(runner).not.toHaveBeenCalled();
        });
    });

    describe('resolveAdoAccessTokenValue', () => {
        it('returns only the token string', async () => {
            mockedReadCache.mockResolvedValueOnce({
                token: 'value-only-token',
                expiresAt: NOW + 10 * 60 * 1000,
                account: null,
            });

            const value = await resolveAdoAccessTokenValue();

            expect(value).toBe('value-only-token');
        });

        it('returns undefined when no token available', async () => {
            const runner = vi.fn().mockRejectedValueOnce(new Error('no az'));

            const value = await resolveAdoAccessTokenValue({ runAzCli: runner });

            expect(value).toBeUndefined();
        });
    });

    describe('ADO_RESOURCE_ID', () => {
        it('uses the correct Azure DevOps resource ID', () => {
            expect(ADO_RESOURCE_ID).toBe('499b84ac-1321-427f-aa17-267ca6975798');
        });
    });

    describe('malformed token output', () => {
        it('returns null for non-JSON output', async () => {
            const runner = vi.fn().mockResolvedValueOnce({ stdout: 'not json', stderr: '' });

            const result = await resolveAdoAccessToken({ runAzCli: runner });

            expect(result).toBeNull();
        });

        it('returns null for JSON without token field', async () => {
            const runner = vi.fn().mockResolvedValueOnce({
                stdout: JSON.stringify({ expiresOn: new Date().toISOString() }),
                stderr: '',
            });

            const result = await resolveAdoAccessToken({ runAzCli: runner });

            expect(result).toBeNull();
        });
    });
});
