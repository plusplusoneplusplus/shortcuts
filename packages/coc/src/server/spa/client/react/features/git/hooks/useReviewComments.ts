/**
 * useReviewComments — every diff comment of one review (commit, branch range or
 * working tree) across all of its files, read from the review's owner.
 *
 * Files need not be selected or loaded: the list comes from the owner's
 * comment store filtered by the review's refs. Mutations derive each comment's
 * storage key from its own context. Owner/review switches discard in-flight
 * reads, and owner WebSocket events refresh the list when a comment of this
 * review is added, updated or deleted (for example from a file diff panel).
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { getWsPath } from '../../../utils/config';
import { cloneWsUrl } from '../../../api/wsUrl';
import { useCocClient } from '../../../repos/cloneRouting';
import { lookupCloneBaseUrl } from '../../../repos/cloneRegistry';
import { getGitReviewClient } from '../diff/diffSource';
import { copyToClipboard } from '../../../utils/format';
import type { DiffComment } from '../../../../comments/diff-comment-types';
import { computeStorageKey, patchDiffComment, deleteDiffCommentById } from '../../../utils/diffCommentApi';
import { formatReviewCommentsPrompt, unresolvedReviewComments, type ReviewCommentScope } from '../../../utils/diffCommentPrompt';
import type { UpdateDiffCommentRequest } from './useDiffComments';
import { GIT_REVIEW_POPOUT_CHANNEL } from '../../../contexts/GitReviewPopOutContext';
import type { GitReviewPopOutMessage } from '../../../contexts/GitReviewPopOutContext';

export type { ReviewCommentScope };

/** The stored refs of a review's comments (see each diff source's `commentContext`). */
export function reviewCommentRefs(scope: ReviewCommentScope): { oldRef?: string; newRef: string } {
    switch (scope.kind) {
        case 'commit': return { oldRef: `${scope.hash}^`, newRef: scope.hash };
        case 'working-tree': return { newRef: 'working-tree' };
        case 'branch-range': return { oldRef: 'branch-base', newRef: 'branch-head' };
    }
}

/** Whether a stored comment context belongs to the review's refs. */
export function isReviewComment(refs: { oldRef?: string; newRef: string }, context?: { oldRef?: string; newRef?: string }): boolean {
    return !!context && context.newRef === refs.newRef && (refs.oldRef === undefined || context.oldRef === refs.oldRef);
}

export interface UseReviewCommentsReturn {
    comments: DiffComment[];
    loading: boolean;
    error: string | null;
    refresh: () => Promise<void>;
    resolveComment: (comment: DiffComment) => Promise<void>;
    unresolveComment: (comment: DiffComment) => Promise<void>;
    deleteComment: (comment: DiffComment) => Promise<void>;
    updateComment: (comment: DiffComment, updates: UpdateDiffCommentRequest) => Promise<void>;
    /** Copies every unresolved comment as one prompt; rejects when the clipboard write fails. */
    copyAllCommentsAsPrompt: () => Promise<void>;
}

/**
 * `routingTarget`: `undefined` uses the workspace's own clone route, `null` the
 * page origin, and a clone key that exact owner.
 */
