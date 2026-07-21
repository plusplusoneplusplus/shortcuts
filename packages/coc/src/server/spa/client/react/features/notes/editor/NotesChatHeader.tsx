/**
 * NotesChatHeader — the single compact header for the Notes Chat surface.
 *
 * Replaces the previously duplicated headers (ReviewChatPlacementFrame's
 * generic title row, NoteChatPanel's own per-state header rows, and
 * ChatDetail's nested floating-chat header) with one 48px header shown in
 * both the empty and active conversation states. See
 * notes/Plans/note-canvas/notes-chat-compact-header.plan.md.
 */

import { useMemo } from 'react';
import { ChatHeaderOverflowMenu, type OverflowMenuItem } from '../../chat/ChatHeaderOverflowMenu';
import type { ChatScope } from '../hooks/useNotesChat';

/** Where the Notes Chat surface is currently presented. Drives which window actions are available. */
export type NotesChatWindowMode = 'lens' | 'side-panel' | 'embedded';

export interface NotesChatHeaderProps {
    /** Muted context label — current note title (note scope) or workspace label (workspace scope). */
    contextLabel: string;
    scope: ChatScope;
    onScopeChange: (scope: ChatScope) => void;
    windowMode: NotesChatWindowMode;
    onClose: () => void;
    /** Minimizes the Lens. Only rendered when windowMode is 'lens'. */
    onMinimize?: () => void;
    /** Pins the Lens to the side panel. Only rendered when windowMode is 'lens'. */
    onPin?: () => void;
    /** Unpins the side panel back to a Lens. Only rendered when windowMode is 'side-panel'. */
    onUnpin?: () => void;
    /** Starts a new chat, keeping the current conversation recoverable in history. Surfaced via the overflow menu. */
    onNewChat?: () => void;
    /**
     * Workspace-relative path of the note the active chat is bound to. When set,
     * a compact 📎 path-reference button appears in the right control cluster; its
     * tooltip reveals the full path that was prepended to the first message.
     */
    chatNotePath?: string | null;
    /** Title of the note the active chat is bound to — used in the switched-state tooltip. */
    chatNoteTitle?: string | null;
    /**
     * True when the currently selected note differs from the note the chat is
     * bound to. Tints the 📎 button amber and swaps its tooltip to the
     * "attached to a different note" warning.
     */
    isSwitched?: boolean;
}

function MinimizeIcon() {
    return (
        <svg aria-hidden="true" className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none">
            <path d="M3.5 8h9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
    );
}

function PinIcon() {
    return (
        <svg aria-hidden="true" className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none">
            <path
                d="M6 2.75h4l-.6 3.5 2.1 2.1v1.15h-7V8.35l2.1-2.1L6 2.75Z"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinejoin="round"
            />
            <path d="M8 9.5v3.75" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
    );
}

function PaperclipIcon() {
    return (
        <svg aria-hidden="true" className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none">
            <path
                d="M11.5 5.25 6.6 10.15a1.6 1.6 0 0 0 2.26 2.26l4.9-4.9a3 3 0 0 0-4.24-4.24l-4.9 4.9a4.4 4.4 0 0 0 6.22 6.22l3.5-3.5"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    );
}

/** Derives a human-friendly note title from the bound title or, failing that, the file name in the path. */
function deriveNoteTitle(chatNotePath: string, chatNoteTitle?: string | null): string {
    return chatNoteTitle || chatNotePath.split('/').pop()?.replace(/\.md$/, '') || chatNotePath;
}

