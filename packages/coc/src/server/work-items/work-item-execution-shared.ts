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
 *
 * It also owns the default command runner the execution commands use for their
 * git and `gh` invocations. Its git half runs in the native addon; only `gh`
 * still starts a child process here.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { execGitAsync } from '@plusplusoneplusplus/forge';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { badRequest, notFound } from '../errors';
import type { ProcessWebSocketServer } from '../streaming/websocket';
import type { WorkItem, WorkItemStore } from './types';
import { getOwnWorkItemTrackerKind } from './types';
import type { EnqueueFunction } from './work-item-executor';
import { clearWorkItemResponseCacheForWorkspace } from './work-item-response-cache';

const execFileAsync = promisify(execFile);

/** Bytes of output kept, for both the git and the `gh` path. */
const COMMAND_MAX_BUFFER = 1024 * 1024 * 10;

export interface WorkItemCommandResult {
    stdout: string;
    /**
     * Empty for a `git` command run by {@link defaultWorkItemCommandRunner} —
     * the native runner keeps stderr only for a failure, where it becomes the
     * message. `gh` still reports both streams.
     */
    stderr: string;
}

export interface WorkItemCommandOptions {
    cwd: string;
}

export interface WorkItemCommandRunner {
    (command: string, args: string[], options: WorkItemCommandOptions): Promise<WorkItemCommandResult>;
}

/**
 * Default runner used when a caller does not inject one (tests inject).
 *
 * `git` runs in the native addon through forge's `execGitAsync`, so the nine
 * git commands behind a PR submission no longer cost nine children spawned
 * from the event-loop thread. Anything else — `gh` — keeps Node's `execFile`.
 *
 * Two details of the git path are load-bearing:
 *
 * - `timeout: 0`. This runner never had a timeout and `execGitAsync` defaults
 *   to 30 s, so taking the default would kill the `fetch` and the `push` of a
 *   real repository mid-transfer.
 * - `stderr` comes back empty; see {@link WorkItemCommandResult}. Nothing here
 *   reads a git command's stderr on success, and a failure carries it in the
 *   `git <args> failed: <stderr>` rejection instead.
 *
 * A `NativeAddonLoadError` is deliberately not caught. The submission's first
 * command is a `git status --porcelain` with no guard around it, so a broken
 * binary fails the whole request wearing the words that name the rebuild.
 */
export async function defaultWorkItemCommandRunner(
    command: string,
    args: string[],
    options: WorkItemCommandOptions,
): Promise<WorkItemCommandResult> {
    if (command === 'git') {
        const stdout = await execGitAsync(args, options.cwd, {
            maxBuffer: COMMAND_MAX_BUFFER,
            timeout: 0,
        });
        return { stdout, stderr: '' };
    }
    const { stdout, stderr } = await execFileAsync(command, args, {
        cwd: options.cwd,
        encoding: 'utf8',
        maxBuffer: COMMAND_MAX_BUFFER,
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
    /** Injected git/`gh` runner. Defaults to {@link defaultWorkItemCommandRunner}. */
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
