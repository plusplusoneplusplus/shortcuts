import { useState, useEffect, useCallback } from 'react';
import { fetchApi } from './useApi';
import type { NoteContentStatusInfo } from '../repos/notes/NoteContextBanner';

export interface UseNotesChatOptions {
    workspaceId: string;
    /** Currently selected note path — injected as context when creating a chat. */
    notePath: string | null;
    noteTitle?: string;
}

/** Metadata about the note that was attached when the chat was created. */
export interface ChatNoteContext {
    notePath: string;
    noteTitle: string;
    contentStatus?: NoteContentStatusInfo;
}

export interface UseNotesChatReturn {
    /** The single chat task ID for this workspace, or null */
    taskId: string | null;
    /** Metadata about the note attached to the current chat (from process metadata). */
    chatNoteContext: ChatNoteContext | null;
    /** Create a new chat. The currently-selected note is injected as context. */
    createChat: (prompt: string) => Promise<string | null>;
    /** Discard the current chat and start fresh. Old chat stays in history. */
    resetChat: () => void;
}

function storageKey(workspaceId: string): string {
    return `coc-notes-chat-${workspaceId}`;
}

function contextStorageKey(workspaceId: string): string {
    return `coc-notes-chat-ctx-${workspaceId}`;
}

function loadContext(workspaceId: string): ChatNoteContext | null {
    try {
        const raw = localStorage.getItem(contextStorageKey(workspaceId));
        if (!raw) return null;
        return JSON.parse(raw) as ChatNoteContext;
    } catch {
        return null;
    }
}

function saveContext(workspaceId: string, ctx: ChatNoteContext | null): void {
    try {
        const key = contextStorageKey(workspaceId);
        if (ctx) localStorage.setItem(key, JSON.stringify(ctx));
        else localStorage.removeItem(key);
    } catch { /* ignore */ }
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

    const [chatNoteContext, setChatNoteContext] = useState<ChatNoteContext | null>(
        () => loadContext(workspaceId),
    );

    // Persist taskId to localStorage
    useEffect(() => {
        try {
            if (taskId) localStorage.setItem(key, taskId);
            else localStorage.removeItem(key);
        } catch { /* ignore */ }
    }, [taskId, key]);

    // Persist context to localStorage
    useEffect(() => {
        saveContext(workspaceId, chatNoteContext);
    }, [workspaceId, chatNoteContext]);

    // Fetch note content status from process metadata when taskId is restored
    useEffect(() => {
        if (!taskId) return;
        // If we already have contentStatus, skip the fetch
        if (chatNoteContext?.contentStatus) return;

        let cancelled = false;
        (async () => {
            try {
                const queueProcessId = taskId.startsWith('q-') ? taskId : `q-${taskId}`;
                const data = await fetchApi(`/processes/${encodeURIComponent(queueProcessId)}`);
                if (cancelled) return;
                const meta = data?.process?.metadata;
                if (meta?.notePath) {
                    const ctx: ChatNoteContext = {
                        notePath: meta.notePath,
                        noteTitle: meta.noteTitle ?? meta.notePath,
                        contentStatus: meta.noteContentStatus ?? undefined,
                    };
                    setChatNoteContext(ctx);
                }
            } catch { /* best-effort */ }
        })();
        return () => { cancelled = true; };
    }, [taskId]); // eslint-disable-line react-hooks/exhaustive-deps

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
            // Store the note context at creation time
            if (notePath) {
                setChatNoteContext({ notePath, noteTitle: noteTitle ?? notePath });
            } else {
                setChatNoteContext(null);
            }
            return newTaskId;
        } catch {
            return null;
        }
    }, [workspaceId, notePath, noteTitle]);

    const resetChat = useCallback(() => {
        setTaskId(null);
        setChatNoteContext(null);
    }, []);

    return { taskId, chatNoteContext, createChat, resetChat };
}