export function NotesChatHeader({
    contextLabel,
    scope,
    onScopeChange,
    windowMode,
    onClose,
    onMinimize,
    onPin,
    onUnpin,
    onNewChat,
    chatNotePath,
    chatNoteTitle,
    isSwitched = false,
}: NotesChatHeaderProps) {
    const overflowItems: OverflowMenuItem[] = useMemo(() => {
        if (!onNewChat) return [];
        return [{
            key: 'new-chat',
            label: 'New chat',
            icon: <span aria-hidden="true">🔄</span>,
            onClick: onNewChat,
        }];
    }, [onNewChat]);

    const pathRefTooltip = useMemo(() => {
        if (!chatNotePath) return '';
        if (isSwitched) {
            return `Attached to ${deriveNoteTitle(chatNotePath, chatNoteTitle)} — Start New Chat to switch.`;
        }
        return `Path reference: ${chatNotePath}`;
    }, [chatNotePath, chatNoteTitle, isSwitched]);

    return (
        <div
            className="flex h-12 flex-shrink-0 items-center justify-between gap-2 border-b border-[#e0e0e0] px-3 dark:border-[#3c3c3c]"
            data-testid="notes-chat-header"
        >
            <div className="flex min-w-0 items-center gap-2">
                <span
                    aria-hidden="true"
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#1e1e1e] text-[11px] dark:bg-[#cccccc]"
                >
                    🤖
                </span>
                <span className="shrink-0 text-xs font-semibold text-[#1e1e1e] dark:text-[#cccccc]">
                    Notes Chat
                </span>
                <span
                    className="min-w-0 truncate text-xs text-[#848484]"
                    title={contextLabel}
                    data-testid="notes-chat-header-context"
                >
                    {contextLabel}
                </span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
                <NotesChatScopeToggle scope={scope} onScopeChange={onScopeChange} />
                <div className="flex shrink-0 items-center gap-0.5">
                    {windowMode === 'lens' && onMinimize && (
                        <button
                            type="button"
                            onClick={onMinimize}
                            aria-label="Minimize chat lens"
                            className="inline-flex h-7 w-7 items-center justify-center rounded text-[#0078d4] hover:bg-black/[0.06] dark:text-[#3794ff] dark:hover:bg-white/[0.08]"
                            data-testid="notes-chat-minimize-btn"
                            title="Minimize chat lens"
                        >
                            <MinimizeIcon />
                        </button>
                    )}
                    {windowMode === 'lens' && onPin && (
                        <button
                            type="button"
                            onClick={onPin}
                            aria-label="Pin to side panel"
                            className="inline-flex h-7 w-7 items-center justify-center rounded text-[#0078d4] hover:bg-black/[0.06] dark:text-[#3794ff] dark:hover:bg-white/[0.08]"
                            data-testid="notes-chat-pin-btn"
                            title="Pin to side panel"
                        >
                            <PinIcon />
                        </button>
                    )}
                    {windowMode === 'side-panel' && onUnpin && (
                        <button
                            type="button"
                            onClick={onUnpin}
                            className="rounded px-1.5 py-0.5 text-[11px] font-medium text-[#0078d4] hover:bg-black/[0.06] dark:text-[#3794ff] dark:hover:bg-white/[0.08]"
                            data-testid="notes-chat-unpin-btn"
                            title="Unpin from side panel"
                        >
                            Unpin
                        </button>
                    )}
                    {chatNotePath && (
                        <button
                            type="button"
                            aria-label={pathRefTooltip}
                            title={pathRefTooltip}
                            className={
                                'inline-flex h-7 w-7 items-center justify-center rounded ' +
                                (isSwitched
                                    ? 'text-[#9a6700] hover:bg-black/[0.06] dark:text-[#d29922] dark:hover:bg-white/[0.08]'
                                    : 'text-[#0078d4] hover:bg-black/[0.06] dark:text-[#3794ff] dark:hover:bg-white/[0.08]')
                            }
                            data-testid="notes-chat-path-ref"
                            data-switched={isSwitched ? 'true' : 'false'}
                        >
                            <PaperclipIcon />
                        </button>
                    )}
                    {overflowItems.length > 0 && (
                        <ChatHeaderOverflowMenu items={overflowItems} />
                    )}
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Close Notes Chat"
                        className="rounded px-1 py-0.5 text-xs text-[#848484] hover:bg-black/[0.06] hover:text-[#1e1e1e] dark:hover:bg-white/[0.08] dark:hover:text-white"
                        data-testid="note-chat-close-btn"
                        title="Close"
                    >
                        ✕
                    </button>
                </div>
            </div>
        </div>
    );
}

// ── Scope toggle segmented control ───────────────────────────────────────────

export interface NotesChatScopeToggleProps {
    scope: ChatScope;
    onScopeChange: (scope: ChatScope) => void;
}

export function NotesChatScopeToggle({ scope, onScopeChange }: NotesChatScopeToggleProps) {
    return (
        <div className="flex items-center gap-0.5" data-testid="chat-scope-toggle">
            <button
                type="button"
                className={
                    'text-[10px] px-2 py-0.5 rounded transition-colors ' +
                    (scope === 'per-note'
                        ? 'bg-[#0078d4] text-white font-medium'
                        : 'text-[#848484] hover:text-[#333] dark:hover:text-white hover:bg-[#e8e8e8] dark:hover:bg-[#333]')
                }
                onClick={() => onScopeChange('per-note')}
                aria-pressed={scope === 'per-note'}
                data-testid="chat-scope-per-note"
                title="One chat per note"
            >
                This note
            </button>
            <button
                type="button"
                className={
                    'text-[10px] px-2 py-0.5 rounded transition-colors ' +
                    (scope === 'per-workspace'
                        ? 'bg-[#0078d4] text-white font-medium'
                        : 'text-[#848484] hover:text-[#333] dark:hover:text-white hover:bg-[#e8e8e8] dark:hover:bg-[#333]')
                }
                onClick={() => onScopeChange('per-workspace')}
                aria-pressed={scope === 'per-workspace'}
                data-testid="chat-scope-per-workspace"
                title="One chat for the whole workspace"
            >
                Workspace
            </button>
        </div>
    );
}
