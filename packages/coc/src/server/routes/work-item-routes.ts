/**
 * Work Item REST API Routes
 *
 * CRUD operations for CoC work items.
 *
 * Routes:
 *   GET    /api/workspaces/:id/work-items              — List work items (with filters)
 *   POST   /api/workspaces/:id/work-items              — Create work item
 *   GET    /api/workspaces/:id/work-items/:workItemId   — Get work item detail
 *   PATCH  /api/workspaces/:id/work-items/:workItemId   — Update work item
 *   DELETE /api/workspaces/:id/work-items/:workItemId   — Delete work item
 */

import * as http from 'http';
import * as url from 'url';
import * as crypto from 'crypto';
import type { Route } from '../types';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { execGit } from '@plusplusoneplusplus/forge';
import { sendJSON, parseBody } from '../core/api-handler';
import { APIError, handleAPIError, missingFields, notFound, badRequest, conflict } from '../errors';
import { readRepoPreferences } from '../preferences-handler';
import type {
    WorkItemStore,
    WorkItemFilter,
    WorkItemStatus,
    WorkItemSource,
    WorkItemPriority,
    WorkItemType,
    WorkItem,
    WorkItemTrackerKind,
    WorkItemTrackerMetadata,
    WorkItemPlanVersion,
    WorkItemChange,
    WorkItemSyncParentReference,
    WorkItemIndexEntry,
} from '../work-items/types';
import { WORK_ITEM_STATUSES, WORK_ITEM_TYPES, WORK_ITEM_TRACKER_KINDS, isValidTransition, HIERARCHY_CONTAINER_TYPES, isValidParentChildTypes, getEffectiveType, isKnownWorkItemStatus } from '../work-items/types';
import { resolveGitHubWorkItemSyncRepo, type GitHubWorkItemSyncRepo } from '../work-items/work-item-sync-github-repo';
import {
    GhCliGitHubWorkItemIssueTransport,
    createGitHubIssueForLocalChild,
    parentReferenceForGitHubMirrorChild,
    updateGitHubIssueForLocalMirror,
    type AvailableGitHubWorkItemSyncRepo,
    type GitHubWorkItemIssue,
    type GitHubWorkItemIssueTransport,
} from '../work-items/work-item-sync-github-provider';
import {
    AzureBoardsRestWorkItemTransport,
    azureBoardsParentWorkItemId,
    azureBoardsProjectFromStatus,
    azureBoardsRemoteWorkItemIdForLocalItem,
    createAzureBoardsWorkItemForLocalChild,
    createAzureBoardsWorkItemSyncProviderAdapter,
    updateAzureBoardsWorkItemForLocalMirror,
    type AzureBoardsWorkItem,
    type AzureBoardsWorkItemTransport,
    type AvailableAzureBoardsWorkItemSyncProject,
} from '../work-items/work-item-sync-azure-boards-provider';
import {
    WORK_ITEM_SYNC_CONFLICT_CODE,
    buildAzureBoardsWorkItemSyncConflict,
    buildGitHubWorkItemSyncConflict,
    type WorkItemSyncConflictResolution,
} from '../work-items/work-item-sync-conflict';
import {
    unavailableWorkItemSyncProviderStatus,
    type WorkItemSyncProviderAdapter,
    type WorkItemSyncProviderContext,
} from '../work-items/work-item-sync-provider';
import { executeWorkItem, type EnqueueFunction } from '../work-items/work-item-executor';
import type { ProcessWebSocketServer } from '../streaming/websocket';
import {
    clearWorkItemResponseCacheForWorkspace,
    getOrRefreshWorkItemResponseCacheEntry,
    makeWorkItemGroupedResponseCacheKey,
    makeWorkItemListResponseCacheKey,
} from '../work-items/work-item-response-cache';

const VALID_SOURCES: Set<string> = new Set(['manual', 'chat', 'schedule']);
const VALID_PRIORITIES: Set<string> = new Set(['high', 'normal', 'low']);
/** Types allowed when hierarchy is disabled (legacy behavior). */
const LEAF_VALID_TYPES: Set<string> = new Set(['work-item', 'bug']);
const VALID_TRACKER_KINDS: Set<string> = new Set(WORK_ITEM_TRACKER_KINDS);
const TRACKER_KEYS: ReadonlySet<string> = new Set(['kind', 'provider', 'github', 'azureBoards']);
const GITHUB_TRACKER_KEYS: ReadonlySet<string> = new Set(['issueId', 'issueNumber', 'issueUrl', 'lastPulledAt']);
const AZURE_BOARDS_TRACKER_KEYS: ReadonlySet<string> = new Set(['workItemId', 'workItemUrl', 'revision', 'updatedAt', 'lastPulledAt']);
const CREDENTIAL_KEY_PATTERN = /(token|secret|password|credential|authorization|auth)/i;
const LEGACY_SYNC_LINKS_ERROR = 'syncLinks are no longer accepted on work item create/update payloads. Use Epic-rooted GitHub import, conversion, or child creation instead.';

export interface WorkItemRouteContext {
    routes: Route[];
    workItemStore: WorkItemStore;
    processStore: ProcessStore;
    enqueue?: EnqueueFunction;
    getWsServer?: () => ProcessWebSocketServer;
    /** Returns true when the workItems.hierarchy feature flag is enabled. */
    getHierarchyEnabled?: () => boolean;
    /** Returns true when remote work-item provider integration is enabled. */
    getSyncEnabled?: () => boolean;
    /** Base CoC data directory, required to resolve workspace GitHub preferences for GitHub-backed child creation. */
    dataDir?: string;
    /** Override GitHub transport for testing. Defaults to GhCliGitHubWorkItemIssueTransport. */
    githubTransport?: GitHubWorkItemIssueTransport;
    /** Override Azure Boards transport for testing. Defaults to AzureBoardsRestWorkItemTransport. */
    azureBoardsTransport?: AzureBoardsWorkItemTransport;
    /** Override Azure Boards status adapter for testing. Defaults to the Azure CLI-backed adapter. */
    azureBoardsProvider?: WorkItemSyncProviderAdapter;
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseWorkItemSyncConflictResolution(value: unknown): WorkItemSyncConflictResolution | undefined {
    if (value === undefined) return undefined;
    if (!isObject(value)) {
        throw new Error('syncConflictResolution must be an object');
    }
    if (value.provider !== 'github' && value.provider !== 'azure-boards') {
        throw new Error('syncConflictResolution.provider must be github or azure-boards');
    }
    const resolution: WorkItemSyncConflictResolution = { provider: value.provider };
    if (value.acknowledgedRemoteUpdatedAt !== undefined) {
        if (typeof value.acknowledgedRemoteUpdatedAt !== 'string') {
            throw new Error('syncConflictResolution.acknowledgedRemoteUpdatedAt must be a string');
        }
        resolution.acknowledgedRemoteUpdatedAt = value.acknowledgedRemoteUpdatedAt;
    }
    if (value.acknowledgedRemoteRevision !== undefined) {
        if (typeof value.acknowledgedRemoteRevision !== 'number' || !Number.isFinite(value.acknowledgedRemoteRevision)) {
            throw new Error('syncConflictResolution.acknowledgedRemoteRevision must be a finite number');
        }
        resolution.acknowledgedRemoteRevision = value.acknowledgedRemoteRevision;
    }
    return resolution;
}

function assertAllowedKeys(
    value: Record<string, unknown>,
    allowed: ReadonlySet<string>,
    path: string,
    metadataLabel = 'sync metadata',
): void {
    for (const key of Object.keys(value)) {
        if (CREDENTIAL_KEY_PATTERN.test(key)) {
            throw new Error(`${path}.${key} must not contain credentials or secrets`);
        }
        if (!allowed.has(key)) {
            throw new Error(`${path}.${key} is not a supported ${metadataLabel} field`);
        }
    }
}

function optionalString(value: unknown, path: string): string | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== 'string') {
        throw new Error(`${path} must be a string`);
    }
    return value;
}

