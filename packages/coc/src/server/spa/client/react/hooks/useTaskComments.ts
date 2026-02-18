/**
 * useTaskComments — hook for CRUD operations on task comments.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { getApiBase } from '../../config';
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
    askAI: (id: string, question?: string) => Promise<void>;
    refresh: () => Promise<void>;
}

export function useTaskComments(wsId: string, taskPath: string): UseTaskCommentsReturn {
    const [comments, setComments] = useState<TaskComment[]>([]);
    const [commentCounts, setCommentCounts] = useState<Record<string, number>>({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
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

    const askAI = useCallback(async (id: string, question?: string): Promise<void> => {
        const url = commentUrl(wsId, taskPath, id) + '/ask-ai';
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ question }),
        });
        if (!res.ok) throw new Error('AI request failed');
        const data = await res.json();
        if (mountedRef.current) {
            setComments(prev => prev.map(c => c.id === id ? { ...c, aiResponse: data.aiResponse } : c));
        }
    }, [wsId, taskPath]);

    const refresh = useCallback(async () => {
        await Promise.all([fetchComments(), fetchCounts()]);
    }, [fetchComments, fetchCounts]);

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
        refresh,
    };
}
