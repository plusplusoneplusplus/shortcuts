import { useState, useEffect, useCallback } from 'react';
import { fetchApi } from '../../../hooks/useApi';
import type { AttachmentPayload } from '../../../types/attachments';

export interface UseCommitChatBindingOptions {
    workspaceId: string;
    commitHash: string | undefined;
    commitMessage?: string;
}

export interface UseCommitChatBindingReturn {
    /** The queue task ID bound to this commit, or null if no chat exists */
    taskId: string | null;
    /** True while fetching the binding */
    loading: boolean;
    /** Error message if binding fetch failed */
    error: string | null;
    /** Create a new chat for this commit. Returns the new taskId. */
    createChat: (prompt: string, attachments?: AttachmentPayload[]) => Promise<string | null>;
}

export function useCommitChatBinding(opts: UseCommitChatBindingOptions): UseCommitChatBindingReturn {
    const { workspaceId, commitHash, commitMessage } = opts;
    const [taskId, setTaskId] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Fetch binding when commitHash changes
    useEffect(() => {
        if (!commitHash) { setTaskId(null); return; }
        let cancelled = false;
        setLoading(true);
        setError(null);
        setTaskId(null);

        fetchApi(`/workspaces/${encodeURIComponent(workspaceId)}/commit-chat-bindings/${encodeURIComponent(commitHash)}`)
            .then(data => { if (!cancelled) setTaskId(data.taskId); })
            .catch(err => {
                if (cancelled) return;
                if (err?.message?.includes('404')) setTaskId(null);
                else setError('Failed to load commit chat');
            })
            .finally(() => { if (!cancelled) setLoading(false); });

        return () => { cancelled = true; };
    }, [workspaceId, commitHash]);

    // Create a new chat for this commit
    const createChat = useCallback(async (prompt: string, attachments?: AttachmentPayload[]): Promise<string | null> => {
        if (!commitHash) return null;
        try {
            // Create queue task
            const res = await fetchApi('/queue/tasks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type: 'chat',
                    priority: 'normal',
                    payload: {
                        kind: 'chat',
                        mode: 'ask',
                        prompt,
                        workspaceId,
                        ...(attachments && attachments.length > 0 ? { attachments } : {}),
                        context: {
                            commitChat: { commitHash, commitMessage },
                        },
                    },
                }),
            });
            const newTaskId = res.task?.id ?? res.id;

            // Save binding
            await fetchApi(
                `/workspaces/${encodeURIComponent(workspaceId)}/commit-chat-bindings`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ commitHash, taskId: newTaskId }),
                }
            );

            setTaskId(newTaskId);
            return newTaskId;
        } catch (err: any) {
            setError(err?.message ?? 'Failed to create commit chat');
            return null;
        }
    }, [workspaceId, commitHash, commitMessage]);

    return { taskId, loading, error, createChat };
}