function optionalNumber(value: unknown, path: string): number | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error(`${path} must be a finite number`);
    }
    return value;
}

function parseGitHubTrackerMetadata(value: unknown, path: string): WorkItemTrackerMetadata & { kind: 'github-backed' } {
    if (value !== undefined && !isObject(value)) {
        throw new Error(`${path}.github must be an object`);
    }
    const github = value === undefined ? {} : value;
    assertAllowedKeys(github, GITHUB_TRACKER_KEYS, `${path}.github`, 'tracker metadata');
    const issueNumber = optionalNumber(github.issueNumber, `${path}.github.issueNumber`);
    if (issueNumber !== undefined && (!Number.isInteger(issueNumber) || issueNumber <= 0)) {
        throw new Error(`${path}.github.issueNumber must be a positive integer`);
    }
    return {
        kind: 'github-backed',
        provider: 'github',
        github: {
            issueId: optionalString(github.issueId, `${path}.github.issueId`),
            issueNumber,
            issueUrl: optionalString(github.issueUrl, `${path}.github.issueUrl`),
            lastPulledAt: optionalString(github.lastPulledAt, `${path}.github.lastPulledAt`),
        },
    };
}

function parseAzureBoardsTrackerMetadata(value: unknown, path: string): WorkItemTrackerMetadata & { kind: 'azure-boards-backed' } {
    if (value !== undefined && !isObject(value)) {
        throw new Error(`${path}.azureBoards must be an object`);
    }
    const azureBoards = value === undefined ? {} : value;
    assertAllowedKeys(azureBoards, AZURE_BOARDS_TRACKER_KEYS, `${path}.azureBoards`, 'tracker metadata');
    const workItemId = optionalNumber(azureBoards.workItemId, `${path}.azureBoards.workItemId`);
    if (workItemId !== undefined && (!Number.isInteger(workItemId) || workItemId <= 0)) {
        throw new Error(`${path}.azureBoards.workItemId must be a positive integer`);
    }
    const revision = optionalNumber(azureBoards.revision, `${path}.azureBoards.revision`);
    if (revision !== undefined && (!Number.isInteger(revision) || revision < 0)) {
        throw new Error(`${path}.azureBoards.revision must be a non-negative integer`);
    }
    return {
        kind: 'azure-boards-backed',
        provider: 'azure-boards',
        azureBoards: {
            workItemId,
            workItemUrl: optionalString(azureBoards.workItemUrl, `${path}.azureBoards.workItemUrl`),
            revision,
            updatedAt: optionalString(azureBoards.updatedAt, `${path}.azureBoards.updatedAt`),
            lastPulledAt: optionalString(azureBoards.lastPulledAt, `${path}.azureBoards.lastPulledAt`),
        },
    };
}

function parseTracker(value: unknown): WorkItemTrackerMetadata | undefined {
    if (value === undefined) return undefined;
    if (!isObject(value)) {
        throw new Error('tracker must be an object');
    }
    assertAllowedKeys(value, TRACKER_KEYS, 'tracker', 'tracker metadata');
    const kind = optionalString(value.kind, 'tracker.kind');
    if (!kind || !VALID_TRACKER_KINDS.has(kind)) {
        throw new Error(`tracker.kind must be one of: ${WORK_ITEM_TRACKER_KINDS.join(', ')}`);
    }
    if (kind === 'local-only') {
        if (value.provider !== undefined || value.github !== undefined || value.azureBoards !== undefined) {
            throw new Error('tracker.local-only must not include provider, github, or azureBoards metadata');
        }
        return { kind: 'local-only' };
    }
    if (kind === 'github-backed') {
        const provider = optionalString(value.provider, 'tracker.provider') ?? 'github';
        if (provider !== 'github') {
            throw new Error('tracker.provider must be github for github-backed trackers');
        }
        if (value.azureBoards !== undefined) {
            throw new Error('tracker.github-backed must not include azureBoards metadata');
        }
        return parseGitHubTrackerMetadata(value.github, 'tracker');
    }
    const provider = optionalString(value.provider, 'tracker.provider') ?? 'azure-boards';
    if (provider !== 'azure-boards') {
        throw new Error('tracker.provider must be azure-boards for azure-boards-backed trackers');
    }
    if (value.github !== undefined) {
        throw new Error('tracker.azure-boards-backed must not include github metadata');
    }
    return parseAzureBoardsTrackerMetadata(value.azureBoards, 'tracker');
}

function validateTrackerRootPlacement(
    tracker: WorkItemTrackerMetadata | undefined,
    type: WorkItemType,
    parentId: string | undefined,
): string | undefined {
    if (!tracker) return undefined;
    if (type !== 'epic' || parentId) {
        return 'tracker metadata can only be set on root epic work items';
    }
    return undefined;
}

function githubRepoUnavailableError(repo: Exclude<GitHubWorkItemSyncRepo, { available: true }>): APIError {
    const messageByReason: Record<typeof repo.reason, string> = {
        'incomplete-preference': 'GitHub sync owner/repo preference must include both owner and repo.',
        'missing-workspace': 'GitHub sync could not resolve the current workspace.',
        'missing-origin': 'GitHub sync could not find a git origin remote for this workspace.',
        'non-github-origin': 'GitHub sync requires a GitHub origin remote or workspace owner/repo override.',
    };
    return new APIError(
        409,
        messageByReason[repo.reason],
        'WORK_ITEM_GITHUB_REPO_UNAVAILABLE',
        { provider: repo },
    );
}

function workItemSyncProviderUnavailableError(status: Awaited<ReturnType<WorkItemSyncProviderAdapter['getStatus']>>): APIError {
    return new APIError(
        409,
        status.message ?? `Work item sync provider '${status.provider}' is unavailable.`,
        'WORK_ITEM_SYNC_PROVIDER_UNAVAILABLE',
        { provider: status },
    );
}

function azureBoardsProviderError(message: string, code: string, details?: unknown): APIError {
    return new APIError(409, message, code, details);
}

function azureBoardsOperationFailedError(action: string, error: unknown, code: string): APIError {
    if (error instanceof APIError) return error;
    const detail = error instanceof Error ? error.message : String(error);
    return azureBoardsProviderError(
        `Azure Boards ${action} failed: ${detail}`,
        code,
    );
}

function githubProviderError(message: string, code: string, details?: unknown): APIError {
    return new APIError(409, message, code, details);
}

function githubOperationFailedError(action: string, error: unknown, code: string): APIError {
    if (error instanceof APIError) return error;
    const detail = error instanceof Error ? error.message : String(error);
    return githubProviderError(`GitHub ${action} failed: ${detail}`, code);
}

