/**
 * Work Item Command Service
 *
 * Shared create/update command logic used by both the Work Items REST routes
 * and the `create_update_work_item` AI tool. Owns hierarchy (parentId)
 * validation, provider-backed remote sync (GitHub / Azure Boards child
 * creation and reparent/unlink updates), response-cache invalidation, and
 * dashboard broadcasts so REST and AI tool calls behave identically.
 *
 * Commands throw {@link APIError} on validation/sync failures; REST routes
 * translate them via `handleAPIError`, the AI tool maps them to tool-result
 * error payloads.
 */

import * as crypto from 'crypto';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { execGit } from '@plusplusoneplusplus/forge';
import { APIError, missingFields, notFound, badRequest, conflict } from '../errors';
import { readRepoPreferences } from '../preferences-handler';
import type {
    WorkItemStore,
    WorkItemStatus,
    WorkItemType,
    WorkItem,
    WorkItemTrackerMetadata,
    WorkItemPlanVersion,
    WorkItemChange,
    WorkItemSyncParentReference,
} from './types';
import {
    WORK_ITEM_STATUSES,
    WORK_ITEM_TYPES,
    WORK_ITEM_TRACKER_KINDS,
    isValidTransition,
    HIERARCHY_CONTAINER_TYPES,
    isValidParentChildTypes,
    getEffectiveType,
} from './types';
import { resolveGitHubWorkItemSyncRepo, type GitHubWorkItemSyncRepo } from './work-item-sync-github-repo';
import { githubIssueContentRevision } from './work-item-sync-github-issue';
import {
    GhCliGitHubWorkItemIssueTransport,
    createGitHubIssueForLocalChild,
    parentReferenceForGitHubMirrorChild,
    updateGitHubIssueForLocalMirror,
    type AvailableGitHubWorkItemSyncRepo,
    type GitHubWorkItemIssue,
    type GitHubWorkItemIssueTransport,
} from './work-item-sync-github-provider';
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
} from './work-item-sync-azure-boards-provider';
import {
    WORK_ITEM_SYNC_CONFLICT_CODE,
    buildAzureBoardsWorkItemSyncConflict,
    buildGitHubWorkItemSyncConflict,
    type WorkItemSyncConflictResolution,
} from './work-item-sync-conflict';
import {
    unavailableWorkItemSyncProviderStatus,
    type WorkItemSyncProviderAdapter,
    type WorkItemSyncProviderContext,
} from './work-item-sync-provider';
import { executeWorkItem, type EnqueueFunction } from './work-item-executor';
import { clearWorkItemResponseCacheForWorkspace } from './work-item-response-cache';

// ============================================================================
// Context & input types
// ============================================================================

export interface WorkItemBroadcastEvent {
    type: 'work-item-added' | 'work-item-updated';
    workspaceId: string;
    item: unknown;
}

export interface WorkItemCommandContext {
    workItemStore: WorkItemStore;
    /** Required for GitHub/Azure-backed provider operations and auto-execute HEAD capture. */
    processStore?: ProcessStore;
    /** Base CoC data directory, required to resolve workspace provider preferences. */
    dataDir?: string;
    /** When present, status changes to `readyToExecute` with `autoExecute` enqueue execution. */
    enqueue?: EnqueueFunction;
    /** Returns true when the workItems.hierarchy feature flag is enabled. Defaults to false. */
    getHierarchyEnabled?: () => boolean;
    /** Returns true when remote work-item provider integration is enabled. Defaults to true. */
    getSyncEnabled?: () => boolean;
    /** Override GitHub transport for testing. Defaults to GhCliGitHubWorkItemIssueTransport. */
    githubTransport?: GitHubWorkItemIssueTransport;
    /** Override Azure Boards transport for testing. Defaults to AzureBoardsRestWorkItemTransport. */
    azureBoardsTransport?: AzureBoardsWorkItemTransport;
    /** Override Azure Boards status adapter for testing. Defaults to the Azure CLI-backed adapter. */
    azureBoardsProvider?: WorkItemSyncProviderAdapter;
    /** Dashboard broadcast sink (WebSocket process event or chat broadcastFn). */
    broadcast?: (event: WorkItemBroadcastEvent) => void;
}

