/**
 * Shared context, scope input and settlement helpers for the Work Item
 * execution command services.
 *
 * Every execution command (execute, PR submission, AI review, comment
 * resolution, from-chat creation) receives the same context and the same
 * explicit repo-id pair:
 *
 *   - `storageRepoId` — where the Work Item is persisted (origin id for
 *     origin-scoped routes); also the cache/broadcast scope.
 *   - `commandRepoId` — the concrete workspace the side effects run against
 *     (git checkout, queue routing, comment storage).
 *
 * Both are required named fields so a command can never silently fall back to
 * the wrong one.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { badRequest, notFound } from '../errors';
import type { ProcessWebSocketServer } from '../streaming/websocket';
import type { WorkItem, WorkItemStore } from './types';
import { getOwnWorkItemTrackerKind } from './types';
import type { EnqueueFunction } from './work-item-executor';
import { clearWorkItemResponseCacheForWorkspace } from './work-item-response-cache';

const execFileAsync = promisify(execFile);

export interface WorkItemCommandResult {
    stdout: string;
    stderr: string;
}

export interface WorkItemCommandOptions {
    cwd: string;
}

export interface WorkItemCommandRunner {
    (command: string, args: string[], options: WorkItemCommandOptions): Promise<WorkItemCommandResult>;
}

/** Default runner used when a caller does not inject one (tests inject). */
export async function defaultWorkItemCommandRunner(
    command: string,
    args: string[],
    options: WorkItemCommandOptions,
): Promise<WorkItemCommandResult> {
    const { stdout, stderr } = await execFileAsync(command, args, {
        cwd: options.cwd,
        encoding: 'utf8',
        maxBuffer: 1024 * 1024 * 10,
    });
    return { stdout: stdout ?? '', stderr: stderr ?? '' };
}

export interface WorkItemExecutionCommandContext {
    workItemStore: WorkItemStore;
    processStore: ProcessStore;
    /** Queue sink; commands that need it throw when it is absent. */
    enqueue?: EnqueueFunction;
    getWsServer?: () => ProcessWebSocketServer;
    /** Whether the `workItems.workflow.enabled` feature flag is on. */
    getWorkflowEnabled?: () => boolean;
    /** Whether the opt-in Git worktree execution feature flag is on. */
    getGitWorktreeExecutionEnabled?: () => boolean;
    /** Injected git/gh runner. Defaults to {@link defaultWorkItemCommandRunner}. */
    runCommand?: WorkItemCommandRunner;
    /** CoC data directory (e.g. ~/.coc). */
    dataDir?: string;
}

/** Explicit repo scope carried by every Work Item execution command. */
export interface WorkItemCommandScope {
    workItemId: string;
    /** Storage/origin scope: Work Item persistence, cache invalidation, broadcasts. */
    storageRepoId: string;
    /** Concrete workspace scope: git checkout, queue routing, comment storage. */
    commandRepoId: string;
}

/**
 * Whether an item is a local-only workflow leaf: the eligibility rule shared by
 * Ralph execution, PR submission and AI review.
 */
export function isLocalOnlyWorkflowLeaf(item: WorkItem): boolean {
    const effectiveType = item.type ?? 'work-item';
    return (effectiveType === 'work-item' || effectiveType === 'goal')
        && getOwnWorkItemTrackerKind(item) === 'local-only'
        && !item.githubMirror
        && !item.azureBoardsMirror;
}

/** Queue sink or a 400 when task execution is unavailable on this server. */
export function requireEnqueue(ctx: WorkItemExecutionCommandContext): EnqueueFunction {
    if (!ctx.enqueue) {
        throw badRequest('Task execution is not available');
    }
    return ctx.enqueue;
}

/** Load a Work Item from its storage scope, or throw a 404. */
export async function requireWorkItem(
    ctx: WorkItemExecutionCommandContext,
    scope: WorkItemCommandScope,
): Promise<WorkItem> {
    const item = await ctx.workItemStore.getWorkItem(scope.workItemId, scope.storageRepoId);
    if (!item) {
        throw notFound('Work item');
    }
    return item;
}

/** Registered root path for a concrete workspace, or `undefined`. */
export async function workspaceRootPath(
    ctx: WorkItemExecutionCommandContext,
    workspaceId: string,
): Promise<string | undefined> {
    try {
        const workspaces = await ctx.processStore.getWorkspaces();
        return workspaces.find(entry => entry.id === workspaceId)?.rootPath;
    } catch {
        return undefined;
    }
}

/** Invalidate the response cache for a storage scope and broadcast the item. */
export function settleWorkItemBroadcast(
    ctx: WorkItemExecutionCommandContext,
    storageRepoId: string,
    item: WorkItem,
): void {
    clearWorkItemResponseCacheForWorkspace(storageRepoId);
    ctx.getWsServer?.()?.broadcastProcessEvent({ type: 'work-item-updated', workspaceId: storageRepoId, item });
}

/**
 * Re-read the Work Item after a mutation and settle cache + broadcast.
 * Returns the fresh item, or `undefined` when it is no longer readable.
 */
export async function settleWorkItemUpdate(
    ctx: WorkItemExecutionCommandContext,
    scope: WorkItemCommandScope,
): Promise<WorkItem | undefined> {
    const updated = await ctx.workItemStore.getWorkItem(scope.workItemId, scope.storageRepoId);
    if (updated) {
        settleWorkItemBroadcast(ctx, scope.storageRepoId, updated);
    }
    return updated;
}
