import { useState, useEffect, useCallback } from 'react';
import { fetchApi } from '../../../hooks/useApi';

/** Whether the chat is scoped to the current note or the whole workspace. */
export type ChatScope = 'per-note' | 'per-workspace';

export interface UseNotesChatOptions {
    workspaceId: string;
    /** Currently selected note path — injected as context when creating a chat. */
    notePath: string | null;
    noteTitle?: string;
    /** Default scope when no persisted value exists. Defaults to 'per-workspace'. */
    defaultScope?: ChatScope;
}

/** Metadata about the note that was attached when the chat was created. */
export interface ChatNoteContext {
    notePath: string;
    noteTitle: string;
}

export interface UseNotesChatReturn {
    /** The resolved chat task ID for the current scope/note, or null */
    taskId: string | null;
    /** Metadata about the note attached to the current chat (from process metadata). */
    chatNoteContext: ChatNoteContext | null;
    /** Create a new chat. The currently-selected note is injected as context. */
    createChat: (prompt: string, model?: string | null, mode?: 'ask' | 'autopilot') => Promise<string | null>;
    /** Discard the current scope's chat and start fresh. Old chat stays in history. */
    resetChat: () => void;
    /** Current active scope. */
    scope: ChatScope;
    /** Switch between per-note and per-workspace scope. */
    setScope: (scope: ChatScope) => void;
}

// ── Storage key helpers ──────────────────────────────────────────────────────

function storageKey(workspaceId: string): string {
    return `coc-notes-chat-${workspaceId}`;
}

function noteMapKey(workspaceId: string): string {
    return `coc-notes-chat-map-${workspaceId}`;
}

function scopeKey(workspaceId: string): string {
    return `coc-notes-chat-scope-${workspaceId}`;
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

function loadNoteMap(workspaceId: string): Record<string, string> {
    try {
        const raw = localStorage.getItem(noteMapKey(workspaceId));
        if (!raw) return {};
        return JSON.parse(raw) as Record<string, string>;
    } catch {
        return {};
    }
}

/**
 * Dual-scope chat hook for the Notes view.
 *
 * Supports two chat scopes:
 * - `per-workspace`: one chat for the entire workspace (stored in `coc-notes-chat-<wsId>`)
 * - `per-note`: one chat per note path (stored as a JSON map in `coc-notes-chat-map-<wsId>`)
 *
 * The active scope is persisted to `coc-notes-chat-scope-<wsId>` localStorage.
 */
export function useNotesChat(opts: UseNotesChatOptions): UseNotesChatReturn {
    const { workspaceId, notePath, noteTitle, defaultScope = 'per-workspace' } = opts;
    const key = storageKey(workspaceId);

    // ── Scope state ──────────────────────────────────────────────────────────

    const [scope, setScope] = useState<ChatScope>(() => {
        try {
            const stored = localStorage.getItem(scopeKey(workspaceId));
            if (stored === 'per-note' || stored === 'per-workspace') return stored as ChatScope;
        } catch { /* ignore */ }
        return defaultScope;
    });

    // ── Per-workspace task ID ────────────────────────────────────────────────

    const [perWorkspaceTaskId, setPerWorkspaceTaskId] = useState<string | null>(() => {
        try { return localStorage.getItem(key); }
        catch { return null; }
    });

    // ── Per-note task ID map ─────────────────────────────────────────────────

    const [perNoteMap, setPerNoteMap] = useState<Record<string, string>>(() =>
        loadNoteMap(workspaceId),
    );

    // ── Derived task ID ──────────────────────────────────────────────────────

    const taskId = scope === 'per-workspace'
        ? perWorkspaceTaskId
        : (notePath ? perNoteMap[notePath] ?? null : null);

    // ── Chat note context ────────────────────────────────────────────────────

    const [chatNoteContext, setChatNoteContext] = useState<ChatNoteContext | null>(
        () => loadContext(workspaceId),
    );

    // ── Persist scope ────────────────────────────────────────────────────────

    useEffect(() => {
        try { localStorage.setItem(scopeKey(workspaceId), scope); }
        catch { /* ignore */ }
    }, [scope, workspaceId]);

    // ── Persist per-workspace taskId ─────────────────────────────────────────

    useEffect(() => {
        try {
            if (perWorkspaceTaskId) localStorage.setItem(key, perWorkspaceTaskId);
            else localStorage.removeItem(key);
        } catch { /* ignore */ }
    }, [perWorkspaceTaskId, key]);

    // ── Persist per-note map ─────────────────────────────────────────────────

    useEffect(() => {
        try {
            if (Object.keys(perNoteMap).length > 0) {
                localStorage.setItem(noteMapKey(workspaceId), JSON.stringify(perNoteMap));
            } else {
                localStorage.removeItem(noteMapKey(workspaceId));
            }
        } catch { /* ignore */ }
    }, [perNoteMap, workspaceId]);

    // ── Persist context to localStorage ─────────────────────────────────────

    useEffect(() => {
        saveContext(workspaceId, chatNoteContext);
    }, [workspaceId, chatNoteContext]);

    // ── createChat ───────────────────────────────────────────────────────────

    const createChat = useCallback(async (prompt: string, model?: string | null, mode: 'ask' | 'autopilot' = 'ask'): Promise<string | null> => {
        try {
            const res = await fetchApi('/queue/tasks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type: 'chat',
                    priority: 'normal',
                    payload: {
                        kind: 'chat',
                        mode,
                        prompt: notePath ? `📝 Note: ${notePath}\n\n${prompt}` : prompt,
                        workspaceId,
                        ...(model ? { model } : {}),
                        context: {
                            noteChat: notePath ? { notePath, noteTitle } : undefined,
                        },
                    },
                }),
            });
            const newTaskId = res.task?.id ?? res.id;

            if (scope === 'per-workspace') {
                setPerWorkspaceTaskId(newTaskId);
            } else if (notePath) {
                setPerNoteMap(prev => ({ ...prev, [notePath]: newTaskId }));
            }

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
    }, [workspaceId, notePath, noteTitle, scope]);

    // ── resetChat ────────────────────────────────────────────────────────────

    const resetChat = useCallback(() => {
        if (scope === 'per-workspace') {
            setPerWorkspaceTaskId(null);
        } else if (notePath) {
            setPerNoteMap(prev => {
                const next = { ...prev };
                delete next[notePath];
                return next;
            });
        }
        setChatNoteContext(null);
    }, [scope, notePath]);

    return { taskId, chatNoteContext, createChat, resetChat, scope, setScope };
}
