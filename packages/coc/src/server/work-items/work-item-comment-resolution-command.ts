/**
 * Owns `POST .../work-items/:wid/resolve-comments`. Plan comments and commit
 * diff comments use different storage and keying models, so they are separate
 * resolvers here; they share only the leaf-type guard and the cache/broadcast
 * settlement in {@link resolveWorkItemCommentsCommand}.
 *
 * Comment storage is always keyed by `commandRepoId` (the concrete workspace),
 * while execution history is written to `storageRepoId`.
 */

import * as path from 'path';
import { badRequest } from '../errors';
import type { DiffCommentsManager } from '../tasks/comments/diff-comments-manager';
import type { TaskCommentsManager } from '../tasks/comments/task-comments-manager';
import { buildBatchResolvePrompt } from '../tasks/comments/task-comments-ai';
import { buildMultiFileBatchResolvePrompt } from '../tasks/comments/diff-comments-ai';
import { HIERARCHY_CONTAINER_TYPES } from './types';
import { resolveWorkItemComments } from './work-item-executor';
import {
    requireEnqueue,
    requireWorkItem,
    settleWorkItemUpdate,
    workspaceRootPath,
    type WorkItemCommandScope,
    type WorkItemExecutionCommandContext,
} from './work-item-execution-shared';

/** Comment managers required by the resolution commands. */
export interface WorkItemCommentResolutionContext extends WorkItemExecutionCommandContext {
    taskCommentsManager: TaskCommentsManager;
    diffCommentsManager: DiffCommentsManager;
}

export type WorkItemCommentResolutionType = 'plan' | 'commit';

export interface ResolveWorkItemCommentsCommandInput extends WorkItemCommandScope {
    type: WorkItemCommentResolutionType;
    /** Required for commit resolution; ignored for plan resolution. */
    commitSha?: string;
    /** Which Run# triggered the comments being resolved (display only). */
    sourceRunIndex?: number;
    /** Model passthrough for the resolve session. */
    model?: string;
}

/** Inline plan comments are stored under a synthetic per-work-item document path. */
export function planCommentDocumentPath(workItemId: string): string {
    return `__wi-plan__/${workItemId}`;
}

/** Parse the `type` field; anything else is a 400. */
export function parseCommentResolutionType(value: unknown): WorkItemCommentResolutionType {
    if (value !== 'plan' && value !== 'commit') {
        throw badRequest('Missing or invalid field: type (must be "plan" or "commit")');
    }
    return value;
}

async function resolvePlanComments(
    ctx: WorkItemCommentResolutionContext,
    input: ResolveWorkItemCommentsCommandInput,
    documentContent: string,
): Promise<unknown> {
    const enqueue = requireEnqueue(ctx);
    const planCommentPath = planCommentDocumentPath(input.workItemId);
    const allComments = await ctx.taskCommentsManager.getComments(input.commandRepoId, planCommentPath);
    const openComments = allComments.filter(c => c.status === 'open');
    if (openComments.length === 0) {
        throw badRequest('No open plan comments to resolve');
    }

    const prompt = buildBatchResolvePrompt(openComments, planCommentPath, planCommentPath, undefined, documentContent);
    const commentIds = openComments.map(c => c.id);

    return resolveWorkItemComments(input.workItemId, ctx.workItemStore, enqueue, {
        type: 'plan',
        repoId: input.storageRepoId,
        workspaceId: input.commandRepoId,
        model: input.model,
        prompt,
        resolveContext: {
            files: [planCommentPath],
            resolveComments: {
                documentUri: planCommentPath,
                commentIds,
                documentContent,
                filePath: planCommentPath,
                wsId: input.commandRepoId,
            },
        },
    });
}

async function resolveCommitComments(
    ctx: WorkItemCommentResolutionContext,
    input: ResolveWorkItemCommentsCommandInput,
): Promise<unknown> {
    const enqueue = requireEnqueue(ctx);
    const commitSha = input.commitSha;
    if (!commitSha) {
        throw badRequest('Missing required field: commitSha');
    }
    const oldRef = `${commitSha}^`;
    const newRef = commitSha;

    const allComments = await ctx.diffCommentsManager.listAllComments(input.commandRepoId);
    const targetComments = allComments
        .filter(c => c.context.oldRef === oldRef && c.context.newRef === newRef)
        .map(comment => ({ comment, storageKey: ctx.diffCommentsManager.hashContext(comment.context) }))
        .filter(entry => entry.comment.status === 'open');

    if (targetComments.length === 0) {
        throw badRequest('No open diff comments for this commit');
    }

    // Group by storage key so each stored diff-comment document is resolved once.
    const grouped = new Map<string, { storageKey: string; commentIds: string[]; filePath: string }>();
    for (const entry of targetComments) {
        const existing = grouped.get(entry.storageKey)
            ?? { storageKey: entry.storageKey, commentIds: [], filePath: entry.comment.context.filePath };
        existing.commentIds.push(entry.comment.id);
        grouped.set(entry.storageKey, existing);
    }
    const files = Array.from(grouped.values());

    const fileEntries = files.map(file => ({
        filePath: file.filePath,
        comments: targetComments
            .filter(entry => entry.storageKey === file.storageKey)
            .map(entry => entry.comment),
    }));

    const prompt = buildMultiFileBatchResolvePrompt(fileEntries, oldRef, newRef);
    if (!prompt) {
        throw badRequest('No open diff comments for this commit');
    }

    // Resolve workspace root for file paths; fall back to the server cwd.
    const wsRootPath = await workspaceRootPath(ctx, input.commandRepoId) ?? process.cwd();

    return resolveWorkItemComments(input.workItemId, ctx.workItemStore, enqueue, {
        type: 'commit',
        repoId: input.storageRepoId,
        workspaceId: input.commandRepoId,
        commitSha,
        sourceRunIndex: input.sourceRunIndex,
        model: input.model,
        prompt,
        resolveContext: {
            files: files.map(file => path.resolve(wsRootPath, file.filePath)),
            resolveDiffCommentsMulti: {
                files,
                wsId: input.commandRepoId,
                oldRef,
                newRef,
            },
        },
    });
}

export async function resolveWorkItemCommentsCommand(
    ctx: WorkItemCommentResolutionContext,
    input: ResolveWorkItemCommentsCommandInput,
): Promise<unknown> {
    requireEnqueue(ctx);
    const item = await requireWorkItem(ctx, input);

    // Only leaf types (work-item, bug) can run resolve-comments.
    const effectiveType = item.type ?? 'work-item';
    if (HIERARCHY_CONTAINER_TYPES.has(effectiveType)) {
        throw badRequest(`Only WorkItem and Bug items can have comments resolved. "${effectiveType}" is a planning container.`);
    }

    const result = input.type === 'plan'
        ? await resolvePlanComments(ctx, input, item.plan?.content ?? '')
        : await resolveCommitComments(ctx, input);

    await settleWorkItemUpdate(ctx, input);
    return result;
}
