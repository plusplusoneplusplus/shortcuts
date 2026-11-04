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
import { useCocClient, useCloneBaseUrl } from '../../../repos/cloneRouting';
import { useRequestScope } from '../../../hooks/useRequestScope';
import { useCommentCollection } from '../../../hooks/useCommentCollection';
import { useCommentMutations } from '../../../hooks/useCommentMutations';
import { useCommentSubscription } from '../../../hooks/useCommentSubscription';
import { isRecord } from '../../../utils/typeGuards';
import { readDiffComment } from '../../../utils/commentContracts';
import { getGitReviewClient } from '../diff/diffSource';
import { cloneWsUrl } from '../../../api/wsUrl';
import { isLineDiffComment, type DiffComment, type DiffCommentContext, type DiffCommentSelection } from '../../../../comments/diff-comment-types';
import type { DiffLine } from '../diff/UnifiedDiffViewer';
import { relocateDiffAnchor } from '../../../utils/relocateDiffAnchor';
import { formatDiffCommentsPrompt } from '../../../utils/diffCommentPrompt';
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
    resolveComment: (id: string) => Promise<DiffComment | undefined>;
    unresolveComment: (id: string) => Promise<DiffComment | undefined>;
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
    /** Rejects when the clipboard write fails. */
    copyAllCommentsAsPrompt: () => Promise<void>;
}

// ============================================================================
// Utilities
// ============================================================================

// computeStorageKey, patchDiffComment, deleteDiffCommentById are imported from ../utils/diffCommentApi.

