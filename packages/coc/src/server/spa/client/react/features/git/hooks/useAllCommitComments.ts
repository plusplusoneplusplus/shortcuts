/**
 * useAllCommitComments — every diff comment of one commit across all of its
 * files, plus the commit-level AI actions. Reading, CRUD, live refresh and the
 * copy-all prompt come from the shared `useReviewComments`.
 */

import { useState, useCallback, useRef } from 'react';
import type { CocClient } from '@plusplusoneplusplus/coc-client';
import { useCocClient } from '../../../repos/cloneRouting';
import { getGitReviewClient } from '../diff/diffSource';
import type { DiffComment } from '../../../../comments/diff-comment-types';
import type { UpdateDiffCommentRequest } from './useDiffComments';
import { useReviewComments } from './useReviewComments';

// ============================================================================
// Return type
// ============================================================================

export interface UseAllCommitCommentsReturn {
    comments: DiffComment[];
    loading: boolean;
    error: string | null;
    resolving: boolean;
    aiLoadingIds: Set<string>;
    aiErrors: Map<string, string>;
    resolvingIds: Set<string>;
    resolveComment: (comment: DiffComment) => Promise<void>;
    unresolveComment: (comment: DiffComment) => Promise<void>;
    deleteComment: (comment: DiffComment) => Promise<void>;
    updateComment: (comment: DiffComment, updates: UpdateDiffCommentRequest) => Promise<void>;
    resolveWithAI: (userContext?: string, skills?: string[]) => Promise<void>;
    fixWithAI: (id: string, userContext?: string, skills?: string[]) => Promise<void>;
    clearAiError: (id: string) => void;
    /** Rejects when the clipboard write fails. */
    copyAllCommentsAsPrompt: () => Promise<void>;
}

// ============================================================================
// Hook
// ============================================================================

/** Poll a queued task until it completes or fails. */
async function pollTaskResult<T>(client: CocClient, taskId: string, timeoutMs = 180_000): Promise<T> {
    const start = Date.now();
    let delay = 1000;
    while (Date.now() - start < timeoutMs) {
        await new Promise(r => setTimeout(r, delay));
        const { task } = await client.queue.getTask(taskId);
        if (task.status === 'completed') return task.result as T;
        if (task.status === 'failed' || task.status === 'cancelled') {
            throw new Error(task.error || `Task ${task.status}`);
        }
        delay = Math.min(delay * 1.5, 5000);
    }
    throw new Error('Task timed out');
}

export function useAllCommitComments(wsId: string, hash: string, routingTarget?: string | null): UseAllCommitCommentsReturn {
    const review = useReviewComments(wsId, hash ? { kind: 'commit', hash } : null, routingTarget);
    const { comments, refresh: fetchComments } = review;
    // AI requests share the concrete review owner.
    const defaultClient = useCocClient(wsId);
    const cloneClient = routingTarget === undefined ? defaultClient : getGitReviewClient(wsId, routingTarget);
    const [resolving, setResolving] = useState(false);
    const [aiLoadingIds, setAiLoadingIds] = useState<Set<string>>(new Set());
    const [aiErrors, setAiErrors] = useState<Map<string, string>>(new Map());
    const [resolvingIds] = useState<Set<string>>(new Set());
    const commentsRef = useRef<DiffComment[]>(comments);
    commentsRef.current = comments;

    // ------------------------------------------------------------------
    // resolveWithAI — commit-level batch resolve via AI
    // ------------------------------------------------------------------

    const resolveWithAI = useCallback(async (userContext?: string, skills?: string[]) => {
        setResolving(true);
        try {
            const response = await cloneClient.git.resolveDiffCommentsWithAI(wsId, {
                oldRef: `${hash}^`,
                newRef: hash,
                ...(userContext ? { userContext } : {}),
                ...(skills?.length ? { skills } : {}),
            });
            if (response.taskId) await pollTaskResult(cloneClient, response.taskId as string);
            await fetchComments();
        } finally {
            setResolving(false);
        }
    }, [wsId, hash, cloneClient, fetchComments]);

    // ------------------------------------------------------------------
    // fixWithAI — resolve a single comment via AI
    // ------------------------------------------------------------------

    const fixWithAI = useCallback(async (id: string, userContext?: string, skills?: string[]) => {
        const comment = commentsRef.current.find(c => c.id === id);
        if (!comment) return;
        setAiLoadingIds(prev => new Set(prev).add(id));
        try {
            const response = await cloneClient.git.resolveDiffCommentsWithAI(wsId, {
                oldRef: comment.context.oldRef,
                newRef: comment.context.newRef,
                filePath: comment.context.filePath,
                commentId: id,
                ...(userContext ? { userContext } : {}),
                ...(skills?.length ? { skills } : {}),
            });
            if (response.taskId) await pollTaskResult(cloneClient, response.taskId as string);
            await fetchComments();
        } catch (err: any) {
            setAiErrors(prev => new Map(prev).set(id, err.message));
        } finally {
            setAiLoadingIds(prev => { const s = new Set(prev); s.delete(id); return s; });
        }
    }, [wsId, cloneClient, fetchComments]);

    // ------------------------------------------------------------------
    // clearAiError
    // ------------------------------------------------------------------

    const clearAiError = useCallback((id: string) => {
        setAiErrors(prev => { const m = new Map(prev); m.delete(id); return m; });
    }, []);

    return {
        ...review, resolving, aiLoadingIds, aiErrors, resolvingIds,
        resolveWithAI, fixWithAI, clearAiError,
    };
}
