/**
 * useDiffComments — hook for CRUD operations on diff view comments.
 *
 * Mirrors useTaskComments in structure but keyed by DiffCommentContext
 * (repo + refs + filePath) instead of a single taskPath string.
 * HTTP calls target the /api/diff-comments/ route family.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { CocClient } from '@plusplusoneplusplus/coc-client';
import { getWsPath } from '../../../utils/config';
import { useCocClient } from '../../../repos/cloneRouting';
import { cloneWsUrl } from '../../../api/wsUrl';
import type { DiffComment, DiffCommentContext, DiffCommentSelection } from '../../../../comments/diff-comment-types';
import type { DiffLine } from '../diff/UnifiedDiffViewer';
import { relocateDiffAnchor } from '../../../utils/relocateDiffAnchor';
import { computeStorageKey, patchDiffComment, deleteDiffCommentById } from '../../../utils/diffCommentApi';
import { GIT_REVIEW_POPOUT_CHANNEL } from '../../../contexts/GitReviewPopOutContext';
import type { GitReviewPopOutMessage } from '../../../contexts/GitReviewPopOutContext';

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
    resolveWithAI: (userContext?: string, skills?: string[]) => Promise<{ totalCount: number }>;
    fixWithAI: (id: string, userContext?: string, skills?: string[]) => Promise<void>;
    copyResolvePrompt: (diffContent: string) => void;
    aiLoadingIds: Set<string>;
    aiErrors: Map<string, string>;
    clearAiError: (id: string) => void;
    resolvingIds: Set<string>;
    deletingIds: Set<string>;
    resolving: boolean;
    refresh: () => Promise<void>;
    runRelocation: (lines: DiffLine[]) => Promise<void>;
    copyAllCommentsAsPrompt: () => void;
}

// ============================================================================
// Utilities
// ============================================================================

// computeStorageKey, patchDiffComment, deleteDiffCommentById are imported from ../utils/diffCommentApi.

/** Poll a queued task until it completes or fails. Returns the task result. */
async function pollTaskResult<T>(client: CocClient, taskId: string, timeoutMs = 180_000): Promise<T> {
    const start = Date.now();
    let delay = 1000;
    while (Date.now() - start < timeoutMs) {
        await new Promise(r => setTimeout(r, delay));
        const { task } = await client.queue.getTask(taskId);
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
    // Route every diff-comment REST call to the selected clone's server (AC-07).
    // The diff-comment-updated WebSocket subscription below keeps using
    // cloneWsUrl(getWsPath()) unchanged (AC-03).
    const cloneClient = useCocClient(wsId);
    const [comments, setComments] = useState<DiffComment[]>([]);
    const [loading, setLoading]   = useState(true);
    const [error, setError]       = useState<string | null>(null);
    const [aiLoadingIds, setAiLoadingIds] = useState<Set<string>>(new Set());
    const [aiErrors, setAiErrors]         = useState<Map<string, string>>(new Map());
    const [resolvingIds, setResolvingIds] = useState<Set<string>>(new Set());
    const [deletingIds, setDeletingIds]   = useState<Set<string>>(new Set());
    const [resolving, setResolving]               = useState(false);
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
            const data = await cloneClient.git.listDiffComments(wsId, {
                oldRef: ctx.oldRef,
                newRef: ctx.newRef,
            });
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
    }, [wsId, cloneClient]); // eslint-disable-line react-hooks/exhaustive-deps

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
        const data = await cloneClient.git.createDiffComment(wsId, {
            context: ctx,
            selection,
            selectedText,
            comment: text,
            ...(category !== undefined ? { category } : {}),
        });
        const comment: DiffComment = data.comment;
        if (mountedRef.current) {
            setComments(prev => [...prev, comment]);
        }
        return comment;
    }, [wsId, cloneClient]);

    // ------------------------------------------------------------------
    // updateComment — PATCH /api/diff-comments/:wsId/:storageKey/:id
    // ------------------------------------------------------------------

    const updateCommentFn = useCallback(async (id: string, req: UpdateDiffCommentRequest): Promise<DiffComment> => {
        const ctx = contextRef.current;
        if (!ctx) throw new Error('No diff context');
        const storageKey = await computeStorageKey(ctx);
        const comment = await patchDiffComment(wsId, storageKey, id, req);
        if (mountedRef.current) {
            setComments(prev => prev.map(c => c.id === id ? comment : c));
        }
        return comment;
    }, [wsId]);

    // ------------------------------------------------------------------
    // deleteComment — DELETE /api/diff-comments/:wsId/:storageKey/:id
    // ------------------------------------------------------------------

    const deleteCommentFn = useCallback(async (id: string): Promise<void> => {
        if (deletingIds.has(id)) return;
        setDeletingIds(prev => new Set(prev).add(id));
        try {
            const ctx = contextRef.current;
            if (!ctx) throw new Error('No diff context');
            const storageKey = await computeStorageKey(ctx);
            await deleteDiffCommentById(wsId, storageKey, id);
            if (mountedRef.current) {
                setComments(prev => prev.filter(c => c.id !== id));
            }
        } finally {
            if (mountedRef.current) {
                setDeletingIds(prev => { const s = new Set(prev); s.delete(id); return s; });
            }
        }
    }, [wsId, deletingIds]);

    // ------------------------------------------------------------------
    // resolveComment / unresolveComment
    // ------------------------------------------------------------------

    const resolveComment = useCallback(async (id: string): Promise<DiffComment> => {
        if (resolvingIds.has(id)) return {} as DiffComment;
        setResolvingIds(prev => new Set(prev).add(id));
        try {
            return await updateCommentFn(id, { status: 'resolved' });
        } finally {
            if (mountedRef.current) {
                setResolvingIds(prev => { const s = new Set(prev); s.delete(id); return s; });
            }
        }
    }, [updateCommentFn, resolvingIds]);

    const unresolveComment = useCallback(async (id: string): Promise<DiffComment> => {
        if (resolvingIds.has(id)) return {} as DiffComment;
        setResolvingIds(prev => new Set(prev).add(id));
        try {
            return await updateCommentFn(id, { status: 'open' });
        } finally {
            if (mountedRef.current) {
                setResolvingIds(prev => { const s = new Set(prev); s.delete(id); return s; });
            }
        }
    }, [updateCommentFn, resolvingIds]);

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
            const data = await cloneClient.git.askDiffCommentAI(wsId, storageKey, id, { commandId, customQuestion });
            let aiResponse: string | undefined;
            if (data.aiResponse) {
                aiResponse = data.aiResponse as string;
            } else if (data.taskId) {
                const result = await pollTaskResult<{ aiResponse: string }>(cloneClient, data.taskId as string);
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
    }, [wsId, cloneClient]);

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
    // copyAllCommentsAsPrompt — formats all comments into a prompt and
    // copies it to the clipboard so the user can paste it into an AI chat.
    // ------------------------------------------------------------------

    const copyAllCommentsAsPrompt = useCallback((): void => {
        const ctx = contextRef.current;
        if (!commentsRef.current.length || !ctx) return;

        const commentsBlock = commentsRef.current
            .map((c, i) =>
                `### Comment ${i + 1} (id: ${c.id}, status: ${c.status})\n` +
                `Lines ${c.selection.diffLineStart}–${c.selection.diffLineEnd} (${c.selection.side})\n` +
                `Selected code:\n\`\`\`\n${c.selectedText}\n\`\`\`\n` +
                `Comment: ${c.comment}`
            )
            .join('\n\n');

        const refRange = ctx.newRef === 'working-tree'
            ? `working tree changes`
            : `${ctx.oldRef} → ${ctx.newRef}`;

        const prompt =
            `You are reviewing a git diff for file: ${ctx.filePath}\n` +
            `Diff range: ${refRange}\n\n` +
            `The following ${commentsRef.current.length} comment(s) have been added to the diff:\n\n` +
            `${commentsBlock}\n\n` +
            `Please address these comments.`;

        void navigator.clipboard.writeText(prompt);
    }, []); // commentsRef and contextRef are always up-to-date

    // ------------------------------------------------------------------
    // resolveWithAI — batch resolve all open comments via AI
    // ------------------------------------------------------------------

    const resolveWithAI = useCallback(async (userContext?: string, skills?: string[]): Promise<{ totalCount: number }> => {
        const ctx = contextRef.current;
        if (!ctx) throw new Error('No diff context');
        setResolving(true);
        try {
            const data = await cloneClient.git.resolveDiffCommentsWithAI(wsId, {
                oldRef: ctx.oldRef,
                newRef: ctx.newRef,
                filePath: ctx.filePath,
                ...(userContext ? { userContext } : {}),
                ...(skills?.length ? { skills } : {}),
            });
            if (data.taskId) {
                await pollTaskResult(cloneClient, data.taskId as string);
            }
            await fetchComments();
            return { totalCount: data.totalCount ?? 0 };
        } finally {
            if (mountedRef.current) setResolving(false);
        }
    }, [wsId, cloneClient, fetchComments]);

    // ------------------------------------------------------------------
    // fixWithAI — resolve a single comment via AI
    // ------------------------------------------------------------------

    const fixWithAI = useCallback(async (id: string, userContext?: string, skills?: string[]): Promise<void> => {
        const ctx = contextRef.current;
        if (!ctx) return;
        setAiLoadingIds(prev => new Set(prev).add(id));
        try {
            const data = await cloneClient.git.resolveDiffCommentsWithAI(wsId, {
                oldRef: ctx.oldRef,
                newRef: ctx.newRef,
                filePath: ctx.filePath,
                commentId: id,
                ...(userContext ? { userContext } : {}),
                ...(skills?.length ? { skills } : {}),
            });
            if (data.taskId) {
                await pollTaskResult(cloneClient, data.taskId as string);
            }
            await fetchComments();
        } catch (err) {
            if (mountedRef.current) {
                const msg = err instanceof Error ? err.message : 'Fix with AI failed';
                setAiErrors(prev => new Map(prev).set(id, msg));
            }
        } finally {
            if (mountedRef.current) {
                setAiLoadingIds(prev => { const s = new Set(prev); s.delete(id); return s; });
            }
        }
    }, [wsId, cloneClient, fetchComments]);

    // ------------------------------------------------------------------
    // copyResolvePrompt — copy a resolve prompt to clipboard
    // ------------------------------------------------------------------

    const copyResolvePrompt = useCallback((diffContent: string): void => {
        const ctx = contextRef.current;
        if (!commentsRef.current.length || !ctx) return;

        const openComments = commentsRef.current.filter(c => c.status === 'open');
        if (openComments.length === 0) return;

        const commentsBlock = openComments
            .map((c, i) =>
                `### Comment ${i + 1} (id: ${c.id})\n` +
                `- **Selected Text**: "${c.selectedText}"\n` +
                `- **Comment**: "${c.comment}"`
            )
            .join('\n\n');

        const refRange = ctx.newRef === 'working-tree'
            ? `working tree changes`
            : `${ctx.oldRef} → ${ctx.newRef}`;

        const prompt =
            `# Diff Comment Resolution Request\n\n` +
            `File: \`${ctx.filePath}\` (${refRange})\n\n` +
            `## Diff Content\n\n\`\`\`diff\n${diffContent}\n\`\`\`\n\n` +
            `## Open Comments\n\n${commentsBlock}\n\n` +
            `## Instructions\n\n` +
            `1. Analyze each comment in the context of the diff.\n` +
            `2. For each comment, explain whether the code change is correct or what improvement could be made.\n` +
            `3. Call \`resolve_comment(commentId, summary)\` for each addressed comment.\n`;

        void navigator.clipboard.writeText(prompt);
    }, []);

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
        const ws = new WebSocket(cloneWsUrl(getWsPath()));
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

    // ------------------------------------------------------------------
    // BroadcastChannel — refetch when pop-out window notifies comment changes
    // ------------------------------------------------------------------

    useEffect(() => {
        if (!context) return;
        if (typeof BroadcastChannel === 'undefined') return;
        const channel = new BroadcastChannel(GIT_REVIEW_POPOUT_CHANNEL);
        channel.onmessage = (event: MessageEvent<GitReviewPopOutMessage>) => {
            if (event.data.type === 'git-review-comments-updated' && mountedRef.current) {
                void fetchComments();
            }
        };
        return () => { channel.close(); };
    }, [context, fetchComments]);

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
        resolveWithAI,
        fixWithAI,
        copyResolvePrompt,
        aiLoadingIds,
        aiErrors,
        clearAiError,
        resolvingIds,
        deletingIds,
        resolving,
        refresh,
        runRelocation,
        copyAllCommentsAsPrompt,
    };
}
