import * as http from 'http';
import * as url from 'url';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import {
    type WorkItemSyncApplyConflictResolution,
    type WorkItemSyncApplyRequest,
    type WorkItemSyncApplyResponse,
    type WorkItemSyncConflictResolution,
    type WorkItemSyncDisabledReason,
    type WorkItemSyncOperation,
    type WorkItemSyncPreviewRequest,
    type WorkItemSyncPreviewResponse,
    type WorkItemSyncProvider as WorkItemSyncProviderName,
    type WorkItemSyncProviderStatus,
    type WorkItemSyncRemoteFilter,
    type WorkItemSyncStatusResponse,
    type WorkItemSyncWarning,
} from '@plusplusoneplusplus/coc-client';
import type { Route } from '../types';
import { sendJSON, parseBody } from '../core/api-handler';
import { APIError, badRequest, forbidden, handleAPIError, notFound } from '../errors';
import { readRepoPreferences } from '../preferences-handler';
import type { WorkItemStore } from '../work-items/types';
import {
    DEFAULT_WORK_ITEM_SYNC_PROVIDER,
    SUPPORTED_WORK_ITEM_SYNC_PROVIDERS,
    WORK_ITEM_SYNC_MAX_ITEMS,
    collectWorkItemSyncScope,
    isSupportedWorkItemSyncProvider,
    unavailableWorkItemSyncProviderStatus,
    type WorkItemSyncProviderAdapter,
    type WorkItemSyncProviderContext,
} from '../work-items/work-item-sync-provider';
import {
    GhCliGitHubWorkItemIssueTransport,
    convertLocalEpicTreeToGitHubBacked,
    deleteGitHubEpicMirrorTree,
    detachGitHubEpicTreeToLocalOnly,
    importGitHubEpicTreeAsWorkItems,
    type AvailableGitHubWorkItemSyncRepo,
    type GitHubWorkItemIssueTransport,
} from '../work-items/work-item-sync-github-provider';
import { parseGitHubWorkItemIssue } from '../work-items/work-item-sync-github-issue';
import type { WorkItem } from '../work-items/types';

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
    /** Notify background poll infrastructure that this workspace's GitHub-backed roots changed. */
    onGitHubBackedEpicTreeChanged?: (workspaceId: string) => void | Promise<void>;
}

const VALID_OPERATIONS: readonly WorkItemSyncOperation[] = ['import', 'export-selected', 'sync-linked'];
const VALID_CONFLICT_RESOLUTIONS: readonly WorkItemSyncConflictResolution[] = ['use-coc', 'use-provider', 'skip'];

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

function optionalBoolean(value: unknown, path: string): boolean | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== 'boolean') {
        throw badRequest(`${path} must be a boolean`);
    }
    return value;
}

function optionalStringArray(value: unknown, path: string): string[] | undefined {
    if (value === undefined) return undefined;
    if (!Array.isArray(value) || value.some(entry => typeof entry !== 'string')) {
        throw badRequest(`${path} must be an array of strings`);
    }
    return value.map(entry => entry.trim()).filter(Boolean);
}

