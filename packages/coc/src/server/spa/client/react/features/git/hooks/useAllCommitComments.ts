/**
 * useAllCommitComments — hook for CRUD operations on commit-level diff comments.
 *
 * Unlike useDiffComments (which is scoped to a single DiffCommentContext),
 * this hook aggregates comments across ALL files in a commit. Each mutating
 * operation derives the storage key on-the-fly from the comment's own `.context`
 * field, using the shared computeStorageKey utility.
 *
 * askAI is intentionally omitted — commit-level ask-AI requires a per-file
 * context and can be added later if needed.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { getWsPath } from '../../../utils/config';
import { cloneWsUrl } from '../../../api/wsUrl';
import { getSpaCocClient } from '../../../api/cocClient';
import type { DiffComment } from '../../../../comments/diff-comment-types';
import { computeStorageKey, patchDiffComment, deleteDiffCommentById } from '../../../utils/diffCommentApi';
import type { UpdateDiffCommentRequest } from './useDiffComments';
import { GIT_REVIEW_POPOUT_CHANNEL } from '../../../contexts/GitReviewPopOutContext';
import type { GitReviewPopOutMessage } from '../../../contexts/GitReviewPopOutContext';

// ============================================================================
// Return type
// ============================================================================

export interface UseAllCommitCommentsReturn {
    comments: DiffComment[];
    loading: boolean;
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
    copyAllCommentsAsPrompt: () => void;
}

// ============================================================================
// Hook
// ============================================================================

/** Poll a queued task until it completes or fails. */
async function pollTaskResult<T>(taskId: string, timeoutMs = 180_000): Promise<T> {
    const start = Date.now();
    let delay = 1000;
    while (Date.now() - start < timeoutMs) {
        await new Promise(r => setTimeout(r, delay));
        const { task } = await getSpaCocClient().queue.getTask(taskId);
        if (task.status === 'completed') return task.result as T;
        if (task.status === 'failed' || task.status === 'cancelled') {
            throw new Error(task.error || `Task ${task.status}`);
        }
        delay = Math.min(delay * 1.5, 5000);
    }
    throw new Error('Task timed out');
}

