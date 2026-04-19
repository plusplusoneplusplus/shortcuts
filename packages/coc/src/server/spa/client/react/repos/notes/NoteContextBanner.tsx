/**
 * NoteContextBanner — read-only banner showing which note is attached
 * to the current Notes Chat session and its content status.
 *
 * Displays:
 * - Note title and workspace-relative path
 * - Status chips: "Attached note", "Truncated to N chars", etc.
 * - Anchoring hint when the user selects a different note
 */

import { cn } from '../../shared/cn';

// ============================================================================
// Types
// ============================================================================

export type NoteStatusKind = 'attached' | 'truncated' | 'not-found' | 'empty';

export interface NoteContentStatusInfo {
    status: NoteStatusKind;
    charLimit: number;
    originalLength?: number;
}

export interface NoteContextBannerProps {
    /** Note path used when the chat was created (from process metadata) */
    chatNotePath: string | null | undefined;
    /** Note title used when the chat was created (from process metadata) */
    chatNoteTitle: string | null | undefined;
    /** Currently selected note path in the Notes sidebar */
    currentNotePath: string | null | undefined;
    /** Note content status from process metadata */
    contentStatus: NoteContentStatusInfo | null | undefined;
    className?: string;
    'data-testid'?: string;
}

// ============================================================================
// Helpers
// ============================================================================

function formatCharCount(n: number): string {
    return n >= 1000 ? `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k` : String(n);
}

function statusChip(
    label: string,
    variant: 'info' | 'warning' | 'error',
): JSX.Element {
    const styles: Record<typeof variant, string> = {
        info: 'bg-[#e8f3ff] dark:bg-[#0f2a42] text-[#0078d4] dark:text-[#3794ff] border-[#b3d7ff] dark:border-[#2a4a66]',
        warning: 'bg-[#fff8e1] dark:bg-[#2a2517] text-[#795500] dark:text-[#e0a825] border-[#e0c87a] dark:border-[#5c4a1a]',
        error: 'bg-[#fff5f5] dark:bg-[#2a1a1a] text-[#c72e2e] dark:text-[#f48771] border-[#f5c6c6] dark:border-[#5c2020]',
    };
    return (
        <span
            className={cn(
                'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border',
                styles[variant],
            )}
            data-testid="note-status-chip"
        >
            {label}
        </span>
    );
}

// ============================================================================
// Component
// ============================================================================

export function NoteContextBanner({
    chatNotePath,
    chatNoteTitle,
    currentNotePath,
    contentStatus,
    className,
    ...props
}: NoteContextBannerProps) {
    if (!chatNotePath) return null;

    const displayTitle = chatNoteTitle || chatNotePath.split('/').pop()?.replace(/\.md$/, '') || chatNotePath;

    const isSwitched = currentNotePath !== null &&
        currentNotePath !== undefined &&
        currentNotePath !== chatNotePath;

    const statusKind = contentStatus?.status ?? 'attached';

    return (
        <div
            className={cn(
                'flex flex-col gap-1 px-3 py-1.5 border-b border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#f5f5f5] dark:bg-[#252526]',
                className,
            )}
            data-testid={props['data-testid'] ?? 'note-context-banner'}
        >
            {/* Main row: icon + title + path + status chips */}
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
                    {statusKind === 'attached' && statusChip('Attached note', 'info')}
                    {statusKind === 'truncated' && statusChip(
                        `Truncated to ${formatCharCount(contentStatus!.charLimit)} chars`,
                        'warning',
                    )}
                    {statusKind === 'not-found' && statusChip('Note not found', 'error')}
                    {statusKind === 'empty' && statusChip('Empty note', 'warning')}
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
