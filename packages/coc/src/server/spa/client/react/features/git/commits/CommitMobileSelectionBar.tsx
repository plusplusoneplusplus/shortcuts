/**
 * CommitMobileSelectionBar — sticky header shown while mobile multi-select is
 * active: a cancel button, the selected count, and an overflow that opens the
 * commit context menu for the selection.
 */

export function CommitMobileSelectionBar({ selectedCount, onClear, onActions }: {
    selectedCount: number;
    onClear: () => void;
    onActions: (e: React.MouseEvent<HTMLButtonElement>) => void;
}) {
    return (
        <div
            className="flex items-center gap-2 px-3 py-2 bg-[#f0f9ff] dark:bg-[#1a2733] border-b border-[#e0e0e0] dark:border-[#3c3c3c] sticky top-0 z-20"
            data-testid="commit-mobile-selection-bar"
        >
            <button
                type="button"
                className="w-7 h-7 rounded text-sm text-[#616161] dark:text-[#ccc] hover:bg-[#dbeafe] dark:hover:bg-[#243447]"
                aria-label="Clear commit selection"
                onClick={onClear}
                data-testid="commit-mobile-selection-cancel"
            >
                ✕
            </button>
            <span className="text-xs font-medium text-[#1e1e1e] dark:text-[#ccc]" data-testid="commit-mobile-selection-count">
                {selectedCount} selected
            </span>
            <button
                type="button"
                className="ml-auto px-2.5 py-1.5 rounded text-xs font-medium text-[#0078d4] dark:text-[#3794ff] hover:bg-[#dbeafe] dark:hover:bg-[#243447]"
                onClick={onActions}
                data-testid="commit-mobile-selection-actions"
            >
                ⋮ Actions
            </button>
        </div>
    );
}
