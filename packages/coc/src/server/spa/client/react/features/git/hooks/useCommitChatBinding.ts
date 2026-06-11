import { useState, useEffect, useCallback, useRef } from 'react';
import { getSpaCocClient } from '../../../api/cocClient';
import type { AttachmentPayload } from '../../../types/attachments';

export interface UseCommitChatBindingOptions {
    workspaceId: string;
    commitHash: string | undefined;
    commitMessage?: string;
}

export interface ReviewChatComposerSendOptions {
    mode?: string;
    context?: Record<string, unknown>;
    attachments?: AttachmentPayload[];
    provider?: string;
    model?: string;
    reasoningEffort?: string;
    config?: { effortTier?: string };
    workingDirectory?: string;
}

export interface UseCommitChatBindingReturn {
    /** The queue task ID bound to this commit, or null if no chat exists */
    taskId: string | null;
    /** True while fetching the binding */
    loading: boolean;
    /** Error message if binding fetch failed */
    error: string | null;
    /** Create a new chat for this commit. Returns the new taskId. */
    createChat: (prompt: string, options?: ReviewChatComposerSendOptions) => Promise<string | null>;
    /** Archive the currently bound chat and return this commit to an empty chat state. */
    startFreshChat: () => Promise<boolean>;
    /** True while the fresh-chat binding reset is in progress. */
    startingFresh: boolean;
}

export function useCommitChatBinding(opts: UseCommitChatBindingOptions): UseCommitChatBindingReturn {
    const { workspaceId, commitHash, commitMessage } = opts;
    const [taskId, setTaskId] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [startingFresh, setStartingFresh] = useState(false);
    const mountedRef = useRef(false);
    const currentRequestRef = useRef({ workspaceId, commitHash });
    currentRequestRef.current = { workspaceId, commitHash };

    useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; };
    }, []);

    const isCurrentRequest = useCallback((requestedWorkspaceId: string, requestedCommitHash: string | undefined) => (
        mountedRef.current
        && currentRequestRef.current.workspaceId === requestedWorkspaceId
        && currentRequestRef.current.commitHash === requestedCommitHash
    ), []);

    // Fetch binding when commitHash changes
    useEffect(() => {
        if (!commitHash) { setTaskId(null); setStartingFresh(false); return; }
        let cancelled = false;
        setLoading(true);
        setError(null);
        setTaskId(null);
        setStartingFresh(false);

        getSpaCocClient().git.getCommitChatBinding(workspaceId, commitHash)
            .then(data => { if (!cancelled) setTaskId(data.taskId); })
            .catch(err => {
                if (cancelled) return;
                if (err?.status === 404 || err?.message?.includes('404')) setTaskId(null);
                else setError('Failed to load commit chat');
            })
            .finally(() => { if (!cancelled) setLoading(false); });

        return () => { cancelled = true; };
    }, [workspaceId, commitHash]);

    // Create a new chat for this commit
    const createChat = useCallback(async (prompt: string, options: ReviewChatComposerSendOptions = {}): Promise<string | null> => {
        if (!commitHash) return null;
        const requestedWorkspaceId = workspaceId;
        const requestedCommitHash = commitHash;
        if (isCurrentRequest(requestedWorkspaceId, requestedCommitHash)) {
            setError(null);
        }
        try {
            // Create queue task
            const res = await getSpaCocClient().queue.enqueue({
                type: 'chat',
                priority: 'normal',
                payload: {
                    kind: 'chat',
                    mode: options.mode ?? 'ask',
                    prompt,
                    ...(options.workingDirectory ? { workingDirectory: options.workingDirectory } : {}),
                    workspaceId,
                    ...(options.attachments && options.attachments.length > 0 ? { attachments: options.attachments } : {}),
                    ...(options.provider ? { provider: options.provider } : {}),
                    ...(options.model ? { model: options.model } : {}),
                    ...(options.reasoningEffort ? { reasoningEffort: options.reasoningEffort } : {}),
                    context: {
                        ...(options.context ?? {}),
                        commitChat: { commitHash, commitMessage },
                    },
                },
                ...(options.config ? { config: options.config } : {}),
            });
            const newTaskId = res.task?.id ?? (res as { id?: string }).id;
            if (!newTaskId) throw new Error('Failed to create commit chat task');

            // Save binding
            await getSpaCocClient().git.createCommitChatBinding(workspaceId, commitHash, newTaskId);

            if (isCurrentRequest(requestedWorkspaceId, requestedCommitHash)) {
                setError(null);
                setTaskId(newTaskId);
            }
            return newTaskId;
        } catch (err: any) {
            if (isCurrentRequest(requestedWorkspaceId, requestedCommitHash)) {
                setError(err?.message ?? 'Failed to create commit chat');
            }
            return null;
        }
    }, [workspaceId, commitHash, commitMessage, isCurrentRequest]);

    const startFreshChat = useCallback(async (): Promise<boolean> => {
        if (!commitHash) return false;
        const requestedWorkspaceId = workspaceId;
        const requestedCommitHash = commitHash;
        if (isCurrentRequest(requestedWorkspaceId, requestedCommitHash)) {
            setStartingFresh(true);
            setError(null);
        }
        try {
            await getSpaCocClient().git.startFreshChat(workspaceId, commitHash);
            if (isCurrentRequest(requestedWorkspaceId, requestedCommitHash)) {
                setTaskId(null);
                setError(null);
            }
            return true;
        } catch (err: any) {
            if (isCurrentRequest(requestedWorkspaceId, requestedCommitHash)) {
                setError(err?.message ?? 'Failed to start fresh commit chat');
            }
            return false;
        } finally {
            if (isCurrentRequest(requestedWorkspaceId, requestedCommitHash)) {
                setStartingFresh(false);
            }
        }
    }, [workspaceId, commitHash, isCurrentRequest]);

    return { taskId, loading, error, createChat, startFreshChat, startingFresh };
}