function githubMirrorIsStale(local: WorkItem, remote: GitHubWorkItemIssue): boolean {
    const localUpdatedAt = local.githubMirror?.updatedAt;
    return Boolean(localUpdatedAt && remote.updatedAt && localUpdatedAt !== remote.updatedAt);
}

function azureBoardsMirrorIsStale(local: WorkItem, remote: AzureBoardsWorkItem): boolean {
    const localRevision = local.azureBoardsMirror?.revision
        ?? (local.tracker?.kind === 'azure-boards-backed' ? local.tracker.azureBoards.revision : undefined);
    if (localRevision !== undefined && remote.revision !== undefined && remote.revision !== localRevision) {
        return true;
    }
    const localUpdatedAt = local.azureBoardsMirror?.updatedAt
        ?? (local.tracker?.kind === 'azure-boards-backed' ? local.tracker.azureBoards.updatedAt : undefined);
    return Boolean(localUpdatedAt && remote.updatedAt && localUpdatedAt !== remote.updatedAt);
}

export interface WorkItemListRouteResponse {
    items: WorkItemIndexEntry[];
    total: number;
    hasMore: boolean;
}

export interface WorkItemGroupedRouteResponse {
    groups: Record<string, { items: WorkItemIndexEntry[]; total: number; hasMore: boolean }>;
}

export async function buildWorkItemListRouteResponse(
    workItemStore: WorkItemStore,
    filter: WorkItemFilter,
): Promise<WorkItemListRouteResponse> {
    const result = await workItemStore.listWorkItems(filter);
    const hasMore = (filter.offset ?? 0) + result.items.length < result.total;
    return { items: result.items, total: result.total, hasMore };
}

export async function buildWorkItemGroupedRouteResponse(
    workItemStore: WorkItemStore,
    filter: WorkItemFilter,
): Promise<WorkItemGroupedRouteResponse> {
    const result = await workItemStore.listWorkItemsGrouped(filter);
    const groups: WorkItemGroupedRouteResponse['groups'] = {};
    for (const [status, group] of Object.entries(result.groups)) {
        groups[status] = {
            items: group.items,
            total: group.total,
            hasMore: group.items.length < group.total,
        };
    }
    return { groups };
}

