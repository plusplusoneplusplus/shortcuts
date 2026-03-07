/**
 * useDiffComments — hook for CRUD operations on diff view comments.
 *
 * Mirrors useTaskComments in structure but keyed by DiffCommentContext
 * (repo + refs + filePath) instead of a single taskPath string.
 * HTTP calls target the /api/diff-comments/ route family.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { getApiBase, getWsPath } from '../utils/config';
import type { DiffComment, DiffCommentContext, DiffCommentSelection } from '../../diff-comment-types';
import type { DiffLine } from '../repos/UnifiedDiffViewer';
import { relocateDiffAnchor } from '../utils/relocateDiffAnchor';

// ============================================================================
// Request/Response Types
// ============================================================================

export interface UpdateDiffCommentRequest {
    comment?: string;
    status?: 'open' | 'resolved';
    category?: string;
    selection?: Partial<DiffCommentSelection>;
}

export interface AskAIOptions {
    commandId?: string;
    customQuestion?: string;
}

// ============================================================================
// Return Type
// ============================================================================

export interface UseDiffCommentsReturn {
    comments: DiffComment[];
    loading: boolean;
    error: string | null;
    isEphemeral: boolean;
    addComment: (
        selection: DiffCommentSelection,
        selectedText: string,
        text: string,
        category?: string,
    ) => Promise<DiffComment>;
    updateComment: (id: string, req: UpdateDiffCommentRequest) => Promise<DiffComment>;
    deleteComment: (id: string) => Promise<void>;
    resolveComment: (id: string) => Promise<DiffComment>;
    unresolveComment: (id: string) => Promise<DiffComment>;
    askAI: (id: string, options?: AskAIOptions) => Promise<void>;
    aiLoadingIds: Set<string>;
    aiErrors: Map<string, string>;
    clearAiError: (id: string) => void;
    resolving: boolean;
    resolvingCommentId: string | null;
    refresh: () => Promise<void>;
    runRelocation: (lines: DiffLine[]) => Promise<void>;
    // TODO: resolveWithAI / fixWithAI / copyResolvePrompt — omitted until a
    // document write-back path is defined for diff comments.
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Compute SHA-256 storage key for a diff context.
 * Mirrors DiffCommentsManager.hashContext on the server:
 *   working-tree → sha256(repositoryId + filePath + 'working-tree')
 *   normal diff  → sha256(repositoryId + oldRef + newRef + filePath)
 */
