import { execFile } from 'child_process';
import * as crypto from 'crypto';
import type { IncomingMessage } from 'http';
import * as https from 'https';
import { promisify } from 'util';
import type { WorkItemSyncProviderStatus } from '@plusplusoneplusplus/coc-client';
import { ADO_RESOURCE_ID } from '../providers/provider-factory';
import { readProvidersConfig } from '../providers/providers-config';
import type {
    WorkItemSyncProviderAdapter,
    WorkItemSyncProviderContext,
} from './work-item-sync-provider';
import {
    formatAzureBoardsTags,
    mapCocWorkItemTypeToAzureBoardsType,
    mapAzureBoardsPriorityToWorkItemPriority,
    mapAzureBoardsStateToWorkItemStatus,
    mapAzureBoardsTypeToCocWorkItemType,
    mapWorkItemPriorityToAzureBoardsPriority,
    mapWorkItemStatusToAzureBoardsState,
    parseAzureBoardsTags,
} from './work-item-sync-azure-boards-mapping';
import type {
    WorkItem,
    WorkItemAzureBoardsMirrorMetadata,
    WorkItemIndexEntry,
    WorkItemPriority,
    WorkItemStatus,
    WorkItemStore,
    WorkItemType,
} from './types';
import {
    getEffectiveType,
    isValidParentChildTypes,
} from './types';
import { WORK_ITEM_SYNC_MAX_ITEMS } from './work-item-sync-provider';

type ExecFileAsync = (
    file: string,
    args: string[],
    options: { encoding: 'utf8'; windowsHide: true; maxBuffer: number },
) => Promise<{ stdout: string; stderr: string }>;

export type AzureBoardsAccessTokenResolver = () => Promise<string | undefined>;
export type AzureBoardsWorkItemSyncProjectSource = 'preference' | 'workspaceRemote';

export interface AvailableAzureBoardsWorkItemSyncProject {
    available: true;
    provider: 'azure-boards';
    organizationUrl: string;
    project: string;
    projectId: string;
    url: string;
    source: AzureBoardsWorkItemSyncProjectSource;
}

export interface AzureBoardsWorkItemUrlReference {
    organizationUrl: string;
    project: string;
    workItemId: number;
}

export interface AzureBoardsWorkItemRelation {
    rel?: string;
    url?: string;
}

export interface AzureBoardsWorkItem {
    id: number;
    revision?: number;
    url?: string;
    title: string;
    description?: string;
    state?: string;
    workItemType?: string;
    priority?: unknown;
    tags?: string;
    updatedAt?: string;
    relations?: AzureBoardsWorkItemRelation[];
}

export interface AzureBoardsWorkItemTransport {
    getWorkItem(project: AvailableAzureBoardsWorkItemSyncProject, workItemId: number): Promise<AzureBoardsWorkItem | undefined>;
    listWorkItemTree(
        project: AvailableAzureBoardsWorkItemSyncProject,
        rootWorkItemId: number,
        limit?: number,
    ): Promise<AzureBoardsWorkItem[]>;
    createWorkItem(
        project: AvailableAzureBoardsWorkItemSyncProject,
        input: AzureBoardsWorkItemCreateInput,
    ): Promise<AzureBoardsWorkItem>;
    updateWorkItem(
        project: AvailableAzureBoardsWorkItemSyncProject,
        workItemId: number,
        input: AzureBoardsWorkItemUpdateInput,
    ): Promise<AzureBoardsWorkItem>;
}

export interface AzureBoardsWorkItemCreateInput {
    workItemType: string;
    title: string;
    description: string;
    state: string;
    priority: number;
    tags?: string;
    parentWorkItemId?: number;
}

export interface AzureBoardsWorkItemUpdateInput {
    title: string;
    description: string;
    state: string;
    priority: number;
    tags?: string;
    parentWorkItemId?: number | null;
    expectedRevision?: number;
}

export interface ImportAzureBoardsEpicTreeResult {
    root: WorkItem;
    items: WorkItem[];
    created: number;
    updated: number;
    deleted: number;
    deletedItemIds: string[];
    warnings: AzureBoardsSyncWarning[];
}

export interface AzureBoardsSyncWarning {
    provider: 'azure-boards';
    code: 'remote-wins-conflict';
    workItemId: string;
    remoteWorkItemId?: number;
    fields: string[];
    message: string;
    localUpdatedAt?: string;
    lastPulledAt?: string;
    previousRevision?: number;
    remoteRevision?: number;
    previousUpdatedAt?: string;
    remoteUpdatedAt?: string;
}

export interface ImportAzureBoardsEpicTreeOptions {
    pruneMissing?: boolean;
}

export interface CreateAzureBoardsWorkItemSyncProviderOptions {
    dataDir: string;
    resolveAccessToken?: AzureBoardsAccessTokenResolver;
}

export interface CreateAzureBoardsWorkItemForLocalChildOptions {
    project: AvailableAzureBoardsWorkItemSyncProject;
    transport: AzureBoardsWorkItemTransport;
    item: WorkItem;
    parent: WorkItem;
    now?: () => string;
}

export interface CreateAzureBoardsWorkItemForLocalChildResult {
    workItem: AzureBoardsWorkItem;
    azureBoardsMirror: WorkItemAzureBoardsMirrorMetadata;
}

export interface UpdateAzureBoardsWorkItemForLocalMirrorOptions {
    project: AvailableAzureBoardsWorkItemSyncProject;
    transport: AzureBoardsWorkItemTransport;
    item: WorkItem;
    remoteWorkItemId: number;
    parentWorkItemId?: number | null;
    expectedRevision?: number;
    now?: () => string;
}

export interface UpdateAzureBoardsWorkItemForLocalMirrorResult {
    workItem: AzureBoardsWorkItem;
    azureBoardsMirror: WorkItemAzureBoardsMirrorMetadata;
}

