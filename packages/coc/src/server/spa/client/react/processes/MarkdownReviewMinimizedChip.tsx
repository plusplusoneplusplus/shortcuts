/**
 * MarkdownReviewMinimizedChip — floating pill shown when a markdown preview
 * dialog has been minimized. Lets the user restore or fully close the preview.
 */

import { useBreakpoint } from '../hooks/useBreakpoint';

export interface MarkdownReviewMinimizedChipProps {
    /** Short filename shown in the chip label. */
    fileName: string;
    /** Called when the user clicks the chip body or the restore button. */
    onRestore: () => void;
    /** Called when the user clicks the close button on the chip. */
    onClose: () => void;
}

export function MarkdownReviewMinimizedChip({
    fileName,
    onRestore,
    onClose,
}: MarkdownReviewMinimizedChipProps) {
    const { isMobile } = useBreakpoint();
    // On mobile sit above the BottomNav bar; on desktop sit at the edge.
    const bottomClass = isMobile ? 'bottom-16' : 'bottom-4';

    return (
        <div
            data-testid="minimized-chip"
            className={`fixed ${bottomClass} right-4 z-[10001] flex items-center gap-1.5 bg-[#1e1e1e] dark:bg-[#3c3c3c] text-[#cccccc] text-sm px-3 py-2 rounded-full shadow-lg border border-[#3c3c3c] dark:border-[#555555] select-none`}
        >
            <span aria-hidden="true">📄</span>
            <button
                data-testid="minimized-chip-restore"
                onClick={onRestore}
                className="truncate max-w-[160px] hover:text-white focus:outline-none"
                title={`Restore: ${fileName}`}
                aria-label={`Restore preview: ${fileName}`}
            >
                {fileName}
            </button>
            <button
                data-testid="minimized-chip-restore-icon"
                onClick={onRestore}
                className="flex items-center justify-center hover:text-white focus:outline-none"
                aria-label="Restore preview"
                title="Restore"
            >
                ⬆
            </button>
            <button
                data-testid="minimized-chip-close"
                onClick={onClose}
                className="flex items-center justify-center hover:text-white focus:outline-none"
                aria-label="Close preview"
                title="Close"
            >
                ✕
            </button>
        </div>
    );
}
