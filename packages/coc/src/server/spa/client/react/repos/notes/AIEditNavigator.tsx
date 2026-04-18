/**
 * AIEditNavigator — floating pill showing pending AI edit count with navigation.
 *
 * Renders a compact "✦ N AI edits ↓" pill that auto-hides when editCount is 0.
 * In narrow (chat-open) mode, shows icon-only "✦ N ↓".
 */

import type React from 'react';

export interface AIEditNavigatorProps {
    /** Number of pending AI edit regions currently decorated in the editor. */
    editCount: number;
    /** Advance to the next edit region (scrolls editor). */
    onNext: () => void;
    /** Dismiss all decorations and reset the count. */
    onDismiss: () => void;
    /** When true, use compact icon-only layout. */
    narrow?: boolean;
}

export function AIEditNavigator({ editCount, onNext, onDismiss, narrow = false }: AIEditNavigatorProps): React.ReactElement | null {
    if (editCount === 0) return null;

    return (
        <div
            className="absolute bottom-8 right-3 z-10 flex items-center gap-1 bg-white dark:bg-[#252526] border border-[#c8e6c9] dark:border-[#2d4a2d] rounded-full shadow-md px-2.5 py-1 text-xs select-none"
            data-testid="ai-edit-navigator"
            aria-live="polite"
            aria-label={`${editCount} AI edit${editCount !== 1 ? 's' : ''} applied`}
        >
            <span className="text-green-600 dark:text-green-400 font-semibold">✦</span>

            {!narrow && (
                <span className="text-[#333] dark:text-[#ccc] font-medium mx-0.5">
                    {editCount} AI edit{editCount !== 1 ? 's' : ''}
                </span>
            )}

            {narrow && (
                <span className="text-[#333] dark:text-[#ccc] font-medium mx-0.5">{editCount}</span>
            )}

            <button
                onClick={onNext}
                className="text-[#0078d4] hover:text-[#005a9e] dark:text-[#4fc3f7] dark:hover:text-[#81d4fa] font-bold leading-none"
                title="Jump to next AI edit"
                aria-label="Jump to next AI edit"
                data-testid="ai-edit-navigator-next"
            >
                ↓
            </button>

            <button
                onClick={onDismiss}
                className="text-[#888] hover:text-[#333] dark:hover:text-white leading-none ml-0.5"
                title="Dismiss AI edit highlights"
                aria-label="Dismiss AI edit highlights"
                data-testid="ai-edit-navigator-dismiss"
            >
                ✕
            </button>
        </div>
    );
}
