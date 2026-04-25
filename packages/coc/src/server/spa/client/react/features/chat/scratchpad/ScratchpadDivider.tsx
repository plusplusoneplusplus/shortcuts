import type { ScratchpadExpandMode, ScratchpadLayout } from './useScratchpadState';
import {
    ChevronUpIcon, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon,
    SplitIcon, CloseIcon, GripDotsIcon, GripDotsHorizontalIcon, FileIcon,
} from './icons';

/** Normalize path separators and extract the filename without .md extension. */
function fileBaseName(filePath: string): string {
    return filePath.replace(/\\/g, '/').split('/').pop()?.replace(/\.md$/, '') ?? filePath;
}

export interface ScratchpadDividerProps {
    linkedNotePath: string | null;
    expandMode: ScratchpadExpandMode;
    isDragging: boolean;
    onMouseDown?: (e: React.MouseEvent) => void;
    onOpenFilePicker: () => void;
    onExpandTop: () => void;
    onExpandBottom: () => void;
    onSplitReset: () => void;
    onClose: () => void;
    /** All .md files known to the scratchpad — rendered as tabs when 2 or more. */
    files?: string[];
    /** Called when a file tab is clicked; receives the file path. */
    onSelectFile?: (path: string) => void;
    /** Layout direction: horizontal (top/bottom) or vertical (left/right). */
    layout?: ScratchpadLayout;
    /**
     * 'header-bar' (default): full bar with tabs and control icons.
     * 'drag-handle': thin vertical drag strip with only the grip indicator (no icons/tabs).
     *   Used in vertical mode as the resize handle between panels.
     */
    renderMode?: 'header-bar' | 'drag-handle';
    /**
     * When true, the header-bar is rendered as a panel-top header (placed above editor content,
     * not as a resize divider). Effects: uses border-b instead of border-t, cursor-default
     * instead of cursor-row-resize, and does not register onMouseDown on the outer div.
     */
    panelHeader?: boolean;
}

