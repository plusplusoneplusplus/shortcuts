/**
 * AIEditNavigator — floating pill showing pending AI edit count with navigation.
 *
 * Renders a compact "✦ N AI edits ↓ | Keep" pill that auto-hides when editCount is 0.
 * In narrow (chat-open) mode, shows icon-only "✦ N ↓ | Keep".
 *
 * The pill floats over the editor, so it anchors away from whatever else owns the
 * corner: the default bottom-right sits above the save indicator, while 'top-right'
 * clears the bottom-anchored Notes Chat lens.
 *
 * The dismiss action is labeled "Keep" rather than a bare ✕ so the hit target
 * matches the rest of the pill (~28px tall) and conveys that the user is
 * accepting the AI edits as-is.
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
    /** Which corner of the containing editor column to anchor to. Defaults to 'bottom-right'. */
    placement?: 'bottom-right' | 'top-right';
}

export function AIEditNavigator({ editCount, onNext, onDismiss, narrow = false, placement = 'bottom-right' }: AIEditNavigatorProps): React.ReactElement | null {
    if (editCount === 0) return null;

    const anchor = placement === 'top-right' ? 'top-2 right-3' : 'bottom-8 right-3';

    return (
        <div
            className={`absolute ${anchor} z-10 flex items-center gap-1 bg-white dark:bg-[#252526] border border-[#c8e6c9] dark:border-[#2d4a2d] rounded-full shadow-md px-2.5 py-1 text-xs select-none`}
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
                className="text-[#0078d4] hover:text-[#005a9e] dark:text-[#4fc3f7] dark:hover:text-[#81d4fa] font-bold leading-none px-1 py-0.5 rounded"
                title="Jump to next AI edit"
                aria-label="Jump to next AI edit"
                data-testid="ai-edit-navigator-next"
            >
                ↓
            </button>

            <span
                className="opacity-20 select-none mx-0.5"
                aria-hidden="true"
                data-testid="ai-edit-navigator-separator"
            >
                |
            </span>

            <button
                onClick={onDismiss}
                className="text-[#666] hover:text-[#222] dark:text-[#aaa] dark:hover:text-white leading-none px-1.5 py-0.5 rounded text-xs font-medium"
                title="Dismiss AI edit highlights"
                aria-label="Dismiss AI edit highlights"
                data-testid="ai-edit-navigator-dismiss"
            >
                Keep
            </button>
        </div>
    );
}