interface AzureBoardsRestWorkItem {
    id?: number;
    rev?: number;
    url?: string;
    fields?: Record<string, unknown>;
    relations?: AzureBoardsWorkItemRelation[];
    _links?: {
        html?: { href?: string };
    };
}

interface AzureBoardsJsonPatchOperation {
    op: 'add' | 'remove' | 'replace' | 'test';
    path: string;
    value?: unknown;
}

const AZURE_BOARDS_REMOTE_WINS_FIELDS = ['title', 'description', 'status', 'priority', 'tags', 'parentId'];

// Resolve child_process.execFile lazily so importing this module has no
// load-time side effects (tests with partial child_process mocks would
// otherwise fail on the export access before any transport is used).
let lazyExecFileAsync: ExecFileAsync | undefined;
const execFileAsync: ExecFileAsync = (file, args, options) => {
    lazyExecFileAsync ??= promisify(execFile) as ExecFileAsync;
    return lazyExecFileAsync(file, args, options);
};

function authNotChecked(
    message = 'Azure CLI authentication was not checked because Azure Boards configuration is incomplete.',
): WorkItemSyncProviderStatus['auth'] {
    return {
        mode: 'external',
        authenticated: false,
        message,
    };
}

function normalizeOrgUrl(orgUrl: string): string {
    return orgUrl.trim().replace(/\/+$/, '');
}

function decodeUrlSegment(segment: string): string {
    try {
        return decodeURIComponent(segment);
    } catch {
        return segment;
    }
}

function pathSegments(pathname: string): string[] {
    return pathname.split('/').filter(Boolean).map(decodeUrlSegment);
}

function devAzureOrgUrl(org: string): string {
    return `https://dev.azure.com/${encodeURIComponent(org.trim())}`;
}

function projectUrl(orgUrl: string, project: string): string {
    return `${normalizeOrgUrl(orgUrl)}/${encodeURIComponent(project)}`;
}

function availableProject(
    orgUrl: string,
    project: string,
    source: AzureBoardsWorkItemSyncProjectSource,
): AvailableAzureBoardsWorkItemSyncProject {
    const organizationUrl = normalizeOrgUrl(orgUrl);
    return {
        available: true,
        provider: 'azure-boards',
        organizationUrl,
        project,
        projectId: project,
        url: projectUrl(organizationUrl, project),
        source,
    };
}

function projectRepository(project: AvailableAzureBoardsWorkItemSyncProject): WorkItemSyncProviderStatus['repository'] {
    return {
        provider: 'azure-boards',
        organizationUrl: project.organizationUrl,
        project: project.project,
        projectId: project.projectId,
        url: project.url,
        source: project.source,
    };
}

function organizationKey(orgUrl: string): string {
    const normalized = normalizeOrgUrl(orgUrl);
    try {
        const parsed = new URL(normalized);
        const host = parsed.hostname.toLowerCase();
        if (host === 'dev.azure.com') {
            const [org] = pathSegments(parsed.pathname);
            if (org) return org.toLowerCase();
        }
        if (host.endsWith('.visualstudio.com')) {
            return host.slice(0, -'.visualstudio.com'.length).toLowerCase();
        }
    } catch {
        // Fall through to compare the normalized value.
    }
    return normalized.toLowerCase();
}

function sameOrganization(left: string, right: string): boolean {
    return organizationKey(left) === organizationKey(right);
}

function sameProject(left: string, right: string): boolean {
    return decodeUrlSegment(left).trim().toLowerCase() === decodeUrlSegment(right).trim().toLowerCase();
}

export function azureBoardsProjectFromRemoteUrl(remoteUrl?: string | null): AvailableAzureBoardsWorkItemSyncProject | undefined {
    const trimmed = remoteUrl?.trim();
    if (!trimmed) return undefined;

    const normalized = trimmed.replace(/^git\+/, '');
    const scpLike = /^[^@]+@ssh\.dev\.azure\.com:v3\/([^/]+)\/([^/]+)\/.+$/i.exec(normalized);
    if (scpLike) {
        const org = decodeUrlSegment(scpLike[1]);
        const project = decodeUrlSegment(scpLike[2]);
        if (org && project) return availableProject(devAzureOrgUrl(org), project, 'workspaceRemote');
    }

    let parsed: URL;
    try {
        parsed = new URL(normalized);
    } catch {
        return undefined;
    }

    const host = parsed.hostname.toLowerCase();
    const segments = pathSegments(parsed.pathname);
    if (host === 'dev.azure.com') {
        const [org, project, marker] = segments;
        if (org && project && marker?.toLowerCase() === '_git') {
            return availableProject(devAzureOrgUrl(org), project, 'workspaceRemote');
        }
    }
    if (host.endsWith('.visualstudio.com')) {
        const org = host.slice(0, -'.visualstudio.com'.length);
        const markerIndex = segments.findIndex(segment => segment.toLowerCase() === '_git');
        const project = markerIndex > 0 ? segments[markerIndex - 1] : undefined;
        if (org && project) {
            return availableProject(devAzureOrgUrl(org), project, 'workspaceRemote');
        }
    }
    if (host === 'ssh.dev.azure.com') {
        const [version, org, project] = segments;
        if (version?.toLowerCase() === 'v3' && org && project) {
            return availableProject(devAzureOrgUrl(org), project, 'workspaceRemote');
        }
    }
    return undefined;
}

