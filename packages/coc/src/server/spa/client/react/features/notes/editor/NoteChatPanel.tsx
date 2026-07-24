import { useEffect, useCallback } from 'react';
import { useNotesChat, notesChatDraftKey } from '../hooks/useNotesChat';
import type { ChatScope, NotesChatAiSelection } from '../hooks/useNotesChat';
import { ChatDetail } from '../../chat/ChatDetail';
import { ChatPreferencesProvider } from '../../../contexts/ChatPreferencesContext';
import { InitialChatComposer } from '../../chat/NewChatArea';
import type { InitialChatComposerSubmission } from '../../chat/NewChatArea';
import { NoteContextBanner } from './NoteContextBanner';
import { NotesChatHeader, type NotesChatWindowMode } from './NotesChatHeader';
import { NoteReferenceChips } from './NoteReferenceChips';
import { formatNoteReferences } from './useNoteReferences';
import type { NoteTextReference } from './useNoteReferences';
import type { ChatMode } from '../../../repos/modeConfig';
import { useApp } from '../../../contexts/AppContext';
import { resolveWorkspaceName } from '../../../utils/workspace';

// ── Allowed modes for Note Chat ──────────────────────────────────────────────
// Notes Chat is intentionally limited to Ask and Autopilot; Ralph, For Each,
// Map Reduce, and every other workflow mode are never offered here, even when
// their feature flags are globally enabled (AC-03). Module-level constant so the
// reference stays stable across renders — the shared composer keys its mode memos
// on it, and ChatDetail restricts its follow-up mode set to the same values.
const NOTE_CHAT_ALLOWED_MODES: ChatMode[] = ['ask', 'autopilot'];

export interface NoteChatPanelProps {
    workspaceId: string;
    /** Currently selected note path — used as context for the initial message */
    notePath: string | null;
    noteTitle?: string;
    onClose: () => void;
    /** Called before creating a new chat to flush pending editor saves. */
    onBeforeSend?: () => Promise<void>;
    /** Default chat scope. Defaults to 'per-note'. */
    defaultScope?: ChatScope;
    /** Note text references to prepend to the next message. */
    references?: NoteTextReference[];
    /** Called to remove a reference chip. */
    onRemoveReference?: (id: string) => void;
    /** Called to clear all reference chips after send. */
    onClearReferences?: () => void;
    /** Called whenever the chat existence state changes (taskId goes from null→set or set→null). */
    onHasChatChange?: (hasChat: boolean) => void;
    /**
     * Where this panel is currently presented — drives which window actions
     * the compact header shows (minimize/pin for 'lens', unpin for
     * 'side-panel', neither for 'embedded'). Defaults to 'embedded'.
     */
    presentation?: NotesChatWindowMode;
    /** Minimizes the Lens. Only meaningful when presentation is 'lens'. */
    onMinimize?: () => void;
    /** Pins the Lens to the side panel. Only meaningful when presentation is 'lens'. */
    onPin?: () => void;
    /** Unpins the side panel back to a Lens. Only meaningful when presentation is 'side-panel'. */
    onUnpin?: () => void;
}

