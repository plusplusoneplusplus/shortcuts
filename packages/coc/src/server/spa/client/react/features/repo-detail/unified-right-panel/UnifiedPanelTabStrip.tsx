/**
 * UnifiedPanelTabStrip — the Cursor-style resource tab strip at the top of the
 * unified right panel.
 *
 * Purely presentational: it renders the tab session `useUnifiedPanelTabs` owns
 * and reports what the user did. The one thing it decides for itself is where
 * the section divider goes, which it reads off each tab's kind rather than
 * being told — workspace-owned tabs (terminal, notes, notes
 * documents) come first, then the selected chat's tabs, and the boundary is
 * simply where that flips.
 *
 * Three details that are easy to lose:
 *  - **Reorder is reachable without a mouse.** Drag is the fast path, but
 *    Alt+Arrow moves the focused tab one place within its own section, so the
 *    strip is not a drag-only control. Both paths refuse to cross the divider:
 *    ownership is not a gesture (AC-02).
 *  - **Promotion is a gesture, not a button.** Double-clicking a preview tab
 *    (or pressing Enter on it) makes it permanent; the strip only reports the
 *    gesture, the model owns the one-way rule (AC-04).
 *  - **State without color.** Dirty is a dot, errors a warning sign, and the
 *    active tab carries `aria-selected` plus an underline — the strip stays
 *    readable to anyone who cannot separate the accents.
 *  - **Overflow scrolls, chrome does not.** Tabs are `flex-shrink-0` inside a
 *    scrolling row so labels truncate at a sane width instead of collapsing to
 *    nothing, and the trailing "+" sits outside that row so it stays reachable
 *    no matter how many tabs are open.
 *
 * The strip is also an inline-size container named `unified-panel-strip`, so the
 * chrome parked at its end can condense against the panel's width rather than
 * the viewport's — that is how the repo picker drops its label on a narrow
 * panel.
 */

