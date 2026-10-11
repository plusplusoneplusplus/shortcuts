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

import {
    AdoConnectionFactory,
    getAdoConnectionFactory,
    resetAdoConnectionFactory,
} from '../../src/ado/ado-connection-factory';
import * as azdev from 'azure-devops-node-api';
import { resolveAdoAccessToken } from '../../src/ado/ado-token-resolver';
import { AuthError } from '@plusplusoneplusplus/coc-native';

const mockedResolveToken = vi.mocked(resolveAdoAccessToken);

const NOW = 1_700_000_000_000;

describe('AdoConnectionFactory', () => {
    const ORIGINAL_ENV = { ...process.env };

    beforeEach(() => {
        resetAdoConnectionFactory();
        delete process.env.AZURE_DEVOPS_ORG_URL;
        vi.clearAllMocks();
        vi.setSystemTime(NOW);
        mockedResolveToken.mockRejectedValue(new AuthError('LoginRequired'));
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

    describe('connect — native token', () => {
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

    describe('connect — token resolution', () => {
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

        it('returns native auth error when token acquisition fails', async () => {
            mockedResolveToken.mockRejectedValueOnce(new AuthError('LoginRequired'));

            const factory = getAdoConnectionFactory();
            const result = await factory.connect();

            expect(result.connected).toBe(false);
            if (!result.connected) {
                expect(result.error).toContain('LoginRequired');
            }
        });

        it('passes dataDir to the shared resolver', async () => {
            mockedResolveToken.mockResolvedValueOnce({
                token: 'token-for-dir',
                expiresAt: NOW + 3600_000,
                account: { upn: 'account@example.test', displayName: 'Account', adoId: null },
            });

            const factory = getAdoConnectionFactory();
            await factory.connect({ orgUrl: 'https://dev.azure.com/myorg', dataDir: '/custom/dir' });

            expect(mockedResolveToken).toHaveBeenCalledWith({ dataDir: '/custom/dir' });
        });

        it('connects with native account metadata', async () => {
            mockedResolveToken.mockResolvedValueOnce({
                token: 'token-no-account',
                expiresAt: NOW + 3600_000,
                account: { upn: 'account@example.test', displayName: 'Account', adoId: null },
            });

            const factory = getAdoConnectionFactory();
            const result = await factory.connect();

            expect(result.connected).toBe(true);
            if (result.connected) {
                expect(result.account?.upn).toBe('account@example.test');
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
                account: { upn: 'account@example.test', displayName: 'Account', adoId: null },
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