function optionalNumberArray(value: unknown, path: string): number[] | undefined {
    if (value === undefined) return undefined;
    if (!Array.isArray(value) || value.some(entry => typeof entry !== 'number' || !Number.isInteger(entry) || entry <= 0)) {
        throw badRequest(`${path} must be an array of positive integers`);
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

function parseOperation(value: unknown): WorkItemSyncOperation {
    if (typeof value !== 'string' || !VALID_OPERATIONS.includes(value as WorkItemSyncOperation)) {
        throw badRequest(`operation must be one of: ${VALID_OPERATIONS.join(', ')}`);
    }
    return value as WorkItemSyncOperation;
}

function parseFilters(value: unknown): WorkItemSyncRemoteFilter | undefined {
    if (value === undefined) return undefined;
    if (!isRecord(value)) {
        throw badRequest('filters must be an object');
    }
    return {
        owner: optionalString(value.owner, 'filters.owner'),
        repo: optionalString(value.repo, 'filters.repo'),
        issueNumbers: optionalNumberArray(value.issueNumbers, 'filters.issueNumbers'),
        labels: optionalStringArray(value.labels, 'filters.labels'),
        q: optionalString(value.q, 'filters.q'),
    };
}

function parseBaseRequest(body: Record<string, unknown>): WorkItemSyncPreviewRequest {
    const operation = parseOperation(body.operation);
    const request: WorkItemSyncPreviewRequest = {
        provider: parseProvider(body.provider),
        operation,
        selectedWorkItemId: optionalString(body.selectedWorkItemId, 'selectedWorkItemId'),
        includeArchived: optionalBoolean(body.includeArchived, 'includeArchived'),
        filters: parseFilters(body.filters),
    };

    if (operation === 'export-selected' && !request.selectedWorkItemId) {
        throw badRequest('selectedWorkItemId is required for export-selected preview');
    }
    if (request.filters?.issueNumbers && request.filters.issueNumbers.length > WORK_ITEM_SYNC_MAX_ITEMS) {
        throw badRequest(`Work item sync run is limited to ${WORK_ITEM_SYNC_MAX_ITEMS} items; narrow the remote issue filter.`);
    }

    return request;
}

function parseConflictResolutions(value: unknown): WorkItemSyncApplyConflictResolution[] | undefined {
    if (value === undefined) return undefined;
    if (!Array.isArray(value)) {
        throw badRequest('conflictResolutions must be an array');
    }
    return value.map((entry, index) => {
        if (!isRecord(entry)) {
            throw badRequest(`conflictResolutions[${index}] must be an object`);
        }
        const conflictId = optionalString(entry.conflictId, `conflictResolutions[${index}].conflictId`);
        if (!conflictId) {
            throw badRequest(`conflictResolutions[${index}].conflictId is required`);
        }
        const resolution = entry.resolution;
        if (typeof resolution !== 'string' || !VALID_CONFLICT_RESOLUTIONS.includes(resolution as WorkItemSyncConflictResolution)) {
            throw badRequest(`conflictResolutions[${index}].resolution must be one of: ${VALID_CONFLICT_RESOLUTIONS.join(', ')}`);
        }
        return { conflictId, resolution: resolution as WorkItemSyncConflictResolution };
    });
}

function parseApplyRequest(body: Record<string, unknown>): WorkItemSyncApplyRequest {
    const base = parseBaseRequest(body);
    return {
        ...base,
        previewId: optionalString(body.previewId, 'previewId'),
        conflictResolutions: parseConflictResolutions(body.conflictResolutions),
    };
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

function disabledReason(ctx: Pick<WorkItemSyncRouteContext, 'getHierarchyEnabled' | 'getSyncEnabled'>): WorkItemSyncDisabledReason | undefined {
    if (!ctx.getHierarchyEnabled()) return 'hierarchy-disabled';
    if (!ctx.getSyncEnabled()) return 'sync-disabled';
    return undefined;
}

function disabledMessage(reason: WorkItemSyncDisabledReason): string {
    return reason === 'hierarchy-disabled'
        ? 'Work item sync requires workItems.hierarchy.enabled to be true.'
        : 'Work item sync requires workItems.sync.enabled to be true.';
}

function countPreviewRows(response: WorkItemSyncPreviewResponse): number {
    return response.creates.length + response.updates.length + response.links.length + response.noOps.length + response.conflicts.length;
}

function assertRunWithinCap(itemCount: number): void {
    if (itemCount > WORK_ITEM_SYNC_MAX_ITEMS) {
        throw badRequest(`Work item sync run is limited to ${WORK_ITEM_SYNC_MAX_ITEMS} items; ${itemCount} matched. Narrow the scope.`);
    }
}

function providerUnavailableError(status: WorkItemSyncProviderStatus): APIError {
    return new APIError(
        409,
        status.message ?? `Work item sync provider '${status.provider}' is unavailable.`,
        'WORK_ITEM_SYNC_PROVIDER_UNAVAILABLE',
        { provider: status },
    );
}

export function registerWorkItemSyncRoutes(ctx: WorkItemSyncRouteContext): void {
    const adapters = new Map<WorkItemSyncProviderName, WorkItemSyncProviderAdapter>(
        (ctx.providers ?? []).map(adapter => [adapter.provider, adapter]),
    );

    async function buildProviderContext(workspaceId: string): Promise<WorkItemSyncProviderContext> {
        const workspaces = await ctx.processStore.getWorkspaces();
        return {
            workspaceId,
            workspace: workspaces.find(workspace => workspace.id === workspaceId),
            preferences: readRepoPreferences(ctx.dataDir, workspaceId),
            workItemStore: ctx.workItemStore,
        };
    }

    async function getProviderStatus(provider: WorkItemSyncProviderName, context: WorkItemSyncProviderContext): Promise<WorkItemSyncProviderStatus> {
        const adapter = adapters.get(provider);
        if (!adapter) {
            return unavailableWorkItemSyncProviderStatus(provider);
        }
        return adapter.getStatus(context);
    }

    async function ensureProviderAvailable(provider: WorkItemSyncProviderName, context: WorkItemSyncProviderContext): Promise<WorkItemSyncProviderAdapter> {
        const adapter = adapters.get(provider);
        const status = adapter ? await adapter.getStatus(context) : unavailableWorkItemSyncProviderStatus(provider);
        if (!adapter || !status.available) {
            throw providerUnavailableError(status);
        }
        return adapter;
    }

    function ensureEnabledForRun(): void {
        const reason = disabledReason(ctx);
        if (reason) {
            throw forbidden(disabledMessage(reason));
        }
    }

    function notifyGitHubBackedEpicTreeChanged(workspaceId: string): void {
        if (!ctx.onGitHubBackedEpicTreeChanged) return;
        Promise.resolve(ctx.onGitHubBackedEpicTreeChanged(workspaceId)).catch(error => {
            const message = error instanceof Error ? error.message : String(error);
            process.stderr.write(`[work-items/github-poll] Failed to reconfigure workspace '${workspaceId}': ${message}\n`);
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

    function statusResponseForDisabled(reason: WorkItemSyncDisabledReason): WorkItemSyncStatusResponse {
        return {
            enabled: false,
            disabled: true,
            disabledReason: reason,
            maxItems: WORK_ITEM_SYNC_MAX_ITEMS,
            providers: [],
        };
    }

    // GET /api/workspaces/:id/work-items/sync/status
    ctx.routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/work-items\/sync\/status$/,
        handler: async (req: http.IncomingMessage, res: http.ServerResponse, match?: RegExpMatchArray) => {
            try {
                const workspaceId = decodeURIComponent(match![1]);
                const reason = disabledReason(ctx);
                if (reason) {
                    return sendJSON(res, 200, statusResponseForDisabled(reason));
                }

                const parsed = url.parse(req.url ?? '/', true);
                const queryProvider = typeof parsed.query.provider === 'string' ? parsed.query.provider : undefined;
                const providerNames = queryProvider ? [parseProvider(queryProvider)] : SUPPORTED_WORK_ITEM_SYNC_PROVIDERS;
                const providerContext = await buildProviderContext(workspaceId);
                const providers = await Promise.all(providerNames.map(provider => getProviderStatus(provider, providerContext)));
                const response: WorkItemSyncStatusResponse = {
                    enabled: true,
                    disabled: false,
                    maxItems: WORK_ITEM_SYNC_MAX_ITEMS,
                    provider: providers[0],
                    providers,
                };
                return sendJSON(res, 200, response);
            } catch (error) {
                return handleAPIError(res, error);
            }
        },
    });

    // POST /api/workspaces/:id/work-items/sync/preview
    ctx.routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/work-items\/sync\/preview$/,
        handler: async (req: http.IncomingMessage, res: http.ServerResponse, match?: RegExpMatchArray) => {
            try {
                ensureEnabledForRun();
                const workspaceId = decodeURIComponent(match![1]);
                const request = parseBaseRequest(await parseJsonObjectBody(req));
                const provider = request.provider ?? DEFAULT_WORK_ITEM_SYNC_PROVIDER;
                const providerContext = await buildProviderContext(workspaceId);
                const adapter = await ensureProviderAvailable(provider, providerContext);
                const scope = await collectWorkItemSyncScope({
                    workItemStore: ctx.workItemStore,
                    workspaceId,
                    provider,
                    request,
                });
                assertRunWithinCap(scope.items.length);
                const preview = await adapter.preview({
                    ...providerContext,
                    operation: request.operation,
                    request,
                    items: scope.items,
                });
                assertRunWithinCap(Math.max(preview.itemCount, countPreviewRows(preview)));
                const warnings: WorkItemSyncWarning[] = [...scope.warnings, ...preview.warnings];
                return sendJSON(res, 200, { ...preview, warnings });
            } catch (error) {
                return handleAPIError(res, error);
            }
        },
    });

    // POST /api/workspaces/:id/work-items/sync/apply
    ctx.routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/work-items\/sync\/apply$/,
        handler: async (req: http.IncomingMessage, res: http.ServerResponse, match?: RegExpMatchArray) => {
            try {
                ensureEnabledForRun();
                const workspaceId = decodeURIComponent(match![1]);
                const request = parseApplyRequest(await parseJsonObjectBody(req));
                const provider = request.provider ?? DEFAULT_WORK_ITEM_SYNC_PROVIDER;
                const providerContext = await buildProviderContext(workspaceId);
                const adapter = await ensureProviderAvailable(provider, providerContext);
                const scope = await collectWorkItemSyncScope({
                    workItemStore: ctx.workItemStore,
                    workspaceId,
                    provider,
                    request,
                });
                assertRunWithinCap(scope.items.length);
                const result: WorkItemSyncApplyResponse = await adapter.apply({
                    ...providerContext,
                    operation: request.operation,
                    request,
                    items: scope.items,
                });
                const warnings: WorkItemSyncWarning[] = [...scope.warnings, ...result.warnings];
                return sendJSON(res, 200, { ...result, warnings });
            } catch (error) {
                return handleAPIError(res, error);
            }
        },
    });

    // POST /api/workspaces/:id/work-items/import-from-github
    ctx.routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/work-items\/import-from-github$/,
        handler: async (req: http.IncomingMessage, res: http.ServerResponse, match?: RegExpMatchArray) => {
            try {
                const workspaceId = decodeURIComponent(match![1]);
                const body = await parseJsonObjectBody(req);

                const issueUrl = optionalString(body.issueUrl, 'issueUrl');
                if (!issueUrl) {
                    throw badRequest('issueUrl is required');
                }

                const urlMatch = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)\/?$/i.exec(issueUrl);
                if (!urlMatch) {
                    throw badRequest(
                        'issueUrl must be a valid GitHub issue URL: https://github.com/<owner>/<repo>/issues/<number>',
                    );
                }
                const [, urlOwner, urlRepo, issueNumberStr] = urlMatch;
                const issueNumber = parseInt(issueNumberStr, 10);

                const { repo } = await resolveAvailableGitHubRepo(workspaceId);
                const configuredOwner = repo.owner;
                const configuredRepo = repo.repo;

                if (
                    urlOwner.toLowerCase() !== configuredOwner.toLowerCase() ||
                    urlRepo.toLowerCase() !== configuredRepo.toLowerCase()
                ) {
                    throw badRequest(
                        `Issue URL repo (${urlOwner}/${urlRepo}) does not match the workspace-configured GitHub repo (${configuredOwner}/${configuredRepo})`,
                    );
                }

                const allItems = await ctx.workItemStore.listWorkItems({ repoId: workspaceId });
                const duplicate = allItems.items.find(item =>
                    item.githubMirror?.issueNumber === issueNumber ||
                    (
                        item.tracker?.kind === 'github-backed' &&
                        item.tracker.github.issueNumber === issueNumber
                    ) ||
                    item.syncLinks?.some(
                        link =>
                            link.provider === 'github' &&
                            link.remote.issueNumber === issueNumber &&
                            (!link.remote.owner || link.remote.owner.toLowerCase() === configuredOwner.toLowerCase()) &&
                            (!link.remote.repo || link.remote.repo.toLowerCase() === configuredRepo.toLowerCase()),
                    ),
                );
                if (duplicate) {
                    throw new APIError(
                        409,
                        `GitHub issue #${issueNumber} is already imported as work item '${duplicate.id}'`,
                        'DUPLICATE_IMPORT',
                        { existingWorkItemId: duplicate.id },
                    );
                }

                const transport = ctx.githubTransport ?? new GhCliGitHubWorkItemIssueTransport();
                const issue = await transport.getIssue(repo, issueNumber);
                if (!issue) {
                    throw notFound(`GitHub issue #${issueNumber}`);
                }
                const rootType = parseGitHubWorkItemIssue(issue).type ?? 'epic';
                if (rootType !== 'epic') {
                    throw badRequest('A GitHub-backed tree must be imported from a GitHub issue marked as coc:type:epic or with no CoC type metadata.');
                }

                const candidateIssues = await transport.listIssues(repo, { limit: WORK_ITEM_SYNC_MAX_ITEMS });
                const result = await importGitHubEpicTreeAsWorkItems(
                    { workspaceId, workItemStore: ctx.workItemStore },
                    repo,
                    issue,
                    candidateIssues,
                );
                notifyGitHubBackedEpicTreeChanged(workspaceId);

                return sendJSON(res, 201, result.root);
            } catch (error) {
                return handleAPIError(res, error);
            }
        },
    });

    // POST /api/workspaces/:id/work-items/:workItemId/convert-to-github
    ctx.routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/work-items\/([^/]+)\/convert-to-github$/,
        handler: async (_req: http.IncomingMessage, res: http.ServerResponse, match?: RegExpMatchArray) => {
            try {
                const workspaceId = decodeURIComponent(match![1]);
                const workItemId = decodeURIComponent(match![2]);
                const root = await loadRootEpic(workspaceId, workItemId, 'Local-to-GitHub conversion');
                if (root.tracker?.kind === 'github-backed') {
                    throw badRequest('Work item is already a GitHub-backed Epic root.');
                }

                const { repo } = await resolveAvailableGitHubRepo(workspaceId);
                const transport = ctx.githubTransport ?? new GhCliGitHubWorkItemIssueTransport();
                const result = await convertLocalEpicTreeToGitHubBacked(
                    { workspaceId, workItemStore: ctx.workItemStore },
                    repo,
                    transport,
                    root.id,
                );
                notifyGitHubBackedEpicTreeChanged(workspaceId);
                return sendJSON(res, 200, result);
            } catch (error) {
                return handleAPIError(res, error);
            }
        },
    });

    // POST /api/workspaces/:id/work-items/:workItemId/convert-to-local
    ctx.routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/work-items\/([^/]+)\/convert-to-local$/,
        handler: async (_req: http.IncomingMessage, res: http.ServerResponse, match?: RegExpMatchArray) => {
            try {
                const workspaceId = decodeURIComponent(match![1]);
                const workItemId = decodeURIComponent(match![2]);
                const root = await loadRootEpic(workspaceId, workItemId, 'GitHub-to-local conversion');
                if (root.tracker?.kind !== 'github-backed' || root.tracker.provider !== 'github') {
                    throw badRequest('Work item is not a GitHub-backed Epic root.');
                }

                const result = await detachGitHubEpicTreeToLocalOnly(
                    { workspaceId, workItemStore: ctx.workItemStore },
                    root.id,
                );
                notifyGitHubBackedEpicTreeChanged(workspaceId);
                return sendJSON(res, 200, result);
            } catch (error) {
                return handleAPIError(res, error);
            }
        },
    });

    // POST /api/workspaces/:id/work-items/:workItemId/sync-from-github
    ctx.routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/work-items\/([^/]+)\/sync-from-github$/,
        handler: async (_req: http.IncomingMessage, res: http.ServerResponse, match?: RegExpMatchArray) => {
            try {
                const workspaceId = decodeURIComponent(match![1]);
                const workItemId = decodeURIComponent(match![2]);
                const root = await loadRootEpic(workspaceId, workItemId, 'GitHub-backed tree sync');
                if (root.tracker?.kind !== 'github-backed' || root.tracker.provider !== 'github') {
                    throw badRequest('Work item is not a GitHub-backed Epic root.');
                }
                const issueNumber = root.tracker.github.issueNumber ?? root.githubMirror?.issueNumber;
                if (issueNumber === undefined) {
                    throw badRequest('GitHub-backed Epic root is missing a GitHub issue number.');
                }

                const { repo } = await resolveAvailableGitHubRepo(workspaceId);
                const transport = ctx.githubTransport ?? new GhCliGitHubWorkItemIssueTransport();
                const issue = await transport.getIssue(repo, issueNumber);
                if (!issue) {
                    const deleteResult = await deleteGitHubEpicMirrorTree(
                        { workspaceId, workItemStore: ctx.workItemStore },
                        root.id,
                    );
                    notifyGitHubBackedEpicTreeChanged(workspaceId);
                    return sendJSON(res, 200, {
                        root,
                        items: [],
                        created: 0,
                        updated: 0,
                        ...deleteResult,
                    });
                }

                const rootType = parseGitHubWorkItemIssue(issue).type ?? 'epic';
                if (rootType !== 'epic') {
                    throw badRequest('A GitHub-backed tree must sync from a GitHub issue marked as coc:type:epic or with no CoC type metadata.');
                }

                const candidateIssues = await transport.listIssues(repo, { limit: WORK_ITEM_SYNC_MAX_ITEMS });
                const result = await importGitHubEpicTreeAsWorkItems(
                    { workspaceId, workItemStore: ctx.workItemStore },
                    repo,
                    issue,
                    candidateIssues,
                    undefined,
                    { pruneMissing: true },
                );
                notifyGitHubBackedEpicTreeChanged(workspaceId);

                return sendJSON(res, 200, result);
            } catch (error) {
                return handleAPIError(res, error);
            }
        },
    });
}