export function useReviewComments(wsId: string, scope: ReviewCommentScope | null, routingTarget?: string | null): UseReviewCommentsReturn {
    const defaultClient = useCocClient(wsId);
    const client = routingTarget === undefined ? defaultClient : getGitReviewClient(wsId, routingTarget);
    const refs = scope ? reviewCommentRefs(scope) : null;
    const reviewKey = refs && wsId ? JSON.stringify([wsId, routingTarget ?? null, refs.oldRef ?? null, refs.newRef]) : null;
    const [comments, setComments] = useState<DiffComment[]>([]);
    const [loading, setLoading] = useState(!!reviewKey);
    const [error, setError] = useState<string | null>(null);
    const generationRef = useRef(0);
    const mountedRef = useRef(true);
    const commentsRef = useRef(comments);
    commentsRef.current = comments;
    const scopeRef = useRef(scope);
    scopeRef.current = scope;

    useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; };
    }, []);

    const fetchComments = useCallback(async () => {
        const generation = generationRef.current;
        if (!reviewKey || !refs) return;
        setLoading(true);
        try {
            const data = await client.git.listDiffComments(wsId, refs);
            if (mountedRef.current && generation === generationRef.current) {
                setComments((data.comments ?? []) as DiffComment[]);
                setError(null);
            }
        } catch (err: any) {
            if (mountedRef.current && generation === generationRef.current) {
                setComments([]);
                setError(err?.message || 'Failed to load comments');
            }
        } finally {
            if (mountedRef.current && generation === generationRef.current) setLoading(false);
        }
    }, [reviewKey, client]); // eslint-disable-line react-hooks/exhaustive-deps

    // A new owner or review starts empty; late reads of the previous one are dropped.
    useEffect(() => {
        generationRef.current++;
        setComments([]);
        setError(null);
        setLoading(!!reviewKey);
        void fetchComments();
    }, [fetchComments]); // eslint-disable-line react-hooks/exhaustive-deps

    const updateComment = useCallback(async (comment: DiffComment, updates: UpdateDiffCommentRequest) => {
        const generation = generationRef.current;
        const storageKey = await computeStorageKey(comment.context);
        const updated = await patchDiffComment(wsId, storageKey, comment.id, updates, client);
        if (mountedRef.current && generation === generationRef.current) {
            setComments(prev => prev.map(c => c.id === comment.id ? updated : c));
        }
    }, [wsId, client]);

    const resolveComment = useCallback((comment: DiffComment) => updateComment(comment, { status: 'resolved' }), [updateComment]);
    const unresolveComment = useCallback((comment: DiffComment) => updateComment(comment, { status: 'open' }), [updateComment]);

    const deleteComment = useCallback(async (comment: DiffComment) => {
        const generation = generationRef.current;
        const storageKey = await computeStorageKey(comment.context);
        await deleteDiffCommentById(wsId, storageKey, comment.id, client);
        if (mountedRef.current && generation === generationRef.current) {
            setComments(prev => prev.filter(c => c.id !== comment.id));
        }
    }, [wsId, client]);

    const copyAllCommentsAsPrompt = useCallback(async () => {
        const current = scopeRef.current;
        if (!current || !unresolvedReviewComments(commentsRef.current).length) return;
        await copyToClipboard(formatReviewCommentsPrompt(current, commentsRef.current));
    }, []);

    // Owner events carry the comment (with its context) or only its id on delete.
    useEffect(() => {
        if (!reviewKey || !refs) return;
        const ws = new WebSocket(cloneWsUrl(getWsPath(), routingTarget === null ? undefined : lookupCloneBaseUrl(routingTarget ?? wsId)));
        ws.addEventListener('message', (event) => {
            try {
                const msg = JSON.parse(event.data as string) as {
                    type: string; workspaceId?: string; commentId?: string;
                    comment?: { id?: string; context?: { oldRef?: string; newRef?: string } };
                };
                if (msg.type !== 'diff-comment-updated' || msg.workspaceId !== wsId) return;
                const id = msg.comment?.id ?? msg.commentId;
                const known = !!id && commentsRef.current.some(c => c.id === id);
                if (known || isReviewComment(refs, msg.comment?.context)) void fetchComments();
            } catch { /* ignore parse errors */ }
        });
        return () => { ws.close(); };
    }, [fetchComments]); // eslint-disable-line react-hooks/exhaustive-deps

    // Pop-out windows announce comment changes over a BroadcastChannel.
    useEffect(() => {
        if (!reviewKey || typeof BroadcastChannel === 'undefined') return;
        const channel = new BroadcastChannel(GIT_REVIEW_POPOUT_CHANNEL);
        channel.onmessage = (event: MessageEvent<GitReviewPopOutMessage>) => {
            if (event.data.type === 'git-review-comments-updated') void fetchComments();
        };
        return () => { channel.close(); };
    }, [fetchComments]); // eslint-disable-line react-hooks/exhaustive-deps

    return {
        comments, loading, error, refresh: fetchComments,
        resolveComment, unresolveComment, deleteComment, updateComment, copyAllCommentsAsPrompt,
    };
}