async function computeStorageKey(ctx: DiffCommentContext): Promise<string> {
    const input = ctx.newRef === 'working-tree'
        ? ctx.repositoryId + ctx.filePath + 'working-tree'
        : ctx.repositoryId + ctx.oldRef + ctx.newRef + ctx.filePath;
    const data = new TextEncoder().encode(input);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

/** Base collection URL used for GET (list) and POST (create). */
function diffCommentsUrl(wsId: string, ctx: DiffCommentContext): string {
    const params = new URLSearchParams({
        repo: ctx.repositoryId,
        oldRef: ctx.oldRef,
        newRef: ctx.newRef,
        file: ctx.filePath,
    });
    return `${getApiBase()}/diff-comments/${encodeURIComponent(wsId)}?${params}`;
}

/** Per-comment URL for PATCH / DELETE / ask-ai. */
function diffCommentUrl(wsId: string, storageKey: string, commentId: string): string {
    return `${getApiBase()}/diff-comments/${encodeURIComponent(wsId)}/${storageKey}/${encodeURIComponent(commentId)}`;
}

/** Poll a queued task until it completes or fails. Returns the task result. */
async function pollTaskResult<T>(taskId: string, timeoutMs = 180_000): Promise<T> {
    const start = Date.now();
    let delay = 1000;
    while (Date.now() - start < timeoutMs) {
        await new Promise(r => setTimeout(r, delay));
        const res = await fetch(getApiBase() + '/queue/' + encodeURIComponent(taskId));
        if (!res.ok) throw new Error('Failed to fetch task status');
        const { task } = await res.json();
        if (task.status === 'completed') {
            return task.result as T;
        }
        if (task.status === 'failed' || task.status === 'cancelled') {
            throw new Error(task.error || `Task ${task.status}`);
        }
        delay = Math.min(delay * 1.5, 5000);
    }
    throw new Error('Task timed out');
}

/** True if a comment belongs to the given context. */
function contextMatches(comment: DiffComment, ctx: DiffCommentContext): boolean {
    return (
        comment.context.repositoryId === ctx.repositoryId &&
        comment.context.oldRef       === ctx.oldRef &&
        comment.context.newRef       === ctx.newRef &&
        comment.context.filePath     === ctx.filePath
    );
}

// ============================================================================
// Hook
// ============================================================================

export function useDiffComments(
    wsId: string,
    context: DiffCommentContext | null,
): UseDiffCommentsReturn {
    const [comments, setComments] = useState<DiffComment[]>([]);
    const [loading, setLoading]   = useState(true);
    const [error, setError]       = useState<string | null>(null);
    const [aiLoadingIds, setAiLoadingIds] = useState<Set<string>>(new Set());
    const [aiErrors, setAiErrors]         = useState<Map<string, string>>(new Map());
    const [resolving, setResolving]               = useState(false);
    const [resolvingCommentId, setResolvingCommentId] = useState<string | null>(null);
    const mountedRef  = useRef(true);
    const contextRef  = useRef(context);
    contextRef.current = context; // always up-to-date without being a dep
    const commentsRef = useRef<DiffComment[]>([]);
    commentsRef.current = comments; // always up-to-date

    useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; };
    }, []);

    const contextKey = context
        ? `${context.repositoryId}:${context.oldRef}:${context.newRef}:${context.filePath}`
        : null;

    const isEphemeral = context?.newRef === 'working-tree';

    // ------------------------------------------------------------------
    // fetchComments — GET collection URL (query-param based), filter client-side
    // ------------------------------------------------------------------

    const fetchComments = useCallback(async () => {
        const ctx = contextRef.current;
        if (!wsId || !ctx) { setLoading(false); return; }
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(diffCommentsUrl(wsId, ctx));
            if (!res.ok) throw new Error('Failed to load diff comments');
            const data = await res.json();
            if (mountedRef.current) {
                // Server may return all workspace comments; keep only those for this context.
                const filtered = (data.comments ?? [] as DiffComment[]).filter(
                    (c: DiffComment) => contextMatches(c, ctx)
                );
                setComments(filtered);
            }
        } catch (err) {
            if (mountedRef.current) {
                setError(err instanceof Error ? err.message : 'Failed to load diff comments');
                setComments([]);
            }
        } finally {
            if (mountedRef.current) setLoading(false);
        }
    }, [wsId]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        void fetchComments();
    }, [contextKey]); // eslint-disable-line react-hooks/exhaustive-deps

    // ------------------------------------------------------------------
    // addComment — POST to collection, context in body
    // ------------------------------------------------------------------

    const addComment = useCallback(async (
        selection: DiffCommentSelection,
        selectedText: string,
        text: string,
        category?: string,
    ): Promise<DiffComment> => {
        const ctx = contextRef.current;
        if (!ctx) throw new Error('No diff context');
        const res = await fetch(
            `${getApiBase()}/diff-comments/${encodeURIComponent(wsId)}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    context: ctx,
                    selection,
                    selectedText,
                    comment: text,
                    ...(category !== undefined ? { category } : {}),
                }),
            }
        );
        if (!res.ok) throw new Error('Failed to create diff comment');
        const data = await res.json();
        const comment: DiffComment = data.comment;
        if (mountedRef.current) {
            setComments(prev => [...prev, comment]);
        }
        return comment;
    }, [wsId]);

    // ------------------------------------------------------------------
    // updateComment — PATCH /api/diff-comments/:wsId/:storageKey/:id
    // ------------------------------------------------------------------

    const updateCommentFn = useCallback(async (id: string, req: UpdateDiffCommentRequest): Promise<DiffComment> => {
        const ctx = contextRef.current;
        if (!ctx) throw new Error('No diff context');
        const storageKey = await computeStorageKey(ctx);
        const res = await fetch(diffCommentUrl(wsId, storageKey, id), {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(req),
        });
        if (!res.ok) throw new Error('Failed to update diff comment');
        const data = await res.json();
        const comment: DiffComment = data.comment;
        if (mountedRef.current) {
            setComments(prev => prev.map(c => c.id === id ? comment : c));
        }
        return comment;
    }, [wsId]);

    // ------------------------------------------------------------------
    // deleteComment — DELETE /api/diff-comments/:wsId/:storageKey/:id
    // ------------------------------------------------------------------

    const deleteCommentFn = useCallback(async (id: string): Promise<void> => {
        const ctx = contextRef.current;
        if (!ctx) throw new Error('No diff context');
        const storageKey = await computeStorageKey(ctx);
        const res = await fetch(diffCommentUrl(wsId, storageKey, id), { method: 'DELETE' });
        if (!res.ok) throw new Error('Failed to delete diff comment');
        if (mountedRef.current) {
            setComments(prev => prev.filter(c => c.id !== id));
        }
    }, [wsId]);

    // ------------------------------------------------------------------
    // resolveComment / unresolveComment
    // ------------------------------------------------------------------

    const resolveComment = useCallback(async (id: string): Promise<DiffComment> => {
        return updateCommentFn(id, { status: 'resolved' });
    }, [updateCommentFn]);

    const unresolveComment = useCallback(async (id: string): Promise<DiffComment> => {
        return updateCommentFn(id, { status: 'open' });
    }, [updateCommentFn]);

    // ------------------------------------------------------------------
    // askAI — POST /api/diff-comments/:wsId/:storageKey/:id/ask-ai
    // Handles both synchronous { aiResponse } and async { taskId } responses.
    // ------------------------------------------------------------------

    const askAI = useCallback(async (id: string, options: AskAIOptions = {}): Promise<void> => {
        const { commandId, customQuestion } = options;
        const ctx = contextRef.current;
        if (!ctx) return;
        setAiLoadingIds(prev => new Set(prev).add(id));
        setAiErrors(prev => { const m = new Map(prev); m.delete(id); return m; });
        try {
            const storageKey = await computeStorageKey(ctx);
            const url = diffCommentUrl(wsId, storageKey, id) + '/ask-ai';
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ commandId, customQuestion }),
            });
            if (!res.ok) throw new Error('AI request failed');
            const data = await res.json();
            let aiResponse: string | undefined;
            if (data.aiResponse) {
                aiResponse = data.aiResponse as string;
            } else if (data.taskId) {
                const result = await pollTaskResult<{ aiResponse: string }>(data.taskId as string);
                aiResponse = result.aiResponse;
            }
            if (mountedRef.current && aiResponse !== undefined) {
                setComments(prev => prev.map(c => c.id === id ? { ...c, aiResponse } : c));
            }
        } catch (err) {
            if (mountedRef.current) {
                const msg = err instanceof Error ? err.message : 'AI request failed';
                setAiErrors(prev => new Map(prev).set(id, msg));
            }
        } finally {
            if (mountedRef.current) {
                setAiLoadingIds(prev => { const s = new Set(prev); s.delete(id); return s; });
            }
        }
    }, [wsId]);

    // ------------------------------------------------------------------
    // clearAiError
    // ------------------------------------------------------------------

    const clearAiError = useCallback((id: string) => {
        setAiErrors(prev => { const m = new Map(prev); m.delete(id); return m; });
    }, []);

    // ------------------------------------------------------------------
    // runRelocation — re-match each comment's anchor against new DiffLines
    // Called from onLinesReady when the diff is re-fetched.
    // ------------------------------------------------------------------

    const runRelocation = useCallback(async (lines: DiffLine[]): Promise<void> => {
        for (const comment of commentsRef.current) {
            if (!comment.anchor) continue;

            const newIndex = relocateDiffAnchor(comment, lines);

            if (newIndex === null) {
                // Mark orphaned locally — no server round-trip needed for status
                if (mountedRef.current) {
                    setComments((prev) =>
                        prev.map((c) =>
                            c.id === comment.id ? { ...c, status: 'orphaned' as const } : c
                        )
                    );
                }
            } else if (newIndex !== comment.selection.diffLineStart) {
                // Persist updated position via PATCH
                const span = comment.selection.diffLineEnd - comment.selection.diffLineStart;
                await updateCommentFn(comment.id, {
                    selection: {
                        diffLineStart: newIndex,
                        diffLineEnd: newIndex + span,
                    },
                });
            }
        }
    }, [wsId, updateCommentFn]); // eslint-disable-line react-hooks/exhaustive-deps

    // ------------------------------------------------------------------
    // refresh
    // ------------------------------------------------------------------

    const refresh = useCallback(async () => {
        await fetchComments();
    }, [fetchComments]);

    // ------------------------------------------------------------------
    // WebSocket subscription for instant refresh on diff-comment-updated
    // ------------------------------------------------------------------

    useEffect(() => {
        if (!context) return;
        const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
        const ws = new WebSocket(`${protocol}://${window.location.host}${getWsPath()}`);
        ws.addEventListener('open', () => {
            ws.send(JSON.stringify({ type: 'subscribe-diff', context }));
        });
        ws.addEventListener('message', (event) => {
            try {
                const msg = JSON.parse(event.data as string) as { type: string; context?: DiffCommentContext };
                const isSameDiff =
                    msg.context?.repositoryId === context.repositoryId &&
                    msg.context?.oldRef       === context.oldRef &&
                    msg.context?.newRef       === context.newRef &&
                    msg.context?.filePath     === context.filePath;
                if (msg.type === 'diff-comment-updated' && isSameDiff && mountedRef.current) {
                    void fetchComments();
                }
            } catch { /* ignore parse errors */ }
        });
        return () => { ws.close(); };
    }, [contextKey, fetchComments]); // eslint-disable-line react-hooks/exhaustive-deps

    return {
        comments,
        loading,
        error,
        isEphemeral,
        addComment,
        updateComment: updateCommentFn,
        deleteComment: deleteCommentFn,
        resolveComment,
        unresolveComment,
        askAI,
        aiLoadingIds,
        aiErrors,
        clearAiError,
        resolving,
        resolvingCommentId,
        refresh,
        runRelocation,
    };
}
