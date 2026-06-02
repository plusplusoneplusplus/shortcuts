import { useState, useCallback, useEffect, useRef } from 'react';
import { getSpaCocClient } from '../../../api/cocClient';
import { notesApi, type CommentThread, type Comment } from '../notesApi';
import type { TextAnchor } from './textAnchor';

export type CommentFilter = 'all' | 'open' | 'resolved';

export interface UseCommentsOptions {
    workspaceId: string;
    notePath: string | null;
    /** Root identifier for multi-root notes. Scopes comment API calls. */
    root?: string;
    /** When set, resolve-with-AI sends a follow-up to this chat instead of a new task. */
    parentProcessId?: string;
    /** Mode to use when sending a follow-up via resolve-with-AI (defaults to the process's stored mode). */
    selectedMode?: 'ask' | 'autopilot';
    onThreadSelect?: (threadId: string | null) => void;
}

export interface UseCommentsReturn {
    threads: CommentThread[];
    allThreads: CommentThread[];
    selectedThreadId: string | null;
    filter: CommentFilter;
    loading: boolean;
    error: string | null;

    totalCount: number;
    openCount: number;
    resolvedCount: number;

    setFilter: (filter: CommentFilter) => void;
    selectThread: (threadId: string | null) => void;
    createThread: (anchor: TextAnchor, initialComment: string) => Promise<CommentThread>;
    resolveThread: (threadId: string) => Promise<void>;
    reopenThread: (threadId: string) => Promise<void>;
    deleteThread: (threadId: string) => Promise<void>;
    addComment: (threadId: string, content: string) => Promise<void>;
    editComment: (threadId: string, commentId: string, content: string) => Promise<void>;
    deleteComment: (threadId: string, commentId: string) => Promise<void>;
    reload: () => Promise<void>;

    /** Enqueue or follow-up an AI batch-resolve for all open comment threads. */
    resolveWithAI: (documentContent: string, userContext?: string) => Promise<{ taskId?: string } | void>;
    /** True while the resolveWithAI request is in flight. */
    resolveWithAILoading: boolean;
}

