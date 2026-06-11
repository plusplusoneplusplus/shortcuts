import { useState, useEffect, useCallback, useRef } from 'react';
import { getSpaCocClient } from '../../../api/cocClient';
import type { AttachmentPayload } from '../../../types/attachments';

export interface UsePullRequestChatBindingOptions {
    /** Workspace ID owning the binding (same value as repoId for the dashboard SPA). */
    workspaceId: string;
    /** PR identifier (stringified). When falsy the hook resets to empty state. */
    prId: string | undefined;
    /** Human-readable PR number — surfaced to the AI prompt. */
    prNumber?: number;
    /** PR title — surfaced to the AI prompt. */
    prTitle?: string;
    /** Repo identifier the PR belongs to (used when different from workspaceId). */
    repoId?: string;
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

export interface UsePullRequestChatBindingReturn {
    /** The queue task ID bound to this PR, or null if no chat exists. */
    taskId: string | null;
    /** True while fetching the binding. */
    loading: boolean;
    /** Error message if binding fetch failed. */
    error: string | null;
    /** Create a new chat for this PR. Returns the new taskId. */
    createChat: (prompt: string, options?: ReviewChatComposerSendOptions) => Promise<string | null>;
    /** Archive the currently bound chat and return this PR to an empty chat state. */
    startFreshChat: () => Promise<boolean>;
    /** True while the fresh-chat binding reset is in progress. */
    startingFresh: boolean;
}

export function usePullRequestChatBinding(opts: UsePullRequestChatBindingOptions): UsePullRequestChatBindingReturn {
    const { workspaceId, prId, prNumber, prTitle, repoId } = opts;
    const [taskId, setTaskId] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [startingFresh, setStartingFresh] = useState(false);
    const mountedRef = useRef(false);
    const currentRequestRef = useRef({ workspaceId, prId });
    currentRequestRef.current = { workspaceId, prId };

    useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; };
    }, []);

    const isCurrentRequest = useCallback((requestedWorkspaceId: string, requestedPrId: string | undefined) => (
        mountedRef.current
        && currentRequestRef.current.workspaceId === requestedWorkspaceId
        && currentRequestRef.current.prId === requestedPrId
    ), []);

    useEffect(() => {
        if (!prId) { setTaskId(null); setStartingFresh(false); return; }
        let cancelled = false;
        setLoading(true);
        setError(null);
        setTaskId(null);
        setStartingFresh(false);

        getSpaCocClient().pullRequests.getChatBinding(workspaceId, prId)
            .then(data => { if (!cancelled) setTaskId(data.taskId); })
            .catch(err => {
                if (cancelled) return;
                if (err?.status === 404 || err?.message?.includes('404')) setTaskId(null);
                else setError('Failed to load pull request chat');
            })
            .finally(() => { if (!cancelled) setLoading(false); });

        return () => { cancelled = true; };
    }, [workspaceId, prId]);

    const createChat = useCallback(async (prompt: string, options: ReviewChatComposerSendOptions = {}): Promise<string | null> => {
        if (!prId) return null;
        const requestedWorkspaceId = workspaceId;
        const requestedPrId = prId;
        if (isCurrentRequest(requestedWorkspaceId, requestedPrId)) {
            setError(null);
        }
        try {
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
                        pullRequestChat: { prId, prNumber, prTitle, repoId },
                    },
                },
                ...(options.config ? { config: options.config } : {}),
            });
            const newTaskId = res.task?.id ?? (res as { id?: string }).id;
            if (!newTaskId) throw new Error('Failed to create pull request chat task');

            await getSpaCocClient().pullRequests.createChatBinding(workspaceId, prId, newTaskId);

            if (isCurrentRequest(requestedWorkspaceId, requestedPrId)) {
                setError(null);
                setTaskId(newTaskId);
            }
            return newTaskId;
        } catch (err: any) {
            if (isCurrentRequest(requestedWorkspaceId, requestedPrId)) {
                setError(err?.message ?? 'Failed to create pull request chat');
            }
            return null;
        }
    }, [workspaceId, prId, prNumber, prTitle, repoId, isCurrentRequest]);

    const startFreshChat = useCallback(async (): Promise<boolean> => {
        if (!prId) return false;
        const requestedWorkspaceId = workspaceId;
        const requestedPrId = prId;
        if (isCurrentRequest(requestedWorkspaceId, requestedPrId)) {
            setStartingFresh(true);
            setError(null);
        }
        try {
            await getSpaCocClient().pullRequests.startFreshChat(workspaceId, prId);
            if (isCurrentRequest(requestedWorkspaceId, requestedPrId)) {
                setTaskId(null);
                setError(null);
            }
            return true;
        } catch (err: any) {
            if (isCurrentRequest(requestedWorkspaceId, requestedPrId)) {
                setError(err?.message ?? 'Failed to start fresh pull request chat');
            }
            return false;
        } finally {
            if (isCurrentRequest(requestedWorkspaceId, requestedPrId)) {
                setStartingFresh(false);
            }
        }
    }, [workspaceId, prId, isCurrentRequest]);

    return { taskId, loading, error, createChat, startFreshChat, startingFresh };
}
