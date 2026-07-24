import { useState, useEffect, useCallback, useRef } from 'react';
import type { AIProcess, ChatProvider, EffortTierKey, ReasoningEffort } from '@plusplusoneplusplus/coc-client';
import { useCocClient } from '../../../repos/cloneRouting';
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
    /** Default scope when no persisted value exists. Defaults to 'per-note'. */
    defaultScope?: ChatScope;
}

/** Metadata about the note that was attached when the chat was created. */
export interface ChatNoteContext {
    notePath: string;
    noteTitle: string;
}

/**
 * Full AI selection captured from the shared initial composer, carried verbatim
 * to the Notes chat-create request so the resolved provider/model/effort reach the
 * queue payload without being dropped (AC-03/AC-07). Concrete provider and Auto
 * routing are mutually exclusive: pass a concrete `provider` OR
 * `autoProviderRouting: true`, never both.
 */
export interface NotesChatAiSelection {
    /** Concrete provider override; omit when Auto routing is requested. */
    provider?: ChatProvider;
    /** Per-turn reasoning-effort override. */
    reasoningEffort?: ReasoningEffort;
    /** Effort-tier key; carried on the top-level task config, like the composer. */
    effortTier?: EffortTierKey;
    /** Auto-provider routing intent (mutually exclusive with `provider`). */
    autoProviderRouting?: boolean;
    /** Workspace root / working directory when available. */
    workingDirectory?: string;
    /** Safe generic composer context; Notes-owned keys win reserved collisions. */
    context?: Record<string, unknown>;
}

