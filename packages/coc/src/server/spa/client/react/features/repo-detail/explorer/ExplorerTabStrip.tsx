/**
 * ExplorerTabStrip — the VS Code-style tab strip above the Explorer's editor
 * area.
 *
 * Purely presentational: it renders the tab session that `useExplorerTabs`
 * owns and reports what the user did. It holds exactly one piece of local
 * state, the open context menu, because that is a property of this widget
 * rather than of the persisted session.
 *
 * Two things it does own that are easy to miss:
 *  - **Reveal on activate.** The strip scrolls horizontally when there are more
 *    tabs than fit, so activating a tab that is off-screen (via Ctrl+Tab, or a
 *    file opened from the tree) has to scroll it back into view.
 *  - **State without color.** Every state a tab can be in is carried by a glyph
 *    or by type as well as by color — italic for preview, a dot for dirty, a
 *    lock for read-only, a warning sign for a failed load, an underline plus
 *    `aria-selected` for the active tab — so the strip stays readable to anyone
 *    who cannot separate the accents.
 */

import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { cn } from '../../../ui/cn';
import type { ExplorerTab } from './explorerTabsModel';

/** The full-path tooltip a tab shows on hover. */
export function tabTooltip(tab: ExplorerTab): string {
    if (tab.kind === 'search') return `Search: ${tab.query ?? tab.name}`;
    return tab.path;
}

export interface ExplorerTabStripProps {
    /** Open tabs, in strip order. */
    tabs: readonly ExplorerTab[];
    /** Id of the tab whose buffer is showing, or null when none is open. */
    activeId: string | null;
    /** Tab id → label, from `tabLabels`: filename, widened when names collide. */
    labels: Map<string, string>;
    /** Tabs with unsaved edits: they show a dot instead of the close button. */
    dirtyIds?: ReadonlySet<string>;
    /** Tabs whose buffer is still loading. */
    loadingIds?: ReadonlySet<string>;
    /** Tabs whose buffer failed to load. */
    errorIds?: ReadonlySet<string>;
    /** Single click, Enter/Space, or arrow-key navigation. */
    onActivate: (id: string) => void;
    /** Double click — promotes a preview tab to a pinned one. */
    onPin: (id: string) => void;
    /** Close button, middle click, or the context menu's Close. */
    onClose: (id: string) => void;
    onCloseOthers: (id: string) => void;
    onCloseToRight: (id: string) => void;
    onCloseAll: () => void;
    /** Drag-reorder: the tab at `fromIndex` should sit at `toIndex`. */
    onMove: (fromIndex: number, toIndex: number) => void;
    className?: string;
}

interface MenuState {
    tabId: string;
    x: number;
    y: number;
}