export const LEGACY_SYNC_LINKS_ERROR = 'syncLinks are no longer accepted on work item create/update payloads. Use Epic-rooted GitHub import, conversion, or child creation instead.';

export interface CreateWorkItemCommandInput {
    id?: unknown;
    title: string;
    /** Legacy field; any value is rejected. */
    syncLinks?: unknown;
    description?: unknown;
    /** Candidate type; unknown values are silently treated as `work-item` (legacy REST behavior). */
    type?: unknown;
    /** Parent work item UUID; requires the hierarchy feature flag. */
    parentId?: unknown;
    tracker?: unknown;
    source?: unknown;
    sourceId?: unknown;
    priority?: unknown;
    tags?: unknown;
    autoExecute?: unknown;
    successCriteria?: unknown;
    /** Initial status override (default `created`); the AI tool passes `planning` with an initial plan. */
    status?: WorkItemStatus;
    plan?: {
        content?: unknown;
        resolvedBy?: unknown;
        reason?: string;
        summary?: string;
        /** Also persist the plan as version 1 in plan-version history (AI tool behavior). */
        recordInitialVersion?: boolean;
    };
}

export interface UpdateWorkItemCommandInput {
    title?: unknown;
    description?: unknown;
    status?: WorkItemStatus;
    priority?: unknown;
    tags?: unknown;
    autoExecute?: unknown;
    completedAt?: unknown;
    reviewComments?: unknown;
    successCriteria?: unknown;
    grillSessionId?: unknown;
    /** Legacy field; any value is rejected. */
    syncLinks?: unknown;
    /**
     * Hierarchy link change. Only participates when the property is present
     * (`'parentId' in input`): a UUID string reparents, `null`/`''` unlinks.
     */
    parentId?: unknown;
    tracker?: unknown;
    plan?: { content?: unknown; resolvedBy?: unknown; reason?: unknown; summary?: unknown };
    syncConflictResolution?: unknown;
    /** Internal route-scope hint for origin-scoped auto-execute task payloads. */
    storageRepoId?: string;
    /**
     * Skip the status-transition validity check while still validating the
     * status value itself. The AI tool forces `planning` on plan updates
     * regardless of the current lifecycle state (legacy tool behavior).
     */
    skipStatusTransitionValidation?: boolean;
}

const VALID_SOURCES: Set<string> = new Set(['manual', 'chat', 'schedule']);
const VALID_PRIORITIES: Set<string> = new Set(['high', 'normal', 'low']);
const VALID_TRACKER_KINDS: Set<string> = new Set(WORK_ITEM_TRACKER_KINDS);
const TRACKER_KEYS: ReadonlySet<string> = new Set(['kind', 'provider', 'github', 'azureBoards']);
const GITHUB_TRACKER_KEYS: ReadonlySet<string> = new Set(['issueId', 'issueNumber', 'issueUrl', 'lastPulledAt']);
const AZURE_BOARDS_TRACKER_KEYS: ReadonlySet<string> = new Set(['workItemId', 'workItemUrl', 'revision', 'updatedAt', 'lastPulledAt']);
const CREDENTIAL_KEY_PATTERN = /(token|secret|password|credential|authorization|auth)/i;
const ALL_VALID_TYPES = new Set<string>(WORK_ITEM_TYPES);

// ============================================================================
// Generic parsing/validation helpers
// ============================================================================

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

// ============================================================================
// Provider error helpers
// ============================================================================

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

/**
 * True when the remote GitHub issue changed since the local mirror last synced.
 *
 * Prefers a real content-revision check: a hash of the remote's CoC-owned
 * content (title, metadata-stripped body, state, labels) is recorded at every
 * pull/push as `lastSyncedRemoteRevision`. Comparing the current remote revision
 * against that base detects a genuine edit to CoC-owned content while ignoring a
 * benign `updated_at` bump (a reaction, comment, cross-reference, lock, or
 * unrelated label) that the old timestamp-string-equality check flagged as a
 * false conflict. Legacy mirrors without a recorded revision fall back to a
 * parsed-instant `updatedAt` comparison so a timestamp reformat alone is not a
 * conflict either.
 */