function azureBoardsConfigMismatchStatus(
    remoteProject: AvailableAzureBoardsWorkItemSyncProject,
    configuredOrgUrl: string | undefined,
    configuredProject: string | undefined,
): WorkItemSyncProviderStatus {
    const configuredParts = [
        configuredOrgUrl ? `organization '${normalizeOrgUrl(configuredOrgUrl)}'` : undefined,
        configuredProject ? `project '${configuredProject}'` : undefined,
    ].filter((part): part is string => Boolean(part));
    return {
        provider: 'azure-boards',
        available: false,
        reason: 'mismatched-remote',
        message: `Azure Boards configuration does not match this workspace repository remote. The remote resolves to organization '${remoteProject.organizationUrl}' and project '${remoteProject.project}', but the configured ${configuredParts.join(' and ')} differs.`,
        repository: projectRepository(remoteProject),
        auth: authNotChecked('Azure CLI authentication was not checked because Azure Boards configuration does not match the workspace remote.'),
    };
}

function missingOrgUrlStatus(): WorkItemSyncProviderStatus {
    return {
        provider: 'azure-boards',
        available: false,
        reason: 'missing-org-url',
        message: 'Azure Boards import requires either an Azure DevOps repo remote or configured ADO organization URL and workspace Azure Boards project.',
        auth: authNotChecked(),
    };
}

function missingProjectStatus(orgUrl: string): WorkItemSyncProviderStatus {
    const normalizedOrgUrl = normalizeOrgUrl(orgUrl);
    return {
        provider: 'azure-boards',
        available: false,
        reason: 'missing-project',
        message: 'Azure Boards import requires either an Azure DevOps repo remote or a workspace Azure Boards project preference.',
        repository: {
            provider: 'azure-boards',
            organizationUrl: normalizedOrgUrl,
            url: normalizedOrgUrl,
            source: 'preference',
        },
        auth: authNotChecked(),
    };
}

function authUnavailableStatus(
    orgUrl: string,
    project: string,
    source: AzureBoardsWorkItemSyncProjectSource,
): WorkItemSyncProviderStatus {
    const resolvedProject = availableProject(orgUrl, project, source);
    return {
        provider: 'azure-boards',
        available: false,
        reason: 'auth-unavailable',
        message: `Azure Boards sync could not authenticate through Azure CLI for project '${project}'.`,
        repository: projectRepository(resolvedProject),
        auth: {
            mode: 'external',
            authenticated: false,
            message: 'Run az login so CoC can request Azure DevOps access from Azure CLI.',
        },
    };
}

