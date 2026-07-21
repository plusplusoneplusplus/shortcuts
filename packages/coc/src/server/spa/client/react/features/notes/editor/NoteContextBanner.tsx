/**
 * NoteContextBanner — a slim amber warning strip shown only when the active
 * Notes Chat is attached to a different note than the one currently selected.
 *
 * The note title, full path, and path-reference affordance now live in the
 * single header row (NotesChatHeader's 📎 button). This strip renders nothing
 * in the common, non-switched case, keeping the Notes Chat surface to one row.
 * It reappears only as a safety signal when the chat is anchored to a note the
 * user has since navigated away from.
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
    className,
    ...props
}: NoteContextBannerProps) {
    if (!isSwitched) return null;

    const displayTitle = chatNoteTitle
        || chatNotePath?.split('/').pop()?.replace(/\.md$/, '')
        || chatNotePath
        || 'another note';

    return (
        <div
            className={cn(
                'px-3 py-1 border-b border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#fff8c5] dark:bg-[#3d2e00]',
                className,
            )}
            data-testid={props['data-testid'] ?? 'note-context-banner'}
        >
            <div
                className="text-[10px] text-[#9a6700] dark:text-[#d29922] italic truncate"
                data-testid="note-anchor-hint"
                title={`This chat is still attached to ${displayTitle}. Start New Chat to switch.`}
            >
                This chat is still attached to{' '}
                <span className="font-medium not-italic">{displayTitle}</span>. Start New Chat to switch.
            </div>
        </div>
    );
}