function githubMirrorIsStale(local: WorkItem, remote: GitHubWorkItemIssue): boolean {
    const baseRevision = local.githubMirror?.lastSyncedRemoteRevision;
    if (baseRevision !== undefined) {
        return githubIssueContentRevision(remote) !== baseRevision;
    }
    return githubUpdatedAtChanged(local.githubMirror?.updatedAt, remote.updatedAt);
}

/**
 * Compare two GitHub `updated_at` timestamps as instants rather than raw
 * strings, so an ISO reformat (millisecond precision, timezone offset form)
 * does not register as a change. Falls back to string inequality when either
 * value is non-parseable, and treats a missing value on either side as "no
 * detectable change" (matching the prior short-circuit behavior).
 */
function githubUpdatedAtChanged(local: string | undefined, remote: string | undefined): boolean {
    if (!local || !remote) return false;
    const localTime = Date.parse(local);
    const remoteTime = Date.parse(remote);
    if (Number.isNaN(localTime) || Number.isNaN(remoteTime)) {
        return local !== remote;
    }
    return localTime !== remoteTime;
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

// ============================================================================
// Hierarchy / provider plumbing
// ============================================================================

function isHierarchyEnabled(ctx: WorkItemCommandContext): boolean {
    return ctx.getHierarchyEnabled?.() ?? false;
}

function isSyncEnabled(ctx: WorkItemCommandContext): boolean {
    return ctx.getSyncEnabled?.() ?? true;
}

/**
 * True when two repoId strings refer to the same upstream origin.
 *
 * The same upstream repo carries two identity layers: a per-clone workspace id
 * (`ws-*`, hashed from the filesystem path) and a canonical origin scope
 * (`gh_<owner>_<repo>`, derived from the git remote). Work items are physically
 * stored under the canonical origin scope, but each item's `repoId` is stamped
 * with whatever id the caller's URL family used — so two items in the same
 * store can hold different `repoId` strings. A raw string compare therefore
 * falsely rejects linking a `ws-*`-stamped child to a `gh_*`-stamped parent of
 * the same repo.
 *
 * Normalize both ids to their canonical storage scope (reusing the store's
 * origin-id resolution, including the `legacyRepoIds` migration machinery)
 * before comparing. Falls back to raw equality when the store does not expose
 * origin resolution, preserving behavior for callers that operate on canonical
 * ids directly.
 */
async function isSameWorkItemOrigin(
    ctx: WorkItemCommandContext,
    repoIdA: string,
    repoIdB: string,
): Promise<boolean> {
    if (repoIdA === repoIdB) return true;
    const resolve = ctx.workItemStore.resolveOriginId?.bind(ctx.workItemStore);
    if (!resolve) return false;
    const [a, b] = await Promise.all([resolve(repoIdA), resolve(repoIdB)]);
    return a === b;
}

async function findTreeRoot(ctx: WorkItemCommandContext, item: WorkItem, repoId: string): Promise<WorkItem> {
    let current = item;
    const visited = new Set<string>();
    while (current.parentId && !visited.has(current.id)) {
        visited.add(current.id);
        const parent = await ctx.workItemStore.getWorkItem(current.parentId, repoId);
        if (!parent) break;
        current = parent;
    }
    return current;
}

/**
 * Reject a reparent that would make `workItemId` an ancestor of itself.
 * Type rules already make cycles structurally impossible, but legacy data
 * could carry inconsistent types, so guard explicitly.
 */
async function assertNoHierarchyCycle(
    ctx: WorkItemCommandContext,
    workItemId: string,
    newParent: WorkItem,
    repoId: string,
): Promise<void> {
    let ancestor: WorkItem | undefined = newParent;
    const visited = new Set<string>();
    while (ancestor && !visited.has(ancestor.id)) {
        if (ancestor.id === workItemId) {
            throw badRequest('Reparenting would create a hierarchy cycle');
        }
        visited.add(ancestor.id);
        ancestor = ancestor.parentId
            ? await ctx.workItemStore.getWorkItem(ancestor.parentId, repoId)
            : undefined;
    }
}

/**
 * Map a stale Azure Boards work item's remote parent back to a local mirror id
 * for the structured conflict payload. Returns `null` when the remote item has
 * no parent (Epic root), or `undefined` when the remote parent is not mirrored
 * locally (so the parent row is omitted from the conflict).
 */
async function azureBoardsRemoteParentLocalId(
    ctx: WorkItemCommandContext,
    remote: AzureBoardsWorkItem,
    repoId: string,
): Promise<string | null | undefined> {
    const parentRemoteId = azureBoardsParentWorkItemId(remote);
    if (parentRemoteId === undefined) return null;
    const entries = (await ctx.workItemStore.listWorkItems({ repoId })).items;
    const match = entries.find(entry => entry.azureBoardsMirror?.workItemId === parentRemoteId);
    return match?.id;
}

async function resolveAvailableGitHubRepo(
    ctx: WorkItemCommandContext,
    repoId: string,
): Promise<Extract<GitHubWorkItemSyncRepo, { available: true }>> {
    if (!ctx.dataDir || !ctx.processStore) {
        throw new APIError(
            409,
            'GitHub-backed child creation requires the server data directory.',
            'WORK_ITEM_GITHUB_REPO_UNAVAILABLE',
        );
    }
    const workspaces = await ctx.processStore.getWorkspaces();
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

async function buildAzureBoardsProviderContext(
    ctx: WorkItemCommandContext,
    repoId: string,
): Promise<WorkItemSyncProviderContext> {
    const workspaces = await ctx.processStore?.getWorkspaces?.() ?? [];
    return {
        workspaceId: repoId,
        workspace: workspaces.find(workspace => workspace.id === repoId),
        preferences: ctx.dataDir ? readRepoPreferences(ctx.dataDir, repoId) : {},
    };
}

async function resolveAvailableAzureBoardsProject(
    ctx: WorkItemCommandContext,
    repoId: string,
): Promise<AvailableAzureBoardsWorkItemSyncProject> {
    if (!ctx.dataDir) {
        throw azureBoardsProviderError(
            'Azure Boards-backed work item writes require the server data directory.',
            'WORK_ITEM_AZURE_BOARDS_PROJECT_UNAVAILABLE',
        );
    }
    const provider = ctx.azureBoardsProvider ?? createAzureBoardsWorkItemSyncProviderAdapter({ dataDir: ctx.dataDir });
    const status = await provider.getStatus(await buildAzureBoardsProviderContext(ctx, repoId));
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
    ctx: WorkItemCommandContext,
    item: WorkItem,
    parentItem: WorkItem | undefined,
    repoId: string,
    now: string,
): Promise<WorkItem> {
    if (!parentItem) return item;
    const root = await findTreeRoot(ctx, parentItem, repoId);
    if (root.tracker?.kind !== 'github-backed') return item;
    if (!parentItem.githubMirror?.issueNumber) {
        throw new APIError(
            409,
            `Parent work item '${parentItem.id}' is not mirrored to GitHub.`,
            'WORK_ITEM_GITHUB_PARENT_NOT_MIRRORED',
        );
    }

    const repo = await resolveAvailableGitHubRepo(ctx, repoId);
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
    ctx: WorkItemCommandContext,
    item: WorkItem,
    parentItem: WorkItem | undefined,
    repoId: string,
    now: string,
): Promise<WorkItem> {
    if (!parentItem) return item;
    const root = await findTreeRoot(ctx, parentItem, repoId);
    if (root.tracker?.kind !== 'azure-boards-backed' || root.tracker.provider !== 'azure-boards') return item;
    if (azureBoardsRemoteWorkItemIdForLocalItem(parentItem) === undefined) {
        throw azureBoardsProviderError(
            `Parent work item '${parentItem.id}' is not mirrored to Azure Boards.`,
            'WORK_ITEM_AZURE_BOARDS_PARENT_NOT_MIRRORED',
        );
    }

    const project = await resolveAvailableAzureBoardsProject(ctx, repoId);
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
    ctx: WorkItemCommandContext,
    current: WorkItem,
    root: WorkItem,
    newParent: WorkItem | undefined,
    repoId: string,
): Promise<number | null | undefined> {
    if (!newParent) return null;
    const newParentRoot = await findTreeRoot(ctx, newParent, repoId);
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
    ctx: WorkItemCommandContext,
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
        const newParentRoot = await findTreeRoot(ctx, newParent!, repoId);
        if (newParentRoot.id !== root.id || newParentRoot.tracker?.kind !== 'github-backed') {
            throw githubProviderError(
                `Parent work item '${newParent!.id}' is not in the same GitHub-backed Epic tree as '${current.id}'.`,
                'WORK_ITEM_GITHUB_PARENT_NOT_MIRRORED',
            );
        }
        parentItem = newParent;
    } else {
        parentItem = await ctx.workItemStore.getWorkItem(effectiveParentId, repoId);
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
    ctx: WorkItemCommandContext,
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
    if (!isSyncEnabled(ctx)) return updates;

    const root = await findTreeRoot(ctx, current, repoId);
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

    const repo = await resolveAvailableGitHubRepo(ctx, repoId);
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

    const parent = await githubParentReferenceForUpdate(ctx, current, root, repo, parentChanged, newParent, repoId);

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
    ctx: WorkItemCommandContext,
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
    if (!isSyncEnabled(ctx)) return updates;

    const root = await findTreeRoot(ctx, current, repoId);
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

    const project = await resolveAvailableAzureBoardsProject(ctx, repoId);
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
            const remoteParentLocalId = await azureBoardsRemoteParentLocalId(ctx, remote, repoId);
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
        ? await azureBoardsParentWorkItemIdForUpdate(ctx, current, root, newParent, repoId)
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

// ============================================================================
// Create command
// ============================================================================

/**
 * Create a work item with full hierarchy validation, provider-backed child
 * creation, response-cache invalidation, and dashboard broadcast.
 *
 * @throws {APIError} on validation, conflict, or provider sync failure.
 */
export async function createWorkItemCommand(
    ctx: WorkItemCommandContext,
    repoId: string,
    input: CreateWorkItemCommandInput,
): Promise<WorkItem> {
    if (!input.title) {
        throw missingFields(['title']);
    }

    const now = new Date().toISOString();
    const hierarchyEnabled = isHierarchyEnabled(ctx);
    let tracker: WorkItemTrackerMetadata | undefined;
    let parentItem: WorkItem | undefined;
    if (input.syncLinks !== undefined) {
        throw badRequest(LEGACY_SYNC_LINKS_ERROR);
    }
    try {
        tracker = parseTracker(input.tracker);
    } catch (err) {
        throw badRequest(err instanceof Error ? err.message : 'Invalid work item metadata');
    }

    // Validate type: hierarchy-only types require the flag to be enabled
    let resolvedType: WorkItemType | undefined;
    if (input.type) {
        if (typeof input.type === 'string' && ALL_VALID_TYPES.has(input.type)) {
            if (HIERARCHY_CONTAINER_TYPES.has(input.type as WorkItemType) && !hierarchyEnabled) {
                throw badRequest(
                    `Type '${input.type}' requires the workItems.hierarchy feature flag to be enabled`,
                );
            }
            resolvedType = input.type as WorkItemType;
        }
        // Unknown types are silently ignored (treated as work-item)
    }

    // Validate parentId: only allowed when hierarchy is enabled
    if (input.parentId && !hierarchyEnabled) {
        throw badRequest('parentId requires the workItems.hierarchy feature flag to be enabled');
    }

    // Validate parent-child type relationship when parentId is provided
    if (input.parentId && hierarchyEnabled) {
        parentItem = await ctx.workItemStore.getWorkItem(String(input.parentId), repoId);
        if (!parentItem) {
            throw badRequest(`Parent work item not found: ${input.parentId}`);
        }
        if (!await isSameWorkItemOrigin(ctx, parentItem.repoId, repoId)) {
            throw badRequest('Parent work item must be in the same workspace');
        }
        const childType = resolvedType ?? 'work-item';
        const parentType = getEffectiveType(parentItem.type);
        if (!isValidParentChildTypes(childType, parentType)) {
            throw badRequest(
                `Invalid parent-child type combination: '${parentType}' cannot be a parent of '${childType}'`,
            );
        }
    }

    if (input.id && await ctx.workItemStore.getWorkItem(String(input.id), repoId)) {
        throw conflict(`Work item already exists: ${input.id}`);
    }

    const trackerPlacementError = validateTrackerRootPlacement(
        tracker,
        resolvedType ?? 'work-item',
        hierarchyEnabled && input.parentId ? String(input.parentId) : undefined,
    );
    if (trackerPlacementError) {
        throw badRequest(trackerPlacementError);
    }

    let item: WorkItem = {
        id: input.id ? String(input.id) : crypto.randomUUID(),
        repoId,
        title: input.title,
        description: typeof input.description === 'string' && input.description ? input.description : '',
        status: input.status ?? 'created',
        type: resolvedType,
        parentId: hierarchyEnabled && input.parentId ? String(input.parentId) : undefined,
        tracker,
        createdAt: now,
        updatedAt: now,
        source: typeof input.source === 'string' && VALID_SOURCES.has(input.source) ? input.source as WorkItem['source'] : 'manual',
        sourceId: typeof input.sourceId === 'string' ? input.sourceId : undefined,
        priority: typeof input.priority === 'string' && VALID_PRIORITIES.has(input.priority) ? input.priority as WorkItem['priority'] : undefined,
        tags: Array.isArray(input.tags) ? input.tags : undefined,
        autoExecute: input.autoExecute === true,
        successCriteria: typeof input.successCriteria === 'string' && input.successCriteria.trim()
            ? input.successCriteria
            : undefined,
    };

    const planContent = typeof input.plan?.content === 'string' && input.plan.content ? input.plan.content : undefined;
    const planResolvedBy = input.plan?.resolvedBy === 'ai' ? 'ai' as const : 'user' as const;
    if (planContent) {
        item.plan = {
            version: 1,
            currentVersion: 1,
            content: planContent,
            updatedAt: now,
            resolvedBy: input.plan?.resolvedBy === 'ai' || input.plan?.resolvedBy === 'user'
                ? input.plan.resolvedBy
                : 'user',
            source: planResolvedBy,
        };
        item.currentContentVersion = 1;
    }

    item = await pushNewGitHubBackedChildIfNeeded(ctx, item, parentItem, repoId, now);
    item = await pushNewAzureBoardsBackedChildIfNeeded(ctx, item, parentItem, repoId, now);

    try {
        await ctx.workItemStore.addWorkItem(item);
    } catch (err: any) {
        if (err?.message?.includes('already exists')) {
            throw conflict(err.message);
        }
        throw err;
    }

    if (planContent && input.plan?.recordInitialVersion) {
        await ctx.workItemStore.savePlanVersion(item.id, {
            version: 1,
            content: planContent,
            createdAt: now,
            resolvedBy: planResolvedBy,
            source: planResolvedBy,
            authorType: planResolvedBy,
            reason: input.plan.reason,
            summary: input.plan.summary,
        }, repoId);
    }

    clearWorkItemResponseCacheForWorkspace(repoId);
    ctx.broadcast?.({ type: 'work-item-added', workspaceId: repoId, item });
    return item;
}

// ============================================================================
// Update command
// ============================================================================

/**
 * Patch a work item with full status-transition validation, hierarchy
 * (reparent/unlink) validation, plan versioning, provider-backed remote sync,
 * auto-execute, response-cache invalidation, and dashboard broadcast.
 *
 * Returns the updated work item (post auto-execute when it ran).
 *
 * @throws {APIError} on validation, not-found, or provider sync failure.
 */
export async function updateWorkItemCommand(
    ctx: WorkItemCommandContext,
    repoId: string,
    workItemId: string,
    input: UpdateWorkItemCommandInput,
): Promise<WorkItem> {
    const current = await ctx.workItemStore.getWorkItem(workItemId, repoId);
    if (!current) {
        throw notFound('Work item');
    }

    let syncConflictResolution: WorkItemSyncConflictResolution | undefined;
    try {
        syncConflictResolution = parseWorkItemSyncConflictResolution(input.syncConflictResolution);
    } catch (err) {
        throw badRequest(err instanceof Error ? err.message : 'Invalid syncConflictResolution');
    }

    // Validate status transition if status is being changed
    if (input.status) {
        if (!WORK_ITEM_STATUSES.includes(input.status as any)) {
            throw badRequest(`Invalid status: ${input.status}`);
        }
        if (!input.skipStatusTransitionValidation
            && current.status !== input.status
            && !isValidTransition(current.status, input.status)) {
            throw badRequest(`Invalid status transition: ${current.status} → ${input.status}`);
        }
    }

    const updates: Partial<WorkItem> = {};
    let pendingPlanVersion: WorkItemPlanVersion | undefined;
    if (input.title !== undefined) updates.title = input.title as string;
    if (input.description !== undefined) updates.description = input.description as string;
    if (input.status !== undefined) updates.status = input.status;
    if (input.priority !== undefined) updates.priority = input.priority as WorkItem['priority'];
    if (input.tags !== undefined) updates.tags = input.tags as string[];
    if (input.autoExecute !== undefined) updates.autoExecute = input.autoExecute as boolean;
    if (input.completedAt !== undefined) updates.completedAt = input.completedAt as string;
    if (input.reviewComments !== undefined) updates.reviewComments = input.reviewComments as WorkItem['reviewComments'];
    if (input.successCriteria !== undefined) updates.successCriteria = input.successCriteria as string;
    if (input.grillSessionId !== undefined) updates.grillSessionId = input.grillSessionId as string;
    if (input.syncLinks !== undefined) {
        throw badRequest(LEGACY_SYNC_LINKS_ERROR);
    }
    if (input.plan !== undefined) {
        if (!isObject(input.plan) || typeof input.plan.content !== 'string') {
            throw badRequest('plan.content must be a string');
        }
        if (!input.plan.content.trim()) {
            throw badRequest('plan.content must contain non-whitespace content');
        }
        const now = new Date().toISOString();
        const newVersion = (current.plan?.version ?? 0) + 1;
        const resolvedBy = input.plan.resolvedBy === 'ai' ? 'ai' : 'user';
        pendingPlanVersion = {
            version: newVersion,
            content: input.plan.content,
            createdAt: now,
            resolvedBy,
            source: resolvedBy,
            authorType: resolvedBy,
            reason: typeof input.plan.reason === 'string' ? input.plan.reason : undefined,
            summary: typeof input.plan.summary === 'string' ? input.plan.summary : undefined,
        };
        updates.currentContentVersion = newVersion;
        updates.plan = {
            version: newVersion,
            currentVersion: newVersion,
            content: input.plan.content,
            updatedAt: now,
            resolvedBy,
            source: resolvedBy,
            reason: pendingPlanVersion.reason,
        };
    }
    if (input.tracker !== undefined) {
        try {
            updates.tracker = parseTracker(input.tracker);
        } catch (err) {
            throw badRequest(err instanceof Error ? err.message : 'Invalid tracker metadata');
        }
        const resultingParentId = 'parentId' in input
            ? (input.parentId === null || input.parentId === '' ? undefined : String(input.parentId))
            : current.parentId;
        const trackerPlacementError = validateTrackerRootPlacement(
            updates.tracker,
            getEffectiveType(current.type),
            resultingParentId,
        );
        if (trackerPlacementError) {
            throw badRequest(trackerPlacementError);
        }
    }

    // Handle parentId reparenting when hierarchy is enabled
    let newParentForRemote: WorkItem | undefined;
    let parentChanged = false;
    if ('parentId' in input) {
        if (!isHierarchyEnabled(ctx)) {
            throw badRequest('parentId requires the workItems.hierarchy feature flag to be enabled');
        }
        parentChanged = true;
        if (input.parentId === null || input.parentId === '') {
            // Unlink parent
            updates.parentId = undefined;
        } else if (typeof input.parentId === 'string') {
            // Validate new parent
            if (input.parentId === workItemId) {
                throw badRequest('A work item cannot be its own parent');
            }
            const newParent = await ctx.workItemStore.getWorkItem(input.parentId, repoId);
            if (!newParent) {
                throw badRequest(`Parent work item not found: ${input.parentId}`);
            }
            if (!await isSameWorkItemOrigin(ctx, newParent.repoId, repoId)) {
                throw badRequest('Parent work item must be in the same workspace');
            }
            // Validate the parent-child type combination for the current item
            const childType = getEffectiveType(current.type);
            const parentType = getEffectiveType(newParent.type);
            if (!isValidParentChildTypes(childType, parentType)) {
                throw badRequest(
                    `Invalid parent-child type combination: '${parentType}' cannot be a parent of '${childType}'`,
                );
            }
            await assertNoHierarchyCycle(ctx, workItemId, newParent, repoId);
            updates.parentId = input.parentId;
            newParentForRemote = newParent;
        }
    }

    let remoteReadyUpdates = await pushAzureBoardsBackedUpdateIfNeeded(
        ctx,
        current,
        updates,
        repoId,
        parentChanged,
        newParentForRemote,
        syncConflictResolution,
    );
    remoteReadyUpdates = await pushGitHubBackedUpdateIfNeeded(
        ctx,
        current,
        remoteReadyUpdates,
        repoId,
        parentChanged,
        newParentForRemote,
        syncConflictResolution,
    );

    if (pendingPlanVersion) {
        await ctx.workItemStore.savePlanVersion(workItemId, pendingPlanVersion, repoId);
    }
    const updated = await ctx.workItemStore.updateWorkItem(workItemId, remoteReadyUpdates, repoId);
    if (!updated) {
        throw notFound('Work item');
    }

    if (updates.plan) {
        const change: WorkItemChange = {
            id: crypto.randomUUID(),
            planVersion: updates.plan.version,
            commits: [],
            startedAt: updates.plan.updatedAt ?? new Date().toISOString(),
            status: 'open',
        };
        ctx.workItemStore.addChange(workItemId, change, repoId).catch(() => { /* non-fatal */ });
    }

    // Auto-execute if status transitioned to 'readyToExecute' and autoExecute is enabled
    if (updated.status === 'readyToExecute' && updated.autoExecute && ctx.enqueue) {
        try {
            // Capture git HEAD before execution for commit range tracking
            let headBefore: string | undefined;
            try {
                const workspaces = await ctx.processStore?.getWorkspaces() ?? [];
                const workspace = workspaces.find(w => w.id === repoId);
                if (workspace?.rootPath) {
                    headBefore = execGit(['rev-parse', 'HEAD'], workspace.rootPath);
                }
            } catch { /* non-fatal */ }

            await executeWorkItem(workItemId, ctx.workItemStore, ctx.enqueue, {
                headBefore,
                repoId: input.storageRepoId ?? repoId,
                workspaceId: repoId,
            });
            const afterExec = await ctx.workItemStore.getWorkItem(workItemId, repoId);
            if (afterExec) {
                clearWorkItemResponseCacheForWorkspace(repoId);
                ctx.broadcast?.({ type: 'work-item-updated', workspaceId: repoId, item: afterExec });
                return afterExec;
            }
        } catch {
            // Auto-execute failed; still return the updated work item
        }
    }

    clearWorkItemResponseCacheForWorkspace(repoId);
    ctx.broadcast?.({ type: 'work-item-updated', workspaceId: repoId, item: updated });
    return updated;
}