export function registerWorkItemRoutes(ctx: WorkItemRouteContext): void {
    const { routes, workItemStore, processStore, enqueue, getWsServer } = ctx;
    const isHierarchyEnabled = () => ctx.getHierarchyEnabled?.() ?? false;
    const isSyncEnabled = () => ctx.getSyncEnabled?.() ?? true;
    // All valid types when hierarchy is enabled
    const ALL_VALID_TYPES = new Set<string>(WORK_ITEM_TYPES);

    async function findTreeRoot(item: WorkItem, repoId: string): Promise<WorkItem> {
        let current = item;
        const visited = new Set<string>();
        while (current.parentId && !visited.has(current.id)) {
            visited.add(current.id);
            const parent = await workItemStore.getWorkItem(current.parentId, repoId);
            if (!parent) break;
            current = parent;
        }
        return current;
    }

    /**
     * Map a stale Azure Boards work item's remote parent back to a local mirror id
     * for the structured conflict payload. Returns `null` when the remote item has
     * no parent (Epic root), or `undefined` when the remote parent is not mirrored
     * locally (so the parent row is omitted from the conflict).
     */
    async function azureBoardsRemoteParentLocalId(
        remote: AzureBoardsWorkItem,
        repoId: string,
    ): Promise<string | null | undefined> {
        const parentRemoteId = azureBoardsParentWorkItemId(remote);
        if (parentRemoteId === undefined) return null;
        const entries = (await workItemStore.listWorkItems({ repoId })).items;
        const match = entries.find(entry => entry.azureBoardsMirror?.workItemId === parentRemoteId);
        return match?.id;
    }

    async function resolveAvailableGitHubRepo(repoId: string): Promise<Extract<GitHubWorkItemSyncRepo, { available: true }>> {
        if (!ctx.dataDir) {
            throw new APIError(
                409,
                'GitHub-backed child creation requires the server data directory.',
                'WORK_ITEM_GITHUB_REPO_UNAVAILABLE',
            );
        }
        const workspaces = await processStore.getWorkspaces();
        const repo = resolveGitHubWorkItemSyncRepo({
            workspace: workspaces.find(workspace => workspace.id === repoId),
            preferences: readRepoPreferences(ctx.dataDir, repoId),
        });
        if (!repo.available) {
            throw githubRepoUnavailableError(repo);
        }
        const transport = ctx.githubTransport ?? new GhCliGitHubWorkItemIssueTransport();
        try {
            await transport.getRepository(repo);
        } catch {
            throw new APIError(
                409,
                `GitHub sync could not reach ${repo.owner}/${repo.repo} using external authentication.`,
                'WORK_ITEM_GITHUB_AUTH_UNAVAILABLE',
            );
        }
        return repo;
    }

    async function buildAzureBoardsProviderContext(repoId: string): Promise<WorkItemSyncProviderContext> {
        const workspaces = await ctx.processStore?.getWorkspaces?.() ?? [];
        return {
            workspaceId: repoId,
            workspace: workspaces.find(workspace => workspace.id === repoId),
            preferences: ctx.dataDir ? readRepoPreferences(ctx.dataDir, repoId) : {},
        };
    }

    async function resolveAvailableAzureBoardsProject(repoId: string): Promise<AvailableAzureBoardsWorkItemSyncProject> {
        if (!ctx.dataDir) {
            throw azureBoardsProviderError(
                'Azure Boards-backed work item writes require the server data directory.',
                'WORK_ITEM_AZURE_BOARDS_PROJECT_UNAVAILABLE',
            );
        }
        const provider = ctx.azureBoardsProvider ?? createAzureBoardsWorkItemSyncProviderAdapter({ dataDir: ctx.dataDir });
        const status = await provider.getStatus(await buildAzureBoardsProviderContext(repoId));
        if (!status.available) {
            throw workItemSyncProviderUnavailableError(status);
        }
        const project = azureBoardsProjectFromStatus(status);
        if (!project) {
            throw workItemSyncProviderUnavailableError(unavailableWorkItemSyncProviderStatus('azure-boards'));
        }
        return project;
    }

    async function pushNewGitHubBackedChildIfNeeded(
        item: WorkItem,
        parentItem: WorkItem | undefined,
        repoId: string,
        now: string,
    ): Promise<WorkItem> {
        if (!parentItem) return item;
        const root = await findTreeRoot(parentItem, repoId);
        if (root.tracker?.kind !== 'github-backed') return item;
        if (!parentItem.githubMirror?.issueNumber) {
            throw new APIError(
                409,
                `Parent work item '${parentItem.id}' is not mirrored to GitHub.`,
                'WORK_ITEM_GITHUB_PARENT_NOT_MIRRORED',
            );
        }

        const repo = await resolveAvailableGitHubRepo(repoId);
        const transport = ctx.githubTransport ?? new GhCliGitHubWorkItemIssueTransport();
        const result = await createGitHubIssueForLocalChild({
            repo,
            transport,
            item,
            parent: parentItem,
            now: () => now,
        });
        return {
            ...item,
            githubMirror: result.githubMirror,
        };
    }

    async function pushNewAzureBoardsBackedChildIfNeeded(
        item: WorkItem,
        parentItem: WorkItem | undefined,
        repoId: string,
        now: string,
    ): Promise<WorkItem> {
        if (!parentItem) return item;
        const root = await findTreeRoot(parentItem, repoId);
        if (root.tracker?.kind !== 'azure-boards-backed' || root.tracker.provider !== 'azure-boards') return item;
        if (azureBoardsRemoteWorkItemIdForLocalItem(parentItem) === undefined) {
            throw azureBoardsProviderError(
                `Parent work item '${parentItem.id}' is not mirrored to Azure Boards.`,
                'WORK_ITEM_AZURE_BOARDS_PARENT_NOT_MIRRORED',
            );
        }

        const project = await resolveAvailableAzureBoardsProject(repoId);
        const transport = ctx.azureBoardsTransport ?? new AzureBoardsRestWorkItemTransport();
        try {
            const result = await createAzureBoardsWorkItemForLocalChild({
                project,
                transport,
                item,
                parent: parentItem,
                now: () => now,
            });
            return {
                ...item,
                azureBoardsMirror: result.azureBoardsMirror,
            };
        } catch (error) {
            throw azureBoardsOperationFailedError(
                'child creation',
                error,
                'WORK_ITEM_AZURE_BOARDS_CREATE_FAILED',
            );
        }
    }

    async function azureBoardsParentWorkItemIdForUpdate(
        current: WorkItem,
        root: WorkItem,
        newParent: WorkItem | undefined,
        repoId: string,
    ): Promise<number | null | undefined> {
        if (!newParent) return null;
        const newParentRoot = await findTreeRoot(newParent, repoId);
        if (newParentRoot.id !== root.id || newParentRoot.tracker?.kind !== 'azure-boards-backed') {
            throw azureBoardsProviderError(
                `Parent work item '${newParent.id}' is not in the same Azure Boards-backed Epic tree as '${current.id}'.`,
                'WORK_ITEM_AZURE_BOARDS_PARENT_NOT_MIRRORED',
            );
        }
        const parentWorkItemId = azureBoardsRemoteWorkItemIdForLocalItem(newParent);
        if (parentWorkItemId === undefined) {
            throw azureBoardsProviderError(
                `Parent work item '${newParent.id}' is not mirrored to Azure Boards.`,
                'WORK_ITEM_AZURE_BOARDS_PARENT_NOT_MIRRORED',
            );
        }
        return parentWorkItemId;
    }

    async function githubParentReferenceForUpdate(
        current: WorkItem,
        root: WorkItem,
        repo: AvailableGitHubWorkItemSyncRepo,
        parentChanged: boolean,
        newParent: WorkItem | undefined,
        repoId: string,
    ): Promise<WorkItemSyncParentReference | null> {
        const effectiveParentId = parentChanged ? newParent?.id : current.parentId;
        if (!effectiveParentId) return null;

        let parentItem: WorkItem | undefined;
        if (parentChanged) {
            const newParentRoot = await findTreeRoot(newParent!, repoId);
            if (newParentRoot.id !== root.id || newParentRoot.tracker?.kind !== 'github-backed') {
                throw githubProviderError(
                    `Parent work item '${newParent!.id}' is not in the same GitHub-backed Epic tree as '${current.id}'.`,
                    'WORK_ITEM_GITHUB_PARENT_NOT_MIRRORED',
                );
            }
            parentItem = newParent;
        } else {
            parentItem = await workItemStore.getWorkItem(effectiveParentId, repoId);
        }

        if (!parentItem?.githubMirror?.issueNumber) {
            throw githubProviderError(
                `Parent work item '${effectiveParentId}' is not mirrored to GitHub.`,
                'WORK_ITEM_GITHUB_PARENT_NOT_MIRRORED',
            );
        }
        return parentReferenceForGitHubMirrorChild(parentItem, repo);
    }

    async function pushGitHubBackedUpdateIfNeeded(
        current: WorkItem,
        updates: Partial<WorkItem>,
        repoId: string,
        parentChanged: boolean,
        newParent: WorkItem | undefined,
        resolution: WorkItemSyncConflictResolution | undefined,
    ): Promise<Partial<WorkItem>> {
        const hasGitHubWritableChange = updates.title !== undefined
            || updates.description !== undefined
            || updates.status !== undefined
            || updates.priority !== undefined
            || updates.tags !== undefined
            || parentChanged;
        if (!hasGitHubWritableChange) return updates;
        if (!isSyncEnabled()) return updates;

        const root = await findTreeRoot(current, repoId);
        if (root.tracker?.kind !== 'github-backed' || root.tracker.provider !== 'github') {
            return updates;
        }

        const issueNumber = current.githubMirror?.issueNumber;
        if (issueNumber === undefined) {
            throw githubProviderError(
                `Work item '${current.id}' is not mirrored to GitHub.`,
                'WORK_ITEM_GITHUB_ITEM_NOT_MIRRORED',
            );
        }

        const repo = await resolveAvailableGitHubRepo(repoId);
        const transport = ctx.githubTransport ?? new GhCliGitHubWorkItemIssueTransport();
        const remote = await transport.getIssue(repo, issueNumber);
        if (!remote) {
            throw githubProviderError(
                `GitHub issue #${issueNumber} no longer exists.`,
                'WORK_ITEM_GITHUB_ITEM_NOT_FOUND',
            );
        }
        const itemForRemote: WorkItem = {
            ...current,
            ...updates,
            parentId: parentChanged ? newParent?.id : current.parentId,
        };
        if (githubMirrorIsStale(current, remote)) {
            const acknowledged = resolution?.provider === 'github'
                && resolution.acknowledgedRemoteUpdatedAt !== undefined
                && resolution.acknowledgedRemoteUpdatedAt === remote.updatedAt;
            if (!acknowledged) {
                throw githubProviderError(
                    `GitHub issue #${issueNumber} changed remotely; resolve the conflict before saving local edits.`,
                    WORK_ITEM_SYNC_CONFLICT_CODE,
                    buildGitHubWorkItemSyncConflict({
                        current,
                        draft: itemForRemote,
                        remote,
                        issueNumber,
                    }),
                );
            }
            // User reviewed exactly this remote snapshot in the inline merge UI and
            // chose the per-field values now present in `itemForRemote`; proceed.
        }

        const parent = await githubParentReferenceForUpdate(current, root, repo, parentChanged, newParent, repoId);

        let result;
        try {
            result = await updateGitHubIssueForLocalMirror({
                repo,
                transport,
                item: itemForRemote,
                issueNumber,
                existingIssue: remote,
                parent,
            });
        } catch (error) {
            throw githubOperationFailedError('update', error, 'WORK_ITEM_GITHUB_UPDATE_FAILED');
        }

        const nextUpdates: Partial<WorkItem> = {
            ...updates,
            githubMirror: result.githubMirror,
        };
        if (current.id === root.id && current.tracker?.kind === 'github-backed') {
            nextUpdates.tracker = {
                ...current.tracker,
                github: {
                    ...current.tracker.github,
                    issueId: result.githubMirror.issueId,
                    issueNumber: result.githubMirror.issueNumber,
                    issueUrl: result.githubMirror.issueUrl,
                    lastPulledAt: result.githubMirror.lastPulledAt,
                },
            };
        }
        return nextUpdates;
    }

    async function pushAzureBoardsBackedUpdateIfNeeded(
        current: WorkItem,
        updates: Partial<WorkItem>,
        repoId: string,
        parentChanged: boolean,
        newParent: WorkItem | undefined,
        resolution: WorkItemSyncConflictResolution | undefined,
    ): Promise<Partial<WorkItem>> {
        const hasAzureWritableChange = updates.title !== undefined
            || updates.description !== undefined
            || updates.status !== undefined
            || updates.priority !== undefined
            || updates.tags !== undefined
            || parentChanged;
        if (!hasAzureWritableChange) return updates;
        if (!isSyncEnabled()) return updates;

        const root = await findTreeRoot(current, repoId);
        if (root.tracker?.kind !== 'azure-boards-backed' || root.tracker.provider !== 'azure-boards') {
            return updates;
        }

        const remoteWorkItemId = azureBoardsRemoteWorkItemIdForLocalItem(current);
        if (remoteWorkItemId === undefined) {
            throw azureBoardsProviderError(
                `Work item '${current.id}' is not mirrored to Azure Boards.`,
                'WORK_ITEM_AZURE_BOARDS_ITEM_NOT_MIRRORED',
            );
        }

        const project = await resolveAvailableAzureBoardsProject(repoId);
        const transport = ctx.azureBoardsTransport ?? new AzureBoardsRestWorkItemTransport();
        const remote = await transport.getWorkItem(project, remoteWorkItemId);
        if (!remote) {
            throw azureBoardsProviderError(
                `Azure Boards work item ${remoteWorkItemId} no longer exists.`,
                'WORK_ITEM_AZURE_BOARDS_ITEM_NOT_FOUND',
            );
        }
        const itemForRemote: WorkItem = {
            ...current,
            ...updates,
            parentId: parentChanged ? newParent?.id : current.parentId,
        };
        let expectedRevisionOverride: number | undefined;
        if (azureBoardsMirrorIsStale(current, remote)) {
            const acknowledged = resolution?.provider === 'azure-boards'
                && resolution.acknowledgedRemoteRevision !== undefined
                && resolution.acknowledgedRemoteRevision === remote.revision;
            if (!acknowledged) {
                const remoteParentLocalId = await azureBoardsRemoteParentLocalId(remote, repoId);
                throw azureBoardsProviderError(
                    `Azure Boards work item ${remoteWorkItemId} changed remotely; resolve the conflict before saving local edits.`,
                    WORK_ITEM_SYNC_CONFLICT_CODE,
                    buildAzureBoardsWorkItemSyncConflict({
                        current,
                        draft: itemForRemote,
                        remote,
                        remoteWorkItemId,
                        remoteParentLocalId,
                    }),
                );
            }
            // User reviewed exactly this remote revision in the inline merge UI;
            // re-base the optimistic concurrency check to the reviewed revision so
            // the provider `test /rev` op matches the current remote.
            expectedRevisionOverride = remote.revision;
        }

        const parentWorkItemId = parentChanged
            ? await azureBoardsParentWorkItemIdForUpdate(current, root, newParent, repoId)
            : undefined;

        const updateOptions: Parameters<typeof updateAzureBoardsWorkItemForLocalMirror>[0] = {
            project,
            transport,
            item: itemForRemote,
            remoteWorkItemId,
            expectedRevision: expectedRevisionOverride
                ?? current.azureBoardsMirror?.revision
                ?? (current.tracker?.kind === 'azure-boards-backed' ? current.tracker.azureBoards.revision : undefined),
        };
        if (parentChanged) {
            updateOptions.parentWorkItemId = parentWorkItemId;
        }

        let result;
        try {
            result = await updateAzureBoardsWorkItemForLocalMirror(updateOptions);
        } catch (error) {
            throw azureBoardsOperationFailedError(
                'update',
                error,
                'WORK_ITEM_AZURE_BOARDS_UPDATE_FAILED',
            );
        }

        const nextUpdates: Partial<WorkItem> = {
            ...updates,
            azureBoardsMirror: result.azureBoardsMirror,
        };
        if (current.id === root.id && current.tracker?.kind === 'azure-boards-backed') {
            nextUpdates.tracker = {
                ...current.tracker,
                azureBoards: {
                    ...current.tracker.azureBoards,
                    workItemId: result.azureBoardsMirror.workItemId,
                    workItemUrl: result.azureBoardsMirror.workItemUrl,
                    revision: result.azureBoardsMirror.revision,
                    updatedAt: result.azureBoardsMirror.updatedAt,
                    lastPulledAt: result.azureBoardsMirror.lastPulledAt,
                },
            };
        }
        return nextUpdates;
    }

    // GET /api/workspaces/:id/work-items — List with optional filters
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/work-items$/,
        handler: async (req: http.IncomingMessage, res: http.ServerResponse, match?: RegExpMatchArray) => {
            const repoId = decodeURIComponent(match![1]);
            const parsed = url.parse(req.url || '/', true);
            const query = parsed.query;
            const force = query.force === 'true';

            const filter: WorkItemFilter = { repoId };
            if (typeof query.status === 'string' && query.status) {
                const statuses = query.status.split(',').filter(isKnownWorkItemStatus);
                if (statuses.length === 1) {
                    filter.status = statuses[0] as WorkItemStatus;
                } else if (statuses.length > 1) {
                    filter.status = statuses as WorkItemStatus[];
                }
            }
            if (typeof query.source === 'string' && VALID_SOURCES.has(query.source)) {
                filter.source = query.source as WorkItemSource;
            }
            if (typeof query.priority === 'string' && VALID_PRIORITIES.has(query.priority)) {
                filter.priority = query.priority as WorkItemPriority;
            }
            if (typeof query.tags === 'string' && query.tags) {
                filter.tags = query.tags.split(',');
            }
            if (typeof query.type === 'string' && ALL_VALID_TYPES.has(query.type)) {
                filter.type = query.type as WorkItemType;
            }
            if (typeof query.tracker === 'string' && VALID_TRACKER_KINDS.has(query.tracker)) {
                filter.tracker = query.tracker as WorkItemTrackerKind;
            }
            if (typeof query.q === 'string' && query.q.trim()) {
                filter.search = query.q.trim();
            }
            if (typeof query.offset === 'string') {
                const n = parseInt(query.offset, 10);
                if (!isNaN(n) && n >= 0) filter.offset = n;
            }
            if (typeof query.limit === 'string') {
                const n = parseInt(query.limit, 10);
                if (!isNaN(n) && n > 0) filter.limit = n;
            }

            const response = await getOrRefreshWorkItemResponseCacheEntry(
                makeWorkItemListResponseCacheKey(filter),
                repoId,
                'list',
                force,
                () => buildWorkItemListRouteResponse(workItemStore, filter),
            );
            sendJSON(res, 200, response);
        },
    });

    // GET /api/workspaces/:id/work-items/grouped — List grouped by status with per-group pagination
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/work-items\/grouped$/,
        handler: async (req: http.IncomingMessage, res: http.ServerResponse, match?: RegExpMatchArray) => {
            const repoId = decodeURIComponent(match![1]);
            const parsed = url.parse(req.url || '/', true);
            const query = parsed.query;
            const force = query.force === 'true';

            const filter: WorkItemFilter = { repoId };
            if (typeof query.source === 'string' && VALID_SOURCES.has(query.source)) {
                filter.source = query.source as WorkItemSource;
            }
            if (typeof query.priority === 'string' && VALID_PRIORITIES.has(query.priority)) {
                filter.priority = query.priority as WorkItemPriority;
            }
            if (typeof query.tags === 'string' && query.tags) {
                filter.tags = query.tags.split(',');
            }
            if (typeof query.type === 'string' && ALL_VALID_TYPES.has(query.type)) {
                filter.type = query.type as WorkItemType;
            }
            if (typeof query.tracker === 'string' && VALID_TRACKER_KINDS.has(query.tracker)) {
                filter.tracker = query.tracker as WorkItemTrackerKind;
            }
            if (typeof query.q === 'string' && query.q.trim()) {
                filter.search = query.q.trim();
            }
            if (typeof query.limit === 'string') {
                const n = parseInt(query.limit, 10);
                if (!isNaN(n) && n > 0) filter.limit = n;
            }

            const response = await getOrRefreshWorkItemResponseCacheEntry(
                makeWorkItemGroupedResponseCacheKey(filter),
                repoId,
                'grouped',
                force,
                () => buildWorkItemGroupedRouteResponse(workItemStore, filter),
            );
            sendJSON(res, 200, response);
        },
    });

    // POST /api/workspaces/:id/work-items — Create work item
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/work-items$/,
        handler: async (req: http.IncomingMessage, res: http.ServerResponse, match?: RegExpMatchArray) => {
            const repoId = decodeURIComponent(match![1]);
            let body: any;
            try {
                body = await parseBody(req);
            } catch {
                return handleAPIError(res, badRequest('Invalid JSON body'));
            }

            const missing: string[] = [];
            if (!body.title) missing.push('title');
            if (missing.length) {
                return handleAPIError(res, missingFields(missing));
            }

            const now = new Date().toISOString();
            const hierarchyEnabled = isHierarchyEnabled();
            let tracker: WorkItemTrackerMetadata | undefined;
            let parentItem: WorkItem | undefined;
            if (body.syncLinks !== undefined) {
                return handleAPIError(res, badRequest(LEGACY_SYNC_LINKS_ERROR));
            }
            try {
                tracker = parseTracker(body.tracker);
            } catch (err) {
                return handleAPIError(res, badRequest(err instanceof Error ? err.message : 'Invalid work item metadata'));
            }

            // Validate type: hierarchy-only types require the flag to be enabled
            let resolvedType: WorkItemType | undefined;
            if (body.type) {
                if (ALL_VALID_TYPES.has(body.type)) {
                    if (HIERARCHY_CONTAINER_TYPES.has(body.type as WorkItemType) && !hierarchyEnabled) {
                        return handleAPIError(res, badRequest(
                            `Type '${body.type}' requires the workItems.hierarchy feature flag to be enabled`,
                        ));
                    }
                    resolvedType = body.type as WorkItemType;
                }
                // Unknown types are silently ignored (treated as work-item)
            }

            // Validate parentId: only allowed when hierarchy is enabled
            if (body.parentId && !hierarchyEnabled) {
                return handleAPIError(res, badRequest(
                    'parentId requires the workItems.hierarchy feature flag to be enabled',
                ));
            }

            // Validate parent-child type relationship when parentId is provided
            if (body.parentId && hierarchyEnabled) {
                parentItem = await workItemStore.getWorkItem(body.parentId, repoId);
                if (!parentItem) {
                    return handleAPIError(res, badRequest(`Parent work item not found: ${body.parentId}`));
                }
                if (parentItem.repoId !== repoId) {
                    return handleAPIError(res, badRequest('Parent work item must be in the same workspace'));
                }
                const childType = resolvedType ?? 'work-item';
                const parentType = getEffectiveType(parentItem.type);
                if (!isValidParentChildTypes(childType, parentType)) {
                    return handleAPIError(res, badRequest(
                        `Invalid parent-child type combination: '${parentType}' cannot be a parent of '${childType}'`,
                    ));
                }
            }

            if (body.id && await workItemStore.getWorkItem(String(body.id), repoId)) {
                return handleAPIError(res, conflict(`Work item already exists: ${body.id}`));
            }

            const trackerPlacementError = validateTrackerRootPlacement(
                tracker,
                resolvedType ?? 'work-item',
                hierarchyEnabled && body.parentId ? String(body.parentId) : undefined,
            );
            if (trackerPlacementError) {
                return handleAPIError(res, badRequest(trackerPlacementError));
            }

            let item: WorkItem = {
                id: body.id || crypto.randomUUID(),
                repoId,
                title: body.title,
                description: body.description || '',
                status: 'created',
                type: resolvedType,
                parentId: hierarchyEnabled && body.parentId ? String(body.parentId) : undefined,
                tracker,
                createdAt: now,
                updatedAt: now,
                source: VALID_SOURCES.has(body.source) ? body.source : 'manual',
                sourceId: body.sourceId,
                priority: VALID_PRIORITIES.has(body.priority) ? body.priority : undefined,
                tags: Array.isArray(body.tags) ? body.tags : undefined,
                autoExecute: body.autoExecute === true,
                successCriteria: typeof body.successCriteria === 'string' && body.successCriteria.trim()
                    ? body.successCriteria
                    : undefined,
            };

            if (body.plan?.content) {
                item.plan = {
                    version: 1,
                    currentVersion: 1,
                    content: body.plan.content,
                    updatedAt: now,
                    resolvedBy: body.plan.resolvedBy || 'user',
                    source: body.plan.resolvedBy === 'ai' ? 'ai' : 'user',
                };
                item.currentContentVersion = 1;
            }

            try {
                item = await pushNewGitHubBackedChildIfNeeded(item, parentItem, repoId, now);
                item = await pushNewAzureBoardsBackedChildIfNeeded(item, parentItem, repoId, now);
            } catch (err) {
                return handleAPIError(res, err);
            }

            try {
                await workItemStore.addWorkItem(item);
            } catch (err: any) {
                if (err?.message?.includes('already exists')) {
                    return handleAPIError(res, conflict(err.message));
                }
                throw err;
            }

            clearWorkItemResponseCacheForWorkspace(repoId);
            getWsServer?.()?.broadcastProcessEvent({ type: 'work-item-added', workspaceId: repoId, item });
            sendJSON(res, 201, item);
        },
    });

    // GET /api/workspaces/:id/work-items/:workItemId — Get detail
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/work-items\/([^/]+)$/,
        handler: async (req: http.IncomingMessage, res: http.ServerResponse, match?: RegExpMatchArray) => {
            const repoId = decodeURIComponent(match![1]);
            const workItemId = decodeURIComponent(match![2]);

            const item = await workItemStore.getWorkItem(workItemId, repoId);
            if (!item) {
                return handleAPIError(res, notFound('Work item'));
            }
            sendJSON(res, 200, item);
        },
    });

    // PATCH /api/workspaces/:id/work-items/:workItemId — Update work item
    routes.push({
        method: 'PATCH',
        pattern: /^\/api\/workspaces\/([^/]+)\/work-items\/([^/]+)$/,
        handler: async (req: http.IncomingMessage, res: http.ServerResponse, match?: RegExpMatchArray) => {
            const repoId = decodeURIComponent(match![1]);
            const workItemId = decodeURIComponent(match![2]);

            let body: any;
            try {
                body = await parseBody(req);
            } catch {
                return handleAPIError(res, badRequest('Invalid JSON body'));
            }

            const current = await workItemStore.getWorkItem(workItemId, repoId);
            if (!current) {
                return handleAPIError(res, notFound('Work item'));
            }

            let syncConflictResolution: WorkItemSyncConflictResolution | undefined;
            try {
                syncConflictResolution = parseWorkItemSyncConflictResolution(body.syncConflictResolution);
            } catch (err) {
                return handleAPIError(res, badRequest(err instanceof Error ? err.message : 'Invalid syncConflictResolution'));
            }

            // Validate status transition if status is being changed
            if (body.status) {
                if (!WORK_ITEM_STATUSES.includes(body.status)) {
                    return handleAPIError(res, badRequest(`Invalid status: ${body.status}`));
                }
                if (current.status !== body.status && !isValidTransition(current.status, body.status)) {
                    return handleAPIError(res, badRequest(
                        `Invalid status transition: ${current.status} → ${body.status}`
                    ));
                }
            }

            const updates: Partial<WorkItem> = {};
            let pendingPlanVersion: WorkItemPlanVersion | undefined;
            if (body.title !== undefined) updates.title = body.title;
            if (body.description !== undefined) updates.description = body.description;
            if (body.status !== undefined) updates.status = body.status;
            if (body.priority !== undefined) updates.priority = body.priority;
            if (body.tags !== undefined) updates.tags = body.tags;
            if (body.autoExecute !== undefined) updates.autoExecute = body.autoExecute;
            if (body.completedAt !== undefined) updates.completedAt = body.completedAt;
            if (body.reviewComments !== undefined) updates.reviewComments = body.reviewComments;
            if (body.successCriteria !== undefined) updates.successCriteria = body.successCriteria;
            if (body.grillSessionId !== undefined) updates.grillSessionId = body.grillSessionId;
            if (body.syncLinks !== undefined) {
                return handleAPIError(res, badRequest(LEGACY_SYNC_LINKS_ERROR));
            }
            if (body.plan !== undefined) {
                if (!isObject(body.plan) || typeof body.plan.content !== 'string') {
                    return handleAPIError(res, badRequest('plan.content must be a string'));
                }
                if (!body.plan.content.trim()) {
                    return handleAPIError(res, badRequest('plan.content must contain non-whitespace content'));
                }
                const now = new Date().toISOString();
                const newVersion = (current.plan?.version ?? 0) + 1;
                const resolvedBy = body.plan.resolvedBy === 'ai' ? 'ai' : 'user';
                pendingPlanVersion = {
                    version: newVersion,
                    content: body.plan.content,
                    createdAt: now,
                    resolvedBy,
                    source: resolvedBy,
                    authorType: resolvedBy,
                    reason: typeof body.plan.reason === 'string' ? body.plan.reason : undefined,
                    summary: typeof body.plan.summary === 'string' ? body.plan.summary : undefined,
                };
                updates.currentContentVersion = newVersion;
                updates.plan = {
                    version: newVersion,
                    currentVersion: newVersion,
                    content: body.plan.content,
                    updatedAt: now,
                    resolvedBy,
                    source: resolvedBy,
                    reason: pendingPlanVersion.reason,
                };
            }
            if (body.tracker !== undefined) {
                try {
                    updates.tracker = parseTracker(body.tracker);
                } catch (err) {
                    return handleAPIError(res, badRequest(err instanceof Error ? err.message : 'Invalid tracker metadata'));
                }
                const resultingParentId = 'parentId' in body
                    ? (body.parentId === null || body.parentId === '' ? undefined : String(body.parentId))
                    : current.parentId;
                const trackerPlacementError = validateTrackerRootPlacement(
                    updates.tracker,
                    getEffectiveType(current.type),
                    resultingParentId,
                );
                if (trackerPlacementError) {
                    return handleAPIError(res, badRequest(trackerPlacementError));
                }
            }

            // Handle parentId reparenting when hierarchy is enabled
            let newParentForRemote: WorkItem | undefined;
            let parentChanged = false;
            if ('parentId' in body) {
                if (!isHierarchyEnabled()) {
                    return handleAPIError(res, badRequest(
                        'parentId requires the workItems.hierarchy feature flag to be enabled',
                    ));
                }
                parentChanged = true;
                if (body.parentId === null || body.parentId === '') {
                    // Unlink parent
                    updates.parentId = undefined;
                } else if (typeof body.parentId === 'string') {
                    // Validate new parent
                    if (body.parentId === workItemId) {
                        return handleAPIError(res, badRequest('A work item cannot be its own parent'));
                    }
                    const newParent = await workItemStore.getWorkItem(body.parentId, repoId);
                    if (!newParent) {
                        return handleAPIError(res, badRequest(`Parent work item not found: ${body.parentId}`));
                    }
                    if (newParent.repoId !== repoId) {
                        return handleAPIError(res, badRequest('Parent work item must be in the same workspace'));
                    }
                    // Fetch the current item to know its type for parent-child validation
                    const childType = getEffectiveType(current.type);
                    const parentType = getEffectiveType(newParent.type);
                    if (!isValidParentChildTypes(childType, parentType)) {
                        return handleAPIError(res, badRequest(
                            `Invalid parent-child type combination: '${parentType}' cannot be a parent of '${childType}'`,
                        ));
                    }
                    updates.parentId = body.parentId;
                    newParentForRemote = newParent;
                }
            }

            let remoteReadyUpdates: Partial<WorkItem>;
            try {
                remoteReadyUpdates = await pushAzureBoardsBackedUpdateIfNeeded(
                    current,
                    updates,
                    repoId,
                    parentChanged,
                    newParentForRemote,
                    syncConflictResolution,
                );
                remoteReadyUpdates = await pushGitHubBackedUpdateIfNeeded(
                    current,
                    remoteReadyUpdates,
                    repoId,
                    parentChanged,
                    newParentForRemote,
                    syncConflictResolution,
                );
            } catch (err) {
                return handleAPIError(res, err);
            }

            if (pendingPlanVersion) {
                await workItemStore.savePlanVersion(workItemId, pendingPlanVersion);
            }
            const updated = await workItemStore.updateWorkItem(workItemId, remoteReadyUpdates);
            if (!updated) {
                return handleAPIError(res, notFound('Work item'));
            }

            if (updates.plan) {
                const change: WorkItemChange = {
                    id: crypto.randomUUID(),
                    planVersion: updates.plan.version,
                    commits: [],
                    startedAt: updates.plan.updatedAt ?? new Date().toISOString(),
                    status: 'open',
                };
                workItemStore.addChange(workItemId, change).catch(() => { /* non-fatal */ });
            }

            // Auto-execute if status transitioned to 'readyToExecute' and autoExecute is enabled
            if (updated.status === 'readyToExecute' && updated.autoExecute && enqueue) {
                try {
                    // Capture git HEAD before execution for commit range tracking
                    let headBefore: string | undefined;
                    try {
                        const workspaces = await processStore.getWorkspaces();
                        const workspace = workspaces.find(w => w.id === repoId);
                        if (workspace?.rootPath) {
                            headBefore = execGit(['rev-parse', 'HEAD'], workspace.rootPath);
                        }
                    } catch { /* non-fatal */ }

                    await executeWorkItem(workItemId, workItemStore, enqueue, { headBefore });
                    const afterExec = await workItemStore.getWorkItem(workItemId);
                    if (afterExec) {
                        clearWorkItemResponseCacheForWorkspace(repoId);
                        getWsServer?.()?.broadcastProcessEvent({ type: 'work-item-updated', workspaceId: repoId, item: afterExec });
                        return sendJSON(res, 200, afterExec);
                    }
                } catch {
                    // Auto-execute failed; still return the updated work item
                }
            }

            clearWorkItemResponseCacheForWorkspace(repoId);
            getWsServer?.()?.broadcastProcessEvent({ type: 'work-item-updated', workspaceId: repoId, item: updated });
            sendJSON(res, 200, updated);
        },
    });

    // POST /api/workspaces/:id/work-items/:workItemId/request-changes — Incorporate review comments into plan, transition to readyToExecute
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/work-items\/([^/]+)\/request-changes$/,
        handler: async (req: http.IncomingMessage, res: http.ServerResponse, match?: RegExpMatchArray) => {
            const repoId = decodeURIComponent(match![1]);
            const workItemId = decodeURIComponent(match![2]);

            let body: any;
            try {
                body = await parseBody(req);
            } catch {
                return handleAPIError(res, badRequest('Invalid JSON body'));
            }

            const comments = body.comments;
            if (!Array.isArray(comments) || comments.length === 0) {
                return handleAPIError(res, badRequest('At least one comment is required'));
            }

            const item = await workItemStore.getWorkItem(workItemId, repoId);
            if (!item) {
                return handleAPIError(res, notFound('Work item'));
            }

            if (item.status !== 'aiDone') {
                return handleAPIError(res, badRequest(
                    `Cannot request changes in status '${item.status}'. Work item must be in 'aiDone' status.`
                ));
            }

            // Build new plan version incorporating the comments
            const now = new Date().toISOString();
            const currentPlan = item.plan?.content || '';
            const source: string | undefined = body.source; // 'diff-comments' | undefined
            const commentBlock = comments.map((c: string, i: number) => `${i + 1}. ${c}`).join('\n');
            const heading = source === 'diff-comments'
                ? '## Diff Review Comments (to address)'
                : '## Review Comments (to address)';
            const newContent = currentPlan + '\n\n' + heading + '\n\n' + commentBlock;
            const newVersion = (item.plan?.version ?? 0) + 1;

            const planVersion = {
                version: newVersion,
                content: newContent,
                createdAt: now,
                resolvedBy: 'user' as const,
                source: 'user' as const,
                authorType: 'user' as const,
                reason: source === 'diff-comments'
                    ? `Incorporated ${comments.length} diff review comment(s)`
                    : `Incorporated ${comments.length} review comment(s)`,
                summary: source === 'diff-comments'
                    ? `Incorporated ${comments.length} diff review comment(s)`
                    : `Incorporated ${comments.length} review comment(s)`,
            };

            await workItemStore.savePlanVersion(workItemId, planVersion);
            const updated = await workItemStore.updateWorkItem(workItemId, {
                status: 'readyToExecute',
                currentContentVersion: newVersion,
                plan: {
                    version: newVersion,
                    currentVersion: newVersion,
                    content: newContent,
                    updatedAt: now,
                    resolvedBy: 'user',
                    source: 'user',
                    reason: planVersion.reason,
                },
                reviewComments: [],
            });

            if (updated) {
                clearWorkItemResponseCacheForWorkspace(repoId);
                getWsServer?.()?.broadcastProcessEvent({ type: 'work-item-updated', workspaceId: repoId, item: updated });
            }

            sendJSON(res, 200, { plan: planVersion, newVersion });
        },
    });

    // DELETE /api/workspaces/:id/work-items/:workItemId — Delete work item
    routes.push({
        method: 'DELETE',
        pattern: /^\/api\/workspaces\/([^/]+)\/work-items\/([^/]+)$/,
        handler: async (req: http.IncomingMessage, res: http.ServerResponse, match?: RegExpMatchArray) => {
            const repoId = decodeURIComponent(match![1]);
            const workItemId = decodeURIComponent(match![2]);

            const removed = await workItemStore.removeWorkItem(workItemId);
            if (!removed) {
                return handleAPIError(res, notFound('Work item'));
            }
            clearWorkItemResponseCacheForWorkspace(repoId);
            getWsServer?.()?.broadcastProcessEvent({ type: 'work-item-removed', workspaceId: repoId, itemId: workItemId });
            sendJSON(res, 204, null);
        },
    });

    // PATCH /api/workspaces/:id/work-items/:workItemId/pin — Pin/unpin work item
    routes.push({
        method: 'PATCH',
        pattern: /^\/api\/workspaces\/([^/]+)\/work-items\/([^/]+)\/pin$/,
        handler: async (req: http.IncomingMessage, res: http.ServerResponse, match?: RegExpMatchArray) => {
            const repoId = decodeURIComponent(match![1]);
            const workItemId = decodeURIComponent(match![2]);

            let body: any;
            try {
                body = await parseBody(req);
            } catch {
                return handleAPIError(res, badRequest('Invalid JSON body'));
            }

            const pinned = body.pinned;
            if (typeof pinned !== 'boolean') {
                return handleAPIError(res, badRequest('Missing or invalid "pinned" field (boolean)'));
            }

            let updated: WorkItem | undefined;
            if (pinned) {
                updated = await workItemStore.pinWorkItem(workItemId, new Date().toISOString());
            } else {
                updated = await workItemStore.unpinWorkItem(workItemId);
            }

            if (!updated) {
                return handleAPIError(res, notFound('Work item'));
            }

            clearWorkItemResponseCacheForWorkspace(repoId);
            getWsServer?.()?.broadcastProcessEvent({ type: 'work-item-updated', workspaceId: repoId, item: updated });
            sendJSON(res, 200, updated);
        },
    });

    // PATCH /api/workspaces/:id/work-items/:workItemId/archive — Archive/unarchive work item
    routes.push({
        method: 'PATCH',
        pattern: /^\/api\/workspaces\/([^/]+)\/work-items\/([^/]+)\/archive$/,
        handler: async (req: http.IncomingMessage, res: http.ServerResponse, match?: RegExpMatchArray) => {
            const repoId = decodeURIComponent(match![1]);
            const workItemId = decodeURIComponent(match![2]);

            let body: any;
            try {
                body = await parseBody(req);
            } catch {
                return handleAPIError(res, badRequest('Invalid JSON body'));
            }

            const archived = body.archived;
            if (typeof archived !== 'boolean') {
                return handleAPIError(res, badRequest('Missing or invalid "archived" field (boolean)'));
            }

            let updated: WorkItem | undefined;
            if (archived) {
                updated = await workItemStore.archiveWorkItem(workItemId, new Date().toISOString());
            } else {
                updated = await workItemStore.unarchiveWorkItem(workItemId);
            }

            if (!updated) {
                return handleAPIError(res, notFound('Work item'));
            }

            clearWorkItemResponseCacheForWorkspace(repoId);
            getWsServer?.()?.broadcastProcessEvent({ type: 'work-item-updated', workspaceId: repoId, item: updated });
            sendJSON(res, 200, updated);
        },
    });
}
