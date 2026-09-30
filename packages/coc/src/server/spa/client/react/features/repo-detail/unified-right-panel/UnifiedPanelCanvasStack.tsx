import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../../ui/cn';
import type { UnifiedPanelTab } from './unifiedPanelTabsModel';

export const CANVAS_TAB_COMPRESSION_THRESHOLD = 4;

export function compressedCanvasTabs(
    tabs: readonly UnifiedPanelTab[],
    activeId: string | null,
): { visibleTabs: readonly UnifiedPanelTab[]; canvasTabs: readonly UnifiedPanelTab[] } {
    const canvasTabs = tabs.filter(tab => tab.kind === 'canvas');
    if (canvasTabs.length < CANVAS_TAB_COMPRESSION_THRESHOLD) return { visibleTabs: tabs, canvasTabs: [] };
    return {
        visibleTabs: tabs.filter(tab => tab.kind !== 'canvas' || tab.id === activeId),
        canvasTabs,
    };
}

interface UnifiedPanelCanvasStackProps {
    tabs: readonly UnifiedPanelTab[];
    activeId: string | null;
    dirtyIds: ReadonlySet<string>;
    errorIds: ReadonlySet<string>;
    onActivate: (id: string) => void;
    onClose: (id: string) => void;
    onCloseMany: (ids: readonly string[]) => void;
}