export function NoteChatPanel({ workspaceId, notePath, noteTitle, onClose, onBeforeSend, defaultScope, references, onRemoveReference, onClearReferences, onHasChatChange, presentation = 'embedded', onMinimize, onPin, onUnpin }: NoteChatPanelProps) {
    const { taskId, chatNoteContext, syncChatNoteContext, createChat, resetChat, scope, setScope } = useNotesChat({
        workspaceId,
        notePath,
        noteTitle,
        defaultScope,
    });

    // ── Compact header context label ─────────────────────────────────────────
    // The header shows the current note title in per-note scope, or the
    // workspace display name in per-workspace scope.
    const { state: appState } = useApp();
    const workspaceLabel = resolveWorkspaceName(workspaceId, null, appState.workspaces) ?? workspaceId;
    const workspaceRoot = appState.workspaces?.find((w: any) => w.id === workspaceId)?.rootPath;
    const noteContextLabel = noteTitle || notePath?.split('/').pop()?.replace(/\.md$/, '') || 'No note selected';
    const headerContextLabel = scope === 'per-note' ? noteContextLabel : workspaceLabel;

    // ── Chat-bound note reference (shared by header 📎 + switched-note banner) ─
    // `chatNoteContext` is the note the chat was bound to when created; `notePath`
    // is the note currently selected in the sidebar. When they diverge the chat
    // is attached to a different note — surfaced as an amber 📎 in the header and
    // a slim warning strip below it. Computed once here so the two can't desync.
    const chatNotePath = chatNoteContext?.notePath ?? null;
    const chatNoteTitle = chatNoteContext?.noteTitle ?? null;
    const isNoteSwitched = chatNotePath !== null && notePath !== null && notePath !== chatNotePath;

    useEffect(() => {
        onHasChatChange?.(!!taskId);
    }, [taskId, onHasChatChange]);

    // ── Shared-composer adapters ─────────────────────────────────────────────
    // Notes owns only a thin submission adapter; the shared InitialChatComposer
    // owns the rich-text input, slash/model menus, skill loading, file
    // attachments, provider/model/effort state, drafts, autocomplete, prompt
    // history, keyboard handling, and send state (AC-01).

    const handleComposerSubmit = useCallback(async (submission: InitialChatComposerSubmission): Promise<string | null> => {
        // Flush pending editor saves before creating the queue task (AC-06 order).
        // A flush rejection propagates, so the shared composer preserves the input,
        // references, and attachments and shows its inline error; no binding is made.
        await onBeforeSend?.();

        // Split the shared submission into useNotesChat.createChat's shape. Skills
        // and the Auto-routing intent travel through dedicated fields; the rest of
        // the generic context passes through untouched (the Notes-owned reserved
        // keys always win the reserved-key merge server-side, AC-07).
        const rawContext = submission.context ?? {};
        const { skills: rawSkills, autoProviderRouting, ...genericContext } = rawContext as {
            skills?: unknown;
            autoProviderRouting?: unknown;
            [key: string]: unknown;
        };
        const skills = Array.isArray(rawSkills) ? (rawSkills as string[]) : undefined;

        const aiSelection: NotesChatAiSelection = {
            // Concrete provider only; Auto routing rides as a boolean intent.
            ...(submission.provider && submission.provider !== 'auto' ? { provider: submission.provider } : {}),
            ...(submission.reasoningEffort ? { reasoningEffort: submission.reasoningEffort } : {}),
            ...(submission.config?.effortTier ? { effortTier: submission.config.effortTier } : {}),
            ...(autoProviderRouting ? { autoProviderRouting: true } : {}),
            ...(submission.workingDirectory ? { workingDirectory: submission.workingDirectory } : {}),
            ...(Object.keys(genericContext).length > 0 ? { context: genericContext } : {}),
        };

        const newTaskId = await createChat(
            submission.prompt,
            submission.model ?? null,
            submission.mode === 'autopilot' ? 'autopilot' : 'ask',
            skills && skills.length > 0 ? skills : undefined,
            submission.attachments && submission.attachments.length > 0 ? submission.attachments : undefined,
            aiSelection,
        );
        // createChat swallows request errors and returns null. Surface that as a
        // rejection so the shared composer keeps the input, references, and
        // attachments and shows its inline error (AC-06) — no binding was created.
        if (!newTaskId) {
            throw new Error('Failed to create Notes chat. Please try again.');
        }
        return newTaskId;
    }, [onBeforeSend, createChat]);

    // Exact trimmed, case-insensitive /new and /clear reset the active Notes
    // binding and clear only the typed command — without flushing the note,
    // creating a queue task, or consuming pending references/attachments (AC-04).
    // Returning true tells the shared composer the input was a local command.
    const handleInterceptSubmit = useCallback((raw: string): boolean => {
        if (/^\/(new|clear)$/i.test(raw.trim())) {
            resetChat();
            return true;
        }
        return false;
    }, [resetChat]);

    const noNoteSelected = scope === 'per-note' && !notePath;

    const emptyStateText = scope === 'per-note'
        ? 'Ask about this note…'
        : 'Ask about your notes — one chat per workspace';

    return (
        <div className="flex flex-col bg-[#f8f8f8] dark:bg-[#1e1e1e] overflow-hidden h-full w-full"
             data-testid="note-chat-panel">

            {/* Single compact header — shown in both empty and active conversation states */}
            <NotesChatHeader
                contextLabel={headerContextLabel}
                scope={scope}
                onScopeChange={setScope}
                windowMode={presentation}
                onClose={onClose}
                onMinimize={onMinimize}
                onPin={onPin}
                onUnpin={onUnpin}
                onNewChat={taskId ? resetChat : undefined}
                chatNotePath={chatNotePath}
                chatNoteTitle={chatNoteTitle}
                isSwitched={isNoteSwitched}
            />

            {/* Empty state / no-note state — no chat yet */}
            {!taskId && (
                noNoteSelected ? (
                    <div className="flex-1 flex items-center justify-center">
                        <div className="text-center text-[#848484]">
                            <div className="text-3xl mb-2">📝</div>
                            <div className="text-sm font-medium mb-1">No note selected</div>
                            <div className="text-xs">Select a note to start chatting</div>
                        </div>
                    </div>
                ) : (
                    // The empty state is the shared initial composer (AC-01). Notes
                    // supplies only a thin adapter: the compact AI-settings chip,
                    // Ask/Autopilot-only modes, its robot identity and scope copy,
                    // selected-text references as a pending prefix + accessory chips,
                    // and a scope-isolated draft key (AC-02/03/04/05). The
                    // `flex-1 min-h-0` wrapper lets the h-full composer fill the space
                    // below the compact header and keep its input bottom-docked.
                    <div className="flex-1 min-h-0">
                        <InitialChatComposer
                            workspaceId={workspaceId}
                            workspaceRoot={workspaceRoot}
                            onSubmit={handleComposerSubmit}
                            interceptSubmit={handleInterceptSubmit}
                            settingsLayout="compact"
                            allowedModes={NOTE_CHAT_ALLOWED_MODES}
                            enableRalphDirectGoal={false}
                            testIdPrefix="note-chat"
                            heroIcon="🤖"
                            heroTitle="Notes Chat"
                            heroDescription={emptyStateText}
                            placeholder="Ask about your notes..."
                            draftKey={notesChatDraftKey(workspaceId, scope, notePath)}
                            pendingPrefix={references && references.length > 0 ? formatNoteReferences(references) : undefined}
                            onClearPendingPrefix={onClearReferences}
                            accessoryAboveInput={
                                <NoteReferenceChips
                                    references={references ?? []}
                                    onRemove={onRemoveReference ?? (() => {})}
                                />
                            }
                        />
                    </div>
                )
            )}

            {/* Active chat */}
            {taskId && (
                <ChatPreferencesProvider workspaceId={workspaceId}>
                    {scope === 'per-note' && (
                        <NoteContextBanner
                            chatNotePath={chatNotePath}
                            chatNoteTitle={chatNoteTitle}
                            isSwitched={isNoteSwitched}
                        />
                    )}
                    {references && references.length > 0 && (
                        <div className="px-3 pt-2 border-b border-[#e0e0e0] dark:border-[#3c3c3c]">
                            <NoteReferenceChips
                                references={references}
                                onRemove={onRemoveReference ?? (() => {})}
                                className="mb-2"
                            />
                        </div>
                    )}
                    <ChatDetail
                        taskId={taskId}
                        workspaceId={workspaceId}
                        variant="floating"
                        standalone
                        title="Notes Chat"
                        hideHeader
                        allowedModes={NOTE_CHAT_ALLOWED_MODES}
                        compactModeSelector
                        disableScratchpad
                        hidePlanBanners
                        onBack={onClose}
                        pendingPrefix={references && references.length > 0 ? formatNoteReferences(references) : undefined}
                        onClearPendingPrefix={onClearReferences}
                        onProcessLoaded={syncChatNoteContext}
                    />
                </ChatPreferencesProvider>
            )}
        </div>
    );
}
