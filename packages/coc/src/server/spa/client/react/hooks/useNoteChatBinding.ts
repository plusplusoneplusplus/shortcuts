import { useState, useEffect, useCallback } from 'react';
import { fetchApi } from './useApi';

export interface UseNoteChatBindingOptions {
    workspaceId: string;
    notePath: string | null;
    noteTitle?: string;
}

export interface UseNoteChatBindingReturn {
    /** The queue task ID bound to this note, or null if no chat exists */
    taskId: string | null;
    /** True while fetching the binding */
    loading: boolean;
    /** Error message if binding fetch failed */
    error: string | null;
    /** Create a new chat for this note. Returns the new taskId. */
    createChat: (prompt: string) => Promise<string | null>;
    /** Reset the binding (unbind), returning to empty state. */
    resetBinding: () => Promise<void>;
}

export function useNoteChatBinding(opts: UseNoteChatBindingOptions): UseNoteChatBindingReturn {
    const { workspaceId, notePath, noteTitle } = opts;
    const [taskId, setTaskId] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Fetch binding when notePath changes
    useEffect(() => {
        if (!notePath) { setTaskId(null); return; }
        let cancelled = false;
        setLoading(true);
        setError(null);
        setTaskId(null);

        fetchApi(`/workspaces/${encodeURIComponent(workspaceId)}/note-chat-bindings?path=${encodeURIComponent(notePath)}`)
            .then(data => { if (!cancelled) setTaskId(data.taskId); })
            .catch(err => {
                if (cancelled) return;
                if (err?.message?.includes('404')) setTaskId(null);
                else setError('Failed to load note chat');
            })
            .finally(() => { if (!cancelled) setLoading(false); });

        return () => { cancelled = true; };
    }, [workspaceId, notePath]);

    // Create a new chat for this note
    const createChat = useCallback(async (prompt: string): Promise<string | null> => {
        if (!notePath) return null;
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
                        context: {
                            noteChat: { notePath, noteTitle },
                        },
                    },
                }),
            });
            const newTaskId = res.task?.id ?? res.id;

            // Save binding
            await fetchApi(
                `/workspaces/${encodeURIComponent(workspaceId)}/note-chat-bindings`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ notePath, taskId: newTaskId }),
                }
            );

            setTaskId(newTaskId);
            return newTaskId;
        } catch (err: any) {
            setError(err?.message ?? 'Failed to create note chat');
            return null;
        }
    }, [workspaceId, notePath, noteTitle]);

    // Reset binding (unbind), returning to empty state
    const resetBinding = useCallback(async () => {
        if (!notePath) return;
        try {
            await fetchApi(
                `/workspaces/${encodeURIComponent(workspaceId)}/note-chat-bindings?path=${encodeURIComponent(notePath)}`,
                { method: 'DELETE' },
            );
        } catch {
            // Ignore — binding may already be gone
        }
        setTaskId(null);
        setError(null);
    }, [workspaceId, notePath]);

    return { taskId, loading, error, createChat, resetBinding };
}
