/**
 * useTaskComments — hook for CRUD operations on task comments.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { getApiBase } from '../utils/config';
import type {
    TaskComment,
    TaskCommentStatus,
    TaskCommentCategory,
    CommentAnchor,
    CommentSelection,
} from '../../task-comments-types';

// ============================================================================
// Request/Response Types
// ============================================================================

export interface CreateCommentRequest {
    filePath: string;
    selection: CommentSelection;
    selectedText: string;
    comment: string;
    status?: TaskCommentStatus;
    author?: string;
    anchor?: CommentAnchor;
    category?: string;
}

export interface UpdateCommentRequest {
    comment?: string;
    status?: TaskCommentStatus;
    author?: string;
    anchor?: CommentAnchor;
}

export interface DocumentContext {
    surroundingLines?: string;
    nearestHeading?: string;
    allHeadings?: string[];
    filePath?: string;
}

export interface ResolveWithAIResult {
    revisedContent: string;
    resolvedCount: number;
}

export interface FixWithAIResult {
    revisedContent: string;
}

export interface AskAIOptions {
    commandId?: string;
    customQuestion?: string;
    documentContext?: DocumentContext;
}

export interface SelectionCapture {
    selection: {
        text: string;
        startLine: number;
        startColumn: number;
        endLine: number;
        endColumn: number;
        boundingRect: { top: number; left: number; width: number; height: number };
    };
    anchor: CommentAnchor;
    selectedText: string;
}

// ============================================================================
// API Helpers
// ============================================================================

function commentsUrl(wsId: string, taskPath: string): string {
    return getApiBase() + '/comments/' + encodeURIComponent(wsId) + '/' + encodeURIComponent(taskPath);
}

function commentUrl(wsId: string, taskPath: string, commentId: string): string {
    return commentsUrl(wsId, taskPath) + '/' + encodeURIComponent(commentId);
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

// ============================================================================
// Hook
// ============================================================================

export interface UseTaskCommentsReturn {
    comments: TaskComment[];
    commentCounts: Record<string, number>;
    loading: boolean;
    error: string | null;
    addComment: (req: CreateCommentRequest) => Promise<TaskComment>;
    updateComment: (id: string, req: UpdateCommentRequest) => Promise<TaskComment>;
    deleteComment: (id: string) => Promise<void>;
    resolveComment: (id: string) => Promise<TaskComment>;
    unresolveComment: (id: string) => Promise<TaskComment>;
    askAI: (id: string, options?: AskAIOptions) => Promise<void>;
    aiLoadingIds: Set<string>;
    aiErrors: Map<string, string>;
    clearAiError: (id: string) => void;
    resolveWithAI: (documentContent: string, filePath: string) => Promise<ResolveWithAIResult>;
    fixWithAI: (id: string, documentContent: string, filePath: string) => Promise<FixWithAIResult>;
    copyResolvePrompt: (documentContent: string, filePath: string) => void;
    resolving: boolean;
    resolvingCommentId: string | null;
    refresh: () => Promise<void>;
}

export function useTaskComments(wsId: string, taskPath: string): UseTaskCommentsReturn {
    const [comments, setComments] = useState<TaskComment[]>([]);
    const [commentCounts, setCommentCounts] = useState<Record<string, number>>({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [aiLoadingIds, setAiLoadingIds] = useState<Set<string>>(new Set());
    const [aiErrors, setAiErrors] = useState<Map<string, string>>(new Map());
    const [resolving, setResolving] = useState(false);
    const [resolvingCommentId, setResolvingCommentId] = useState<string | null>(null);
    const mountedRef = useRef(true);

    useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; };
    }, []);

    const fetchComments = useCallback(async () => {
        if (!wsId || !taskPath) return;
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(commentsUrl(wsId, taskPath));
            if (!res.ok) throw new Error('Failed to load comments');
            const data = await res.json();
            if (mountedRef.current) {
                setComments(data.comments || []);
            }
        } catch (err) {
            if (mountedRef.current) {
                setError(err instanceof Error ? err.message : 'Failed to load comments');
                setComments([]);
            }
        } finally {
            if (mountedRef.current) setLoading(false);
        }
    }, [wsId, taskPath]);

    const fetchCounts = useCallback(async () => {
        if (!wsId) return;
        try {
            const res = await fetch(getApiBase() + '/comment-counts/' + encodeURIComponent(wsId));
            if (!res.ok) return;
            const data = await res.json();
            if (mountedRef.current) setCommentCounts(data.counts || {});
        } catch {
            // Silently ignore count fetch failures
        }
    }, [wsId]);

    useEffect(() => {
        fetchComments();
        fetchCounts();
    }, [fetchComments, fetchCounts]);

    const addComment = useCallback(async (req: CreateCommentRequest): Promise<TaskComment> => {
        const res = await fetch(commentsUrl(wsId, taskPath), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(req),
        });
        if (!res.ok) throw new Error('Failed to create comment');
        const data = await res.json();
        const comment: TaskComment = data.comment;
        if (mountedRef.current) {
            setComments(prev => [...prev, comment]);
        }
        return comment;
    }, [wsId, taskPath]);

    const updateCommentFn = useCallback(async (id: string, req: UpdateCommentRequest): Promise<TaskComment> => {
        const res = await fetch(commentUrl(wsId, taskPath, id), {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(req),
        });
        if (!res.ok) throw new Error('Failed to update comment');
        const data = await res.json();
        const comment: TaskComment = data.comment;
        if (mountedRef.current) {
            setComments(prev => prev.map(c => c.id === id ? comment : c));
        }
        return comment;
    }, [wsId, taskPath]);

    const deleteCommentFn = useCallback(async (id: string): Promise<void> => {
        const res = await fetch(commentUrl(wsId, taskPath, id), { method: 'DELETE' });
        if (!res.ok) throw new Error('Failed to delete comment');
        if (mountedRef.current) {
            setComments(prev => prev.filter(c => c.id !== id));
        }
    }, [wsId, taskPath]);

    const resolveComment = useCallback(async (id: string): Promise<TaskComment> => {
        return updateCommentFn(id, { status: 'resolved' });
    }, [updateCommentFn]);

    const unresolveComment = useCallback(async (id: string): Promise<TaskComment> => {
        return updateCommentFn(id, { status: 'open' });
    }, [updateCommentFn]);

    const askAI = useCallback(async (id: string, options: AskAIOptions = {}): Promise<void> => {
        const { commandId, customQuestion, documentContext } = options;
        setAiLoadingIds(prev => new Set(prev).add(id));
        setAiErrors(prev => { const m = new Map(prev); m.delete(id); return m; });
        try {
            const url = commentUrl(wsId, taskPath, id) + '/ask-ai';
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ commandId, customQuestion, documentContext }),
            });
            if (!res.ok) throw new Error('AI request failed');
            const data = await res.json();
            if (mountedRef.current) {
                setComments(prev => prev.map(c => c.id === id ? { ...c, aiResponse: data.aiResponse } : c));
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
    }, [wsId, taskPath]);

    const clearAiError = useCallback((id: string) => {
        setAiErrors(prev => { const m = new Map(prev); m.delete(id); return m; });
    }, []);

    const refresh = useCallback(async () => {
        await Promise.all([fetchComments(), fetchCounts()]);
    }, [fetchComments, fetchCounts]);

    const resolveWithAI = useCallback(
        async (documentContent: string, filePath: string): Promise<ResolveWithAIResult> => {
            if (mountedRef.current) setResolving(true);
            try {
                // Step 1 — call batch resolve endpoint
                const aiRes = await fetch(commentsUrl(wsId, taskPath) + '/batch-resolve', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ documentContent }),
                });
                if (!aiRes.ok) throw new Error('Batch resolve failed');

                let revisedContent: string;
                let commentIds: string[];

                if (aiRes.status === 202) {
                    // Async queue path: poll for result
                    const { taskId } = await aiRes.json();
                    const result = await pollTaskResult<{ revisedContent: string; commentIds: string[] }>(taskId);
                    revisedContent = result.revisedContent;
                    commentIds = result.commentIds;
                } else {
                    // Sync fallback path
                    const data = await aiRes.json();
                    revisedContent = data.revisedContent;
                    commentIds = data.commentIds;
                }

                // Step 2 — write revised file only if the server returned content
                // (the async queue path uses AI tools to edit the file directly,
                //  so revisedContent is absent; the sync fallback returns actual content)
                if (revisedContent) {
                    const patchRes = await fetch(
                        getApiBase() + '/workspaces/' + encodeURIComponent(wsId) + '/tasks/content',
                        {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ path: filePath, content: revisedContent }),
                        }
                    );
                    if (!patchRes.ok) throw new Error('Failed to write revised content');
                }

                // Step 3 — batch-resolve comments
                await Promise.all(commentIds.map(id => resolveComment(id)));

                await refresh();

                return { revisedContent: revisedContent ?? '', resolvedCount: commentIds.length };
            } finally {
                if (mountedRef.current) setResolving(false);
            }
        },
        [wsId, taskPath, resolveComment, refresh]
    );

    const fixWithAI = useCallback(
        async (id: string, documentContent: string, filePath: string): Promise<FixWithAIResult> => {
            if (mountedRef.current) setResolvingCommentId(id);
            try {
                // Step 1 — per-comment ask-ai with commandId: 'resolve'
                const aiRes = await fetch(commentUrl(wsId, taskPath, id) + '/ask-ai', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ commandId: 'resolve', documentContent }),
                });
                if (!aiRes.ok) throw new Error('AI resolve failed');

                let revisedContent: string;

                if (aiRes.status === 202) {
                    // Async queue path: poll for result
                    const { taskId } = await aiRes.json();
                    const result = await pollTaskResult<{ revisedContent: string; commentIds: string[] }>(taskId);
                    revisedContent = result.revisedContent;
                } else {
                    // Sync fallback path
                    const data = await aiRes.json();
                    revisedContent = data.revisedContent;
                }

                // Step 2 — write revised file only if content was returned
                if (revisedContent) {
                    const patchRes = await fetch(
                        getApiBase() + '/workspaces/' + encodeURIComponent(wsId) + '/tasks/content',
                        {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ path: filePath, content: revisedContent }),
                        }
                    );
                    if (!patchRes.ok) throw new Error('Failed to write revised content');
                }

                // Step 3 — resolve the single comment
                await resolveComment(id);
                await refresh();

                return { revisedContent };
            } finally {
                if (mountedRef.current) setResolvingCommentId(null);
            }
        },
        [wsId, taskPath, resolveComment, refresh]
    );

    const copyResolvePrompt = useCallback(
        (documentContent: string, filePath: string): void => {
            const openComments = comments.filter(c => c.status === 'open');
            if (openComments.length === 0) return;

            const commentsBlock = openComments
                .map((c, i) =>
                    `### Comment ${i + 1} (id: ${c.id})\n` +
                    `Selection: lines ${c.selection.startLine}\u2013${c.selection.endLine}\n` +
                    `Selected text:\n\`\`\`\n${c.selectedText}\n\`\`\`\n` +
                    `Comment: ${c.comment}`
                )
                .join('\n\n');

            const prompt =
                `You are reviewing the file: ${filePath}\n\n` +
                `The following ${openComments.length} comment(s) need to be addressed:\n\n` +
                `${commentsBlock}\n\n` +
                `Current document content:\n\`\`\`markdown\n${documentContent}\n\`\`\`\n\n` +
                `Please produce a revised version of the document that addresses all comments. ` +
                `Return only the revised markdown, no explanation.`;

            void navigator.clipboard.writeText(prompt);
        },
        [comments]
    );

    return {
        comments,
        commentCounts,
        loading,
        error,
        addComment,
        updateComment: updateCommentFn,
        deleteComment: deleteCommentFn,
        resolveComment,
        unresolveComment,
        askAI,
        aiLoadingIds,
        aiErrors,
        clearAiError,
        resolveWithAI,
        fixWithAI,
        copyResolvePrompt,
        resolving,
        resolvingCommentId,
        refresh,
    };
}
