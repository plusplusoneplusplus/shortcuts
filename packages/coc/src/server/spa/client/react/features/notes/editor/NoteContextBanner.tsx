/**
 * NoteContextBanner — a slim amber warning strip shown only when the active
 * Notes Chat is attached to a different note than the one currently selected.
 *
 * The note title, full path, and path-reference affordance now live in the
 * single header row (NotesChatHeader's 📎 button). This strip renders nothing
 * in the common, non-switched case, keeping the Notes Chat surface to one row.
 * It reappears only when the chat is anchored to a note the user has since
 * navigated away from — and when it does it offers a way out rather than just
 * naming the problem: continue the chat on the note you're actually looking at,
 * or widen it to the whole folder so sibling clicks stop switching anything.
 */

import { cn } from '../../../ui/cn';

// ============================================================================
// Types
// ============================================================================

export interface NoteContextBannerProps {
    /** Note title used when the chat was created (from process metadata) */
    chatNoteTitle: string | null | undefined;
    /** Note path used when the chat was created — used to derive a title fallback */
    chatNotePath?: string | null | undefined;
    /** True when the currently selected note differs from the chat-bound note. */
    isSwitched: boolean;
    /**
     * Move the chat onto the selected note, keeping the conversation. Omitted →
     * the action isn't offered and the strip stays informational.
     */
    onContinueHere?: () => void;
    /**
     * Move the chat onto the selected note AND widen it to section scope, so
     * further sibling clicks stop switching anything. A shortcut to the scope
     * toggle, which is independently visible in the header — not the only path
     * to it. Omitted when the selected note has no folder.
     */
    onUseSectionScope?: () => void;
    className?: string;
    'data-testid'?: string;
}

// ============================================================================
// Component
// ============================================================================

export function NoteContextBanner({
    chatNoteTitle,
    chatNotePath,
    isSwitched,
    onContinueHere,
    onUseSectionScope,
    className,
    ...props
}: NoteContextBannerProps) {
    if (!isSwitched) return null;

    const displayTitle = chatNoteTitle
        || chatNotePath?.split('/').pop()?.replace(/\.md$/, '')
        || chatNotePath
        || 'another note';

    const actionClass =
        'shrink-0 rounded px-1.5 py-px text-[10px] font-medium text-[#9a6700] underline '
        + 'underline-offset-2 hover:bg-black/[0.06] dark:text-[#d29922] dark:hover:bg-white/[0.08]';

    return (
        <div
            className={cn(
                'px-3 py-1 border-b border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#fff8c5] dark:bg-[#3d2e00]',
                className,
            )}
            data-testid={props['data-testid'] ?? 'note-context-banner'}
        >
            <div className="flex items-center gap-1.5">
                <span
                    className="min-w-0 flex-1 truncate text-[10px] text-[#9a6700] dark:text-[#d29922] italic"
                    data-testid="note-anchor-hint"
                    title={`This chat is about ${displayTitle}.`}
                >
                    <span aria-hidden="true">📎</span> This chat is about{' '}
                    <span className="font-medium not-italic">{displayTitle}</span>
                </span>
                {onContinueHere && (
                    <button
                        type="button"
                        onClick={onContinueHere}
                        className={actionClass}
                        data-testid="note-context-continue-here"
                        title="Move this chat onto the note you're viewing, keeping the conversation"
                    >
                        Continue here
                    </button>
                )}
                {onUseSectionScope && (
                    <button
                        type="button"
                        onClick={onUseSectionScope}
                        className={actionClass}
                        data-testid="note-context-use-section-scope"
                        title="Move this chat here and keep one chat for every note in this folder"
                    >
                        Use section scope
                    </button>
                )}
            </div>
        </div>
    );
}
