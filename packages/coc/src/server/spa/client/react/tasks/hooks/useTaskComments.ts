import { useState, useEffect, useCallback } from 'react';
import { getWsPath } from '../../utils/config';
import { getSpaCocClient, getSpaCocClientErrorMessage } from '../../api/cocClient';
import { cloneWsUrl } from '../../api/wsUrl';
import { useRequestScope } from '../../hooks/useRequestScope';
import { useCommentCollection } from '../../hooks/useCommentCollection';
import { useCommentMutations } from '../../hooks/useCommentMutations';
import { useCommentSubscription } from '../../hooks/useCommentSubscription';
import { isRecord } from '../../utils/typeGuards';
import { readTaskComment, toTaskCommentCreateRequest, toTaskCommentUpdateRequest } from '../../utils/commentContracts';
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
    resolveComment: (id: string) => Promise<TaskComment | undefined>;
    unresolveComment: (id: string) => Promise<TaskComment | undefined>;
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

function commentLoadError(error: unknown): string {
    return getSpaCocClientErrorMessage(error, 'Failed to load comments');
}

export function useTaskComments(wsId: string, taskPath: string): UseTaskCommentsReturn {
    // Task-result comments intentionally use the page-origin tasks API.
    const client = getSpaCocClient();
    const isCurrent = useRequestScope(client, JSON.stringify([wsId, taskPath]));
    const [commentCounts, setCommentCounts] = useState<Record<string, number>>({});
    const [aiLoadingIds, setAiLoadingIds] = useState<Set<string>>(new Set());
    const [aiErrors, setAiErrors] = useState<Map<string, string>>(new Map());
    const loadComments = useCallback(async () => {
        if (!wsId || !taskPath) return [];
        return (await client.tasks.listComments(wsId, taskPath) || []).map(readTaskComment);
    }, [client, wsId, taskPath]);
    const { comments, setComments, loading, error, refresh: fetchComments } =
        useCommentCollection(loadComments, isCurrent, commentLoadError);

    const fetchCounts = useCallback(async () => {
        if (!wsId) return;
        try {
            const counts = await client.tasks.getCommentCounts(wsId);
            if (isCurrent()) setCommentCounts(counts || {});
        } catch {
            // Silently ignore count fetch failures
        }
    }, [client, wsId, isCurrent]);

    useEffect(() => {
        setCommentCounts({});
        setAiLoadingIds(new Set());
        setAiErrors(new Map());
        void fetchCounts();
    }, [fetchCounts]);

    const addComment = useCallback(async (req: CreateCommentRequest): Promise<TaskComment> => {
        const comment = readTaskComment(await client.tasks.createComment(wsId, taskPath, toTaskCommentCreateRequest(req)));
        if (isCurrent()) {
            setComments(prev => [...prev, comment]);
        }
        return comment;
    }, [client, wsId, taskPath, isCurrent]);

    const updateCommentFn = useCallback(async (id: string, req: UpdateCommentRequest): Promise<TaskComment> => {
        const comment = readTaskComment(await client.tasks.updateComment(wsId, taskPath, id, toTaskCommentUpdateRequest(req)));
        if (isCurrent()) {
            setComments(prev => prev.map(c => c.id === id ? comment : c));
        }
        return comment;
    }, [client, wsId, taskPath, isCurrent]);

    const removeComment = useCallback(async (id: string): Promise<void> => {
        await client.tasks.deleteComment(wsId, taskPath, id);
        if (isCurrent()) setComments(prev => prev.filter(c => c.id !== id));
    }, [client, wsId, taskPath, isCurrent]);
    const updateStatus = useCallback((id: string, status: 'open' | 'resolved') =>
        updateCommentFn(id, { status }), [updateCommentFn]);
    const { deleteComment: deleteCommentFn, resolveComment, unresolveComment, resolvingIds, deletingIds } =
        useCommentMutations(updateStatus, removeComment, isCurrent);

    const askAI = useCallback(async (id: string, options: AskAIOptions = {}): Promise<void> => {
        if (!isCurrent()) return;
        const { commandId, customQuestion, documentContext } = options;
        setAiLoadingIds(prev => new Set(prev).add(id));
        setAiErrors(prev => { const m = new Map(prev); m.delete(id); return m; });
        try {
            const data = await client.tasks.askCommentAI(wsId, taskPath, id, { commandId, customQuestion, documentContext });
            if (isCurrent()) {
                setComments(prev => prev.map(c => c.id === id ? { ...c, aiResponse: data.aiResponse } : c));
            }
        } catch (err) {
            if (isCurrent()) {
                const msg = getSpaCocClientErrorMessage(err, 'AI request failed');
                setAiErrors(prev => new Map(prev).set(id, msg));
            }
        } finally {
            if (isCurrent()) {
                setAiLoadingIds(prev => { const s = new Set(prev); s.delete(id); return s; });
            }
        }
    }, [client, wsId, taskPath, isCurrent]);

    const clearAiError = useCallback((id: string) => {
        setAiErrors(prev => { const m = new Map(prev); m.delete(id); return m; });
    }, []);

    const refresh = useCallback(async () => {
        await Promise.all([fetchComments(), fetchCounts()]);
    }, [fetchComments, fetchCounts]);

    const onCommentMessage = useCallback((message: unknown) => {
        if (!isRecord(message)) return;
        if (message.type === 'comment-resolved' && message.filePath === taskPath && isCurrent()) {
            void refresh();
        }
    }, [taskPath, refresh, isCurrent]);
    useCommentSubscription(cloneWsUrl(getWsPath()), taskPath
        ? JSON.stringify({ type: 'subscribe-file', filePath: taskPath }) : null, onCommentMessage);

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