function availableStatus(
    orgUrl: string,
    project: string,
    source: AzureBoardsWorkItemSyncProjectSource,
): WorkItemSyncProviderStatus {
    const resolvedProject = availableProject(orgUrl, project, source);
    return {
        provider: 'azure-boards',
        available: true,
        repository: projectRepository(resolvedProject),
        auth: {
            mode: 'external',
            authenticated: true,
            message: 'Azure Boards sync is using Azure CLI authentication.',
        },
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function optionalNumber(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function stringField(fields: Record<string, unknown> | undefined, name: string): string | undefined {
    return optionalString(fields?.[name]);
}

function workItemUrl(raw: AzureBoardsRestWorkItem): string | undefined {
    return optionalString(raw._links?.html?.href) ?? optionalString(raw.url);
}

function normalizeRestWorkItem(raw: AzureBoardsRestWorkItem): AzureBoardsWorkItem | undefined {
    if (!Number.isInteger(raw.id) || raw.id === undefined || raw.id <= 0) return undefined;
    const fields = isRecord(raw.fields) ? raw.fields : undefined;
    const title = stringField(fields, 'System.Title') ?? `Azure Boards work item ${raw.id}`;
    return {
        id: raw.id,
        revision: optionalNumber(raw.rev),
        url: workItemUrl(raw),
        title,
        description: stringField(fields, 'System.Description'),
        state: stringField(fields, 'System.State'),
        workItemType: stringField(fields, 'System.WorkItemType'),
        priority: fields?.['Microsoft.VSTS.Common.Priority'],
        tags: stringField(fields, 'System.Tags'),
        updatedAt: stringField(fields, 'System.ChangedDate'),
        relations: Array.isArray(raw.relations) ? raw.relations : undefined,
    };
}

export function azureBoardsProjectFromStatus(status: WorkItemSyncProviderStatus): AvailableAzureBoardsWorkItemSyncProject | undefined {
    if (!status.available || status.provider !== 'azure-boards') return undefined;
    const organizationUrl = status.repository?.organizationUrl?.trim();
    const project = status.repository?.project?.trim();
    if (!organizationUrl || !project) return undefined;
    const source = status.repository?.source === 'workspaceRemote' ? 'workspaceRemote' : 'preference';
    const resolvedProject = availableProject(organizationUrl, project, source);
    return {
        ...resolvedProject,
        projectId: status.repository?.projectId?.trim() || project,
        url: status.repository?.url?.trim() || resolvedProject.url,
    };
}

export function azureBoardsWorkItemReferenceFromUrl(workItemUrlValue: string): AzureBoardsWorkItemUrlReference | undefined {
    let parsed: URL;
    try {
        parsed = new URL(workItemUrlValue);
    } catch {
        return undefined;
    }

    const host = parsed.hostname.toLowerCase();
    const segments = pathSegments(parsed.pathname);
    let org: string | undefined;
    let project: string | undefined;
    let markerIndex: number | undefined;
    if (host === 'dev.azure.com') {
        [org, project] = segments;
        markerIndex = 2;
    } else if (host.endsWith('.visualstudio.com')) {
        org = host.slice(0, -'.visualstudio.com'.length);
        [project] = segments;
        markerIndex = 1;
    } else {
        return undefined;
    }

    if (!org || !project || markerIndex === undefined) return undefined;
    if (
        segments[markerIndex]?.toLowerCase() !== '_workitems'
        || segments[markerIndex + 1]?.toLowerCase() !== 'edit'
    ) {
        return undefined;
    }
    const id = Number.parseInt(segments[markerIndex + 2] ?? '', 10);
    if (!Number.isInteger(id) || id <= 0) return undefined;
    return {
        organizationUrl: devAzureOrgUrl(org),
        project,
        workItemId: id,
    };
}

export function azureBoardsWorkItemIdFromUrl(
    workItemUrlValue: string,
    project: AvailableAzureBoardsWorkItemSyncProject,
): number | undefined {
    const reference = azureBoardsWorkItemReferenceFromUrl(workItemUrlValue);
    if (!reference) return undefined;
    if (!sameOrganization(reference.organizationUrl, project.organizationUrl)) return undefined;
    if (!sameProject(reference.project, project.project)) return undefined;
    return reference.workItemId;
}

function azureApiUrl(project: AvailableAzureBoardsWorkItemSyncProject, pathSuffix: string): URL {
    const url = new URL(`${normalizeOrgUrl(project.organizationUrl)}/${encodeURIComponent(project.project)}/_apis/wit${pathSuffix}`);
    url.searchParams.set('api-version', '7.1');
    return url;
}

function azureWorkItemRelationUrl(project: AvailableAzureBoardsWorkItemSyncProject, workItemId: number): string {
    return `${normalizeOrgUrl(project.organizationUrl)}/${encodeURIComponent(project.project)}/_apis/wit/workItems/${workItemId}`;
}

async function readResponseBody(res: IncomingMessage): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const chunk of res) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString('utf8');
}

export class AzureBoardsRestWorkItemTransport implements AzureBoardsWorkItemTransport {
    constructor(private readonly resolveAccessToken: AzureBoardsAccessTokenResolver = resolveAzureDevOpsCliAccessToken) {}

    async getWorkItem(
        project: AvailableAzureBoardsWorkItemSyncProject,
        workItemId: number,
    ): Promise<AzureBoardsWorkItem | undefined> {
        const url = azureApiUrl(project, `/workitems/${encodeURIComponent(String(workItemId))}`);
        url.searchParams.set('$expand', 'relations');
        const response = await this.requestJson<AzureBoardsRestWorkItem>(url);
        if (response.status === 404) return undefined;
        if (response.status < 200 || response.status >= 300) {
            throw new Error(`Azure Boards API request failed with status ${response.status}.`);
        }
        const item = normalizeRestWorkItem(response.body);
        if (!item) {
            throw new Error(`Azure Boards API did not return a valid work item for ID ${workItemId}.`);
        }
        return item;
    }

    async listWorkItemTree(
        project: AvailableAzureBoardsWorkItemSyncProject,
        rootWorkItemId: number,
        limit = WORK_ITEM_SYNC_MAX_ITEMS,
    ): Promise<AzureBoardsWorkItem[]> {
        const cappedLimit = Math.max(1, Math.min(limit, WORK_ITEM_SYNC_MAX_ITEMS));
        const result: AzureBoardsWorkItem[] = [];
        const seen = new Set<number>();
        const queue = [rootWorkItemId];

        while (queue.length > 0 && result.length < cappedLimit) {
            const workItemId = queue.shift()!;
            if (seen.has(workItemId)) continue;
            seen.add(workItemId);
            const item = await this.getWorkItem(project, workItemId);
            if (!item) {
                if (workItemId === rootWorkItemId) return [];
                continue;
            }
            result.push(item);
            for (const childId of childWorkItemIds(item)) {
                if (!seen.has(childId) && result.length + queue.length < cappedLimit) {
                    queue.push(childId);
                }
            }
        }

        return result;
    }

    async createWorkItem(
        project: AvailableAzureBoardsWorkItemSyncProject,
        input: AzureBoardsWorkItemCreateInput,
    ): Promise<AzureBoardsWorkItem> {
        const url = azureApiUrl(project, `/workitems/$${encodeURIComponent(input.workItemType)}`);
        const response = await this.requestJson<AzureBoardsRestWorkItem>(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json-patch+json' },
            body: createWorkItemPatch(project, input),
        });
        if (response.status < 200 || response.status >= 300) {
            throw new Error(`Azure Boards API create request failed with status ${response.status}.`);
        }
        const item = normalizeRestWorkItem(response.body);
        if (!item) {
            throw new Error('Azure Boards API did not return a valid created work item.');
        }
        return item;
    }

    async updateWorkItem(
        project: AvailableAzureBoardsWorkItemSyncProject,
        workItemId: number,
        input: AzureBoardsWorkItemUpdateInput,
    ): Promise<AzureBoardsWorkItem> {
        const current = Object.prototype.hasOwnProperty.call(input, 'parentWorkItemId')
            ? await this.getWorkItem(project, workItemId)
            : undefined;
        if (Object.prototype.hasOwnProperty.call(input, 'parentWorkItemId') && !current) {
            throw new Error(`Azure Boards work item ${workItemId} was not found.`);
        }

        const url = azureApiUrl(project, `/workitems/${encodeURIComponent(String(workItemId))}`);
        const response = await this.requestJson<AzureBoardsRestWorkItem>(url, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json-patch+json' },
            body: updateWorkItemPatch(project, input, current),
        });
        if (response.status < 200 || response.status >= 300) {
            throw new Error(`Azure Boards API update request failed with status ${response.status}.`);
        }
        const item = normalizeRestWorkItem(response.body);
        if (!item) {
            throw new Error(`Azure Boards API did not return a valid updated work item for ID ${workItemId}.`);
        }
        return item;
    }

    private async requestJson<T>(
        url: URL,
        options: {
            method?: string;
            headers?: Record<string, string>;
            body?: unknown;
        } = {},
    ): Promise<{ status: number; body: T }> {
        const token = await this.resolveAccessToken();
        if (!token) {
            throw new Error('Azure Boards API requires Azure CLI authentication.');
        }
        return new Promise((resolve, reject) => {
            const req = https.request(url, {
                method: options.method ?? 'GET',
                headers: {
                    Accept: 'application/json',
                    Authorization: `Bearer ${token}`,
                    ...options.headers,
                },
            }, async res => {
                try {
                    const raw = await readResponseBody(res);
                    const body = raw ? JSON.parse(raw) as T : {} as T;
                    resolve({ status: res.statusCode ?? 0, body });
                } catch {
                    reject(new Error('Azure Boards API returned invalid JSON.'));
                }
            });
            req.on('error', reject);
            if (options.body !== undefined) {
                req.write(JSON.stringify(options.body));
            }
            req.end();
        });
    }
}

