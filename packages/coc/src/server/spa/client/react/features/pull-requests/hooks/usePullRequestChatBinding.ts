import { useState, useEffect, useCallback } from 'react';
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

export interface UsePullRequestChatBindingReturn {
    /** The queue task ID bound to this PR, or null if no chat exists. */
    taskId: string | null;
    /** True while fetching the binding. */
    loading: boolean;
    /** Error message if binding fetch failed. */
    error: string | null;
    /** Create a new chat for this PR. Returns the new taskId. */
    createChat: (prompt: string, attachments?: AttachmentPayload[]) => Promise<string | null>;
}

export function usePullRequestChatBinding(opts: UsePullRequestChatBindingOptions): UsePullRequestChatBindingReturn {
    const { workspaceId, prId, prNumber, prTitle, repoId } = opts;
    const [taskId, setTaskId] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!prId) { setTaskId(null); return; }
        let cancelled = false;
        setLoading(true);
        setError(null);
        setTaskId(null);

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

    const createChat = useCallback(async (prompt: string, attachments?: AttachmentPayload[]): Promise<string | null> => {
        if (!prId) return null;
        try {
            const res = await getSpaCocClient().queue.enqueue({
                type: 'chat',
                priority: 'normal',
                payload: {
                    kind: 'chat',
                    mode: 'ask',
                    prompt,
                    workspaceId,
                    ...(attachments && attachments.length > 0 ? { attachments } : {}),
                    context: {
                        pullRequestChat: { prId, prNumber, prTitle, repoId },
                    },
                },
            });
            const newTaskId = res.task?.id ?? (res as { id?: string }).id;
            if (!newTaskId) throw new Error('Failed to create pull request chat task');

            await getSpaCocClient().pullRequests.createChatBinding(workspaceId, prId, newTaskId);

            setTaskId(newTaskId);
            return newTaskId;
        } catch (err: any) {
            setError(err?.message ?? 'Failed to create pull request chat');
            return null;
        }
    }, [workspaceId, prId, prNumber, prTitle, repoId]);

    return { taskId, loading, error, createChat };
}
