/**
 * useTaskComments — hook for CRUD operations on task comments.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { getWsPath } from '../../utils/config';
import { getSpaCocClient, getSpaCocClientErrorMessage } from '../../api/cocClient';
import { cloneWsUrl } from '../../api/wsUrl';
import type {
    TaskComment,
    TaskCommentStatus,
    TaskCommentCategory,
    CommentAnchor,
    CommentSelection,
} from '../../../comments/task-comments-types';

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
    resolvingIds: Set<string>;
    deletingIds: Set<string>;
    resolveWithAI: (documentContent: string, filePath: string, userContext?: string, skills?: string[]) => Promise<ResolveWithAIResult>;
    fixWithAI: (id: string, documentContent: string, filePath: string, userContext?: string, skills?: string[]) => Promise<FixWithAIResult>;
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
    const [resolvingIds, setResolvingIds] = useState<Set<string>>(new Set());
    const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
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
            const comments = await getSpaCocClient().tasks.listComments(wsId, taskPath);
            if (mountedRef.current) {
                setComments(comments || []);
            }
        } catch (err) {
            if (mountedRef.current) {
                setError(getSpaCocClientErrorMessage(err, 'Failed to load comments'));
                setComments([]);
            }
        } finally {
            if (mountedRef.current) setLoading(false);
        }
    }, [wsId, taskPath]);

    const fetchCounts = useCallback(async () => {
        if (!wsId) return;
        try {
            const counts = await getSpaCocClient().tasks.getCommentCounts(wsId);
            if (mountedRef.current) setCommentCounts(counts || {});
        } catch {
            // Silently ignore count fetch failures
        }
    }, [wsId]);

    useEffect(() => {
        fetchComments();
        fetchCounts();
    }, [fetchComments, fetchCounts]);

    const addComment = useCallback(async (req: CreateCommentRequest): Promise<TaskComment> => {
        const comment = await getSpaCocClient().tasks.createComment(wsId, taskPath, req);
        if (mountedRef.current) {
            setComments(prev => [...prev, comment]);
        }
        return comment;
    }, [wsId, taskPath]);

    const updateCommentFn = useCallback(async (id: string, req: UpdateCommentRequest): Promise<TaskComment> => {
        const comment = await getSpaCocClient().tasks.updateComment(wsId, taskPath, id, req);
        if (mountedRef.current) {
            setComments(prev => prev.map(c => c.id === id ? comment : c));
        }
        return comment;
    }, [wsId, taskPath]);

    const deleteCommentFn = useCallback(async (id: string): Promise<void> => {
        if (deletingIds.has(id)) return;
        setDeletingIds(prev => new Set(prev).add(id));
        try {
            await getSpaCocClient().tasks.deleteComment(wsId, taskPath, id);
            if (mountedRef.current) {
                setComments(prev => prev.filter(c => c.id !== id));
            }
        } finally {
            if (mountedRef.current) {
                setDeletingIds(prev => { const s = new Set(prev); s.delete(id); return s; });
            }
        }
    }, [wsId, taskPath, deletingIds]);

    const resolveComment = useCallback(async (id: string): Promise<TaskComment> => {
        if (resolvingIds.has(id)) return {} as TaskComment;
        setResolvingIds(prev => new Set(prev).add(id));
        try {
            return await updateCommentFn(id, { status: 'resolved' });
        } finally {
            if (mountedRef.current) {
                setResolvingIds(prev => { const s = new Set(prev); s.delete(id); return s; });
            }
        }
    }, [updateCommentFn, resolvingIds]);

    const unresolveComment = useCallback(async (id: string): Promise<TaskComment> => {
        if (resolvingIds.has(id)) return {} as TaskComment;
        setResolvingIds(prev => new Set(prev).add(id));
        try {
            return await updateCommentFn(id, { status: 'open' });
        } finally {
            if (mountedRef.current) {
                setResolvingIds(prev => { const s = new Set(prev); s.delete(id); return s; });
            }
        }
    }, [updateCommentFn, resolvingIds]);

    const askAI = useCallback(async (id: string, options: AskAIOptions = {}): Promise<void> => {
        const { commandId, customQuestion, documentContext } = options;
        setAiLoadingIds(prev => new Set(prev).add(id));
        setAiErrors(prev => { const m = new Map(prev); m.delete(id); return m; });
        try {
            const data = await getSpaCocClient().tasks.askCommentAI(wsId, taskPath, id, { commandId, customQuestion, documentContext });
            if (mountedRef.current) {
                setComments(prev => prev.map(c => c.id === id ? { ...c, aiResponse: data.aiResponse } : c));
            }
        } catch (err) {
            if (mountedRef.current) {
                const msg = getSpaCocClientErrorMessage(err, 'AI request failed');
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
        const ws = new WebSocket(cloneWsUrl(getWsPath()));
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
        async (documentContent: string, filePath: string, userContext?: string, skills?: string[]): Promise<ResolveWithAIResult> => {
            const totalCount = comments.filter(c => c.status === 'open').length;
            try {
                await getSpaCocClient().tasks.batchResolveComments(wsId, taskPath, { documentContent, ...(userContext ? { userContext } : {}), ...(skills?.length ? { skills } : {}) });
            } catch {
                throw new Error('Batch resolve failed');
            }
            return { totalCount };
        },
        [wsId, taskPath, comments]
    );

    const fixWithAI = useCallback(
        async (id: string, documentContent: string, filePath: string, userContext?: string, skills?: string[]): Promise<FixWithAIResult> => {
            try {
                await getSpaCocClient().tasks.askCommentAI(wsId, taskPath, id, { commandId: 'resolve', documentContent, ...(userContext ? { userContext } : {}), ...(skills?.length ? { skills } : {}) });
            } catch {
                throw new Error('AI resolve failed');
            }
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
        resolvingIds,
        deletingIds,
        resolveWithAI,
        fixWithAI,
        copyResolvePrompt,
        refresh,
    };
}
