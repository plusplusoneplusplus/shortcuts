import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('azure-devops-node-api', () => {
    const mockWebApi = vi.fn().mockImplementation(() => ({
        getWorkItemTrackingApi: vi.fn(),
    }));
    return {
        WebApi: mockWebApi,
        getPersonalAccessTokenHandler: vi.fn().mockReturnValue({ token: 'mock-handler' }),
    };
});

import {
    AdoConnectionFactory,
    getAdoConnectionFactory,
    resetAdoConnectionFactory,
} from '../../src/ado/ado-connection-factory';
import * as azdev from 'azure-devops-node-api';

describe('AdoConnectionFactory', () => {
    const ORIGINAL_ENV = { ...process.env };

    beforeEach(() => {
        resetAdoConnectionFactory();
        delete process.env.AZURE_DEVOPS_TOKEN;
        delete process.env.AZURE_DEVOPS_ORG_URL;
        vi.clearAllMocks();
    });

    afterEach(() => {
        resetAdoConnectionFactory();
        process.env = { ...ORIGINAL_ENV };
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

    describe('connect — missing env vars', () => {
        it('returns error when AZURE_DEVOPS_TOKEN is not set', async () => {
            const factory = getAdoConnectionFactory();
            const result = await factory.connect();
            expect(result.connected).toBe(false);
            if (!result.connected) {
                expect(result.error).toContain('AZURE_DEVOPS_TOKEN');
            }
        });

        it('returns error when AZURE_DEVOPS_ORG_URL is not set', async () => {
            process.env.AZURE_DEVOPS_TOKEN = 'some-pat';
            const factory = getAdoConnectionFactory();
            const result = await factory.connect();
            expect(result.connected).toBe(false);
            if (!result.connected) {
                expect(result.error).toContain('AZURE_DEVOPS_ORG_URL');
            }
        });
    });

    describe('connect — successful (mocked)', () => {
        it('creates WebApi with env var credentials', async () => {
            process.env.AZURE_DEVOPS_TOKEN = 'my-pat';
            process.env.AZURE_DEVOPS_ORG_URL = 'https://dev.azure.com/myorg';

            const factory = getAdoConnectionFactory();
            const result = await factory.connect();

            expect(result.connected).toBe(true);
            expect(azdev.getPersonalAccessTokenHandler).toHaveBeenCalledWith('my-pat');
            expect(azdev.WebApi).toHaveBeenCalledWith(
                'https://dev.azure.com/myorg',
                expect.anything()
            );
            if (result.connected) {
                expect(result.connection).toBeDefined();
            }
        });
    });

    describe('connect — caller-supplied options override env vars', () => {
        it('uses options over env vars', async () => {
            process.env.AZURE_DEVOPS_TOKEN = 'env-pat';
            process.env.AZURE_DEVOPS_ORG_URL = 'https://env-org';

            const factory = getAdoConnectionFactory();
            const result = await factory.connect({
                orgUrl: 'https://custom-org',
                token: 'custom-pat',
            });

            expect(result.connected).toBe(true);
            expect(azdev.getPersonalAccessTokenHandler).toHaveBeenCalledWith('custom-pat');
            expect(azdev.WebApi).toHaveBeenCalledWith(
                'https://custom-org',
                expect.anything()
            );
        });
    });

    describe('connect — error handling', () => {
        it('returns connected false when WebApi constructor throws', async () => {
            vi.mocked(azdev.WebApi).mockImplementationOnce(() => {
                throw new Error('network failure');
            });
            process.env.AZURE_DEVOPS_TOKEN = 'pat';
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
