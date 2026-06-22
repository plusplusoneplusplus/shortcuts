import * as http from 'http';
import * as url from 'url';
import { detectRemoteUrl, type ProcessStore, type WorkspaceInfo } from '@plusplusoneplusplus/forge';
import {
    type WorkItemSyncDisabledReason,
    type WorkItemSyncProvider as WorkItemSyncProviderName,
    type WorkItemSyncProviderStatus,
    type WorkItemSyncStatusResponse,
} from '@plusplusoneplusplus/coc-client';
import type { Route } from '../types';
import { sendJSON, parseBody } from '../core/api-handler';
import { APIError, badRequest, handleAPIError, notFound } from '../errors';
import { readRepoPreferences } from '../preferences-handler';
import type { WorkItemStore } from '../work-items/types';
import {
    DEFAULT_WORK_ITEM_SYNC_PROVIDER,
    SUPPORTED_WORK_ITEM_SYNC_PROVIDERS,
    WORK_ITEM_SYNC_MAX_ITEMS,
    detectWorkItemSyncProviderFromRemoteUrl,
    isSupportedWorkItemSyncProvider,
    unavailableWorkItemSyncProviderStatus,
    type WorkItemSyncProviderAdapter,
    type WorkItemSyncProviderContext,
} from '../work-items/work-item-sync-provider';
import {
    AzureBoardsRestWorkItemTransport,
    azureBoardsProjectFromStatus,
    azureBoardsWorkItemIdFromUrl,
    azureBoardsWorkItemReferenceFromUrl,
    importAzureBoardsEpicTreeAsWorkItems,
    type AvailableAzureBoardsWorkItemSyncProject,
    type AzureBoardsWorkItemTransport,
} from '../work-items/work-item-sync-azure-boards-provider';
import {
    GhCliGitHubWorkItemIssueTransport,
    convertLocalEpicTreeToGitHubBacked,
    detachGitHubEpicTreeToLocalOnly,
    importGitHubEpicTreeAsWorkItems,
    type AvailableGitHubWorkItemSyncRepo,
    type GitHubWorkItemIssueTransport,
} from '../work-items/work-item-sync-github-provider';
import { parseGitHubWorkItemIssue } from '../work-items/work-item-sync-github-issue';
import type { WorkItem } from '../work-items/types';
import {
    clearWorkItemResponseCacheForWorkspace,
    getOrRefreshWorkItemResponseCacheEntry,
    makeWorkItemSyncStatusResponseCacheKey,
} from '../work-items/work-item-response-cache';
import {
    queryWorkspaceId,
    resolveWorkItemRouteScope,
    type WorkItemRouteScope,
    type WorkItemRouteScopeKind,
} from './work-item-route-scope';

const WORK_ITEM_SYNC_STATUS_PATTERN = /^\/api\/(workspaces|origins)\/([^/]+)\/work-items\/sync\/status$/;
const WORK_ITEM_IMPORT_FROM_GITHUB_PATTERN = /^\/api\/(workspaces|origins)\/([^/]+)\/work-items\/import-from-github$/;
const WORK_ITEM_IMPORT_FROM_AZURE_BOARDS_PATTERN = /^\/api\/(workspaces|origins)\/([^/]+)\/work-items\/import-from-azure-boards$/;
const WORK_ITEM_CONVERT_TO_GITHUB_PATTERN = /^\/api\/(workspaces|origins)\/([^/]+)\/work-items\/([^/]+)\/convert-to-github$/;
const WORK_ITEM_CONVERT_TO_LOCAL_PATTERN = /^\/api\/(workspaces|origins)\/([^/]+)\/work-items\/([^/]+)\/convert-to-local$/;