export interface UseNotesChatReturn {
    /** The resolved chat task ID for the current scope/note, or null */
    taskId: string | null;
    /** Metadata about the note attached to the active chat. */
    chatNoteContext: ChatNoteContext | null;
    /** Accept note metadata from a process load when it still belongs to the active task. */
    syncChatNoteContext: (process: AIProcess) => void;
    /** Create a new chat. The currently-selected note is injected as context. */
    createChat: (prompt: string, model?: string | null, mode?: 'ask' | 'autopilot', skills?: string[], attachments?: AttachmentPayload[], aiSelection?: NotesChatAiSelection) => Promise<string | null>;
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

// ── Composer draft-key helper (AC-05) ────────────────────────────────────────

/**
 * Normalize a note path into a stable draft-key segment.
 *
 * Only unambiguous equivalences are collapsed — separator style, redundant or
 * trailing slashes, a single leading `./` or `/` — so two spellings of the SAME
 * note share one draft. Case is preserved: two genuinely-distinct notes on a
 * case-sensitive store must never collapse onto one draft.
 */
function normalizeNotePathForDraftKey(notePath: string | null): string {
    if (!notePath) return '';
    return notePath
        .trim()
        .replace(/\\/g, '/')      // Windows separators → POSIX
        .replace(/\/{2,}/g, '/')  // collapse duplicate slashes
        .replace(/^\.?\//, '')    // strip a single leading `./` or `/`
        .replace(/\/+$/, '');     // strip trailing slashes
}

/**
 * Build the composer draft key for a Notes chat, isolated by workspace and scope
 * (AC-05). Draft identity never crosses workspaces, notes, or scopes:
 *
 * - `per-workspace` → one draft per workspace, independent of any selected note.
 * - `per-note` → one draft per (workspace, normalized note path).
 *
 * Both segments are URI-encoded so no workspace ID or note path can inject the
 * `:` delimiter and collide with another key — including the `per-workspace`
 * marker — which keeps distinct (workspace, scope, note) tuples strictly apart.
 * The returned string is passed straight to `InitialChatComposer`'s `draftKey`,
 * reusing the existing text- and attachment-draft stores unchanged.
 */
export function notesChatDraftKey(
    workspaceId: string,
    scope: ChatScope,
    notePath: string | null,
): string {
    const ws = encodeURIComponent(workspaceId);
    if (scope === 'per-workspace') {
        return `notes-chat:${ws}:ws`;
    }
    const note = encodeURIComponent(normalizeNotePathForDraftKey(notePath));
    return `notes-chat:${ws}:note:${note}`;
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
    const { workspaceId, notePath, noteTitle, defaultScope = 'per-note' } = opts;
    const cloneClient = useCocClient(workspaceId); // AC-07: notes chat bindings on the selected clone's server.
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
        void cloneClient.notes.listChatBindings(workspaceId).then(res => {
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
    }, [workspaceId, cloneClient]);

    // ── Derived task ID ──────────────────────────────────────────────────────

    const taskId = scope === 'per-workspace'
        ? perWorkspaceTaskId
        : (notePath ? perNoteMap[notePath] ?? null : null);

    // ── Chat note context ────────────────────────────────────────────────────

    const [noteContextsByTaskId, setNoteContextsByTaskId] = useState<Record<string, ChatNoteContext | null>>({});
    const activeTaskIdRef = useRef(taskId);
    activeTaskIdRef.current = taskId;

    const chatNoteContext = taskId ? noteContextsByTaskId[taskId] ?? null : null;

    const syncChatNoteContext = useCallback((process: AIProcess) => {
        const metadata = process.metadata;
        const loadedTaskId = typeof metadata?.queueTaskId === 'string'
            ? metadata.queueTaskId
            : null;
        // ChatDetail can finish an older request after the selected note changes.
        // Never let that response replace the active task's attachment label.
        if (!loadedTaskId || loadedTaskId !== activeTaskIdRef.current) {
            return;
        }

        const loadedNotePath = typeof metadata?.notePath === 'string'
            ? metadata.notePath
            : null;
        const loadedNoteTitle = typeof metadata?.noteTitle === 'string'
            ? metadata.noteTitle
            : loadedNotePath;
        const nextContext = loadedNotePath
            ? { notePath: loadedNotePath, noteTitle: loadedNoteTitle ?? loadedNotePath }
            : null;
        setNoteContextsByTaskId(prev => {
            const current = prev[loadedTaskId] ?? null;
            if (current?.notePath === nextContext?.notePath
                && current?.noteTitle === nextContext?.noteTitle) {
                return prev;
            }
            return { ...prev, [loadedTaskId]: nextContext };
        });
    }, []);

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

    // ── createChat ───────────────────────────────────────────────────────────

    const createChat = useCallback(async (prompt: string, model?: string | null, mode: 'ask' | 'autopilot' = 'ask', skills?: string[], attachments?: AttachmentPayload[], aiSelection?: NotesChatAiSelection): Promise<string | null> => {
        try {
            const res = await cloneClient.notes.createChat(workspaceId, {
                prompt: formatNoteAttachmentPrompt(prompt, workspaceId, notePath),
                notePath,
                noteTitle,
                // Declare the scope explicitly (AC-04): under Workspace scope the
                // selected note path is prompt context only, so the server must not
                // create/replace that note's per-note binding.
                scope,
                mode,
                model,
                skills,
                attachments,
                // Full AI selection from the shared composer (AC-03/AC-07): concrete
                // provider / reasoning-effort / effort-tier / working directory, the
                // Auto-routing intent, and safe generic composer context. Notes-owned
                // note binding and Lens metadata are re-applied on top server-side.
                ...(aiSelection?.provider ? { provider: aiSelection.provider } : {}),
                ...(aiSelection?.reasoningEffort ? { reasoningEffort: aiSelection.reasoningEffort } : {}),
                ...(aiSelection?.effortTier ? { effortTier: aiSelection.effortTier } : {}),
                ...(aiSelection?.autoProviderRouting ? { autoProviderRouting: true } : {}),
                ...(aiSelection?.workingDirectory ? { workingDirectory: aiSelection.workingDirectory } : {}),
                ...(aiSelection?.context ? { context: aiSelection.context } : {}),
                ...(isCommitChatLensEnabled() ? { lensChat: INHERITED_LENS_CHAT_MODE } : {}),
            });
            const newTaskId = res.task.id;

            if (scope === 'per-workspace') {
                setPerWorkspaceTaskId(newTaskId);
            } else if (notePath) {
                // Server auto-binds on enqueue; mirror locally so the UI updates without waiting.
                setPerNoteMap(prev => ({ ...prev, [notePath]: newTaskId }));
            }

            // Seed the returned task's context while its process is still queued.
            setNoteContextsByTaskId(prev => ({
                ...prev,
                [newTaskId]: notePath
                    ? { notePath, noteTitle: noteTitle ?? notePath }
                    : null,
            }));
            return newTaskId;
        } catch {
            return null;
        }
    }, [workspaceId, notePath, noteTitle, scope, cloneClient]);

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
            void cloneClient.notes.deleteChatBindingByPath(workspaceId, notePath).catch(() => undefined);
        }
        if (taskId) {
            setNoteContextsByTaskId(prev => {
                const next = { ...prev };
                delete next[taskId];
                return next;
            });
        }
    }, [scope, notePath, taskId, workspaceId, cloneClient]);

    return { taskId, chatNoteContext, syncChatNoteContext, createChat, resetChat, scope, setScope };
}
