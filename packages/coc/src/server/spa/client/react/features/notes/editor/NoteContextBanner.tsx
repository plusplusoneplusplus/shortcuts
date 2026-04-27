/**
 * NoteContextBanner — read-only banner showing which note is attached
 * to the current Notes Chat session.
 *
 * Displays:
 * - Note title and workspace-relative path
 * - Static "📎 Path reference" chip (the note path was prepended to the first message)
 * - Anchoring hint when the user selects a different note
 */

import { cn } from '../../../ui/cn';

// ============================================================================
// Types
// ============================================================================

export interface NoteContextBannerProps {
    /** Note path used when the chat was created (from process metadata) */
    chatNotePath: string | null | undefined;
    /** Note title used when the chat was created (from process metadata) */
    chatNoteTitle: string | null | undefined;
    /** Currently selected note path in the Notes sidebar */
    currentNotePath: string | null | undefined;
    className?: string;
    'data-testid'?: string;
}

// ============================================================================
// Component
// ============================================================================

export function NoteContextBanner({
    chatNotePath,
    chatNoteTitle,
    currentNotePath,
    className,
    ...props
}: NoteContextBannerProps) {
    if (!chatNotePath) return null;

    const displayTitle = chatNoteTitle || chatNotePath.split('/').pop()?.replace(/\.md$/, '') || chatNotePath;

    const isSwitched = currentNotePath !== null &&
        currentNotePath !== undefined &&
        currentNotePath !== chatNotePath;

    return (
        <div
            className={cn(
                'flex flex-col gap-1 px-3 py-1.5 border-b border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#f5f5f5] dark:bg-[#252526]',
                className,
            )}
            data-testid={props['data-testid'] ?? 'note-context-banner'}
        >
            {/* Main row: icon + title + path + path-reference chip */}
            <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                <span className="shrink-0 text-xs">📝</span>
                <span
                    className="shrink-0 font-medium text-[11px] text-[#1e1e1e] dark:text-[#cccccc] truncate max-w-[40%]"
                    title={displayTitle}
                >
                    {displayTitle}
                </span>
                <span
                    className="text-[10px] text-[#848484] truncate min-w-0"
                    title={chatNotePath}
                >
                    {chatNotePath}
                </span>
                <span className="ml-auto flex items-center gap-1 shrink-0">
                    <span
                        className={cn(
                            'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border',
                            'bg-[#e8f3ff] dark:bg-[#0f2a42] text-[#0078d4] dark:text-[#3794ff] border-[#b3d7ff] dark:border-[#2a4a66]',
                        )}
                        data-testid="note-status-chip"
                    >
                        📎 Path reference
                    </span>
                </span>
            </div>

            {/* Anchoring hint when selected note differs from chat note */}
            {isSwitched && (
                <div
                    className="text-[10px] text-[#848484] italic"
                    data-testid="note-anchor-hint"
                >
                    This chat is still attached to <span className="font-medium">{displayTitle}</span>. Start New Chat to switch.
                </div>
            )}
        </div>
    );
}