/** Poll a queued task until it completes or fails. Returns the task result. */
async function pollTaskResult(
    client: CocClient,
    taskId: string,
    isCurrent: () => boolean,
    wait: (delay: number) => Promise<void>,
): Promise<unknown> {
    const start = Date.now();
    let delay = 1000;
    while (Date.now() - start < 180_000) {
        if (!isCurrent()) throw new Error('Diff context changed');
        await wait(delay);
        if (!isCurrent()) throw new Error('Diff context changed');
        const { task } = await client.queue.getTask(taskId);
        if (!isCurrent()) throw new Error('Diff context changed');
        if (task.status === 'completed') {
            return task.result;
        }
        if (task.status === 'failed' || task.status === 'cancelled') {
            throw new Error(String(task.error || `Task ${task.status}`));
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

function commentLoadError(error: unknown): string {
    return error instanceof Error ? error.message : 'Failed to load diff comments';
}

// ============================================================================
// Hook
// ============================================================================

export function useDiffComments(
    wsId: string,
    context: DiffCommentContext | null,
    routingTarget?: string | null,
): UseDiffCommentsReturn {
    // Reads, mutations and subscriptions share the concrete review owner.
    const defaultClient = useCocClient(wsId);
    const cloneClient = routingTarget === undefined ? defaultClient : getGitReviewClient(wsId, routingTarget);
    const ownerBaseUrl = useCloneBaseUrl(routingTarget ?? wsId);
    const contextKey = context
        ? JSON.stringify([context.repositoryId, context.oldRef, context.newRef, context.filePath])
        : null;
    const isCurrent = useRequestScope(cloneClient, JSON.stringify([wsId, routingTarget, contextKey]));
    const pendingPolls = useRef(new Set<() => void>());
    useEffect(() => {
        const pending = new Set<() => void>();
        pendingPolls.current = pending;
        return () => { for (const cancel of pending) cancel(); };
    }, [isCurrent]);
    const waitForPoll = useCallback((delay: number) => new Promise<void>((resolve, reject) => {
        if (!isCurrent()) { reject(new Error('Diff context changed')); return; }
        const pending = pendingPolls.current;
        const cancel = () => {
            clearTimeout(timer);
            pending.delete(cancel);
            reject(new Error('Diff context changed'));
        };
        const timer = setTimeout(() => {
            pending.delete(cancel);
            resolve();
        }, delay);
        pending.add(cancel);
    }), [isCurrent]);
    const [aiLoadingIds, setAiLoadingIds] = useState<Set<string>>(new Set());
    const [aiErrors, setAiErrors]         = useState<Map<string, string>>(new Map());
    const [resolving, setResolving]               = useState(false);
    const contextRef  = useRef(context);
    contextRef.current = context; // always up-to-date without being a dep
    useEffect(() => {
        setAiLoadingIds(new Set());
        setAiErrors(new Map());
        setResolving(false);
    }, [isCurrent]);

    const isEphemeral = context?.newRef === 'working-tree';

    // ------------------------------------------------------------------
    // fetchComments — GET collection URL (query-param based), filter client-side
    // ------------------------------------------------------------------

    const loadComments = useCallback(async (): Promise<DiffComment[]> => {
        if (!isCurrent()) return [];
        const ctx = contextRef.current;
        if (!wsId || !ctx) return [];
        const data = await cloneClient.git.listDiffComments(wsId, {
            oldRef: ctx.oldRef,
            newRef: ctx.newRef,
        });
        return (data.comments ?? []).map(readDiffComment).filter(comment => contextMatches(comment, ctx));
    }, [wsId, cloneClient, isCurrent]);
    const { comments, setComments, loading, error, refresh: fetchComments } =
        useCommentCollection(loadComments, isCurrent, commentLoadError);
    const commentsRef = useRef<DiffComment[]>([]);
    commentsRef.current = comments;

    // ------------------------------------------------------------------
    // addComment — POST to collection, context in body
    // ------------------------------------------------------------------

    const addComment = useCallback(async (
        selection: DiffCommentSelection,
        selectedText: string,
        text: string,
        category?: string,
    ): Promise<DiffComment> => {
        if (!isCurrent()) throw new Error('Diff context changed');
        const ctx = contextRef.current;
        if (!ctx) throw new Error('No diff context');
        const data = await cloneClient.git.createDiffComment(wsId, {
            context: ctx,
            selection,
            selectedText,
            comment: text,
            ...(category !== undefined ? { category } : {}),
        });
        const comment = readDiffComment(data.comment);
        if (isCurrent()) {
            setComments(prev => [...prev, comment]);
        }
        return comment;
    }, [wsId, cloneClient, isCurrent]);

    // ------------------------------------------------------------------
    // updateComment — PATCH /api/diff-comments/:wsId/:storageKey/:id
    // ------------------------------------------------------------------

    const updateCommentFn = useCallback(async (id: string, req: UpdateDiffCommentRequest): Promise<DiffComment> => {
        if (!isCurrent()) throw new Error('Diff context changed');
        const ctx = contextRef.current;
        if (!ctx) throw new Error('No diff context');
        const storageKey = await computeStorageKey(ctx);
        const comment = readDiffComment(await patchDiffComment(wsId, storageKey, id, req, cloneClient));
        if (isCurrent()) {
            setComments(prev => prev.map(c => c.id === id ? comment : c));
        }
        return comment;
    }, [wsId, cloneClient, isCurrent]);

    // ------------------------------------------------------------------
    // deleteComment — DELETE /api/diff-comments/:wsId/:storageKey/:id
    // ------------------------------------------------------------------

    const removeComment = useCallback(async (id: string): Promise<void> => {
        if (!isCurrent()) throw new Error('Diff context changed');
        const ctx = contextRef.current;
        if (!ctx) throw new Error('No diff context');
        const storageKey = await computeStorageKey(ctx);
        await deleteDiffCommentById(wsId, storageKey, id, cloneClient);
        if (isCurrent()) setComments(prev => prev.filter(c => c.id !== id));
    }, [wsId, cloneClient, isCurrent]);

    // ------------------------------------------------------------------
    // resolveComment / unresolveComment
    // ------------------------------------------------------------------

    const updateStatus = useCallback((id: string, status: 'open' | 'resolved') =>
        updateCommentFn(id, { status }), [updateCommentFn]);
    const { deleteComment: deleteCommentFn, resolveComment, unresolveComment, resolvingIds, deletingIds } =
        useCommentMutations(updateStatus, removeComment, isCurrent);

    // ------------------------------------------------------------------
    // askAI — POST /api/diff-comments/:wsId/:storageKey/:id/ask-ai
    // Handles both synchronous { aiResponse } and async { taskId } responses.
    // ------------------------------------------------------------------

    const askAI = useCallback(async (id: string, options: AskAIOptions = {}): Promise<void> => {
        if (!isCurrent()) return;
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
                aiResponse = data.aiResponse;
            } else if (data.taskId) {
                const result = await pollTaskResult(cloneClient, data.taskId, isCurrent, waitForPoll);
                if (!isRecord(result) || typeof result.aiResponse !== 'string') {
                    throw new Error('Invalid diff comment AI response');
                }
                aiResponse = result.aiResponse;
            }
            if (isCurrent() && aiResponse !== undefined) {
                setComments(prev => prev.map(c => c.id === id ? { ...c, aiResponse } : c));
            }
        } catch (err) {
            if (isCurrent()) {
                const msg = err instanceof Error ? err.message : 'AI request failed';
                setAiErrors(prev => new Map(prev).set(id, msg));
            }
        } finally {
            if (isCurrent()) {
                setAiLoadingIds(prev => { const s = new Set(prev); s.delete(id); return s; });
            }
        }
    }, [wsId, cloneClient, isCurrent, waitForPoll]);

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
            if (!isCurrent()) return;
            if (!comment.anchor || !isLineDiffComment(comment)) continue;

            const newIndex = relocateDiffAnchor(comment, lines);

            if (newIndex === null) {
                // Mark orphaned locally — no server round-trip needed for status
                if (isCurrent()) {
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
    }, [wsId, updateCommentFn, isCurrent]); // eslint-disable-line react-hooks/exhaustive-deps

    // ------------------------------------------------------------------
    // copyAllCommentsAsPrompt — formats all comments into a prompt and
    // copies it to the clipboard so the user can paste it into an AI chat.
    // ------------------------------------------------------------------

    const copyAllCommentsAsPrompt = useCallback(async (): Promise<void> => {
        const ctx = contextRef.current;
        if (!commentsRef.current.length || !ctx) return;

        const prompt = formatDiffCommentsPrompt(ctx, commentsRef.current);

        await navigator.clipboard.writeText(prompt);
    }, []); // commentsRef and contextRef are always up-to-date

    // ------------------------------------------------------------------
    // resolveWithAI — batch resolve all open comments via AI
    // ------------------------------------------------------------------

    const resolveWithAI = useCallback(async (userContext?: string, skills?: string[]): Promise<{ totalCount: number }> => {
        if (!isCurrent()) throw new Error('Diff context changed');
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
                await pollTaskResult(cloneClient, data.taskId, isCurrent, waitForPoll);
            }
            if (isCurrent()) await fetchComments();
            return { totalCount: data.totalCount ?? 0 };
        } finally {
            if (isCurrent()) setResolving(false);
        }
    }, [wsId, cloneClient, fetchComments, isCurrent, waitForPoll]);

    // ------------------------------------------------------------------
    // fixWithAI — resolve a single comment via AI
    // ------------------------------------------------------------------

    const fixWithAI = useCallback(async (id: string, userContext?: string, skills?: string[]): Promise<void> => {
        if (!isCurrent()) return;
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
                await pollTaskResult(cloneClient, data.taskId, isCurrent, waitForPoll);
            }
            if (isCurrent()) await fetchComments();
        } catch (err) {
            if (isCurrent()) {
                const msg = err instanceof Error ? err.message : 'Fix with AI failed';
                setAiErrors(prev => new Map(prev).set(id, msg));
            }
        } finally {
            if (isCurrent()) {
                setAiLoadingIds(prev => { const s = new Set(prev); s.delete(id); return s; });
            }
        }
    }, [wsId, cloneClient, fetchComments, isCurrent, waitForPoll]);

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

    const onCommentMessage = useCallback((message: unknown) => {
        const ctx = contextRef.current;
        if (!ctx || !isCurrent() || !isRecord(message)
            || message.type !== 'diff-comment-updated' || !isRecord(message.context)) return;
        const eventContext = message.context;
        if (eventContext.repositoryId === ctx.repositoryId
            && eventContext.oldRef === ctx.oldRef
            && eventContext.newRef === ctx.newRef
            && eventContext.filePath === ctx.filePath) {
            void fetchComments();
        }
    }, [fetchComments, isCurrent]);
    useCommentSubscription(
        cloneWsUrl(getWsPath(), routingTarget === null ? undefined : ownerBaseUrl),
        context ? JSON.stringify({ type: 'subscribe-diff', context }) : null,
        onCommentMessage,
    );

    // ------------------------------------------------------------------
    // BroadcastChannel — refetch when pop-out window notifies comment changes
    // ------------------------------------------------------------------

    useEffect(() => {
        if (!context) return;
        if (typeof BroadcastChannel === 'undefined') return;
        const channel = new BroadcastChannel(GIT_REVIEW_POPOUT_CHANNEL);
        channel.onmessage = (event: MessageEvent<GitReviewPopOutMessage>) => {
            if (event.data.type === 'git-review-comments-updated' && isCurrent()) {
                void fetchComments();
            }
        };
        return () => { channel.close(); };
    }, [contextKey, fetchComments, isCurrent]);

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
