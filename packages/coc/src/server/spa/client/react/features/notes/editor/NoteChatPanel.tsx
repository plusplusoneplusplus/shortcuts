import { useEffect, useCallback, useRef, useState } from 'react';
import { useNotesChat, notesChatDraftKey, noteSectionOf, formatNoteSwitchLink } from '../hooks/useNotesChat';
import type { ChatScope, NotesChatAiSelection } from '../hooks/useNotesChat';
import { ChatDetail } from '../../chat/ChatDetail';
import { ChatPreferencesProvider } from '../../../contexts/ChatPreferencesContext';
import { InitialChatComposer } from '../../chat/NewChatArea';
import type { InitialChatComposerSubmission } from '../../chat/NewChatArea';
import { NoteContextBanner } from './NoteContextBanner';
import { NotesChatHeader, type NotesChatWindowMode } from './NotesChatHeader';
import type { ChatHeaderMetadata } from '../../chat/conversation/ChatMetadataButton';
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
    /**
     * Goal 3 (AC-03): whole-paper grounding directive prepended to the next
     * message so the NoteChatExecutor reads an embedded paper's full extracted
     * text. Set by the "💬 Chat about this paper" action; cleared after send.
     */
    paperGrounding?: string | null;
    /** Called to clear the paper grounding prefix after send. */
    onClearPaperGrounding?: () => void;
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

