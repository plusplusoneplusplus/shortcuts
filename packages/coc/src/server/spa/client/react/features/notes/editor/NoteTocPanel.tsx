import { useEffect, useRef } from 'react';
import type { TocEntry } from './noteTocUtils';

export interface NoteTocPanelProps {
    entries: TocEntry[];
    activeIndex: number | null;
    onJump: (entry: TocEntry) => void;
    onClose: () => void;
}

const INDENT: Record<1 | 2 | 3, string> = {
    1: '',
    2: 'pl-4',
    3: 'pl-8',
};

export function NoteTocPanel({ entries, activeIndex, onJump, onClose }: NoteTocPanelProps) {
    const panelRef = useRef<HTMLDivElement>(null);
    const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

    // Click-outside dismiss
    useEffect(() => {
        function handleMouseDown(e: MouseEvent) {
            if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
                onClose();
            }
        }
        document.addEventListener('mousedown', handleMouseDown);
        return () => document.removeEventListener('mousedown', handleMouseDown);
    }, [onClose]);

    // Keyboard navigation
    function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
        if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
            return;
        }
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            const items = itemRefs.current.filter(Boolean) as HTMLButtonElement[];
            if (items.length === 0) return;
            const focused = document.activeElement;
            const currentIdx = items.indexOf(focused as HTMLButtonElement);
            let nextIdx: number;
            if (e.key === 'ArrowDown') {
                nextIdx = currentIdx < 0 ? 0 : Math.min(currentIdx + 1, items.length - 1);
            } else {
                nextIdx = currentIdx < 0 ? items.length - 1 : Math.max(currentIdx - 1, 0);
            }
            items[nextIdx]?.focus();
        }
    }

    return (
        <div
            ref={panelRef}
            role="dialog"
            aria-label="Table of contents"
            data-testid="toc-panel"
            className="absolute top-full right-0 mt-1 z-50 min-w-[220px] max-w-[320px] max-h-[60vh] overflow-y-auto rounded-md shadow-lg border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e]"
            onKeyDown={handleKeyDown}
        >
            {/* Header */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-[#e0e0e0] dark:border-[#3c3c3c]">
                <span className="text-xs font-semibold text-[#333] dark:text-[#ccc]">
                    Table of Contents
                </span>
                <div className="flex items-center gap-2">
                    {entries.length > 0 && (
                        <span className="text-[10px] text-[#888] bg-[#f0f0f0] dark:bg-[#2a2a2a] rounded px-1">
                            {entries.length}
                        </span>
                    )}
                    <button
                        type="button"
                        aria-label="Close table of contents"
                        data-testid="toc-close-btn"
                        className="text-[10px] text-[#888] hover:text-[#333] dark:hover:text-white"
                        onClick={onClose}
                    >
                        ✕
                    </button>
                </div>
            </div>

            {/* Entry list or empty state */}
            {entries.length === 0 ? (
                <div className="px-3 py-4 text-xs italic text-[#888] dark:text-[#666]" data-testid="toc-empty">
                    No headings in this note
                </div>
            ) : (
                <ul className="py-1" role="list">
                    {entries.map((entry, i) => {
                        const isActive = activeIndex === entry.index;
                        return (
                            <li key={`${entry.pos}-${entry.index}`} role="listitem">
                                <button
                                    ref={(el) => { itemRefs.current[i] = el; }}
                                    type="button"
                                    data-testid={`toc-entry-${entry.index}`}
                                    className={
                                        `w-full text-left text-xs px-3 py-1 flex items-start gap-1 ${INDENT[entry.level]} ` +
                                        (isActive
                                            ? 'border-l-2 border-[#0078d4] text-[#0078d4] font-medium bg-[#f0f7ff] dark:bg-[#1a2a3a]'
                                            : 'hover:bg-[#f3f3f3] dark:hover:bg-[#2a2a2a] text-[#333] dark:text-[#ccc]')
                                    }
                                    onClick={() => onJump(entry)}
                                >
                                    <span className="truncate">{entry.text}</span>
                                </button>
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}
