import { useState, useEffect, useCallback, useRef } from 'react';
import type { AIProcess, ChatProvider, ChatStyle, EffortTierKey, ReasoningEffort } from '@plusplusoneplusplus/coc-client';
import { useCocClient } from '../../../repos/cloneRouting';
import type { AttachmentPayload } from '../../../types/attachments';
import { isCommitChatLensEnabled } from '../../../utils/config';
import { isQueueProcessId, toQueueProcessId } from '../../../utils/queue-process-id';

const INHERITED_LENS_CHAT_MODE = {
    inherited: true,
    source: 'features.commitChatLens',
} as const;

/**
 * Whether the chat is scoped to the current note, its folder, or the whole
 * workspace. `per-section` sits between the other two: every note under one
 * folder resolves to a single chat, so switching between siblings keeps the
 * conversation you were just having.
 */
export type ChatScope = 'per-note' | 'per-section' | 'per-workspace';

/**
 * Nearest-parent folder of a note path — the key a `per-section` chat binds to.
 * Null for a note at the notes root, which has no section.
 *
 * Nearest parent, not top-level: `MultiModal/sub/note.md` is a note of section
 * `MultiModal/sub`. Mirrors `noteSectionPath` in the server's
 * note-chat-bindings handler; the two must agree or a chat binds to one key and
 * resolves from another.
 */
