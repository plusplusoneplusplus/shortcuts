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
import { getWsPath } from '../utils/config';
import { fetchApi } from './useApi';
import type { DiffComment } from '../../diff-comment-types';
import { computeStorageKey, patchDiffComment, deleteDiffCommentById } from '../utils/diffCommentApi';
import type { UpdateDiffCommentRequest } from './useDiffComments';

// ============================================================================
// Return type
// ============================================================================

export interface UseAllCommitCommentsReturn {
    comments: DiffComment[];
    loading: boolean;
    resolveComment: (comment: DiffComment) => Promise<void>;
    unresolveComment: (comment: DiffComment) => Promise<void>;
    deleteComment: (comment: DiffComment) => Promise<void>;
    updateComment: (comment: DiffComment, updates: UpdateDiffCommentRequest) => Promise<void>;
    copyAllCommentsAsPrompt: () => void;
}

// ============================================================================
// Hook
// ============================================================================

export function useAllCommitComments(wsId: string, hash: string): UseAllCommitCommentsReturn {
    const [comments, setComments] = useState<DiffComment[]>([]);
    const [loading, setLoading] = useState(false);
    const mountedRef = useRef(true);

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
            const params = new URLSearchParams({ oldRef: `${hash}^`, newRef: hash });
            const data = await fetchApi(`/diff-comments/${encodeURIComponent(wsId)}?${params}`);
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
        const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
        const ws = new WebSocket(`${protocol}://${window.location.host}${getWsPath()}`);
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

    return { comments, loading, resolveComment, unresolveComment, deleteComment, updateComment, copyAllCommentsAsPrompt };
}