export function UnifiedPanelCanvasStack({
    tabs,
    activeId,
    dirtyIds,
    errorIds,
    onActivate,
    onClose,
    onCloseMany,
}: UnifiedPanelCanvasStackProps) {
    const buttonRef = useRef<HTMLButtonElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const searchRef = useRef<HTMLInputElement>(null);
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [highlighted, setHighlighted] = useState(0);
    const [position, setPosition] = useState({ top: 0, left: 0 });

    const filteredTabs = useMemo(() => {
        const needle = query.trim().toLocaleLowerCase();
        if (!needle) return tabs;
        return tabs.filter(tab => `${tab.label} ${tab.repoLabel ?? ''}`.toLocaleLowerCase().includes(needle));
    }, [query, tabs]);

    useEffect(() => {
        if (!open) return;
        const button = buttonRef.current;
        if (!button) return;
        const rect = button.getBoundingClientRect();
        const width = 320;
        setPosition({
            top: Math.min(rect.bottom + 4, Math.max(8, window.innerHeight - 420)),
            left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)),
        });
        queueMicrotask(() => searchRef.current?.focus());
    }, [open]);

    useEffect(() => {
        if (!open) return;
        const dismiss = (event: MouseEvent) => {
            const target = event.target as Node;
            if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return;
            setOpen(false);
        };
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            setOpen(false);
            queueMicrotask(() => buttonRef.current?.focus());
        };
        document.addEventListener('mousedown', dismiss);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('mousedown', dismiss);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [open]);

    useEffect(() => {
        const activeIndex = filteredTabs.findIndex(tab => tab.id === activeId);
        setHighlighted(activeIndex >= 0 ? activeIndex : 0);
    }, [activeId, filteredTabs]);

    const activate = (tab: UnifiedPanelTab, restoreFocus = false) => {
        onActivate(tab.id);
        setOpen(false);
        if (restoreFocus) queueMicrotask(() => buttonRef.current?.focus());
    };

    const onSearchKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            if (filteredTabs.length === 0) return;
            const step = event.key === 'ArrowDown' ? 1 : -1;
            setHighlighted(current => (current + step + filteredTabs.length) % filteredTabs.length);
            return;
        }
        if (event.key === 'Enter') {
            event.preventDefault();
            const tab = filteredTabs[highlighted];
            if (tab) activate(tab, true);
        }
    };

    const closeTargets = tabs.filter(tab => tab.id !== activeId).map(tab => tab.id);

    return (
        <>
            <button
                ref={buttonRef}
                type="button"
                aria-label={`Show ${tabs.length} canvas tabs`}
                aria-haspopup="dialog"
                aria-expanded={open}
                title={`${tabs.length} canvas tabs`}
                data-testid="unified-panel-canvas-stack"
                onClick={() => {
                    setQuery('');
                    setOpen(value => !value);
                }}
                className={cn(
                    'mx-1 my-1 flex h-[27px] flex-shrink-0 cursor-pointer items-center gap-1 rounded-full border px-2 text-[11px]',
                    'border-[#b6b6b6] bg-transparent text-[#4b5563] hover:border-[#0078d4] hover:text-[#0078d4]',
                    'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#0078d4]',
                    'dark:border-[#555] dark:text-[#b8b8b8] dark:hover:border-[#3794ff] dark:hover:text-[#3794ff]',
                )}
            >
                <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
                    <rect x="2.2" y="3" width="8.6" height="8.6" rx="1.2" />
                    <path d="M5.2 1.4h7.4c1.1 0 2 .9 2 2v7.4" />
                </svg>
                <span>Canvases {tabs.length}</span>
                <span aria-hidden="true">⌄</span>
            </button>

            {open && createPortal(
                <div
                    ref={menuRef}
                    role="dialog"
                    aria-label="Canvas tabs"
                    data-testid="unified-panel-canvas-stack-menu"
                    className={cn(
                        'fixed z-[70] w-80 overflow-hidden rounded-md border border-[#c8c8c8] bg-white shadow-xl',
                        'dark:border-[#454545] dark:bg-[#252526]',
                    )}
                    style={position}
                >
                    <div className="flex items-center justify-between px-3 pb-2 pt-3">
                        <span className="text-xs font-semibold text-[#333] dark:text-[#ddd]">Canvas tabs</span>
                        <span className="text-[10px] text-[#777] dark:text-[#aaa]">{tabs.length} open</span>
                    </div>
                    <div className="px-2 pb-2">
                        <input
                            ref={searchRef}
                            value={query}
                            onChange={event => setQuery(event.target.value)}
                            onKeyDown={onSearchKeyDown}
                            aria-label="Search canvas tabs"
                            placeholder="Search open canvases…"
                            data-testid="unified-panel-canvas-stack-search"
                            className={cn(
                                'h-8 w-full rounded border border-[#c8c8c8] bg-[#f8f8f8] px-2 text-xs text-[#222] outline-none',
                                'focus:border-[#0078d4] dark:border-[#555] dark:bg-[#1e1e1e] dark:text-[#ddd]',
                            )}
                        />
                    </div>
                    <div className="max-h-64 overflow-y-auto px-1 pb-1" data-testid="unified-panel-canvas-stack-results">
                        {filteredTabs.length === 0 && (
                            <div className="px-3 py-5 text-center text-xs text-[#777] dark:text-[#aaa]">No matching canvases</div>
                        )}
                        {filteredTabs.map((tab, index) => {
                            const active = tab.id === activeId;
                            const dirty = dirtyIds.has(tab.id);
                            const error = errorIds.has(tab.id);
                            return (
                                <div
                                    key={tab.id}
                                    className={cn(
                                        'group/row flex min-w-0 items-center rounded',
                                        index === highlighted && 'bg-[#e8f2fb] dark:bg-[#37373d]',
                                    )}
                                    data-testid={`unified-panel-canvas-stack-row-${tab.id}`}
                                >
                                    <button
                                        type="button"
                                        onMouseEnter={() => setHighlighted(index)}
                                        onClick={() => activate(tab)}
                                        className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 border-0 bg-transparent px-2 py-2 text-left text-xs text-[#333] dark:text-[#ddd]"
                                    >
                                        <span className="w-4 flex-shrink-0 text-center text-[#0078d4] dark:text-[#3794ff]" aria-hidden="true">
                                            {active ? '✓' : error ? '⚠' : dirty ? '●' : ''}
                                        </span>
                                        <span className="min-w-0 flex-1 truncate">{tab.label}</span>
                                        {tab.repoLabel && <span className="max-w-16 truncate text-[10px] opacity-60">{tab.repoLabel}</span>}
                                        <span className="sr-only">
                                            {active ? ' (active)' : ''}{dirty ? ' (unsaved changes)' : ''}{error ? ' (unavailable)' : ''}
                                        </span>
                                    </button>
                                    <button
                                        type="button"
                                        aria-label={`Close ${tab.label}`}
                                        title={`Close ${tab.label}`}
                                        data-testid={`unified-panel-canvas-stack-close-${tab.id}`}
                                        onClick={() => onClose(tab.id)}
                                        className="mr-1 w-6 flex-shrink-0 cursor-pointer border-0 bg-transparent text-[#777] hover:text-[#222] dark:text-[#aaa] dark:hover:text-white"
                                    >
                                        ×
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                    <div className="flex items-center justify-between border-t border-[#e5e5e5] px-3 py-2 dark:border-[#454545]">
                        <button
                            type="button"
                            disabled={closeTargets.length === 0}
                            data-testid="unified-panel-canvas-stack-close-others"
                            onClick={() => {
                                onCloseMany(closeTargets);
                                setOpen(false);
                                queueMicrotask(() => buttonRef.current?.focus());
                            }}
                            className="cursor-pointer border-0 bg-transparent p-0 text-[11px] text-[#b42318] disabled:cursor-default disabled:opacity-40 dark:text-[#f97066]"
                        >
                            {activeId && tabs.some(tab => tab.id === activeId) ? 'Close other canvases' : 'Close all canvases'}
                        </button>
                        <span className="text-[10px] text-[#888]">↑↓ Enter · Esc</span>
                    </div>
                </div>,
                document.body,
            )}
        </>
    );
}