function createWorkItemPatch(
    project: AvailableAzureBoardsWorkItemSyncProject,
    input: AzureBoardsWorkItemCreateInput,
): AzureBoardsJsonPatchOperation[] {
    const operations: AzureBoardsJsonPatchOperation[] = [
        { op: 'add', path: '/fields/System.Title', value: input.title },
        { op: 'add', path: '/fields/System.Description', value: input.description },
        { op: 'add', path: '/fields/System.State', value: input.state },
        { op: 'add', path: '/fields/Microsoft.VSTS.Common.Priority', value: input.priority },
    ];
    if (input.tags) {
        operations.push({ op: 'add', path: '/fields/System.Tags', value: input.tags });
    }
    if (input.parentWorkItemId !== undefined) {
        operations.push({
            op: 'add',
            path: '/relations/-',
            value: {
                rel: 'System.LinkTypes.Hierarchy-Reverse',
                url: azureWorkItemRelationUrl(project, input.parentWorkItemId),
            },
        });
    }
    return operations;
}

function updateWorkItemPatch(
    project: AvailableAzureBoardsWorkItemSyncProject,
    input: AzureBoardsWorkItemUpdateInput,
    current: AzureBoardsWorkItem | undefined,
): AzureBoardsJsonPatchOperation[] {
    const operations: AzureBoardsJsonPatchOperation[] = [];
    if (input.expectedRevision !== undefined) {
        operations.push({ op: 'test', path: '/rev', value: input.expectedRevision });
    }
    operations.push(
        { op: 'replace', path: '/fields/System.Title', value: input.title },
        { op: 'replace', path: '/fields/System.Description', value: input.description },
        { op: 'replace', path: '/fields/System.State', value: input.state },
        { op: 'replace', path: '/fields/Microsoft.VSTS.Common.Priority', value: input.priority },
        { op: 'replace', path: '/fields/System.Tags', value: input.tags ?? '' },
    );

    if (Object.prototype.hasOwnProperty.call(input, 'parentWorkItemId')) {
        const existingParent = current ? parentRelation(current) : undefined;
        const desiredParentId = input.parentWorkItemId ?? undefined;
        if (existingParent?.workItemId !== desiredParentId) {
            if (existingParent) {
                operations.push({ op: 'remove', path: `/relations/${existingParent.index}` });
            }
            if (desiredParentId !== undefined) {
                operations.push({
                    op: 'add',
                    path: '/relations/-',
                    value: {
                        rel: 'System.LinkTypes.Hierarchy-Reverse',
                        url: azureWorkItemRelationUrl(project, desiredParentId),
                    },
                });
            }
        }
    }

    return operations;
}

function parentRelation(item: Pick<AzureBoardsWorkItem, 'relations'>): { index: number; workItemId: number } | undefined {
    for (const [index, relation] of (item.relations ?? []).entries()) {
        if (relation.rel !== 'System.LinkTypes.Hierarchy-Reverse') continue;
        const workItemId = relationWorkItemId(relation);
        if (workItemId !== undefined) {
            return { index, workItemId };
        }
    }
    return undefined;
}

function relationWorkItemId(relation: AzureBoardsWorkItemRelation): number | undefined {
    const value = relation.url?.trim();
    if (!value) return undefined;
    const match = /\/workItems\/(\d+)(?:\?|$)/i.exec(value);
    if (!match) return undefined;
    const id = Number.parseInt(match[1], 10);
    return Number.isInteger(id) && id > 0 ? id : undefined;
}

function childWorkItemIds(item: Pick<AzureBoardsWorkItem, 'relations'>): number[] {
    return (item.relations ?? [])
        .filter(relation => relation.rel === 'System.LinkTypes.Hierarchy-Forward')
        .map(relationWorkItemId)
        .filter((id): id is number => id !== undefined);
}

function parentWorkItemId(item: Pick<AzureBoardsWorkItem, 'relations'>): number | undefined {
    return (item.relations ?? [])
        .filter(relation => relation.rel === 'System.LinkTypes.Hierarchy-Reverse')
        .map(relationWorkItemId)
        .find((id): id is number => id !== undefined);
}

/**
 * Read the parent Azure Boards work item id from a remote work item's
 * `Hierarchy-Reverse` relation, or `undefined` when the item has no parent
 * (i.e. it is an Epic-tree root). Exposed for conflict detection so callers can
 * map the remote parent back to a local mirror id.
 */
export function azureBoardsParentWorkItemId(item: Pick<AzureBoardsWorkItem, 'relations'>): number | undefined {
    return parentWorkItemId(item);
}

function azureBoardsMirrorForWorkItem(
    item: AzureBoardsWorkItem,
    pulledAt: string,
): WorkItemAzureBoardsMirrorMetadata {
    return {
        workItemId: item.id,
        workItemUrl: item.url,
        revision: item.revision,
        workItemType: item.workItemType,
        state: item.state,
        updatedAt: item.updatedAt,
        lastPulledAt: pulledAt,
        lastSyncedLocalFingerprint: azureBoardsLocalFingerprintForRemoteWorkItem(item),
    };
}

export function azureBoardsRemoteWorkItemIdForLocalItem(item: WorkItem): number | undefined {
    return item.azureBoardsMirror?.workItemId
        ?? (item.tracker?.kind === 'azure-boards-backed' && item.tracker.provider === 'azure-boards'
            ? item.tracker.azureBoards.workItemId
            : undefined);
}

