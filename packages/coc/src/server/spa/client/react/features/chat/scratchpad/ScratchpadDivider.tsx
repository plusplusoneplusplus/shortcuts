import type { ScratchpadExpandMode } from './useScratchpadState';

export interface ScratchpadDividerProps {
    linkedNotePath: string | null;
    expandMode: ScratchpadExpandMode;
    isDragging: boolean;
    onMouseDown: (e: React.MouseEvent) => void;
    onOpenFilePicker: () => void;
    onExpandTop: () => void;
    onExpandBottom: () => void;
    onSplitReset: () => void;
    onClose: () => void;
}

export function ScratchpadDivider({
    linkedNotePath, expandMode, isDragging,
    onMouseDown, onOpenFilePicker,
    onExpandTop, onExpandBottom, onSplitReset, onClose,
}: ScratchpadDividerProps) {
    const displayName = linkedNotePath
        ? linkedNotePath.split('/').pop()?.replace(/\.md$/, '') ?? 'Scratchpad'
        : 'Scratchpad';

    return (
        <div
            className={[
                'h-7 flex items-center gap-0.5 px-2',
                'border-t border-[#e0e0e0] dark:border-[#3c3c3c]',
                'bg-[#f3f3f3] dark:bg-[#252526]',
                'cursor-row-resize select-none flex-shrink-0',
                'transition-colors',
                isDragging ? 'bg-[#e8f4fd] dark:bg-[#1a3a5c]' : '',
            ].join(' ')}
            onMouseDown={onMouseDown}
            data-testid="scratchpad-divider"
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize scratchpad"
        >
            {/* Drag grip indicator */}
            <span
                className="text-[#c0c0c0] dark:text-[#555] text-[10px] mr-1 pointer-events-none"
                aria-hidden="true"
            >
                ⋮⋮
            </span>

            {/* Filename — clickable to open note file picker */}
            <button
                className="text-xs text-[#0078d4] hover:underline truncate max-w-[180px]"
                onClick={(e) => { e.stopPropagation(); onOpenFilePicker(); }}
                title={linkedNotePath ?? 'Select note file'}
                data-testid="scratchpad-file-btn"
                type="button"
            >
                📝 {displayName}
            </button>

            {/* Spacer */}
            <div className="flex-1" />

            {/* Expand top: maximize conversation, collapse scratchpad */}
            <button
                className={[
                    'text-[11px] w-6 h-5 flex items-center justify-center rounded',
                    'hover:bg-[#e0e0e0] dark:hover:bg-[#3a3a3a]',
                    expandMode === 'top'
                        ? 'text-[#0078d4]'
                        : 'text-[#848484] dark:text-[#888]',
                ].join(' ')}
                onClick={(e) => { e.stopPropagation(); onExpandTop(); }}
                title="Expand conversation (collapse scratchpad to bar)"
                data-testid="scratchpad-expand-top-btn"
                type="button"
            >⬆</button>

            {/* Expand bottom: maximize scratchpad, collapse conversation */}
            <button
                className={[
                    'text-[11px] w-6 h-5 flex items-center justify-center rounded',
                    'hover:bg-[#e0e0e0] dark:hover:bg-[#3a3a3a]',
                    expandMode === 'bottom'
                        ? 'text-[#0078d4]'
                        : 'text-[#848484] dark:text-[#888]',
                ].join(' ')}
                onClick={(e) => { e.stopPropagation(); onExpandBottom(); }}
                title="Expand scratchpad (collapse conversation to bar)"
                data-testid="scratchpad-expand-bottom-btn"
                type="button"
            >⬇</button>

            {/* Split 50/50 reset */}
            <button
                className={[
                    'text-[11px] w-6 h-5 flex items-center justify-center rounded',
                    'hover:bg-[#e0e0e0] dark:hover:bg-[#3a3a3a]',
                    expandMode === 'split'
                        ? 'text-[#0078d4]'
                        : 'text-[#848484] dark:text-[#888]',
                ].join(' ')}
                onClick={(e) => { e.stopPropagation(); onSplitReset(); }}
                title="Reset to 50/50 split"
                data-testid="scratchpad-split-btn"
                type="button"
            >⊞</button>

            {/* Close */}
            <button
                className="text-[11px] w-6 h-5 flex items-center justify-center rounded text-[#848484] dark:text-[#888] hover:text-[#c00] hover:bg-[#e0e0e0] dark:hover:bg-[#3a3a3a]"
                onClick={(e) => { e.stopPropagation(); onClose(); }}
                title="Close scratchpad"
                data-testid="scratchpad-close-btn"
                type="button"
            >✕</button>
        </div>
    );
}
