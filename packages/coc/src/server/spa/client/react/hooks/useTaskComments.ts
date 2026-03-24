/**
 * useTaskComments — hook for CRUD operations on task comments.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { getApiBase, getWsPath } from '../utils/config';
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
    totalCount: number;
}

export interface FixWithAIResult {
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
    refresh: () => Promise<void>;
}

export function useTaskComments(wsId: string, taskPath: string): UseTaskCommentsReturn {
    const [comments, setComments] = useState<TaskComment[]>([]);
    const [commentCounts, setCommentCounts] = useState<Record<string, number>>({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [aiLoadingIds, setAiLoadingIds] = useState<Set<string>>(new Set());
    const [aiErrors, setAiErrors] = useState<Map<string, string>>(new Map());
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

    // Subscribe to file-scoped WebSocket events for instant comment-resolved updates
    useEffect(() => {
        if (!taskPath) return;
        const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
        const ws = new WebSocket(`${protocol}://${window.location.host}${getWsPath()}`);
        ws.addEventListener('open', () => {
            ws.send(JSON.stringify({ type: 'subscribe-file', filePath: taskPath }));
        });
        ws.addEventListener('message', (event) => {
            try {
                const msg = JSON.parse(event.data as string) as { type: string; filePath?: string };
                if (msg.type === 'comment-resolved' && msg.filePath === taskPath && mountedRef.current) {
                    void refresh();
                }
            } catch { /* ignore */ }
        });
        return () => { ws.close(); };
    }, [taskPath, refresh]);

    const resolveWithAI = useCallback(
        async (documentContent: string, filePath: string): Promise<ResolveWithAIResult> => {
            const totalCount = comments.filter(c => c.status === 'open').length;
            const aiRes = await fetch(commentsUrl(wsId, taskPath) + '/batch-resolve', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ documentContent }),
            });
            if (!aiRes.ok) throw new Error('Batch resolve failed');
            await aiRes.json(); // consume response (contains taskId)
            return { totalCount };
        },
        [wsId, taskPath, comments]
    );

    const fixWithAI = useCallback(
        async (id: string, documentContent: string, filePath: string): Promise<FixWithAIResult> => {
            const aiRes = await fetch(commentUrl(wsId, taskPath, id) + '/ask-ai', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ commandId: 'resolve', documentContent }),
            });
            if (!aiRes.ok) throw new Error('AI resolve failed');
            await aiRes.json(); // consume response (contains taskId)
            return {};
        },
        [wsId, taskPath]
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
        refresh,
    };
}