export interface WorkItemSyncRouteContext {
    routes: Route[];
    workItemStore: WorkItemStore;
    processStore: ProcessStore;
    dataDir: string;
    getHierarchyEnabled: () => boolean;
    getSyncEnabled: () => boolean;
    providers?: WorkItemSyncProviderAdapter[];
    /** Override GitHub transport for testing. Defaults to GhCliGitHubWorkItemIssueTransport. */
    githubTransport?: GitHubWorkItemIssueTransport;
    /** Override Azure Boards transport for testing. Defaults to AzureBoardsRestWorkItemTransport. */
    azureBoardsTransport?: AzureBoardsWorkItemTransport;
    /** Notify background poll infrastructure that this workspace's GitHub-backed roots changed. */
    onGitHubBackedEpicTreeChanged?: (workspaceId: string) => void | Promise<void>;
    /** Notify background poll infrastructure that this workspace's Azure Boards-backed roots changed. */
    onAzureBoardsBackedEpicTreeChanged?: (workspaceId: string) => void | Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown, path: string): string | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== 'string') {
        throw badRequest(`${path} must be a string`);
    }
    const trimmed = value.trim();
    return trimmed || undefined;
}

function optionalPositiveInteger(value: unknown, path: string): number | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
        throw badRequest(`${path} must be a positive integer`);
    }
    return value;
}

function parseProvider(value: unknown): WorkItemSyncProviderName {
    if (value === undefined) return DEFAULT_WORK_ITEM_SYNC_PROVIDER;
    if (typeof value !== 'string' || !isSupportedWorkItemSyncProvider(value)) {
        throw badRequest(`provider must be one of: ${SUPPORTED_WORK_ITEM_SYNC_PROVIDERS.join(', ')}`);
    }
    return value;
}

async function parseJsonObjectBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
    let body: unknown;
    try {
        body = await parseBody(req);
    } catch {
        throw badRequest('Invalid JSON body');
    }
    if (!isRecord(body)) {
        throw badRequest('Request body must be a JSON object');
    }
    return body;
}

function bodyWorkspaceId(body: unknown): string | undefined {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined;
    const raw = (body as Record<string, unknown>).workspaceId;
    return typeof raw === 'string' && raw.trim() ? raw.trim() : undefined;
}

async function resolveSyncRouteScope(
    ctx: Pick<WorkItemSyncRouteContext, 'processStore'>,
    req: http.IncomingMessage,
    kind: WorkItemRouteScopeKind,
    routeScopeId: string,
    body?: unknown,
): Promise<WorkItemRouteScope> {
    const workspaceId = bodyWorkspaceId(body) ?? queryWorkspaceId(req);
    const scope = await resolveWorkItemRouteScope(
        { processStore: ctx.processStore },
        kind,
        routeScopeId,
        workspaceId,
    );
    if (kind === 'origins' && !scope.workspaceId) {
        throw badRequest('workspaceId is required for origin-scoped Work Item sync routes');
    }
    return scope;
}

function concreteWorkspaceId(scope: WorkItemRouteScope): string {
    if (!scope.workspaceId) {
        throw badRequest('Work Item sync routes require a concrete workspaceId');
    }
    return scope.workspaceId;
}

function disabledReason(ctx: Pick<WorkItemSyncRouteContext, 'getHierarchyEnabled' | 'getSyncEnabled'>): WorkItemSyncDisabledReason | undefined {
    if (!ctx.getHierarchyEnabled()) return 'hierarchy-disabled';
    if (!ctx.getSyncEnabled()) return 'sync-disabled';
    return undefined;
}

function providerUnavailableError(status: WorkItemSyncProviderStatus): APIError {
    return new APIError(
        409,
        status.message ?? `Work item sync provider '${status.provider}' is unavailable.`,
        'WORK_ITEM_SYNC_PROVIDER_UNAVAILABLE',
        { provider: status },
    );
}

function statusResponseForDisabled(reason: WorkItemSyncDisabledReason): WorkItemSyncStatusResponse {
    return {
        enabled: false,
        disabled: true,
        disabledReason: reason,
        maxItems: WORK_ITEM_SYNC_MAX_ITEMS,
        providers: [],
    };
}

