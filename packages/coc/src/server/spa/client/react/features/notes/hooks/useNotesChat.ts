import { useState, useEffect, useCallback, useRef } from 'react';
import { getSpaCocClient } from '../../../api/cocClient';
import type { AttachmentPayload } from '../../../types/attachments';
import { isCommitChatLensEnabled } from '../../../utils/config';

const INHERITED_LENS_CHAT_MODE = {
    inherited: true,
    source: 'features.commitChatLens',
} as const;

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
    createChat: (prompt: string, model?: string | null, mode?: 'ask' | 'autopilot', skills?: string[], attachments?: AttachmentPayload[]) => Promise<string | null>;
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

function encodeMarkdownLinkPathSegment(value: string): string {
    return encodeURIComponent(value).replace(/[!'()*]/g, char =>
        `%${char.charCodeAt(0).toString(16).toUpperCase()}`
    );
}

function escapeMarkdownLinkText(value: string): string {
    return value.replace(/([\\\[\]])/g, '\\$1');
}

export function formatNoteAttachmentLink(workspaceId: string, notePath: string): string {
    const encodedWorkspaceId = encodeMarkdownLinkPathSegment(workspaceId);
    const encodedNotePath = notePath.split('/').map(encodeMarkdownLinkPathSegment).join('/');
    return `[📝 Note: ${escapeMarkdownLinkText(notePath)}](#repos/${encodedWorkspaceId}/notes/${encodedNotePath})`;
}

export function formatNoteAttachmentPrompt(prompt: string, workspaceId: string, notePath: string | null): string {
    return notePath ? `${formatNoteAttachmentLink(workspaceId, notePath)}\n\n${prompt}` : prompt;
}

/**
 * Dual-scope chat hook for the Notes view.
 *
 * Supports two chat scopes:
 * - `per-workspace`: one chat for the entire workspace (stored in `coc-notes-chat-<wsId>` localStorage)
 * - `per-note`: one chat per note path (persisted server-side in the `note_chat_bindings` SQLite
 *   table; the server auto-binds when a chat task is enqueued with `context.noteChat.notePath`)
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

    // ── Per-workspace task ID (localStorage; unaffected by note rename) ──────

    const [perWorkspaceTaskId, setPerWorkspaceTaskId] = useState<string | null>(() => {
        try { return localStorage.getItem(key); }
        catch { return null; }
    });

    // ── Per-note task ID map (server-backed; seeded on mount) ────────────────

    const [perNoteMap, setPerNoteMap] = useState<Record<string, string>>({});
    const seededWorkspaceRef = useRef<string | null>(null);

    useEffect(() => {
        if (seededWorkspaceRef.current === workspaceId) return;
        seededWorkspaceRef.current = workspaceId;
        let cancelled = false;
        void getSpaCocClient().notes.listChatBindings(workspaceId).then(res => {
            if (cancelled) return;
            const next: Record<string, string> = {};
            for (const [path, binding] of Object.entries(res.bindings ?? {})) {
                next[path] = binding.taskId;
            }
            setPerNoteMap(next);
        }).catch(() => {
            // Best-effort: if the request fails, leave the map empty.
        });
        return () => { cancelled = true; };
    }, [workspaceId]);

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

    // ── Persist context to localStorage ─────────────────────────────────────

    useEffect(() => {
        saveContext(workspaceId, chatNoteContext);
    }, [workspaceId, chatNoteContext]);

    // ── createChat ───────────────────────────────────────────────────────────

    const createChat = useCallback(async (prompt: string, model?: string | null, mode: 'ask' | 'autopilot' = 'ask', skills?: string[], attachments?: AttachmentPayload[]): Promise<string | null> => {
        try {
            const res = await getSpaCocClient().notes.createChat(workspaceId, {
                prompt: formatNoteAttachmentPrompt(prompt, workspaceId, notePath),
                notePath,
                noteTitle,
                mode,
                model,
                skills,
                attachments,
                ...(isCommitChatLensEnabled() ? { lensChat: INHERITED_LENS_CHAT_MODE } : {}),
            });
            const newTaskId = res.task.id;

            if (scope === 'per-workspace') {
                setPerWorkspaceTaskId(newTaskId);
            } else if (notePath) {
                // Server auto-binds on enqueue; mirror locally so the UI updates without waiting.
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
            // Best-effort server cleanup; failures are tolerated.
            void getSpaCocClient().notes.deleteChatBindingByPath(workspaceId, notePath).catch(() => undefined);
        }
        setChatNoteContext(null);
    }, [scope, notePath, workspaceId]);

    return { taskId, chatNoteContext, createChat, resetChat, scope, setScope };
}