function sortThreads(threads: CommentThread[]): CommentThread[] {
    return [...threads].sort((a, b) => {
        // Open threads first
        if (a.status !== b.status) {
            return a.status === 'open' ? -1 : 1;
        }
        // Newest first within each group
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
}

function filterThreads(threads: CommentThread[], filter: CommentFilter): CommentThread[] {
    if (filter === 'all') return threads;
    return threads.filter(t => t.status === filter);
}

export function useComments(options: UseCommentsOptions): UseCommentsReturn {
    const { workspaceId, notePath, root, parentProcessId, selectedMode, onThreadSelect } = options;

    const [allThreads, setAllThreads] = useState<CommentThread[]>([]);
    const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
    const [filter, setFilter] = useState<CommentFilter>('all');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [resolveWithAILoading, setResolveWithAILoading] = useState(false);

    // Refs for stale-closure prevention
    const workspaceIdRef = useRef(workspaceId);
    const notePathRef = useRef(notePath);
    const rootRef = useRef(root);
    const parentProcessIdRef = useRef(parentProcessId);
    const selectedModeRef = useRef(selectedMode);
    const onThreadSelectRef = useRef(onThreadSelect);
    const threadsRef = useRef(allThreads);
    const lastFetchedPathRef = useRef<string | null>(null);

    workspaceIdRef.current = workspaceId;
    notePathRef.current = notePath;
    rootRef.current = root;
    parentProcessIdRef.current = parentProcessId;
    selectedModeRef.current = selectedMode;
    onThreadSelectRef.current = onThreadSelect;
    threadsRef.current = allThreads;

    const fetchThreads = useCallback(async (targetPath: string) => {
        setLoading(true);
        setError(null);
        try {
            const sidecar = await notesApi.getComments(workspaceIdRef.current, targetPath, rootRef.current);
            const threads = Object.values(sidecar.threads);
            setAllThreads(sortThreads(threads));
        } catch (err: any) {
            setError(err.message ?? 'Failed to load comments');
        } finally {
            setLoading(false);
        }
    }, []);

    // Load on mount / notePath change
    useEffect(() => {
        if (!notePath) {
            setAllThreads([]);
            setSelectedThreadId(null);
            setError(null);
            setLoading(false);
            lastFetchedPathRef.current = null;
            return;
        }
        if (lastFetchedPathRef.current === notePath) return;
        lastFetchedPathRef.current = notePath;
        fetchThreads(notePath);
    }, [notePath, fetchThreads]);

    // Derived counts (always from unfiltered list)
    const totalCount = allThreads.length;
    const openCount = allThreads.filter(t => t.status === 'open').length;
    const resolvedCount = allThreads.filter(t => t.status === 'resolved').length;

    const filteredAndSorted = filterThreads(allThreads, filter);

    const selectThread = useCallback((threadId: string | null) => {
        setSelectedThreadId(threadId);
        onThreadSelectRef.current?.(threadId);
    }, []);

    const createThread = useCallback(async (anchor: TextAnchor, initialComment: string): Promise<CommentThread> => {
        const wsId = workspaceIdRef.current;
        const path = notePathRef.current;
        if (!path) throw new Error('No note path');

        const now = new Date().toISOString();
        const tempId = `temp-${Date.now()}`;
        const newThread: CommentThread = {
            id: tempId,
            anchor,
            status: 'open',
            comments: [{ id: `temp-c-${Date.now()}`, content: initialComment, createdAt: now }],
            createdAt: now,
        };

        const result = await notesApi.createThread(wsId, path, newThread, rootRef.current);
        const created = result.thread;
        setAllThreads(prev => sortThreads([...prev, created]));
        setSelectedThreadId(created.id);
        onThreadSelectRef.current?.(created.id);
        return created;
    }, []);

    const resolveThread = useCallback(async (threadId: string) => {
        const prev = threadsRef.current;
        setAllThreads(sortThreads(prev.map(t => t.id === threadId ? { ...t, status: 'resolved' as const } : t)));
        try {
            await notesApi.updateThread(workspaceIdRef.current, notePathRef.current!, threadId, 'resolved', rootRef.current);
        } catch (e: any) {
            setAllThreads(prev);
            setError(e.message ?? 'Failed to resolve thread');
        }
    }, []);

    const reopenThread = useCallback(async (threadId: string) => {
        const prev = threadsRef.current;
        setAllThreads(sortThreads(prev.map(t => t.id === threadId ? { ...t, status: 'open' as const } : t)));
        try {
            await notesApi.updateThread(workspaceIdRef.current, notePathRef.current!, threadId, 'open', rootRef.current);
        } catch (e: any) {
            setAllThreads(prev);
            setError(e.message ?? 'Failed to reopen thread');
        }
    }, []);

    const deleteThread = useCallback(async (threadId: string) => {
        const prev = threadsRef.current;
        setAllThreads(prev.filter(t => t.id !== threadId));
        setSelectedThreadId(current => current === threadId ? null : current);
        try {
            await notesApi.deleteThread(workspaceIdRef.current, notePathRef.current!, threadId, rootRef.current);
        } catch (e: any) {
            setAllThreads(prev);
            setError(e.message ?? 'Failed to delete thread');
        }
    }, []);

    const addComment = useCallback(async (threadId: string, content: string) => {
        const prev = threadsRef.current;
        const tempComment: Comment = {
            id: `temp-c-${Date.now()}`,
            content,
            createdAt: new Date().toISOString(),
        };
        setAllThreads(prev.map(t =>
            t.id === threadId ? { ...t, comments: [...t.comments, tempComment] } : t,
        ));
        try {
            const result = await notesApi.addComment(workspaceIdRef.current, notePathRef.current!, threadId, content, rootRef.current);
            // Replace temp comment with server response
            setAllThreads(current =>
                current.map(t =>
                    t.id === threadId
                        ? { ...t, comments: t.comments.map(c => c.id === tempComment.id ? result.comment : c) }
                        : t,
                ),
            );
        } catch (e: any) {
            setAllThreads(prev);
            setError(e.message ?? 'Failed to add comment');
        }
    }, []);

    const editComment = useCallback(async (threadId: string, commentId: string, content: string) => {
        const prev = threadsRef.current;
        setAllThreads(prev.map(t =>
            t.id === threadId
                ? { ...t, comments: t.comments.map(c => c.id === commentId ? { ...c, content, updatedAt: new Date().toISOString() } : c) }
                : t,
        ));
        try {
            await notesApi.editComment(workspaceIdRef.current, notePathRef.current!, threadId, commentId, content, rootRef.current);
        } catch (e: any) {
            setAllThreads(prev);
            setError(e.message ?? 'Failed to edit comment');
        }
    }, []);

    const deleteComment = useCallback(async (threadId: string, commentId: string) => {
        const prev = threadsRef.current;
        setAllThreads(prev.map(t =>
            t.id === threadId
                ? { ...t, comments: t.comments.filter(c => c.id !== commentId) }
                : t,
        ));
        try {
            await notesApi.deleteComment(workspaceIdRef.current, notePathRef.current!, threadId, commentId, rootRef.current);
        } catch (e: any) {
            setAllThreads(prev);
            setError(e.message ?? 'Failed to delete comment');
        }
    }, []);

    const reload = useCallback(async () => {
        const path = notePathRef.current;
        if (!path) return;
        lastFetchedPathRef.current = null;
        setError(null);
        await fetchThreads(path);
    }, [fetchThreads]);

    const resolveWithAI = useCallback(async (documentContent: string, userContext?: string): Promise<{ taskId?: string } | void> => {
        const wsId = workspaceIdRef.current;
        const path = notePathRef.current;
        const ppId = parentProcessIdRef.current;
        if (!path) throw new Error('No note path');

        setResolveWithAILoading(true);
        setError(null);
        try {
            if (ppId) {
                // Follow-up path: send a message to the existing chat
                const openThreads = threadsRef.current.filter(t => t.status === 'open');
                if (openThreads.length === 0) throw new Error('No open comments to resolve');

                let message = `Please resolve the following open comments in ${path}:\n\n`;
                openThreads.forEach((thread, i) => {
                    message += `**Comment ${i + 1}:** "${thread.anchor.quotedText}"\n`;
                    const first = thread.comments[0];
                    if (first) message += `> ${first.content}\n`;
                    message += '\n';
                });
                message += `\nThe current document content is provided. Please address each comment and make the necessary changes.`;

                await getSpaCocClient().notes.sendCommentResolutionMessage(ppId, {
                    content: message,
                    ...(selectedModeRef.current ? { mode: selectedModeRef.current } : {}),
                    noteContent: documentContent,
                    documentUri: path,
                    commentIds: openThreads.map(t => t.id),
                    documentContent,
                    workspaceId: wsId,
                });
                return;
            }

            // New task path: enqueue via server endpoint
            const result = await notesApi.batchResolve(wsId, path, documentContent, userContext, rootRef.current);
            return { taskId: result.taskId };
        } catch (e: any) {
            setError(e.message ?? 'Failed to resolve with AI');
            throw e;
        } finally {
            setResolveWithAILoading(false);
        }
    }, []);

    return {
        threads: filteredAndSorted,
        allThreads,
        selectedThreadId,
        filter,
        loading,
        error,
        totalCount,
        openCount,
        resolvedCount,
        setFilter,
        selectThread,
        createThread,
        resolveThread,
        reopenThread,
        deleteThread,
        addComment,
        editComment,
        deleteComment,
        reload,
        resolveWithAI,
        resolveWithAILoading,
    };
}
