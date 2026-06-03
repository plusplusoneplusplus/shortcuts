import { execFile } from 'child_process';
import { promisify } from 'util';
import type { WorkItemSyncProviderStatus } from '@plusplusoneplusplus/coc-client';
import { ADO_RESOURCE_ID } from '../providers/provider-factory';
import { readProvidersConfig } from '../providers/providers-config';
import type {
    WorkItemSyncProviderAdapter,
    WorkItemSyncProviderContext,
} from './work-item-sync-provider';

type ExecFileAsync = (
    file: string,
    args: string[],
    options: { encoding: 'utf8'; windowsHide: true; maxBuffer: number },
) => Promise<{ stdout: string; stderr: string }>;

export type AzureBoardsAccessTokenResolver = () => Promise<string | undefined>;

export interface CreateAzureBoardsWorkItemSyncProviderOptions {
    dataDir: string;
    resolveAccessToken?: AzureBoardsAccessTokenResolver;
}

const execFileAsync = promisify(execFile) as ExecFileAsync;

function authNotChecked(): WorkItemSyncProviderStatus['auth'] {
    return {
        mode: 'external',
        authenticated: false,
        message: 'Azure CLI authentication was not checked because Azure Boards configuration is incomplete.',
    };
}

function normalizeOrgUrl(orgUrl: string): string {
    return orgUrl.trim().replace(/\/+$/, '');
}

function projectUrl(orgUrl: string, project: string): string {
    return `${normalizeOrgUrl(orgUrl)}/${encodeURIComponent(project)}`;
}

function missingOrgUrlStatus(): WorkItemSyncProviderStatus {
    return {
        provider: 'azure-boards',
        available: false,
        reason: 'missing-org-url',
        message: 'Azure Boards sync requires an Azure DevOps organization URL in provider configuration.',
        auth: authNotChecked(),
    };
}

function missingProjectStatus(orgUrl: string): WorkItemSyncProviderStatus {
    const normalizedOrgUrl = normalizeOrgUrl(orgUrl);
    return {
        provider: 'azure-boards',
        available: false,
        reason: 'missing-project',
        message: 'Azure Boards sync requires a workspace Azure Boards project preference.',
        repository: {
            provider: 'azure-boards',
            organizationUrl: normalizedOrgUrl,
            url: normalizedOrgUrl,
            source: 'preference',
        },
        auth: authNotChecked(),
    };
}

function authUnavailableStatus(orgUrl: string, project: string): WorkItemSyncProviderStatus {
    const normalizedOrgUrl = normalizeOrgUrl(orgUrl);
    return {
        provider: 'azure-boards',
        available: false,
        reason: 'auth-unavailable',
        message: `Azure Boards sync could not authenticate through Azure CLI for project '${project}'.`,
        repository: {
            provider: 'azure-boards',
            organizationUrl: normalizedOrgUrl,
            project,
            projectId: project,
            url: projectUrl(normalizedOrgUrl, project),
            source: 'preference',
        },
        auth: {
            mode: 'external',
            authenticated: false,
            message: 'Run az login so CoC can request Azure DevOps access from Azure CLI.',
        },
    };
}

function availableStatus(orgUrl: string, project: string): WorkItemSyncProviderStatus {
    const normalizedOrgUrl = normalizeOrgUrl(orgUrl);
    return {
        provider: 'azure-boards',
        available: true,
        repository: {
            provider: 'azure-boards',
            organizationUrl: normalizedOrgUrl,
            project,
            projectId: project,
            url: projectUrl(normalizedOrgUrl, project),
            source: 'preference',
        },
        auth: {
            mode: 'external',
            authenticated: true,
            message: 'Azure Boards sync is using Azure CLI authentication.',
        },
    };
}

export async function resolveAzureDevOpsCliAccessToken(
    run: ExecFileAsync = execFileAsync,
): Promise<string | undefined> {
    try {
        const { stdout } = await run('az', [
            'account',
            'get-access-token',
            '--resource',
            ADO_RESOURCE_ID,
            '--query',
            'accessToken',
            '-o',
            'tsv',
        ], {
            encoding: 'utf8',
            windowsHide: true,
            maxBuffer: 1024 * 1024,
        });
        const token = stdout.trim();
        return token.length > 0 ? token : undefined;
    } catch {
        return undefined;
    }
}

export function createAzureBoardsWorkItemSyncProviderAdapter(
    options: CreateAzureBoardsWorkItemSyncProviderOptions,
): WorkItemSyncProviderAdapter {
    const resolveAccessToken = options.resolveAccessToken ?? (() => resolveAzureDevOpsCliAccessToken());

    return {
        provider: 'azure-boards',
        async getStatus(context: WorkItemSyncProviderContext) {
            const config = await readProvidersConfig(options.dataDir);
            const orgUrl = config.providers.ado?.orgUrl?.trim();
            if (!orgUrl) return missingOrgUrlStatus();

            const project = context.preferences.workItems?.sync?.azureBoards?.project?.trim();
            if (!project) return missingProjectStatus(orgUrl);

            const accessToken = await resolveAccessToken();
            if (!accessToken) return authUnavailableStatus(orgUrl, project);

            return availableStatus(orgUrl, project);
        },
    };
}