export async function buildWorkItemSyncStatusRouteResponse(
    ctx: WorkItemSyncRouteContext,
    workspaceId: string,
    providerName?: WorkItemSyncProviderName,
): Promise<WorkItemSyncStatusResponse> {
    const reason = disabledReason(ctx);
    if (reason) {
        return statusResponseForDisabled(reason);
    }

    const adapters = new Map<WorkItemSyncProviderName, WorkItemSyncProviderAdapter>(
        (ctx.providers ?? []).map(adapter => [adapter.provider, adapter]),
    );

    async function resolveWorkspaceRemote(workspace: WorkspaceInfo | undefined): Promise<WorkspaceInfo | undefined> {
        if (!workspace || workspace.remoteUrl?.trim()) return workspace;
        const remoteUrl = await detectRemoteUrl(workspace.rootPath);
        if (!remoteUrl) return workspace;
        const updated = await ctx.processStore.updateWorkspace(workspace.id, { remoteUrl });
        return updated ?? { ...workspace, remoteUrl };
    }

    async function buildProviderContext(workspaceId: string): Promise<WorkItemSyncProviderContext> {
        const workspaces = await ctx.processStore.getWorkspaces();
        const workspace = await resolveWorkspaceRemote(workspaces.find(candidate => candidate.id === workspaceId));
        return {
            workspaceId,
            workspace,
            preferences: readRepoPreferences(ctx.dataDir, workspaceId),
        };
    }

    async function getProviderStatus(provider: WorkItemSyncProviderName, context: WorkItemSyncProviderContext): Promise<WorkItemSyncProviderStatus> {
        const adapter = adapters.get(provider);
        if (!adapter) {
            return unavailableWorkItemSyncProviderStatus(provider);
        }
        return adapter.getStatus(context);
    }

    const providerContext = await buildProviderContext(workspaceId);
    const remoteProvider = detectWorkItemSyncProviderFromRemoteUrl(providerContext.workspace?.remoteUrl);
    const providerNames = providerName
        ? [providerName]
        : remoteProvider ? [remoteProvider] : [];
    const providers = await Promise.all(providerNames.map(provider => getProviderStatus(provider, providerContext)));
    return {
        enabled: true,
        disabled: false,
        maxItems: WORK_ITEM_SYNC_MAX_ITEMS,
        remoteProvider,
        provider: providers[0],
        providers,
    };
}