export function ExplorerTabStrip({
    tabs,
    activeId,
    labels,
    dirtyIds,
    loadingIds,
    errorIds,
    onActivate,
    onPin,
    onClose,
    onCloseOthers,
    onCloseToRight,
    onCloseAll,
    onMove,
    className,
}: ExplorerTabStripProps) {
    const [menu, setMenu] = useState<MenuState | null>(null);
    const [draggingId, setDraggingId] = useState<string | null>(null);
    const tabRefs = useRef(new Map<string, HTMLDivElement>());

    // Keep the active tab visible: it can be activated from far outside the
    // strip (Ctrl+Tab, the tree, a deep link) while sitting past the overflow.
    useEffect(() => {
        if (activeId === null) return;
        const node = tabRefs.current.get(activeId);
        node?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    }, [activeId, tabs]);

    // A menu left open over a tab that just closed would act on nothing.
    useEffect(() => {
        if (menu && !tabs.some(tab => tab.id === menu.tabId)) setMenu(null);
    }, [menu, tabs]);

    const closeMenu = useCallback(() => setMenu(null), []);

    useEffect(() => {
        if (!menu) return;
        const dismiss = () => setMenu(null);
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setMenu(null);
        };
        window.addEventListener('mousedown', dismiss);
        window.addEventListener('keydown', onKey);
        return () => {
            window.removeEventListener('mousedown', dismiss);
            window.removeEventListener('keydown', onKey);
        };
    }, [menu]);

    const onTabKeyDown = (event: ReactKeyboardEvent, index: number) => {
        const tab = tabs[index];
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onActivate(tab.id);
            return;
        }
        const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
        if (step !== 0) {
            event.preventDefault();
            const next = tabs[(index + step + tabs.length) % tabs.length];
            onActivate(next.id);
            tabRefs.current.get(next.id)?.focus?.();
            return;
        }
        if (event.key === 'Home' || event.key === 'End') {
            event.preventDefault();
            const next = event.key === 'Home' ? tabs[0] : tabs[tabs.length - 1];
            onActivate(next.id);
            tabRefs.current.get(next.id)?.focus?.();
        }
    };

    if (tabs.length === 0) return null;

    return (
        <div className={cn('relative flex-shrink-0', className)} data-testid="explorer-tab-strip">
            <div
                role="tablist"
                aria-label="Open editors"
                aria-orientation="horizontal"
                className="flex items-stretch overflow-x-auto overflow-y-hidden border-b border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#f3f3f3] dark:bg-[#252526]"
                data-testid="explorer-tab-list"
            >
                {tabs.map((tab, index) => {
                    const isActive = tab.id === activeId;
                    const isDirty = dirtyIds?.has(tab.id) ?? false;
                    const isLoading = loadingIds?.has(tab.id) ?? false;
                    const hasError = errorIds?.has(tab.id) ?? false;
                    const label = labels.get(tab.id) ?? tab.name;
                    return (
                        <div
                            key={tab.id}
                            ref={node => {
                                if (node) tabRefs.current.set(tab.id, node);
                                else tabRefs.current.delete(tab.id);
                            }}
                            role="tab"
                            id={`explorer-tab-${tab.id}`}
                            aria-selected={isActive}
                            aria-busy={isLoading || undefined}
                            tabIndex={isActive ? 0 : -1}
                            draggable
                            title={tabTooltip(tab)}
                            data-testid={`explorer-tab-${tab.id}`}
                            data-tab-id={tab.id}
                            data-active={isActive || undefined}
                            data-preview={tab.preview || undefined}
                            data-dirty={isDirty || undefined}
                            data-readonly={tab.readOnly || undefined}
                            data-dragging={draggingId === tab.id || undefined}
                            onClick={() => onActivate(tab.id)}
                            onDoubleClick={() => onPin(tab.id)}
                            onAuxClick={event => {
                                if (event.button !== 1) return;
                                event.preventDefault();
                                onClose(tab.id);
                            }}
                            onContextMenu={event => {
                                event.preventDefault();
                                setMenu({ tabId: tab.id, x: event.clientX, y: event.clientY });
                            }}
                            onKeyDown={event => onTabKeyDown(event, index)}
                            onDragStart={event => {
                                setDraggingId(tab.id);
                                event.dataTransfer?.setData('text/plain', String(index));
                                if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
                            }}
                            onDragEnd={() => setDraggingId(null)}
                            onDragOver={event => {
                                event.preventDefault();
                                if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
                            }}
                            onDrop={event => {
                                event.preventDefault();
                                const raw = event.dataTransfer?.getData('text/plain') ?? '';
                                const from = Number.parseInt(raw, 10);
                                setDraggingId(null);
                                if (!Number.isInteger(from) || from === index) return;
                                onMove(from, index);
                            }}
                            className={cn(
                                'group relative flex items-center gap-1.5 min-w-0 max-w-[180px] h-9 px-3',
                                'cursor-pointer select-none border-r border-[#e0e0e0] dark:border-[#3c3c3c]',
                                'text-xs whitespace-nowrap',
                                'focus:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[#0078d4] dark:focus-visible:ring-[#3794ff]',
                                isActive
                                    ? 'bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#ffffff] border-b-2 border-b-[#0078d4] dark:border-b-[#3794ff]'
                                    : 'bg-[#ececec] dark:bg-[#2d2d2d] text-[#616161] dark:text-[#969696] hover:bg-[#e4e4e4] dark:hover:bg-[#333333]',
                                draggingId === tab.id && 'opacity-50',
                            )}
                        >
                            {tab.readOnly && (
                                <span aria-hidden="true" className="flex-shrink-0" data-testid={`explorer-tab-readonly-${tab.id}`}>
                                    🔒
                                </span>
                            )}
                            {hasError && (
                                <span aria-hidden="true" className="flex-shrink-0" data-testid={`explorer-tab-error-${tab.id}`}>
                                    ⚠
                                </span>
                            )}
                            <span
                                className={cn('truncate', tab.preview && 'italic', isLoading && 'opacity-60')}
                                data-testid={`explorer-tab-label-${tab.id}`}
                            >
                                {label}
                            </span>
                            <span className="sr-only">
                                {tab.readOnly ? ' (read-only)' : ''}
                                {tab.preview ? ' (preview)' : ''}
                                {isDirty ? ' (unsaved changes)' : ''}
                                {isLoading ? ' (loading)' : ''}
                                {hasError ? ' (failed to load)' : ''}
                            </span>
                            {/*
                              * The dirty dot sits where the close button goes and swaps with it on
                              * hover or keyboard focus, so a dirty tab never loses its close
                              * affordance and the strip never jumps width.
                              */}
                            {isDirty && (
                                <span
                                    aria-hidden="true"
                                    className="flex-shrink-0 w-4 text-center leading-none group-hover:hidden group-focus-within:hidden"
                                    data-testid={`explorer-tab-dirty-${tab.id}`}
                                >
                                    ●
                                </span>
                            )}
                            <button
                                type="button"
                                aria-label={`Close ${label}`}
                                title={`Close ${label}`}
                                data-testid={`explorer-tab-close-${tab.id}`}
                                onClick={event => {
                                    event.stopPropagation();
                                    onClose(tab.id);
                                }}
                                className={cn(
                                    'flex-shrink-0 w-4 leading-none bg-transparent border-none cursor-pointer p-0',
                                    'text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#ffffff]',
                                    isDirty && 'hidden group-hover:block group-focus-within:block',
                                )}
                            >
                                ✕
                            </button>
                        </div>
                    );
                })}
            </div>

            {menu && (
                <div
                    role="menu"
                    aria-label="Tab actions"
                    data-testid="explorer-tab-menu"
                    style={{ top: menu.y, left: menu.x }}
                    onMouseDown={event => event.stopPropagation()}
                    className="fixed z-50 min-w-[160px] py-1 rounded shadow-lg border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#252526] text-xs text-[#1e1e1e] dark:text-[#cccccc]"
                >
                    {[
                        { key: 'close', label: 'Close', run: () => onClose(menu.tabId) },
                        { key: 'close-others', label: 'Close Others', run: () => onCloseOthers(menu.tabId) },
                        { key: 'close-right', label: 'Close to the Right', run: () => onCloseToRight(menu.tabId) },
                        { key: 'close-all', label: 'Close All', run: () => onCloseAll() },
                    ].map(item => (
                        <button
                            key={item.key}
                            type="button"
                            role="menuitem"
                            data-testid={`explorer-tab-menu-${item.key}`}
                            onClick={() => {
                                closeMenu();
                                item.run();
                            }}
                            className="block w-full text-left px-3 py-1 bg-transparent border-none cursor-pointer hover:bg-[#e8e8e8] dark:hover:bg-[#37373d]"
                        >
                            {item.label}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
