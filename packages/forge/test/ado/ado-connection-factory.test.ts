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

vi.mock('../../src/ado/ado-token-resolver', async (importOriginal) => {
    const original = await importOriginal<typeof import('../../src/ado/ado-token-resolver')>();
    return {
        ...original,
        resolveAdoAccessToken: vi.fn(),
    };
});

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
import { resolveAdoAccessToken } from '../../src/ado/ado-token-resolver';
import { readAdoSessionCache } from '../../src/ado/ado-session-cache';

const mockedResolveToken = vi.mocked(resolveAdoAccessToken);
const mockedReadCache = vi.mocked(readAdoSessionCache);

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
        // Default: token resolver returns null (no token available)
        mockedResolveToken.mockResolvedValue(null);
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

        it('uses resolved token from shared resolver', async () => {
            mockedResolveToken.mockResolvedValueOnce({
                token: 'cached-token',
                expiresAt: NOW + 10 * 60 * 1000,
                account: { upn: 'user@example.com', displayName: 'Test User', adoId: null },
            });

            const factory = getAdoConnectionFactory();
            const result = await factory.connect();

            expect(result.connected).toBe(true);
            expect(azdev.getBearerHandler).toHaveBeenCalledWith('cached-token');
        });

        it('exposes account from resolver on successful connect', async () => {
            const account = { upn: 'user@example.com', displayName: 'Test User', adoId: 'guid-123' };
            mockedResolveToken.mockResolvedValueOnce({
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

    describe('connect — token resolution (cache miss)', () => {
        beforeEach(() => {
            process.env.AZURE_DEVOPS_ORG_URL = 'https://dev.azure.com/myorg';
        });

        it('connects when shared resolver returns a token', async () => {
            mockedResolveToken.mockResolvedValueOnce({
                token: 'az-bearer-token-123',
                expiresAt: NOW + 3600_000,
                account: { upn: 'user@example.com', displayName: 'Test User', adoId: null },
            });

            const factory = getAdoConnectionFactory();
            const result = await factory.connect();

            expect(result.connected).toBe(true);
            expect(mockedResolveToken).toHaveBeenCalledWith({ dataDir: undefined });
            expect(azdev.getBearerHandler).toHaveBeenCalledWith('az-bearer-token-123');
        });

        it('returns error when token resolver returns null', async () => {
            mockedResolveToken.mockResolvedValueOnce(null);

            const factory = getAdoConnectionFactory();
            const result = await factory.connect();

            expect(result.connected).toBe(false);
            if (!result.connected) {
                expect(result.error).toContain('az login');
            }
        });

        it('passes dataDir to the shared resolver', async () => {
            mockedResolveToken.mockResolvedValueOnce({
                token: 'token-for-dir',
                expiresAt: NOW + 3600_000,
                account: null,
            });

            const factory = getAdoConnectionFactory();
            await factory.connect({ orgUrl: 'https://dev.azure.com/myorg', dataDir: '/custom/dir' });

            expect(mockedResolveToken).toHaveBeenCalledWith({ dataDir: '/custom/dir' });
        });

        it('still connects when account is null', async () => {
            mockedResolveToken.mockResolvedValueOnce({
                token: 'token-no-account',
                expiresAt: NOW + 3600_000,
                account: null,
            });

            const factory = getAdoConnectionFactory();
            const result = await factory.connect();

            expect(result.connected).toBe(true);
            if (result.connected) {
                expect(result.account).toBeNull();
            }
        });
    });

    describe('connect — error handling', () => {
        it('returns connected false when WebApi constructor throws', async () => {
            vi.mocked(azdev.WebApi).mockImplementationOnce(function (this: any) {
                throw new Error('network failure');
            });
            mockedResolveToken.mockResolvedValueOnce({
                token: 'az-bearer-token-123',
                expiresAt: NOW + 3600_000,
                account: null,
            });
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