function azureBoardsBackedTrackerForRoot(item: AzureBoardsWorkItem, pulledAt: string): WorkItem['tracker'] {
    return {
        kind: 'azure-boards-backed',
        provider: 'azure-boards',
        azureBoards: {
            workItemId: item.id,
            workItemUrl: item.url,
            revision: item.revision,
            updatedAt: item.updatedAt,
            lastPulledAt: pulledAt,
        },
    };
}

function sameAzureBoardsMirror(
    mirror: WorkItem['azureBoardsMirror'] | undefined,
    remote: Pick<AzureBoardsWorkItem, 'id' | 'url'>,
): boolean {
    if (!mirror) return false;
    if (mirror.workItemId === remote.id) return true;
    return Boolean(mirror.workItemUrl && remote.url && mirror.workItemUrl === remote.url);
}

async function findLocalMirrorForAzureBoardsWorkItem(
    context: { workspaceId: string; workItemStore: WorkItemStore },
    entries: readonly WorkItemIndexEntry[],
    remote: AzureBoardsWorkItem,
): Promise<WorkItem | undefined> {
    const entry = entries.find(candidate =>
        sameAzureBoardsMirror(candidate.azureBoardsMirror, remote)
        || (
            candidate.tracker?.kind === 'azure-boards-backed'
            && candidate.tracker.provider === 'azure-boards'
            && candidate.tracker.azureBoards.workItemId === remote.id
        ),
    );
    return entry ? context.workItemStore.getWorkItem(entry.id, context.workspaceId) : undefined;
}

function tagsForAzureBoardsMirror(remote: AzureBoardsWorkItem): string[] | undefined {
    const typeMapping = mapAzureBoardsTypeToCocWorkItemType(remote.workItemType, remote.tags);
    const priorityMapping = mapAzureBoardsPriorityToWorkItemPriority(remote.priority);
    const tags: string[] = [];
    const seen = new Set<string>();
    for (const tag of [...typeMapping.tags, ...priorityMapping.tags]) {
        const trimmed = tag.trim();
        if (!trimmed) continue;
        const key = trimmed.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        tags.push(trimmed);
    }
    return tags.length > 0 ? tags : undefined;
}

function mirrorTypeForAzureBoardsWorkItem(remote: AzureBoardsWorkItem, rootId: number): WorkItemType {
    if (remote.id === rootId) return 'epic';
    return mapAzureBoardsTypeToCocWorkItemType(remote.workItemType, remote.tags).type;
}

function priorityForAzureBoardsWorkItem(remote: AzureBoardsWorkItem) {
    return mapAzureBoardsPriorityToWorkItemPriority(remote.priority).priority;
}

interface AzureBoardsLocalFingerprintFields {
    title: string;
    description: string;
    status: WorkItemStatus;
    priority?: WorkItemPriority;
    tags?: readonly string[];
    parentWorkItemId?: number | null;
}

function normalizedFingerprintTags(tags: readonly string[] | undefined): string[] {
    return parseAzureBoardsTags(tags)
        .map(tag => tag.trim())
        .filter(Boolean)
        .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()) || a.localeCompare(b));
}