export function ScratchpadDivider({
    linkedNotePath, expandMode, isDragging,
    onMouseDown, onOpenFilePicker,
    onExpandTop, onExpandBottom, onSplitReset, onClose,
    files = [], onSelectFile, layout = 'horizontal',
    renderMode = 'header-bar', panelHeader = false,
}: ScratchpadDividerProps) {
    const isVertical = layout === 'vertical';
    const displayName = linkedNotePath ? fileBaseName(linkedNotePath) : 'Scratchpad';

    const showTabs = files.length >= 2;

    const activeFileName = linkedNotePath ? fileBaseName(linkedNotePath) : 'Scratchpad';

    // Thin vertical drag-handle: grip only, no icons or tabs
    if (renderMode === 'drag-handle') {
        return (
            <div
                className={[
                    'w-2 flex flex-col items-center justify-center',
                    'border-l border-[#e0e0e0] dark:border-[#3c3c3c]',
                    'bg-[#f3f3f3] dark:bg-[#252526]',
                    'cursor-col-resize select-none flex-shrink-0',
                    'transition-colors',
                    isDragging
                        ? 'bg-[#e8f4fd] dark:bg-[#1a3a5c]'
                        : 'hover:bg-[#e8e8e8] dark:hover:bg-[#2d2d2d]',
                ].join(' ')}
                onMouseDown={onMouseDown}
                data-testid="scratchpad-divider"
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize scratchpad"
            >
                <span
                    className="text-[#999] dark:text-[#666] pointer-events-none"
                    aria-hidden="true"
                    data-testid="scratchpad-grip"
                >
                    <GripDotsHorizontalIcon />
                </span>
            </div>
        );
    }

    // Active-mode button styling helper
    const modeBtn = (mode: ScratchpadExpandMode) => [
        'w-6 h-6 flex items-center justify-center rounded',
        'hover:bg-[#e0e0e0] dark:hover:bg-[#3a3a3a]',
        expandMode === mode
            ? 'text-[#0078d4] bg-[#dbeeff] dark:bg-[#1a3a5c]'
            : 'text-[#848484] dark:text-[#888]',
    ].join(' ');

    return (
        <div
            className={isVertical ? [
                'w-8 flex flex-col items-center gap-0.5 py-2',
                'border-l border-[#e0e0e0] dark:border-[#3c3c3c]',
                'bg-[#f3f3f3] dark:bg-[#252526]',
                'cursor-col-resize select-none flex-shrink-0',
                'transition-colors',
                isDragging ? 'bg-[#e8f4fd] dark:bg-[#1a3a5c]' : '',
            ].join(' ') : [
                'h-8 flex items-center gap-0.5 px-2',
                panelHeader ? 'border-b' : 'border-t',
                'border-[#e0e0e0] dark:border-[#3c3c3c]',
                'bg-[#f3f3f3] dark:bg-[#252526]',
                panelHeader ? 'cursor-default' : 'cursor-row-resize',
                'select-none flex-shrink-0',
                'transition-colors',
                isDragging ? 'bg-[#e8f4fd] dark:bg-[#1a3a5c]' : '',
            ].join(' ')}
            onMouseDown={!panelHeader ? onMouseDown : undefined}
            data-testid="scratchpad-divider"
            role="separator"
            aria-orientation={isVertical ? 'vertical' : 'horizontal'}
            aria-label="Resize scratchpad"
        >
            {/* Drag grip indicator */}
            <span
                className={[
                    'text-[#999] dark:text-[#666] pointer-events-none',
                    isVertical ? 'mb-1' : 'mr-1',
                ].join(' ')}
                aria-hidden="true"
                data-testid="scratchpad-grip"
            >
                {isVertical ? <GripDotsHorizontalIcon /> : <GripDotsIcon />}
            </span>

            {isVertical ? (
                /* Vertical layout: show active file name vertically or a compact indicator */
                <button
                    className="text-[10px] text-[#0078d4] hover:underline writing-mode-vertical truncate max-h-[120px] flex items-center gap-0.5"
                    style={{ writingMode: 'vertical-rl', textOrientation: 'mixed' }}
                    onClick={(e) => { e.stopPropagation(); showTabs && onSelectFile ? onSelectFile(files[0]) : onOpenFilePicker(); }}
                    title={linkedNotePath ?? 'Select note file'}
                    data-testid="scratchpad-file-btn"
                    type="button"
                >
                    <FileIcon className="shrink-0" /> {activeFileName}
                </button>
            ) : showTabs ? (
                /* Horizontal tab strip — shown when 2+ files are known */
                <div
                    className="relative flex-1 min-w-0"
                    data-testid="scratchpad-file-tabs"
                >
                    <div className="flex items-stretch overflow-x-auto gap-0 scrollbar-none">
                        {files.map(f => {
                            const name = fileBaseName(f);
                            const isActive = linkedNotePath !== null &&
                                f.toLowerCase() === linkedNotePath.toLowerCase();
                            return (
                                <button
                                    key={f}
                                    className={[
                                        'text-xs px-2.5 py-1 whitespace-nowrap border-b-2 cursor-pointer transition-colors',
                                        isActive
                                            ? 'bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-white border-[#0078d4] font-medium'
                                            : 'text-[#848484] dark:text-[#888] border-transparent hover:bg-[#e8e8e8] dark:hover:bg-[#2d2d2d] hover:text-[#0078d4]',
                                    ].join(' ')}
                                    onClick={(e) => { e.stopPropagation(); onSelectFile?.(f); }}
                                    title={f}
                                    type="button"
                                    data-testid={`scratchpad-tab-${name}`}
                                    aria-current={isActive ? 'page' : undefined}
                                >
                                    {name}
                                </button>
                            );
                        })}
                    </div>
                    {/* Right-edge fade for overflow */}
                    <div
                        className="pointer-events-none absolute right-0 inset-y-0 w-8 bg-gradient-to-l from-[#f3f3f3] dark:from-[#252526] to-transparent"
                        data-testid="scratchpad-tab-fade"
                        aria-hidden="true"
                    />
                </div>
            ) : (
                /* Single-file button */
                <>
                    <button
                        className="text-xs text-[#0078d4] hover:bg-[#e8e8e8] dark:hover:bg-[#2d2d2d] truncate max-w-[180px] flex items-center gap-1 border border-[#e0e0e0] dark:border-[#3c3c3c] rounded px-1.5 py-0.5"
                        onClick={(e) => { e.stopPropagation(); onOpenFilePicker(); }}
                        title={linkedNotePath ?? 'Select note file'}
                        data-testid="scratchpad-file-btn"
                        type="button"
                    >
                        <FileIcon className="shrink-0" /> {displayName}
                    </button>

                    {/* Spacer */}
                    <div className="flex-1" />
                </>
            )}

            {isVertical && <div className="flex-1" />}

            {/* Expand primary: maximize conversation, collapse scratchpad */}
            <button
                className={modeBtn('top')}
                onClick={(e) => { e.stopPropagation(); onExpandTop(); }}
                title={isVertical ? 'Expand conversation (collapse scratchpad)' : 'Expand conversation (collapse scratchpad to bar)'}
                data-testid="scratchpad-expand-top-btn"
                type="button"
            >{isVertical ? <ChevronLeftIcon /> : <ChevronUpIcon />}</button>

            {/* Expand secondary: maximize scratchpad, collapse conversation */}
            <button
                className={modeBtn('bottom')}
                onClick={(e) => { e.stopPropagation(); onExpandBottom(); }}
                title={isVertical ? 'Expand scratchpad (collapse conversation)' : 'Expand scratchpad (collapse conversation to bar)'}
                data-testid="scratchpad-expand-bottom-btn"
                type="button"
            >{isVertical ? <ChevronRightIcon /> : <ChevronDownIcon />}</button>

            {/* Split 50/50 reset */}
            <button
                className={modeBtn('split')}
                onClick={(e) => { e.stopPropagation(); onSplitReset(); }}
                title="Reset to 50/50 split"
                data-testid="scratchpad-split-btn"
                type="button"
            ><SplitIcon /></button>

            {/* Close */}
            <button
                className="w-6 h-6 flex items-center justify-center rounded text-[#848484] dark:text-[#888] hover:text-[#c00] hover:bg-[#e0e0e0] dark:hover:bg-[#3a3a3a]"
                onClick={(e) => { e.stopPropagation(); onClose(); }}
                title="Close scratchpad"
                data-testid="scratchpad-close-btn"
                type="button"
            ><CloseIcon /></button>
        </div>
    );
}
