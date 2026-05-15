import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('azure-devops-node-api', () => {
    // Use a regular function (not arrow) so the mock is constructible with `new`.
    // In vitest 4, mocks invoke their implementation as a constructor when called
    // with `new`, and arrow functions do not have [[Construct]].
    const mockWebApi = vi.fn(function (this: any) {
        this.getWorkItemTrackingApi = vi.fn();
    });
    return {
        WebApi: mockWebApi,
        getBearerHandler: vi.fn().mockReturnValue({ token: 'mock-bearer-handler' }),
    };
});

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
    AdoConnectionFactory,
    getAdoConnectionFactory,
    resetAdoConnectionFactory,
} from '../../src/ado/ado-connection-factory';
import * as azdev from 'azure-devops-node-api';
import { execAsync } from '../../src/utils/exec-utils';
import { readAdoSessionCache, writeAdoSessionCache } from '../../src/ado/ado-session-cache';

const mockedExecAsync = vi.mocked(execAsync);
const mockedReadCache = vi.mocked(readAdoSessionCache);
const mockedWriteCache = vi.mocked(writeAdoSessionCache);

const NOW = 1_700_000_000_000;
const TOKEN_JSON = JSON.stringify({
    token: 'az-bearer-token-123',
    expiresOn: new Date(NOW + 3600_000).toISOString(),
});
const ACCOUNT_JSON = JSON.stringify({ upn: 'user@example.com', displayName: 'Test User' });

