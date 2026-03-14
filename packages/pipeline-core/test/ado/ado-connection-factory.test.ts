import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('azure-devops-node-api', () => {
    const mockWebApi = vi.fn().mockImplementation(() => ({
        getWorkItemTrackingApi: vi.fn(),
    }));
    return {
        WebApi: mockWebApi,
        getBearerHandler: vi.fn().mockReturnValue({ token: 'mock-bearer-handler' }),
    };
});

vi.mock('../../src/utils/exec-utils', () => ({
    execAsync: vi.fn(),
}));

import {
    AdoConnectionFactory,
    getAdoConnectionFactory,
    resetAdoConnectionFactory,
} from '../../src/ado/ado-connection-factory';
import * as azdev from 'azure-devops-node-api';
import { execAsync } from '../../src/utils/exec-utils';

const mockedExecAsync = vi.mocked(execAsync);

describe('AdoConnectionFactory', () => {
    const ORIGINAL_ENV = { ...process.env };

    beforeEach(() => {
        resetAdoConnectionFactory();
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

    describe('connect — Azure CLI fallback', () => {
        beforeEach(() => {
            process.env.AZURE_DEVOPS_ORG_URL = 'https://dev.azure.com/myorg';
        });

        it('uses Azure CLI bearer token', async () => {
            mockedExecAsync.mockResolvedValueOnce({
                stdout: 'az-bearer-token-123\n',
                stderr: '',
            });

            const factory = getAdoConnectionFactory();
            const result = await factory.connect();

            expect(result.connected).toBe(true);
            expect(mockedExecAsync).toHaveBeenCalledWith(
                expect.stringContaining('az account get-access-token')
            );
            expect(azdev.getBearerHandler).toHaveBeenCalledWith('az-bearer-token-123');
        });

        it('returns error when az CLI returns empty token', async () => {
            mockedExecAsync.mockResolvedValueOnce({
                stdout: '  \n',
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
            mockedExecAsync.mockRejectedValueOnce(
                new Error('az: command not found')
            );

            const factory = getAdoConnectionFactory();
            const result = await factory.connect();

            expect(result.connected).toBe(false);
            if (!result.connected) {
                expect(result.error).toContain('Azure CLI');
                expect(result.error).toContain('az login');
            }
        });
    });

    describe('connect — error handling', () => {
        it('returns connected false when WebApi constructor throws', async () => {
            vi.mocked(azdev.WebApi).mockImplementationOnce(() => {
                throw new Error('network failure');
            });
            mockedExecAsync.mockResolvedValueOnce({ stdout: 'bearer-token\n', stderr: '' });
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