function azureBoardsLocalFingerprint(fields: AzureBoardsLocalFingerprintFields): string {
    const normalized = {
        title: fields.title,
        description: fields.description,
        status: fields.status,
        priority: fields.priority ?? null,
        tags: normalizedFingerprintTags(fields.tags),
        parentWorkItemId: fields.parentWorkItemId ?? null,
    };
    return crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

function azureBoardsLocalFingerprintForRemoteWorkItem(remote: AzureBoardsWorkItem): string {
    return azureBoardsLocalFingerprint({
        title: remote.title,
        description: remote.description ?? '',
        status: mapAzureBoardsStateToWorkItemStatus(remote.state),
        priority: priorityForAzureBoardsWorkItem(remote),
        tags: tagsForAzureBoardsMirror(remote),
        parentWorkItemId: parentWorkItemId(remote) ?? null,
    });
}

function azureBoardsRemoteChangedSinceLastMirror(existing: WorkItem, remote: AzureBoardsWorkItem): boolean {
    const mirror = existing.azureBoardsMirror;
    if (!mirror) return false;
    if (mirror.revision !== undefined && remote.revision !== undefined && mirror.revision !== remote.revision) {
        return true;
    }
    return Boolean(mirror.updatedAt && remote.updatedAt && mirror.updatedAt !== remote.updatedAt);
}

async function localParentAzureBoardsWorkItemId(
    context: { workspaceId: string; workItemStore: WorkItemStore },
    item: WorkItem,
): Promise<number | null> {
    if (!item.parentId) return null;
    const parent = await context.workItemStore.getWorkItem(item.parentId, context.workspaceId);
    return parent ? azureBoardsRemoteWorkItemIdForLocalItem(parent) ?? null : null;
}

async function azureBoardsRemoteWinsWarningForExistingItem(
    context: { workspaceId: string; workItemStore: WorkItemStore },
    existing: WorkItem,
    remote: AzureBoardsWorkItem,
): Promise<AzureBoardsSyncWarning | undefined> {
    const mirror = existing.azureBoardsMirror;
    if (!mirror?.lastSyncedLocalFingerprint || !azureBoardsRemoteChangedSinceLastMirror(existing, remote)) {
        return undefined;
    }
    const currentFingerprint = azureBoardsLocalFingerprint({
        title: existing.title,
        description: existing.description ?? '',
        status: existing.status,
        priority: existing.priority,
        tags: existing.tags,
        parentWorkItemId: await localParentAzureBoardsWorkItemId(context, existing),
    });
    if (currentFingerprint === mirror.lastSyncedLocalFingerprint) {
        return undefined;
    }
    return {
        provider: 'azure-boards',
        code: 'remote-wins-conflict',
        workItemId: existing.id,
        remoteWorkItemId: remote.id,
        fields: AZURE_BOARDS_REMOTE_WINS_FIELDS,
        message: `Azure Boards work item ${remote.id} changed remotely while local Azure-owned fields had unsynced edits; Azure Boards values were applied.`,
        localUpdatedAt: existing.updatedAt,
        lastPulledAt: mirror.lastPulledAt,
        previousRevision: mirror.revision,
        remoteRevision: remote.revision,
        previousUpdatedAt: mirror.updatedAt,
        remoteUpdatedAt: remote.updatedAt,
    };
}

function azureBoardsInputFieldsForLocalItem(item: WorkItem) {
    const typeMapping = mapCocWorkItemTypeToAzureBoardsType({
        type: item.type,
        tags: item.tags,
    });
    return {
        workItemType: typeMapping.workItemType,
        title: item.title,
        description: item.description ?? '',
        state: mapWorkItemStatusToAzureBoardsState(item.status),
        priority: mapWorkItemPriorityToAzureBoardsPriority(item.priority),
        tags: formatAzureBoardsTags(typeMapping.tags),
    };
}

export async function createAzureBoardsWorkItemForLocalChild(
    options: CreateAzureBoardsWorkItemForLocalChildOptions,
): Promise<CreateAzureBoardsWorkItemForLocalChildResult> {
    const syncedAt = (options.now ?? (() => new Date().toISOString()))();
    const parentWorkItemId = azureBoardsRemoteWorkItemIdForLocalItem(options.parent);
    if (parentWorkItemId === undefined) {
        throw new Error(`Parent work item '${options.parent.id}' is not mirrored to Azure Boards.`);
    }
    const created = await options.transport.createWorkItem(options.project, {
        ...azureBoardsInputFieldsForLocalItem(options.item),
        parentWorkItemId,
    });
    return {
        workItem: created,
        azureBoardsMirror: azureBoardsMirrorForWorkItem(created, syncedAt),
    };
}

export async function updateAzureBoardsWorkItemForLocalMirror(
    options: UpdateAzureBoardsWorkItemForLocalMirrorOptions,
): Promise<UpdateAzureBoardsWorkItemForLocalMirrorResult> {
    const syncedAt = (options.now ?? (() => new Date().toISOString()))();
    const input: AzureBoardsWorkItemUpdateInput = {
        ...azureBoardsInputFieldsForLocalItem(options.item),
        expectedRevision: options.expectedRevision,
    };
    if (Object.prototype.hasOwnProperty.call(options, 'parentWorkItemId')) {
        input.parentWorkItemId = options.parentWorkItemId;
    }
    const updated = await options.transport.updateWorkItem(
        options.project,
        options.remoteWorkItemId,
        input,
    );
    return {
        workItem: updated,
        azureBoardsMirror: azureBoardsMirrorForWorkItem(updated, syncedAt),
    };
}

function collectLocalTreeEntries(
    entries: readonly WorkItemIndexEntry[],
    rootId: string,
): Array<{ entry: WorkItemIndexEntry; depth: number }> {
    const childrenByParent = new Map<string, WorkItemIndexEntry[]>();
    for (const entry of entries) {
        if (!entry.parentId) continue;
        const children = childrenByParent.get(entry.parentId) ?? [];
        children.push(entry);
        childrenByParent.set(entry.parentId, children);
    }

    const result: Array<{ entry: WorkItemIndexEntry; depth: number }> = [];
    const stack = [{ id: rootId, depth: 0 }];
    const visited = new Set<string>();
    while (stack.length > 0) {
        const current = stack.pop()!;
        if (visited.has(current.id)) continue;
        visited.add(current.id);
        for (const child of childrenByParent.get(current.id) ?? []) {
            result.push({ entry: child, depth: current.depth + 1 });
            stack.push({ id: child.id, depth: current.depth + 1 });
        }
    }
    return result;
}

async function pruneMissingAzureBoardsMirrorItems(
    context: { workspaceId: string; workItemStore: WorkItemStore },
    rootId: string,
    currentWorkItemIds: ReadonlySet<number>,
): Promise<{ deleted: number; deletedItemIds: string[] }> {
    const entries = (await context.workItemStore.listWorkItems({ repoId: context.workspaceId })).items;
    const descendants = collectLocalTreeEntries(entries, rootId);
    const toDelete = descendants.filter(({ entry }) =>
        entry.azureBoardsMirror?.workItemId !== undefined
        && !currentWorkItemIds.has(entry.azureBoardsMirror.workItemId),
    );
    if (toDelete.length === 0) {
        return { deleted: 0, deletedItemIds: [] };
    }

    const deleteIds = new Set(toDelete.map(({ entry }) => entry.id));
    for (const { entry } of descendants) {
        if (entry.parentId && deleteIds.has(entry.parentId) && !deleteIds.has(entry.id)) {
            await context.workItemStore.updateWorkItem(entry.id, { parentId: undefined });
        }
    }

    const deletedItemIds: string[] = [];
    for (const { entry } of [...toDelete].sort((a, b) => b.depth - a.depth)) {
        if (await context.workItemStore.removeWorkItem(entry.id)) {
            deletedItemIds.push(entry.id);
        }
    }

    return { deleted: deletedItemIds.length, deletedItemIds };
}

export async function deleteAzureBoardsEpicMirrorTree(
    context: { workspaceId: string; workItemStore: WorkItemStore },
    rootId: string,
): Promise<{ deleted: number; deletedItemIds: string[] }> {
    const entries = (await context.workItemStore.listWorkItems({ repoId: context.workspaceId })).items;
    const rootEntry = entries.find(entry => entry.id === rootId);
    if (!rootEntry) {
        return { deleted: 0, deletedItemIds: [] };
    }

    const tree = [
        { entry: rootEntry, depth: 0 },
        ...collectLocalTreeEntries(entries, rootId),
    ];
    const toDelete = tree.filter(({ entry }) =>
        entry.azureBoardsMirror?.workItemId !== undefined
        || (entry.id === rootId && entry.tracker?.kind === 'azure-boards-backed' && entry.tracker.provider === 'azure-boards'),
    );
    if (toDelete.length === 0) {
        return { deleted: 0, deletedItemIds: [] };
    }

    const deleteIds = new Set(toDelete.map(({ entry }) => entry.id));
    for (const { entry } of tree) {
        if (entry.parentId && deleteIds.has(entry.parentId) && !deleteIds.has(entry.id)) {
            await context.workItemStore.updateWorkItem(entry.id, { parentId: undefined });
        }
    }

    const deletedItemIds: string[] = [];
    for (const { entry } of [...toDelete].sort((a, b) => b.depth - a.depth)) {
        if (await context.workItemStore.removeWorkItem(entry.id)) {
            deletedItemIds.push(entry.id);
        }
    }

    return { deleted: deletedItemIds.length, deletedItemIds };
}

export async function importAzureBoardsEpicTreeAsWorkItems(
    context: { workspaceId: string; workItemStore: WorkItemStore },
    rootWorkItem: AzureBoardsWorkItem,
    treeWorkItems: readonly AzureBoardsWorkItem[],
    now?: () => string,
    options: ImportAzureBoardsEpicTreeOptions = {},
): Promise<ImportAzureBoardsEpicTreeResult> {
    const pulledAt = (now ?? (() => new Date().toISOString()))();
    const byRemoteId = new Map<number, AzureBoardsWorkItem>();
    for (const remote of [rootWorkItem, ...treeWorkItems]) {
        if (!byRemoteId.has(remote.id)) {
            byRemoteId.set(remote.id, remote);
        }
    }
    const ordered = Array.from(byRemoteId.values());
    const index = (await context.workItemStore.listWorkItems({ repoId: context.workspaceId })).items;
    const localByRemoteId = new Map<number, string>();
    const localById = new Map<string, WorkItem>();
    const items: WorkItem[] = [];
    let created = 0;
    let updated = 0;
    const warnings: AzureBoardsSyncWarning[] = [];

    for (const remote of ordered) {
        const existing = await findLocalMirrorForAzureBoardsWorkItem(context, index, remote);
        const warning = existing
            ? await azureBoardsRemoteWinsWarningForExistingItem(context, existing, remote)
            : undefined;
        if (warning) warnings.push(warning);
        const type = mirrorTypeForAzureBoardsWorkItem(remote, rootWorkItem.id);
        const remoteParentId = remote.id === rootWorkItem.id ? undefined : parentWorkItemId(remote);
        const proposedParentId = remoteParentId !== undefined ? localByRemoteId.get(remoteParentId) : undefined;
        const parent = proposedParentId
            ? localById.get(proposedParentId) ?? await context.workItemStore.getWorkItem(proposedParentId, context.workspaceId)
            : undefined;
        const parentId = parent && isValidParentChildTypes(type, getEffectiveType(parent.type))
            ? parent.id
            : undefined;
        const isRoot = remote.id === rootWorkItem.id;
        const desiredId = existing?.id ?? crypto.randomUUID();
        const commonFields = {
            title: remote.title,
            description: remote.description ?? '',
            status: mapAzureBoardsStateToWorkItemStatus(remote.state),
            type,
            parentId,
            tracker: isRoot ? azureBoardsBackedTrackerForRoot(remote, pulledAt) : undefined,
            azureBoardsMirror: azureBoardsMirrorForWorkItem(remote, pulledAt),
            tags: tagsForAzureBoardsMirror(remote),
            priority: priorityForAzureBoardsWorkItem(remote),
        };

        let item: WorkItem;
        if (existing) {
            item = await context.workItemStore.updateWorkItem(existing.id, commonFields) ?? {
                ...existing,
                ...commonFields,
            };
            updated++;
        } else {
            item = {
                id: desiredId,
                repoId: context.workspaceId,
                ...commonFields,
                createdAt: pulledAt,
                updatedAt: pulledAt,
                source: 'manual',
            };
            await context.workItemStore.addWorkItem(item);
            created++;
        }

        localByRemoteId.set(remote.id, item.id);
        localById.set(item.id, item);
        items.push(item);
    }

    const root = items.find(item => item.azureBoardsMirror?.workItemId === rootWorkItem.id);
    if (!root) {
        throw new Error(`Azure Boards work item ${rootWorkItem.id} was not imported as the Epic root.`);
    }
    const pruneResult = options.pruneMissing
        ? await pruneMissingAzureBoardsMirrorItems(
            context,
            root.id,
            new Set(ordered.map(item => item.id)),
        )
        : { deleted: 0, deletedItemIds: [] };
    return { root, items, created, updated, warnings, ...pruneResult };
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
            const project = context.preferences.workItems?.sync?.azureBoards?.project?.trim();
            const remoteProject = azureBoardsProjectFromRemoteUrl(context.workspace?.remoteUrl);
            if (remoteProject) {
                const orgMismatches = orgUrl ? !sameOrganization(orgUrl, remoteProject.organizationUrl) : false;
                const projectMismatches = project ? !sameProject(project, remoteProject.project) : false;
                if (orgMismatches || projectMismatches) {
                    return azureBoardsConfigMismatchStatus(remoteProject, orgUrl, project);
                }

                const accessToken = await resolveAccessToken();
                if (!accessToken) return authUnavailableStatus(remoteProject.organizationUrl, remoteProject.project, remoteProject.source);

                return availableStatus(remoteProject.organizationUrl, remoteProject.project, remoteProject.source);
            }

            if (!orgUrl) return missingOrgUrlStatus();
            if (!project) return missingProjectStatus(orgUrl);

            const accessToken = await resolveAccessToken();
            if (!accessToken) return authUnavailableStatus(orgUrl, project, 'preference');

            return availableStatus(orgUrl, project, 'preference');
        },
    };
}