export function useAllCommitComments(wsId: string, hash: string): UseAllCommitCommentsReturn {
    const [comments, setComments] = useState<DiffComment[]>([]);
    const [loading, setLoading] = useState(false);
    const [resolving, setResolving] = useState(false);
    const [aiLoadingIds, setAiLoadingIds] = useState<Set<string>>(new Set());
    const [aiErrors, setAiErrors] = useState<Map<string, string>>(new Map());
    const [resolvingIds, setResolvingIds] = useState<Set<string>>(new Set());
    const mountedRef = useRef(true);
    const commentsRef = useRef<DiffComment[]>(comments);
    commentsRef.current = comments;

    useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; };
    }, []);

    // ------------------------------------------------------------------
    // fetchComments — GET all comments for this commit (all files)
    // ------------------------------------------------------------------

    const fetchComments = useCallback(async () => {
        if (!wsId || !hash) return;
        setLoading(true);
        try {
            const data = await getSpaCocClient().git.listDiffComments(wsId, { oldRef: `${hash}^`, newRef: hash });
            if (mountedRef.current) {
                setComments(data.comments ?? []);
            }
        } catch {
            if (mountedRef.current) setComments([]);
        } finally {
            if (mountedRef.current) setLoading(false);
        }
    }, [wsId, hash]);

    useEffect(() => {
        void fetchComments();
    }, [fetchComments]);

    // ------------------------------------------------------------------
    // Mutating operations — derive storageKey from comment.context
    // ------------------------------------------------------------------

    const updateComment = useCallback(async (
        comment: DiffComment,
        updates: UpdateDiffCommentRequest,
    ): Promise<void> => {
        const storageKey = await computeStorageKey(comment.context);
        const updated = await patchDiffComment(wsId, storageKey, comment.id, updates);
        if (mountedRef.current) {
            setComments(prev => prev.map(c => c.id === comment.id ? updated : c));
        }
    }, [wsId]);

    const resolveComment = useCallback(async (comment: DiffComment): Promise<void> => {
        return updateComment(comment, { status: 'resolved' });
    }, [updateComment]);

    const unresolveComment = useCallback(async (comment: DiffComment): Promise<void> => {
        return updateComment(comment, { status: 'open' });
    }, [updateComment]);

    const deleteComment = useCallback(async (comment: DiffComment): Promise<void> => {
        const storageKey = await computeStorageKey(comment.context);
        await deleteDiffCommentById(wsId, storageKey, comment.id);
        if (mountedRef.current) {
            setComments(prev => prev.filter(c => c.id !== comment.id));
        }
    }, [wsId]);

    // ------------------------------------------------------------------
    // resolveWithAI — commit-level batch resolve via AI
    // ------------------------------------------------------------------

    const resolveWithAI = useCallback(async (userContext?: string, skills?: string[]) => {
        setResolving(true);
        try {
            const response = await getSpaCocClient().git.resolveDiffCommentsWithAI(wsId, {
                oldRef: `${hash}^`,
                newRef: hash,
                ...(userContext ? { userContext } : {}),
                ...(skills?.length ? { skills } : {}),
            });
            if (response.taskId) await pollTaskResult(response.taskId as string);
            await fetchComments();
        } finally {
            if (mountedRef.current) setResolving(false);
        }
    }, [wsId, hash, fetchComments]);

    // ------------------------------------------------------------------
    // fixWithAI — resolve a single comment via AI
    // ------------------------------------------------------------------

    const fixWithAI = useCallback(async (id: string, userContext?: string, skills?: string[]) => {
        const comment = commentsRef.current.find(c => c.id === id);
        if (!comment) return;
        setAiLoadingIds(prev => new Set(prev).add(id));
        try {
            const response = await getSpaCocClient().git.resolveDiffCommentsWithAI(wsId, {
                oldRef: comment.context.oldRef,
                newRef: comment.context.newRef,
                filePath: comment.context.filePath,
                commentId: id,
                ...(userContext ? { userContext } : {}),
                ...(skills?.length ? { skills } : {}),
            });
            if (response.taskId) await pollTaskResult(response.taskId as string);
            await fetchComments();
        } catch (err: any) {
            if (mountedRef.current) {
                setAiErrors(prev => new Map(prev).set(id, err.message));
            }
        } finally {
            if (mountedRef.current) {
                setAiLoadingIds(prev => { const s = new Set(prev); s.delete(id); return s; });
            }
        }
    }, [wsId, fetchComments]);

    // ------------------------------------------------------------------
    // clearAiError
    // ------------------------------------------------------------------

    const clearAiError = useCallback((id: string) => {
        setAiErrors(prev => { const m = new Map(prev); m.delete(id); return m; });
    }, []);

    // ------------------------------------------------------------------
    // Copy all comments as prompt
    // ------------------------------------------------------------------

    const copyAllCommentsAsPrompt = useCallback((): void => {
        if (!comments.length) return;

        const byFile = new Map<string, DiffComment[]>();
        for (const c of comments) {
            const fp = c.context.filePath;
            if (!byFile.has(fp)) byFile.set(fp, []);
            byFile.get(fp)!.push(c);
        }

        const sections = [...byFile.entries()].map(([filePath, cs]) => {
            const block = cs
                .map((c, i) =>
                    `### Comment ${i + 1} (id: ${c.id}, status: ${c.status})\n` +
                    `Lines ${c.selection.diffLineStart}–${c.selection.diffLineEnd} (${c.selection.side})\n` +
                    `Selected code:\n\`\`\`\n${c.selectedText}\n\`\`\`\n` +
                    `Comment: ${c.comment}`
                )
                .join('\n\n');
            return `## File: ${filePath} (${cs.length} comment(s))\n\n${block}`;
        }).join('\n\n');

        const prompt =
            `You are reviewing commit ${hash} with comments across ${byFile.size} file(s).\n\n` +
            `${sections}\n\n` +
            `Please address these comments.`;

        void navigator.clipboard.writeText(prompt);
    }, [comments, hash]);

    // ------------------------------------------------------------------
    // WebSocket subscription — refresh on diff-comment-updated for this commit
    // ------------------------------------------------------------------

    useEffect(() => {
        if (!wsId || !hash) return;
        const ws = new WebSocket(cloneWsUrl(getWsPath()));
        ws.addEventListener('open', () => {
            ws.send(JSON.stringify({ type: 'subscribe-commit-diff', wsId, hash }));
        });
        ws.addEventListener('message', (event) => {
            try {
                const msg = JSON.parse(event.data as string) as {
                    type: string;
                    context?: { oldRef?: string; newRef?: string };
                };
                const isThisCommit =
                    msg.context?.oldRef === `${hash}^` && msg.context?.newRef === hash;
                if (msg.type === 'diff-comment-updated' && isThisCommit && mountedRef.current) {
                    void fetchComments();
                }
            } catch { /* ignore parse errors */ }
        });
        return () => { ws.close(); };
    }, [wsId, hash, fetchComments]);

    // ------------------------------------------------------------------
    // BroadcastChannel — refetch when pop-out window notifies comment changes
    // ------------------------------------------------------------------

    useEffect(() => {
        if (!wsId || !hash) return;
        if (typeof BroadcastChannel === 'undefined') return;
        const channel = new BroadcastChannel(GIT_REVIEW_POPOUT_CHANNEL);
        channel.onmessage = (event: MessageEvent<GitReviewPopOutMessage>) => {
            if (event.data.type === 'git-review-comments-updated' && mountedRef.current) {
                void fetchComments();
            }
        };
        return () => { channel.close(); };
    }, [wsId, hash, fetchComments]);

    return {
        comments, loading, resolving, aiLoadingIds, aiErrors, resolvingIds,
        resolveComment, unresolveComment, deleteComment, updateComment,
        resolveWithAI, fixWithAI, clearAiError, copyAllCommentsAsPrompt,
    };
}