export function registerWorkItemSyncRoutes(ctx: WorkItemSyncRouteContext): void {
    const adapters = new Map<WorkItemSyncProviderName, WorkItemSyncProviderAdapter>(
        (ctx.providers ?? []).map(adapter => [adapter.provider, adapter]),
    );

    async function resolveWorkspaceRemote(workspace: WorkspaceInfo | undefined): Promise<WorkspaceInfo | undefined> {
        if (!workspace || workspace.remoteUrl?.trim()) return workspace;
        const remoteUrl = await detectRemoteUrl(workspace.rootPath);
        if (!remoteUrl) return workspace;
        const updated = await ctx.processStore.updateWorkspace(workspace.id, { remoteUrl });
        return updated ?? { ...workspace, remoteUrl };
    }

    async function buildProviderContext(workspaceId: string): Promise<WorkItemSyncProviderContext> {
        const workspaces = await ctx.processStore.getWorkspaces();
        const workspace = await resolveWorkspaceRemote(workspaces.find(candidate => candidate.id === workspaceId));
        return {
            workspaceId,
            workspace,
            preferences: readRepoPreferences(ctx.dataDir, workspaceId),
        };
    }

    async function getProviderStatus(provider: WorkItemSyncProviderName, context: WorkItemSyncProviderContext): Promise<WorkItemSyncProviderStatus> {
        const adapter = adapters.get(provider);
        if (!adapter) {
            return unavailableWorkItemSyncProviderStatus(provider);
        }
        return adapter.getStatus(context);
    }

    function notifyGitHubBackedEpicTreeChanged(workspaceId: string): void {
        if (!ctx.onGitHubBackedEpicTreeChanged) return;
        Promise.resolve(ctx.onGitHubBackedEpicTreeChanged(workspaceId)).catch(error => {
            const message = error instanceof Error ? error.message : String(error);
            process.stderr.write(`[work-items/github-poll] Failed to reconfigure workspace '${workspaceId}': ${message}\n`);
        });
    }

    function notifyAzureBoardsBackedEpicTreeChanged(workspaceId: string): void {
        if (!ctx.onAzureBoardsBackedEpicTreeChanged) return;
        Promise.resolve(ctx.onAzureBoardsBackedEpicTreeChanged(workspaceId)).catch(error => {
            const message = error instanceof Error ? error.message : String(error);
            process.stderr.write(`[work-items/azure-boards-poll] Failed to reconfigure workspace '${workspaceId}': ${message}\n`);
        });
    }

    async function loadRootEpic(workspaceId: string, workItemId: string, action: string): Promise<WorkItem> {
        const root = await ctx.workItemStore.getWorkItem(workItemId, workspaceId);
        if (!root) {
            throw notFound(`Work item '${workItemId}'`);
        }
        if (root.type !== 'epic' || root.parentId) {
            throw badRequest(`${action} must be run from a root Epic work item.`);
        }
        return root;
    }

    async function resolveAvailableGitHubRepo(workspaceId: string): Promise<{
        context: WorkItemSyncProviderContext;
        repo: AvailableGitHubWorkItemSyncRepo;
    }> {
        const providerContext = await buildProviderContext(workspaceId);
        const adapter = adapters.get('github');
        const status = adapter
            ? await adapter.getStatus(providerContext)
            : unavailableWorkItemSyncProviderStatus('github');

        if (!status.available) {
            throw providerUnavailableError(status);
        }

        const configuredOwner = status.repository?.owner;
        const configuredRepo = status.repository?.repo;
        if (!configuredOwner || !configuredRepo) {
            throw providerUnavailableError(status);
        }

        return {
            context: providerContext,
            repo: {
                available: true,
                provider: 'github',
                owner: configuredOwner,
                repo: configuredRepo,
                url: status.repository?.url ?? `https://github.com/${configuredOwner}/${configuredRepo}`,
                source: (status.repository?.source as 'preference' | 'workspaceRemote' | 'origin') ?? 'origin',
            },
        };
    }

    async function resolveAvailableAzureBoardsProject(workspaceId: string): Promise<{
        context: WorkItemSyncProviderContext;
        project: AvailableAzureBoardsWorkItemSyncProject;
    }> {
        const providerContext = await buildProviderContext(workspaceId);
        const status = await getProviderStatus('azure-boards', providerContext);
        if (!status.available) {
            throw providerUnavailableError(status);
        }
        const project = azureBoardsProjectFromStatus(status);
        if (!project) {
            throw providerUnavailableError(status);
        }
        return { context: providerContext, project };
    }

    function azureBoardsWorkItemUrlErrorMessage(
        workItemUrlValue: string,
        project: AvailableAzureBoardsWorkItemSyncProject,
    ): string {
        const reference = azureBoardsWorkItemReferenceFromUrl(workItemUrlValue);
        if (!reference) {
            return 'workItemUrl must be a valid Azure Boards work item URL: https://dev.azure.com/<org>/<project>/_workitems/edit/<id>';
        }

        const contextLabel = project.source === 'workspaceRemote'
            ? 'current workspace repository remote'
            : 'workspace Azure Boards configuration';
        return `Azure Boards work item URL belongs to organization '${reference.organizationUrl}' and project '${reference.project}', but the ${contextLabel} resolves to organization '${project.organizationUrl}' and project '${project.project}'. Paste a work item URL from the current workspace Azure Boards project.`;
    }

    // GET /api/origins/:originId/work-items/sync/status?workspaceId=:workspaceId
    ctx.routes.push({
        method: 'GET',
        pattern: WORK_ITEM_SYNC_STATUS_PATTERN,
        handler: async (req: http.IncomingMessage, res: http.ServerResponse, match?: RegExpMatchArray) => {
            try {
                const routeKind = match![1] as WorkItemRouteScopeKind;
                const routeScopeId = decodeURIComponent(match![2]);
                const scope = await resolveSyncRouteScope(ctx, req, routeKind, routeScopeId);
                const workspaceId = concreteWorkspaceId(scope);
                const reason = disabledReason(ctx);
                if (reason) {
                    return sendJSON(res, 200, statusResponseForDisabled(reason));
                }

                const parsed = url.parse(req.url ?? '/', true);
                const queryProvider = typeof parsed.query.provider === 'string' ? parsed.query.provider : undefined;
                const requestedProvider = queryProvider ? parseProvider(queryProvider) : undefined;
                const force = parsed.query.force === 'true';
                const response = await getOrRefreshWorkItemResponseCacheEntry(
                    makeWorkItemSyncStatusResponseCacheKey(workspaceId, requestedProvider),
                    workspaceId,
                    'sync-status',
                    force,
                    () => buildWorkItemSyncStatusRouteResponse(ctx, workspaceId, requestedProvider),
                );
                return sendJSON(res, 200, response);
            } catch (error) {
                return handleAPIError(res, error);
            }
        },
    });

    // POST /api/origins/:originId/work-items/import-from-github
    ctx.routes.push({
        method: 'POST',
        pattern: WORK_ITEM_IMPORT_FROM_GITHUB_PATTERN,
        handler: async (req: http.IncomingMessage, res: http.ServerResponse, match?: RegExpMatchArray) => {
            try {
                const routeKind = match![1] as WorkItemRouteScopeKind;
                const routeScopeId = decodeURIComponent(match![2]);
                const body = await parseJsonObjectBody(req);
                const scope = await resolveSyncRouteScope(ctx, req, routeKind, routeScopeId, body);
                const workspaceId = concreteWorkspaceId(scope);
                const storageRepoId = scope.storageRepoId;

                const { repo } = await resolveAvailableGitHubRepo(workspaceId);
                const configuredOwner = repo.owner;
                const configuredRepo = repo.repo;

                const issueUrl = optionalString(body.issueUrl, 'issueUrl');
                const explicitIssueNumber = optionalPositiveInteger(body.issueNumber, 'issueNumber');
                if (!issueUrl && explicitIssueNumber === undefined) {
                    throw badRequest('Either issueUrl or issueNumber is required');
                }

                let issueNumber = explicitIssueNumber;
                if (issueUrl) {
                    const urlMatch = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)\/?$/i.exec(issueUrl);
                    if (!urlMatch) {
                        throw badRequest(
                            'issueUrl must be a valid GitHub issue URL: https://github.com/<owner>/<repo>/issues/<number>',
                        );
                    }
                    const [, urlOwner, urlRepo, issueNumberStr] = urlMatch;
                    const urlIssueNumber = parseInt(issueNumberStr, 10);
                    if (
                        urlOwner.toLowerCase() !== configuredOwner.toLowerCase() ||
                        urlRepo.toLowerCase() !== configuredRepo.toLowerCase()
                    ) {
                        throw badRequest(
                            `Issue URL repo (${urlOwner}/${urlRepo}) does not match the workspace-configured GitHub repo (${configuredOwner}/${configuredRepo})`,
                        );
                    }
                    if (issueNumber !== undefined && issueNumber !== urlIssueNumber) {
                        throw badRequest('issueNumber must match the issue number in issueUrl');
                    }
                    issueNumber = urlIssueNumber;
                }
                const resolvedIssueNumber = issueNumber;
                if (resolvedIssueNumber === undefined) {
                    throw badRequest('Either issueUrl or issueNumber is required');
                }

                const allItems = await ctx.workItemStore.listWorkItems({ repoId: storageRepoId });
                const duplicate = allItems.items.find(item =>
                    item.githubMirror?.issueNumber === resolvedIssueNumber ||
                    (
                        item.tracker?.kind === 'github-backed' &&
                        item.tracker.github.issueNumber === resolvedIssueNumber
                    ),
                );
                if (duplicate) {
                    throw new APIError(
                        409,
                        `GitHub issue #${resolvedIssueNumber} is already imported as work item '${duplicate.id}'`,
                        'DUPLICATE_IMPORT',
                        { existingWorkItemId: duplicate.id },
                    );
                }

                const transport = ctx.githubTransport ?? new GhCliGitHubWorkItemIssueTransport();
                const issue = await transport.getIssue(repo, resolvedIssueNumber);
                if (!issue) {
                    throw notFound(`GitHub issue #${resolvedIssueNumber}`);
                }
                const rootType = parseGitHubWorkItemIssue(issue).type ?? 'epic';
                if (rootType !== 'epic') {
                    throw badRequest('A GitHub-backed tree must be imported from a GitHub issue marked as coc:type:epic or with no CoC type metadata.');
                }

                const candidateIssues = await transport.listIssues(repo, { limit: WORK_ITEM_SYNC_MAX_ITEMS });
                const result = await importGitHubEpicTreeAsWorkItems(
                    { workspaceId: storageRepoId, workItemStore: ctx.workItemStore },
                    repo,
                    issue,
                    candidateIssues,
                );
                clearWorkItemResponseCacheForWorkspace(storageRepoId);
                notifyGitHubBackedEpicTreeChanged(workspaceId);

                return sendJSON(res, 201, result.root);
            } catch (error) {
                return handleAPIError(res, error);
            }
        },
    });

    // POST /api/origins/:originId/work-items/import-from-azure-boards
    ctx.routes.push({
        method: 'POST',
        pattern: WORK_ITEM_IMPORT_FROM_AZURE_BOARDS_PATTERN,
        handler: async (req: http.IncomingMessage, res: http.ServerResponse, match?: RegExpMatchArray) => {
            try {
                const routeKind = match![1] as WorkItemRouteScopeKind;
                const routeScopeId = decodeURIComponent(match![2]);
                const body = await parseJsonObjectBody(req);
                const scope = await resolveSyncRouteScope(ctx, req, routeKind, routeScopeId, body);
                const workspaceId = concreteWorkspaceId(scope);
                const storageRepoId = scope.storageRepoId;
                const { project } = await resolveAvailableAzureBoardsProject(workspaceId);

                const workItemUrl = optionalString(body.workItemUrl, 'workItemUrl');
                const explicitWorkItemId = optionalPositiveInteger(body.workItemId, 'workItemId');
                if (!workItemUrl && explicitWorkItemId === undefined) {
                    throw badRequest('Either workItemUrl or workItemId is required');
                }

                let workItemId = explicitWorkItemId;
                if (workItemUrl) {
                    const urlWorkItemId = azureBoardsWorkItemIdFromUrl(workItemUrl, project);
                    if (urlWorkItemId === undefined) {
                        throw badRequest(azureBoardsWorkItemUrlErrorMessage(workItemUrl, project));
                    }
                    if (workItemId !== undefined && workItemId !== urlWorkItemId) {
                        throw badRequest('workItemId must match the work item ID in workItemUrl');
                    }
                    workItemId = urlWorkItemId;
                }
                const resolvedWorkItemId = workItemId;
                if (resolvedWorkItemId === undefined) {
                    throw badRequest('Either workItemUrl or workItemId is required');
                }

                const allItems = await ctx.workItemStore.listWorkItems({ repoId: storageRepoId });
                const duplicate = allItems.items.find(item =>
                    item.azureBoardsMirror?.workItemId === resolvedWorkItemId ||
                    (
                        item.tracker?.kind === 'azure-boards-backed' &&
                        item.tracker.provider === 'azure-boards' &&
                        item.tracker.azureBoards.workItemId === resolvedWorkItemId
                    ),
                );
                if (duplicate) {
                    throw new APIError(
                        409,
                        `Azure Boards work item ${resolvedWorkItemId} is already imported as work item '${duplicate.id}'`,
                        'DUPLICATE_IMPORT',
                        { existingWorkItemId: duplicate.id },
                    );
                }

                const transport = ctx.azureBoardsTransport ?? new AzureBoardsRestWorkItemTransport();
                const tree = await transport.listWorkItemTree(project, resolvedWorkItemId, WORK_ITEM_SYNC_MAX_ITEMS);
                const rootWorkItem = tree.find(item => item.id === resolvedWorkItemId);
                if (!rootWorkItem) {
                    throw notFound(`Azure Boards work item ${resolvedWorkItemId}`);
                }

                const result = await importAzureBoardsEpicTreeAsWorkItems(
                    { workspaceId: storageRepoId, workItemStore: ctx.workItemStore },
                    rootWorkItem,
                    tree,
                );
                clearWorkItemResponseCacheForWorkspace(storageRepoId);
                notifyAzureBoardsBackedEpicTreeChanged(workspaceId);

                return sendJSON(res, 201, result.root);
            } catch (error) {
                return handleAPIError(res, error);
            }
        },
    });

    // POST /api/origins/:originId/work-items/:workItemId/convert-to-github
    ctx.routes.push({
        method: 'POST',
        pattern: WORK_ITEM_CONVERT_TO_GITHUB_PATTERN,
        handler: async (req: http.IncomingMessage, res: http.ServerResponse, match?: RegExpMatchArray) => {
            try {
                const routeKind = match![1] as WorkItemRouteScopeKind;
                const routeScopeId = decodeURIComponent(match![2]);
                const workItemId = decodeURIComponent(match![3]);
                const scope = await resolveSyncRouteScope(ctx, req, routeKind, routeScopeId);
                const workspaceId = concreteWorkspaceId(scope);
                const storageRepoId = scope.storageRepoId;
                const root = await loadRootEpic(storageRepoId, workItemId, 'Local-to-GitHub conversion');
                if (root.tracker?.kind === 'github-backed') {
                    throw badRequest('Work item is already a GitHub-backed Epic root.');
                }

                const { repo } = await resolveAvailableGitHubRepo(workspaceId);
                const transport = ctx.githubTransport ?? new GhCliGitHubWorkItemIssueTransport();
                const result = await convertLocalEpicTreeToGitHubBacked(
                    { workspaceId: storageRepoId, workItemStore: ctx.workItemStore },
                    repo,
                    transport,
                    root.id,
                );
                clearWorkItemResponseCacheForWorkspace(storageRepoId);
                notifyGitHubBackedEpicTreeChanged(workspaceId);
                return sendJSON(res, 200, result);
            } catch (error) {
                return handleAPIError(res, error);
            }
        },
    });

    // POST /api/origins/:originId/work-items/:workItemId/convert-to-local
    ctx.routes.push({
        method: 'POST',
        pattern: WORK_ITEM_CONVERT_TO_LOCAL_PATTERN,
        handler: async (req: http.IncomingMessage, res: http.ServerResponse, match?: RegExpMatchArray) => {
            try {
                const routeKind = match![1] as WorkItemRouteScopeKind;
                const routeScopeId = decodeURIComponent(match![2]);
                const workItemId = decodeURIComponent(match![3]);
                const scope = await resolveSyncRouteScope(ctx, req, routeKind, routeScopeId);
                const workspaceId = concreteWorkspaceId(scope);
                const storageRepoId = scope.storageRepoId;
                const root = await loadRootEpic(storageRepoId, workItemId, 'GitHub-to-local conversion');
                if (root.tracker?.kind !== 'github-backed' || root.tracker.provider !== 'github') {
                    throw badRequest('Work item is not a GitHub-backed Epic root.');
                }

                const result = await detachGitHubEpicTreeToLocalOnly(
                    { workspaceId: storageRepoId, workItemStore: ctx.workItemStore },
                    root.id,
                );
                clearWorkItemResponseCacheForWorkspace(storageRepoId);
                notifyGitHubBackedEpicTreeChanged(workspaceId);
                return sendJSON(res, 200, result);
            } catch (error) {
                return handleAPIError(res, error);
            }
        },
    });

}
