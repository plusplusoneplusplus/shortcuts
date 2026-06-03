import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
    createAzureBoardsWorkItemSyncProviderAdapter,
    resolveAzureDevOpsCliAccessToken,
} from '../../../src/server/work-items/work-item-sync-azure-boards-provider';
import { writeProvidersConfig } from '../../../src/server/providers/providers-config';

const WORKSPACE_ID = 'azure-sync-repo';

let tmpDir: string;

beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'coc-wi-az-sync-'));
});

afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
});

function makeContext(project?: string) {
    return {
        workspaceId: WORKSPACE_ID,
        workspace: {
            id: WORKSPACE_ID,
            name: 'Azure Sync',
            rootPath: undefined,
            remoteUrl: undefined,
        },
        preferences: project
            ? { workItems: { sync: { azureBoards: { project } } } }
            : {},
    };
}

describe('Azure Boards work item sync provider status adapter', () => {
    it('reports available status from global org URL and workspace project using external auth only', async () => {
        await writeProvidersConfig({
            providers: {
                ado: { orgUrl: 'https://dev.azure.com/octo-org/' },
            },
        }, tmpDir);
        const provider = createAzureBoardsWorkItemSyncProviderAdapter({
            dataDir: tmpDir,
            resolveAccessToken: async () => 'secret-bearer-token',
        });

        const status = await provider.getStatus(makeContext('Project Alpha'));

        expect(status).toMatchObject({
            provider: 'azure-boards',
            available: true,
            repository: {
                provider: 'azure-boards',
                organizationUrl: 'https://dev.azure.com/octo-org',
                project: 'Project Alpha',
                projectId: 'Project Alpha',
                url: 'https://dev.azure.com/octo-org/Project%20Alpha',
                source: 'preference',
            },
            auth: {
                mode: 'external',
                authenticated: true,
            },
        });
        expect(JSON.stringify(status)).not.toContain('secret-bearer-token');
        expect(JSON.stringify(status)).not.toMatch(/token|bearer|authorization/i);
    });

    it('reports missing organization URL before checking Azure CLI auth', async () => {
        let authChecks = 0;
        const provider = createAzureBoardsWorkItemSyncProviderAdapter({
            dataDir: tmpDir,
            resolveAccessToken: async () => {
                authChecks++;
                return 'secret-token';
            },
        });

        const status = await provider.getStatus(makeContext('Project Alpha'));

        expect(status).toMatchObject({
            provider: 'azure-boards',
            available: false,
            reason: 'missing-org-url',
            auth: { mode: 'external', authenticated: false },
        });
        expect(authChecks).toBe(0);
        expect(JSON.stringify(status)).not.toMatch(/secret-token|bearer|authorization/i);
    });

    it('reports missing workspace project before checking Azure CLI auth', async () => {
        await writeProvidersConfig({
            providers: {
                ado: { orgUrl: 'https://dev.azure.com/octo-org' },
            },
        }, tmpDir);
        let authChecks = 0;
        const provider = createAzureBoardsWorkItemSyncProviderAdapter({
            dataDir: tmpDir,
            resolveAccessToken: async () => {
                authChecks++;
                return 'secret-token';
            },
        });

        const status = await provider.getStatus(makeContext());

        expect(status).toMatchObject({
            provider: 'azure-boards',
            available: false,
            reason: 'missing-project',
            repository: {
                provider: 'azure-boards',
                organizationUrl: 'https://dev.azure.com/octo-org',
                url: 'https://dev.azure.com/octo-org',
            },
            auth: { mode: 'external', authenticated: false },
        });
        expect(authChecks).toBe(0);
        expect(JSON.stringify(status)).not.toMatch(/secret-token|bearer|authorization/i);
    });

    it('reports Azure CLI auth unavailable without exposing credential details', async () => {
        await writeProvidersConfig({
            providers: {
                ado: { orgUrl: 'https://dev.azure.com/octo-org' },
            },
        }, tmpDir);
        const provider = createAzureBoardsWorkItemSyncProviderAdapter({
            dataDir: tmpDir,
            resolveAccessToken: async () => undefined,
        });

        const status = await provider.getStatus(makeContext('Project Alpha'));

        expect(status).toMatchObject({
            provider: 'azure-boards',
            available: false,
            reason: 'auth-unavailable',
            repository: {
                provider: 'azure-boards',
                organizationUrl: 'https://dev.azure.com/octo-org',
                project: 'Project Alpha',
            },
            auth: {
                mode: 'external',
                authenticated: false,
            },
        });
        expect(JSON.stringify(status)).not.toMatch(/token|bearer|authorization/i);
    });
});

describe('resolveAzureDevOpsCliAccessToken', () => {
    it('uses Azure DevOps resource ID and returns only trimmed stdout', async () => {
        const calls: Array<{ file: string; args: string[] }> = [];
        const run = async (file: string, args: string[]) => {
            calls.push({ file, args });
            return { stdout: '  access-token-value\n', stderr: '' };
        };

        await expect(resolveAzureDevOpsCliAccessToken(run)).resolves.toBe('access-token-value');
        expect(calls).toEqual([{
            file: 'az',
            args: [
                'account',
                'get-access-token',
                '--resource',
                '499b84ac-1321-427f-aa17-267ca6975798',
                '--query',
                'accessToken',
                '-o',
                'tsv',
            ],
        }]);
    });
});