describe('AdoConnectionFactory', () => {
    const ORIGINAL_ENV = { ...process.env };

    beforeEach(() => {
        resetAdoConnectionFactory();
        delete process.env.AZURE_DEVOPS_ORG_URL;
        vi.clearAllMocks();
        vi.setSystemTime(NOW);
        // Default: no valid cache
        mockedReadCache.mockResolvedValue(null);
        mockedWriteCache.mockResolvedValue(undefined);
    });

    afterEach(() => {
        resetAdoConnectionFactory();
        process.env = { ...ORIGINAL_ENV };
        vi.useRealTimers();
    });

    describe('singleton', () => {
        it('getInstance returns the same instance', () => {
            const a = AdoConnectionFactory.getInstance();
            const b = AdoConnectionFactory.getInstance();
            expect(a).toBe(b);
        });

        it('resetInstance isolates tests', () => {
            const a = getAdoConnectionFactory();
            resetAdoConnectionFactory();
            const b = getAdoConnectionFactory();
            expect(a).not.toBe(b);
        });
    });

    describe('connect — missing org URL', () => {
        it('returns error when AZURE_DEVOPS_ORG_URL is not set', async () => {
            const factory = getAdoConnectionFactory();
            const result = await factory.connect();
            expect(result.connected).toBe(false);
            if (!result.connected) {
                expect(result.error).toContain('AZURE_DEVOPS_ORG_URL');
            }
        });
    });

    describe('connect — token cache hit', () => {
        beforeEach(() => {
            process.env.AZURE_DEVOPS_ORG_URL = 'https://dev.azure.com/myorg';
        });

        it('skips az CLI when cache is valid', async () => {
            mockedReadCache.mockResolvedValueOnce({
                token: 'cached-token',
                expiresAt: NOW + 10 * 60 * 1000,
                account: { upn: 'user@example.com', displayName: 'Test User', adoId: null },
            });

            const factory = getAdoConnectionFactory();
            const result = await factory.connect();

            expect(result.connected).toBe(true);
            expect(mockedExecAsync).not.toHaveBeenCalled();
            expect(azdev.getBearerHandler).toHaveBeenCalledWith('cached-token');
        });

        it('exposes account from cache on successful connect', async () => {
            const account = { upn: 'user@example.com', displayName: 'Test User', adoId: 'guid-123' };
            mockedReadCache.mockResolvedValueOnce({
                token: 'cached-token',
                expiresAt: NOW + 10 * 60 * 1000,
                account,
            });

            const factory = getAdoConnectionFactory();
            const result = await factory.connect();

            expect(result.connected).toBe(true);
            if (result.connected) {
                expect(result.account).toEqual(account);
            }
        });
    });

    describe('connect — Azure CLI fallback (cache miss)', () => {
        beforeEach(() => {
            process.env.AZURE_DEVOPS_ORG_URL = 'https://dev.azure.com/myorg';
        });

        it('fetches token via az CLI and writes cache', async () => {
            mockedExecAsync
                .mockResolvedValueOnce({ stdout: TOKEN_JSON, stderr: '' })  // get-access-token
                .mockResolvedValueOnce({ stdout: ACCOUNT_JSON, stderr: '' }); // account show

            const factory = getAdoConnectionFactory();
            const result = await factory.connect();

            expect(result.connected).toBe(true);
            expect(mockedExecAsync).toHaveBeenCalledWith(
                expect.stringContaining('az account get-access-token'),
            );
            expect(mockedWriteCache).toHaveBeenCalledOnce();
            expect(azdev.getBearerHandler).toHaveBeenCalledWith('az-bearer-token-123');
        });

        it('returns error when az CLI returns empty token', async () => {
            mockedExecAsync.mockResolvedValueOnce({
                stdout: JSON.stringify({ token: '', expiresOn: new Date().toISOString() }),
                stderr: '',
            });

            const factory = getAdoConnectionFactory();
            const result = await factory.connect();

            expect(result.connected).toBe(false);
            if (!result.connected) {
                expect(result.error).toContain('empty token');
            }
        });

        it('returns error with helpful message when az CLI fails', async () => {
            mockedExecAsync.mockRejectedValueOnce(new Error('az: command not found'));

            const factory = getAdoConnectionFactory();
            const result = await factory.connect();

            expect(result.connected).toBe(false);
            if (!result.connected) {
                expect(result.error).toContain('Azure CLI');
                expect(result.error).toContain('az login');
            }
        });

        it('still connects even if account show fails', async () => {
            mockedExecAsync
                .mockResolvedValueOnce({ stdout: TOKEN_JSON, stderr: '' })
                .mockRejectedValueOnce(new Error('account show failed'));

            const factory = getAdoConnectionFactory();
            const result = await factory.connect();

            expect(result.connected).toBe(true);
            if (result.connected) {
                expect(result.account).toBeNull();
            }
        });

        it('still connects even if cache write fails', async () => {
            mockedExecAsync
                .mockResolvedValueOnce({ stdout: TOKEN_JSON, stderr: '' })
                .mockResolvedValueOnce({ stdout: ACCOUNT_JSON, stderr: '' });
            mockedWriteCache.mockRejectedValueOnce(new Error('disk full'));

            const factory = getAdoConnectionFactory();
            const result = await factory.connect();

            expect(result.connected).toBe(true);
        });
    });

    describe('connect — expired cache falls back to az CLI', () => {
        beforeEach(() => {
            process.env.AZURE_DEVOPS_ORG_URL = 'https://dev.azure.com/myorg';
        });

        it('calls az CLI when cached token is within 5-min buffer', async () => {
            mockedReadCache.mockResolvedValueOnce({
                token: 'old-token',
                expiresAt: NOW + 3 * 60 * 1000, // < 5 min buffer
                account: null,
            });
            mockedExecAsync
                .mockResolvedValueOnce({ stdout: TOKEN_JSON, stderr: '' })
                .mockResolvedValueOnce({ stdout: ACCOUNT_JSON, stderr: '' });

            const factory = getAdoConnectionFactory();
            const result = await factory.connect();

            expect(result.connected).toBe(true);
            expect(mockedExecAsync).toHaveBeenCalled();
            expect(azdev.getBearerHandler).toHaveBeenCalledWith('az-bearer-token-123');
        });
    });

    describe('connect — error handling', () => {
        it('returns connected false when WebApi constructor throws', async () => {
            vi.mocked(azdev.WebApi).mockImplementationOnce(function (this: any) {
                throw new Error('network failure');
            });
            mockedExecAsync
                .mockResolvedValueOnce({ stdout: TOKEN_JSON, stderr: '' })
                .mockResolvedValueOnce({ stdout: ACCOUNT_JSON, stderr: '' });
            process.env.AZURE_DEVOPS_ORG_URL = 'https://org';

            const factory = getAdoConnectionFactory();
            const result = await factory.connect();

            expect(result.connected).toBe(false);
            if (!result.connected) {
                expect(result.error).toContain('network failure');
            }
        });
    });
});