export function noteSectionOf(notePath: string | null | undefined): string | null {
    if (!notePath) return null;
    const normalized = normalizeNotePathForDraftKey(notePath);
    const idx = normalized.lastIndexOf('/');
    return idx > 0 ? normalized.slice(0, idx) : null;
}

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
    /** Response style; presentation only, validated server-side at the queue boundary. */
    chatStyle?: ChatStyle;
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
    /**
     * Retarget the active chat at the given note: rewrites the process's
     * `notePath`/`noteTitle` metadata so the chat's next turn reads and diffs
     * that note. Resolves false when there is no active chat or the server
     * rejects the move.
     */
    moveChatNote: (notePath: string, noteTitle?: string) => Promise<boolean>;
    scope: ChatScope;
    /**
     * Switch between per-note, per-section, and per-workspace scope. Widening a
     * per-note chat to section scope carries that chat onto the folder, so the
     * conversation survives the switch (see `changeScope`).
     */
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
 * - `per-section` → one draft per (workspace, nearest parent folder), falling
 *   back to the per-note key for a note that has no folder.
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
    if (scope === 'per-section') {
        // One draft per folder, so a half-typed message survives clicking a
        // sibling — the whole point of section scope. A note with no folder has
        // no section, so it keeps its own note-keyed draft.
        const section = noteSectionOf(notePath);
        if (section) {
            return `notes-chat:${ws}:section:${encodeURIComponent(section)}`;
        }
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
 * One-line marker prepended to the next message after the chat moves to another
 * note. Deliberately worded *Now viewing* rather than the creation-time *Note:*
 * so a transcript holding several note links reads as replacement, not
 * accumulation — the newest line is the note the chat is on.
 *
 * Like the creation-time link this carries no document content; the agent opens
 * the file itself, so a switch costs one line.
 */
export function formatNoteSwitchLink(workspaceId: string, notePath: string): string {
    const encodedWorkspaceId = encodeMarkdownLinkPathSegment(workspaceId);
    const encodedNotePath = notePath.split('/').map(encodeMarkdownLinkPathSegment).join('/');
    return `[📝 Now viewing: ${escapeMarkdownLinkText(notePath)}](#repos/${encodedWorkspaceId}/notes/${encodedNotePath})`;
}

/**
 * Scoped chat hook for the Notes view.
 *
 * Supports three chat scopes:
 * - `per-workspace`: one chat for the entire workspace (stored in `coc-notes-chat-<wsId>` localStorage)
 * - `per-section`: one chat for every note under a folder, keyed on the note's
 *   nearest parent folder — so switching between siblings keeps the conversation
 * - `per-note`: one chat per note path
 *
 * The latter two are persisted server-side in the `note_chat_bindings` SQLite table;
 * the server auto-binds when a chat task is enqueued with `context.noteChat.notePath`,
 * picking the note or its folder from `context.noteChat.scope`.
 *
 * The active scope is persisted to `coc-notes-chat-scope-<wsId>` localStorage.
 */
export function useNotesChat(opts: UseNotesChatOptions): UseNotesChatReturn {
    const { workspaceId, notePath, noteTitle, defaultScope = 'per-note' } = opts;
    const cloneClient = useCocClient(workspaceId); // AC-07: notes chat bindings on the selected clone's server.
    const key = storageKey(workspaceId);

    // ── Scope state ──────────────────────────────────────────────────────────

    const [scope, setScopeState] = useState<ChatScope>(() => {
        try {
            const stored = localStorage.getItem(scopeKey(workspaceId));
            if (stored === 'per-note' || stored === 'per-section' || stored === 'per-workspace') {
                return stored as ChatScope;
            }
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

    // `per-section` reads the folder key, or — for a root note, which has no
    // folder — the note key, matching what the server binds in each case.
    const sectionPath = noteSectionOf(notePath);
    const taskId = scope === 'per-workspace'
        ? perWorkspaceTaskId
        : scope === 'per-section'
            ? (sectionPath ? perNoteMap[sectionPath] ?? null : (notePath ? perNoteMap[notePath] ?? null : null))
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
                ...(aiSelection?.chatStyle ? { chatStyle: aiSelection.chatStyle } : {}),
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
                // Server auto-binds on enqueue; mirror locally so the UI updates
                // without waiting. Mirror the SAME key the server bound — the
                // folder under section scope — or the local map and the server
                // would disagree until the next reload.
                const bindKey = scope === 'per-section'
                    ? (noteSectionOf(notePath) ?? notePath)
                    : notePath;
                setPerNoteMap(prev => ({ ...prev, [bindKey]: newTaskId }));
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
            // Drop the same key the chat resolved from, so a section reset clears
            // the folder binding rather than a note binding that isn't there.
            const bindKey = scope === 'per-section'
                ? (noteSectionOf(notePath) ?? notePath)
                : notePath;
            setPerNoteMap(prev => {
                const next = { ...prev };
                delete next[bindKey];
                return next;
            });
            // Best-effort server cleanup; failures are tolerated.
            void cloneClient.notes.deleteChatBindingByPath(workspaceId, bindKey).catch(() => undefined);
        }
        if (taskId) {
            setNoteContextsByTaskId(prev => {
                const next = { ...prev };
                delete next[taskId];
                return next;
            });
        }
    }, [scope, notePath, taskId, workspaceId, cloneClient]);

    // ── changeScope ──────────────────────────────────────────────────────────

    /**
     * Switch scope, carrying the active chat across when it widens.
     *
     * Flipping per-note → per-section changes which key the chat resolves from
     * (note → folder). Nothing else writes that folder row — bindings are
     * normally a side effect of enqueue, and widening an existing chat has no
     * new enqueue — so without this the conversation would resolve to nothing
     * the moment the user clicked a sibling, which is precisely the disappearing
     * act section scope exists to fix.
     *
     * Adoption only fills an EMPTY folder: if the section already has a chat,
     * the user joins it rather than overwriting it.
     */
    const changeScope = useCallback((next: ChatScope) => {
        if (next === 'per-section' && notePath && taskId) {
            const section = noteSectionOf(notePath);
            if (section && !perNoteMap[section]) {
                setPerNoteMap(prev => (prev[section] ? prev : { ...prev, [section]: taskId }));
                // Best-effort server write; the local mirror already moved, so a
                // failure costs the binding on next reload, not this session.
                void cloneClient.notes
                    .setChatBindingByPath(workspaceId, section, taskId)
                    .catch(() => undefined);
            }
        }
        setScopeState(next);
    }, [notePath, taskId, perNoteMap, workspaceId, cloneClient]);

    // ── moveChatNote ─────────────────────────────────────────────────────────

    /**
     * Move the active chat onto another note. The server write to
     * `metadata.notePath` is the part that matters: follow-up turns snapshot the
     * note named there, so without it a "moved" chat would keep diffing the note
     * it was created against and silently credit edits to the wrong file.
     *
     * The local note-context map is updated optimistically so the header, the 📎
     * indicator, and the switched-note banner all follow immediately.
     */
    const moveChatNote = useCallback(async (nextNotePath: string, nextNoteTitle?: string): Promise<boolean> => {
        const activeTaskId = activeTaskIdRef.current;
        if (!activeTaskId || !nextNotePath) return false;
        const title = nextNoteTitle
            ?? nextNotePath.split('/').pop()?.replace(/\.md$/, '')
            ?? nextNotePath;
        // The binding map holds queue task IDs; the process endpoint is keyed on
        // the process ID, exactly as ChatDetail resolves it.
        const processId = isQueueProcessId(activeTaskId) ? activeTaskId : toQueueProcessId(activeTaskId);
        try {
            await cloneClient.notes.setChatNote(processId, {
                notePath: nextNotePath,
                noteTitle: title,
            });
        } catch {
            return false;
        }
        setNoteContextsByTaskId(prev => ({
            ...prev,
            [activeTaskId]: { notePath: nextNotePath, noteTitle: title },
        }));
        return true;
    }, [cloneClient]);

    return { taskId, chatNoteContext, syncChatNoteContext, createChat, resetChat, moveChatNote, scope, setScope: changeScope };
}
