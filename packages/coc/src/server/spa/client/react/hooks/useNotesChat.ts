import { useState, useEffect, useCallback } from 'react';
import { fetchApi } from './useApi';

export interface UseNotesChatOptions {
    workspaceId: string;
    /** Currently selected note path — injected as context when creating a chat. */
    notePath: string | null;
    noteTitle?: string;
}

export interface UseNotesChatReturn {
    /** The single chat task ID for this workspace, or null */
    taskId: string | null;
    /** Create a new chat. The currently-selected note is injected as context. */
    createChat: (prompt: string) => Promise<string | null>;
    /** Discard the current chat and start fresh. Old chat stays in history. */
    resetChat: () => void;
}

function storageKey(workspaceId: string): string {
    return `coc-notes-chat-${workspaceId}`;
}

/**
 * Single-chat-per-workspace hook for the Notes view.
 *
 * Stores one taskId per workspace in localStorage. No server-side
 * binding — the taskId is just a pointer to a queue task / process.
 */
export function useNotesChat(opts: UseNotesChatOptions): UseNotesChatReturn {
    const { workspaceId, notePath, noteTitle } = opts;
    const key = storageKey(workspaceId);

    const [taskId, setTaskId] = useState<string | null>(() => {
        try { return localStorage.getItem(key); }
        catch { return null; }
    });

    // Persist taskId to localStorage
    useEffect(() => {
        try {
            if (taskId) localStorage.setItem(key, taskId);
            else localStorage.removeItem(key);
        } catch { /* ignore */ }
    }, [taskId, key]);

    const createChat = useCallback(async (prompt: string): Promise<string | null> => {
        try {
            const res = await fetchApi('/queue/tasks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type: 'chat',
                    priority: 'normal',
                    payload: {
                        kind: 'chat',
                        mode: 'autopilot',
                        prompt,
                        workspaceId,
                        context: {
                            noteChat: notePath ? { notePath, noteTitle } : undefined,
                        },
                    },
                }),
            });
            const newTaskId = res.task?.id ?? res.id;
            setTaskId(newTaskId);
            return newTaskId;
        } catch {
            return null;
        }
    }, [workspaceId, notePath, noteTitle]);

    const resetChat = useCallback(() => {
        setTaskId(null);
    }, []);

    return { taskId, createChat, resetChat };
}