export function NoteChatPanel({ workspaceId, notePath, noteTitle, onClose, onBeforeSend, defaultScope, references, onRemoveReference, onClearReferences, paperGrounding, onClearPaperGrounding, onHasChatChange, presentation = 'embedded', onMinimize, onPin, onUnpin }: NoteChatPanelProps) {
    const { taskId, chatNoteContext, syncChatNoteContext, createChat, resetChat, moveChatNote, scope, setScope } = useNotesChat({
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
    // The section the selected note belongs to (its nearest parent folder), or
    // null at the notes root. Drives the Section toggle segment, the section
    // header label, and the "Use section scope" banner action.
    const sectionPath = noteSectionOf(notePath);
    const sectionLabel = sectionPath?.split('/').pop() ?? sectionPath;
    const headerContextLabel = scope === 'per-note'
        ? noteContextLabel
        : scope === 'per-section'
            ? (sectionLabel ?? noteContextLabel)
            : workspaceLabel;

    // ── Chat-bound note reference (shared by header 📎 + switched-note banner) ─
    // `chatNoteContext` is the note the chat was bound to when created; `notePath`
    // is the note currently selected in the sidebar. When they diverge the chat
    // is attached to a different note — surfaced as an amber 📎 in the header and
    // a slim warning strip below it. Computed once here so the two can't desync.
    const chatNotePath = chatNoteContext?.notePath ?? null;
    const chatNoteTitle = chatNoteContext?.noteTitle ?? null;
    // Only meaningful in per-note scope. Under section scope every sibling
    // legitimately shares the chat, so flagging each sibling click as a switch
    // would fire the banner constantly and defeat the whole feature — the chat
    // follows the selection instead (see the auto-move effect below).
    const isNoteSwitched = scope === 'per-note'
        && chatNotePath !== null && notePath !== null && notePath !== chatNotePath;

    useEffect(() => {
        onHasChatChange?.(!!taskId);
    }, [taskId, onHasChatChange]);

    // ── Conversation metadata for the header "i" ─────────────────────────────
    // ChatDetail owns the chat state and publishes this bundle upward; the
    // compact header only renders it. Cleared whenever the chat goes away
    // (New chat, /new, /clear, scope switch) so the empty state can never show
    // the previous conversation's metadata.
    const [chatMeta, setChatMeta] = useState<ChatHeaderMetadata | null>(null);
    useEffect(() => {
        if (!taskId) setChatMeta(null);
    }, [taskId]);

    // ── Moving the chat's active note ────────────────────────────────────────
    // Nothing is sent when the note changes: clicking a note in the sidebar is
    // navigation, not a turn, and firing a model turn per click would burn
    // tokens while you browse. The switch is marked pending and folded into the
    // next message as a single `Now viewing:` line — the same shape as the
    // creation-time note link, so a switch costs one line and no document.
    const [pendingSwitchNotePath, setPendingSwitchNotePath] = useState<string | null>(null);

    const moveChatTo = useCallback(async (targetPath: string, targetTitle?: string) => {
        const moved = await moveChatNote(targetPath, targetTitle);
        if (moved) setPendingSwitchNotePath(targetPath);
        return moved;
    }, [moveChatNote]);

    // Section scope: the chat follows the selection inside its folder, with no
    // banner and no confirmation — that is what "one chat for this folder"
    // means. The server rejects a target outside the bound folder, so a stray
    // selection can't retarget where the agent writes.
    const lastAutoMovedRef = useRef<string | null>(null);
    useEffect(() => {
        if (scope !== 'per-section' || !taskId || !notePath) return;
        if (!chatNotePath || chatNotePath === notePath) return;
        if (noteSectionOf(notePath) !== noteSectionOf(chatNotePath)) return;
        const moveKey = `${taskId}:${notePath}`;
        if (lastAutoMovedRef.current === moveKey) return;
        lastAutoMovedRef.current = moveKey;
        void moveChatTo(notePath, noteTitle);
    }, [scope, taskId, notePath, noteTitle, chatNotePath, moveChatTo]);

    // Banner actions (per-note scope only). `Continue here` keeps the task and
    // moves it; `Use section scope` does the same and widens the scope, so the
    // sibling you just clicked — and every other note in the folder — resolves
    // to this chat from now on.
    const handleContinueHere = useCallback(() => {
        if (!notePath) return;
        void moveChatTo(notePath, noteTitle);
    }, [notePath, noteTitle, moveChatTo]);

    const handleUseSectionScope = useCallback(() => {
        if (!notePath || !sectionPath) return;
        void moveChatTo(notePath, noteTitle).then(moved => {
            if (moved) setScope('per-section');
        });
    }, [notePath, noteTitle, sectionPath, moveChatTo, setScope]);

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
            ...(submission.chatStyle ? { chatStyle: submission.chatStyle } : {}),
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

    // Section scope still needs a note to know which folder it is scoped to.
    const noNoteSelected = scope !== 'per-workspace' && !notePath;

    // Fold the pending note switch, the paper grounding directive (Goal 3,
    // AC-03), and note references into one pending prefix; undefined when none is
    // present. The switch line leads — it names the note everything after it is
    // about, so "summarize this" resolves against the newest link rather than an
    // earlier one still sitting in the transcript. The paper directive then
    // precedes the quoted note excerpts so the model reads the full paper first.
    const switchPrefix = pendingSwitchNotePath
        ? `${formatNoteSwitchLink(workspaceId, pendingSwitchNotePath)}\n\n`
        : '';
    const referencePrefix = references && references.length > 0 ? formatNoteReferences(references) : '';
    const combinedPrefix = `${switchPrefix}${paperGrounding ?? ''}${referencePrefix}`;
    const pendingPrefix = combinedPrefix.length > 0 ? combinedPrefix : undefined;
    const clearPendingPrefix = useCallback(() => {
        onClearReferences?.();
        onClearPaperGrounding?.();
        setPendingSwitchNotePath(null);
    }, [onClearReferences, onClearPaperGrounding]);

    const emptyStateText = scope === 'per-note'
        ? 'Ask about this note…'
        : scope === 'per-section'
            ? `Ask about the notes in ${sectionLabel ?? 'this folder'} — one chat per folder`
            : 'Ask about your notes — one chat per workspace';

    return (
        <div className="flex flex-col bg-[#f8f8f8] dark:bg-[#1e1e1e] overflow-hidden h-full w-full"
             data-testid="note-chat-panel">

            {/* Single compact header — shown in both empty and active conversation states */}
            <NotesChatHeader
                contextLabel={headerContextLabel}
                scope={scope}
                onScopeChange={setScope}
                sectionAvailable={sectionPath !== null}
                windowMode={presentation}
                onClose={onClose}
                onMinimize={onMinimize}
                onPin={onPin}
                onUnpin={onUnpin}
                onNewChat={taskId ? resetChat : undefined}
                chatNotePath={chatNotePath}
                chatNoteTitle={chatNoteTitle}
                isSwitched={isNoteSwitched}
                chatMetadata={chatMeta}
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
                            pendingPrefix={pendingPrefix}
                            onClearPendingPrefix={clearPendingPrefix}
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
                            onContinueHere={notePath ? handleContinueHere : undefined}
                            onUseSectionScope={notePath && sectionPath ? handleUseSectionScope : undefined}
                        />
                    )}
                    {pendingSwitchNotePath && (
                        <div
                            className="border-b border-[#e0e0e0] bg-[#f3f3f3] px-3 py-1 dark:border-[#3c3c3c] dark:bg-[#252526]"
                            data-testid="note-switch-divider"
                        >
                            <div className="truncate text-[10px] text-[#848484]" title={pendingSwitchNotePath}>
                                <span aria-hidden="true">📝</span> Now viewing{' '}
                                <span className="font-medium text-[#1e1e1e] dark:text-[#cccccc]">
                                    {pendingSwitchNotePath.split('/').pop()?.replace(/\.md$/, '') ?? pendingSwitchNotePath}
                                </span>
                                {' '}— included with your next message
                            </div>
                        </div>
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
                        openNotePath={notePath ?? undefined}
                        variant="floating"
                        standalone
                        title="Notes Chat"
                        hideHeader
                        allowedModes={NOTE_CHAT_ALLOWED_MODES}
                        disableScratchpad
                        hidePlanBanners
                        onBack={onClose}
                        pendingPrefix={pendingPrefix}
                        onClearPendingPrefix={clearPendingPrefix}
                        onProcessLoaded={syncChatNoteContext}
                        onHeaderMetadataChange={setChatMeta}
                    />
                </ChatPreferencesProvider>
            )}
        </div>
    );
}