import { Fragment, useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { cn } from '../../../ui/cn';
import { scopeForKind, type UnifiedPanelTab, type UnifiedTabKind } from './unifiedPanelTabsModel';
import { UnifiedPanelTabContextMenu } from './UnifiedPanelTabContextMenu';
import {
    unifiedPanelTabMenuItems,
    type UnifiedPanelFileActionAvailability,
    type UnifiedPanelTabMenuAction,
} from './unifiedPanelTabMenuModel';

/**
 * The tooltip a tab shows on hover: the full label, its repo if any, and — for
 * the preview slot — what the italics mean. Italics alone say "temporary" only
 * to someone who already knows the convention, so the words are always there
 * too, in the tooltip and in the tab's screen-reader text (AC-03).
 */
export function unifiedTabTooltip(tab: UnifiedPanelTab): string {
    const withRepo = tab.repoLabel ? `${tab.label} — ${tab.repoLabel}` : tab.label;
    return tab.preview ? `${withRepo} (preview — double-click to keep open)` : withRepo;
}

const KIND_ICONS: Readonly<Record<UnifiedTabKind, JSX.Element>> = {
    terminal: (
        <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="3,4 6,8 3,12" />
            <line x1="8" y1="12" x2="13" y2="12" />
        </svg>
    ),
    notes: (
        <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 2.2h5.4L12.5 5.3v8.5H4z" />
            <polyline points="9.2,2.4 9.2,5.5 12.3,5.5" />
            <line x1="6" y1="8.2" x2="10.5" y2="8.2" />
        </svg>
    ),
    note: (
        <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 2.2h5.4L12.5 5.3v8.5H4z" />
            <line x1="6" y1="8.2" x2="10.5" y2="8.2" />
            <line x1="6" y1="10.6" x2="10.5" y2="10.6" />
        </svg>
    ),
    file: (
        <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 2.2h5.4L12.5 5.3v8.5H4z" />
            <polyline points="9.2,2.4 9.2,5.5 12.3,5.5" />
        </svg>
    ),
    canvas: (
        <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" aria-hidden="true">
            <rect x="2.5" y="3" width="11" height="10" rx="1.2" />
            <line x1="2.5" y1="6" x2="13.5" y2="6" />
        </svg>
    ),
    diff: (
        <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" aria-hidden="true">
            <line x1="4" y1="3" x2="4" y2="13" />
            <line x1="12" y1="3" x2="12" y2="13" />
            <line x1="6.2" y1="6" x2="9.8" y2="6" />
            <line x1="6.2" y1="10" x2="9.8" y2="10" />
        </svg>
    ),
    git: (
        <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" aria-hidden="true">
            <circle cx="5" cy="4" r="1.6" />
            <circle cx="5" cy="12" r="1.6" />
            <circle cx="11" cy="6" r="1.6" />
            <line x1="5" y1="5.6" x2="5" y2="10.4" />
            <path d="M11 7.6c0 2.2-2.4 2.4-4.6 3.4" />
        </svg>
    ),
};

export interface UnifiedPanelTabStripProps {
    /** Visible tabs, in strip order: workspace-owned first, then the chat's. */
    tabs: readonly UnifiedPanelTab[];
    /** Id of the tab whose view is showing, or null when the panel is empty. */
    activeId: string | null;
    /** Tabs with unsaved edits: they show a dot instead of the close button. */
    dirtyIds?: ReadonlySet<string>;
    /** Tabs whose resource failed to load, or whose session is gone. */
    errorIds?: ReadonlySet<string>;
    /** Click, Enter/Space, or arrow-key navigation. */
    onActivate: (id: string) => void;
    /** Close button, middle click, or Alt/Ctrl+W-style callers. */
    onClose: (id: string) => void;
    /** Reorder: put `id` where `beforeId` sits, or at the end of its section. */
    onMove: (id: string, beforeId: string | null) => void;
    /**
     * Make a preview tab permanent (AC-04). Raised by a double click on the
     * tab, the strip's half of "double-click to keep open" that the preview
     * tooltip promises. A no-op for a tab that is already permanent, so the
     * strip does not have to check.
     */
    onPromote?: (id: string) => void;
    /** Resolve file-only command availability for a tab. */
    fileActionAvailability?: (tab: UnifiedPanelTab) => UnifiedPanelFileActionAvailability;
    /** Context-menu command selected for a tab. */
    onMenuAction?: (action: UnifiedPanelTabMenuAction, tabId: string) => void;
    /** The trailing "+" — opens the searchable resource menu (AC-03). */
    onOpenMenu?: () => void;
    /**
     * The file-tree toggle, parked beside the "+" whenever the panel's own
     * toolbar row is not rendered (a non-file tab, or no tabs at all) so the
     * tree is always one click away. One of the strip's two guests, and the
     * conditional one — nothing else portals in here, because the strip is the
     * panel's one tab row.
     */
    trailing?: ReactNode;
    /**
     * The repo picker, sitting just left of the "+". Its own prop rather than
     * part of `trailing` because it is present on every tab state: the panel's
     * repo scope does not come and go with the breadcrumb toolbar.
     */
    leadingControls?: ReactNode;
    className?: string;
}

export function UnifiedPanelTabStrip({
    tabs,
    activeId,
    dirtyIds,
    errorIds,
    onActivate,
    onClose,
    onMove,
    onPromote,
    fileActionAvailability,
    onMenuAction,
    onOpenMenu,
    trailing,
    leadingControls,
    className,
}: UnifiedPanelTabStripProps) {
    const tabRefs = useRef(new Map<string, HTMLDivElement>());
    const draggingId = useRef<string | null>(null);
    const [contextMenu, setContextMenu] = useState<{ tabId: string; x: number; y: number } | null>(null);

    // Keep the active tab visible: it is routinely activated from far outside
    // the strip — a chat source link, a canvas event, a restored selection —
    // while sitting past the overflow.
    useEffect(() => {
        if (activeId === null) return;
        tabRefs.current.get(activeId)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    }, [activeId, tabs]);

    useEffect(() => {
        if (contextMenu && !tabs.some(tab => tab.id === contextMenu.tabId)) setContextMenu(null);
    }, [contextMenu, tabs]);

    const dismissContextMenu = useCallback(() => {
        const originId = contextMenu?.tabId;
        setContextMenu(null);
        if (originId) queueMicrotask(() => tabRefs.current.get(originId)?.focus());
    }, [contextMenu?.tabId]);

    /** The contiguous run of tabs sharing `tab`'s scope — its own section. */
    const sectionOf = (tab: UnifiedPanelTab) => {
        const scope = scopeForKind(tab.kind);
        return tabs.filter(entry => scopeForKind(entry.kind) === scope);
    };

    /** Alt+Arrow: shift the focused tab one place inside its section. */
    const shift = (tab: UnifiedPanelTab, step: -1 | 1) => {
        const section = sectionOf(tab);
        const from = section.findIndex(entry => entry.id === tab.id);
        const to = from + step;
        if (to < 0 || to >= section.length) return;
        // Moving right means landing *after* the neighbour, i.e. before whatever
        // follows it — or at the end of the section when nothing does.
        const beforeId = step === -1 ? section[to].id : (section[to + 1]?.id ?? null);
        onMove(tab.id, beforeId);
        tabRefs.current.get(tab.id)?.focus?.();
    };

    const onTabKeyDown = (event: ReactKeyboardEvent, index: number) => {
        const tab = tabs[index];
        if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
            event.preventDefault();
            const rect = tabRefs.current.get(tab.id)?.getBoundingClientRect();
            setContextMenu({
                tabId: tab.id,
                x: rect?.left ?? 0,
                y: rect?.bottom ?? 0,
            });
            return;
        }
        if (event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
            event.preventDefault();
            shift(tab, event.key === 'ArrowLeft' ? -1 : 1);
            return;
        }
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            // Enter is the keyboard's double click here: activating a preview
            // that is already active would otherwise have no way to keep it.
            onActivate(tab.id);
            if (tab.preview) onPromote?.(tab.id);
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

    return (
        <div
            className={cn(
                'flex min-w-0 flex-shrink-0 items-stretch border-b border-[#e5e5e5] dark:border-[#333]',
                '[container-type:inline-size] [container-name:unified-panel-strip]',
                className,
            )}
            data-testid="unified-panel-tab-strip"
        >
            <div
                role="tablist"
                aria-label="Open resources"
                aria-orientation="horizontal"
                className="flex min-w-0 flex-1 items-stretch overflow-x-auto overflow-y-hidden"
                data-testid="unified-panel-tab-list"
            >
                {tabs.map((tab, index) => {
                    const isActive = tab.id === activeId;
                    const isDirty = dirtyIds?.has(tab.id) ?? false;
                    const hasError = errorIds?.has(tab.id) ?? false;
                    // The divider marks where workspace-owned tools (Terminal
                    // and Notes) end and chat resources begin — derived, never
                    // passed in.
                    const startsChatSection = index > 0
                        && scopeForKind(tab.kind) === 'chat'
                        && scopeForKind(tabs[index - 1].kind) === 'workspace';
                    return (
                        <Fragment key={tab.id}>
                            {startsChatSection && (
                                <div
                                    aria-hidden="true"
                                    data-testid="unified-panel-tab-section-divider"
                                    className="flex h-[35px] w-4 flex-shrink-0 items-center justify-center border-x border-[#c8c8c8] bg-[#e8e8e8] dark:border-[#3c3c3c] dark:bg-[#252526]"
                                >
                                    <span className="h-5 w-px bg-[#808080] dark:bg-[#858585]" />
                                </div>
                            )}
                        <div
                            key={tab.id}
                            ref={node => {
                                if (node) tabRefs.current.set(tab.id, node);
                                else tabRefs.current.delete(tab.id);
                            }}
                            role="tab"
                            id={`unified-panel-tab-${tab.id}`}
                            aria-selected={isActive}
                            tabIndex={isActive ? 0 : -1}
                            draggable
                            title={unifiedTabTooltip(tab)}
                            data-testid={`unified-panel-tab-${tab.id}`}
                            data-tab-id={tab.id}
                            data-kind={tab.kind}
                            data-scope={scopeForKind(tab.kind)}
                            data-active={isActive || undefined}
                            data-dirty={isDirty || undefined}
                            data-preview={tab.preview || undefined}
                            data-section-start={startsChatSection || undefined}
                            onClick={() => onActivate(tab.id)}
                            onDoubleClick={() => onPromote?.(tab.id)}
                            onAuxClick={event => {
                                if (event.button !== 1) return;
                                event.preventDefault();
                                onClose(tab.id);
                            }}
                            onContextMenu={event => {
                                event.preventDefault();
                                setContextMenu({ tabId: tab.id, x: event.clientX, y: event.clientY });
                            }}
                            onKeyDown={event => onTabKeyDown(event, index)}
                            onDragStart={event => {
                                draggingId.current = tab.id;
                                event.dataTransfer?.setData('text/plain', tab.id);
                                if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
                            }}
                            onDragEnd={() => { draggingId.current = null; }}
                            onDragOver={event => {
                                event.preventDefault();
                                if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
                            }}
                            onDrop={event => {
                                event.preventDefault();
                                const from = event.dataTransfer?.getData('text/plain') || draggingId.current;
                                draggingId.current = null;
                                if (!from || from === tab.id) return;
                                // A cross-section drop is rejected by the model,
                                // so ownership survives a wrong-target drag.
                                onMove(from, tab.id);
                            }}
                            className={cn(
                                // `flex-shrink-0` is what makes the row scroll: without it every
                                // tab squeezes and the labels truncate to nothing long before the
                                // strip actually overflows.
                                'group relative flex h-[35px] min-w-0 max-w-[180px] flex-shrink-0 cursor-pointer select-none',
                                'items-center gap-1.5 whitespace-nowrap border-r border-[#e5e5e5] px-2.5 text-xs dark:border-[#333]',
                                'focus:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[#0078d4] dark:focus-visible:ring-[#3794ff]',
                                isActive
                                    ? 'bg-white text-[#1f1f1f] shadow-[inset_0_-2px_0_0_#0078d4] dark:bg-[#1e1e1e] dark:text-white dark:shadow-[inset_0_-2px_0_0_#3794ff]'
                                    : 'text-[#616161] hover:text-[#1f1f1f] dark:text-[#9d9d9d] dark:hover:text-white',
                            )}
                        >
                            <span className="flex-shrink-0 opacity-80" aria-hidden="true">{KIND_ICONS[tab.kind]}</span>
                            {hasError && (
                                <span aria-hidden="true" className="flex-shrink-0" data-testid={`unified-panel-tab-error-${tab.id}`}>⚠</span>
                            )}
                            <span
                                className={cn('truncate', tab.preview && 'italic')}
                                data-testid={`unified-panel-tab-label-${tab.id}`}
                            >
                                {tab.label}
                            </span>
                            {tab.repoLabel && (
                                <span
                                    className="max-w-[64px] flex-shrink truncate text-[10px] opacity-70"
                                    data-testid={`unified-panel-tab-repo-${tab.id}`}
                                >
                                    {tab.repoLabel}
                                </span>
                            )}
                            <span className="sr-only">
                                {tab.preview ? ' (preview — double-click to keep open)' : ''}
                                {isDirty ? ' (unsaved changes)' : ''}
                                {hasError ? ' (unavailable)' : ''}
                            </span>
                            {/* The dirty dot occupies the close button's slot and swaps
                              * with it on hover or focus, so a dirty tab keeps its close
                              * affordance and the strip never jumps width. */}
                            {isDirty && (
                                <span
                                    aria-hidden="true"
                                    className="w-4 flex-shrink-0 text-center leading-none group-hover:hidden group-focus-within:hidden"
                                    data-testid={`unified-panel-tab-dirty-${tab.id}`}
                                >
                                    ●
                                </span>
                            )}
                            <button
                                type="button"
                                aria-label={`Close ${tab.label}`}
                                title={`Close ${tab.label}`}
                                data-testid={`unified-panel-tab-close-${tab.id}`}
                                onClick={event => {
                                    event.stopPropagation();
                                    onClose(tab.id);
                                }}
                                className={cn(
                                    'w-4 flex-shrink-0 cursor-pointer border-none bg-transparent p-0 leading-none',
                                    'text-[#848484] hover:text-[#1f1f1f] dark:hover:text-white',
                                    isDirty && 'hidden group-hover:block group-focus-within:block',
                                )}
                            >
                                ✕
                            </button>
                        </div>
                        </Fragment>
                    );
                })}
            </div>

            {/* Outside the scrolling row, so they stay reachable at any tab count. */}
            {leadingControls}
            {onOpenMenu && (
                <button
                    type="button"
                    aria-label="Open resource"
                    title="Open resource"
                    data-testid="unified-panel-open-menu"
                    onClick={onOpenMenu}
                    className={cn(
                        'flex h-[35px] w-8 flex-shrink-0 items-center justify-center border-l border-[#e5e5e5] dark:border-[#333]',
                        'cursor-pointer border-y-0 border-r-0 bg-transparent text-sm leading-none text-[#616161]',
                        'hover:text-[#1f1f1f] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset',
                        'focus-visible:ring-[#0078d4] dark:text-[#9d9d9d] dark:hover:text-white dark:focus-visible:ring-[#3794ff]',
                    )}
                >
                    +
                </button>
            )}

            {trailing}
            {contextMenu && (() => {
                const tab = tabs.find(candidate => candidate.id === contextMenu.tabId);
                if (!tab) return null;
                const items = unifiedPanelTabMenuItems(
                    tab,
                    tabs,
                    dirtyIds ?? new Set<string>(),
                    fileActionAvailability?.(tab),
                );
                return (
                    <UnifiedPanelTabContextMenu
                        x={contextMenu.x}
                        y={contextMenu.y}
                        items={items}
                        onDismiss={dismissContextMenu}
                        onAction={action => {
                            dismissContextMenu();
                            onMenuAction?.(action, tab.id);
                        }}
                    />
                );
            })()}
        </div>
    );
}
