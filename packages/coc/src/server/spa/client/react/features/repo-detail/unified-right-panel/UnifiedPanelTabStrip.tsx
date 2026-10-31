/**
 * UnifiedPanelTabStrip — the Cursor-style resource tab strip at the top of the
 * unified right panel.
 *
 * Renders the session owned by `useUnifiedPanelTabs`. Inline kind groups cap
 * visible slots without changing saved order. With groups disabled, the mixed
 * ordering flag selects free ordering or sections separated by a divider.
 *
 * Three details that are easy to lose:
 *  - **Reorder is reachable without a mouse.** Drag is the fast path, but
 *    Alt+Arrow moves the focused tab. Mixed ordering also exposes menu actions;
 *    grouped ordering confines moves to the tab's section.
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
 *  - **Browser tabs share one width.** Like a browser's own strip, page tabs
 *    are sized by the strip, not by their titles: each starts at 160px and they
 *    shrink together to 96px before the row scrolls, so long titles ellipsize.
 *  - **Canvas bursts collapse with groups disabled.** Four or more canvas tabs render as the active
 *    canvas only. While a canvas is active its header carries the count chip
 *    (wired by `UnifiedRightPanel`); otherwise the chip sits here so hidden
 *    canvases stay reachable. The chip opens the complete searchable list;
 *    storage, ordering, ownership, dirty state, and close guards remain with
 *    the normal tab session.
 *  - **The scrollbar is an overlay.** The native bar is hidden (it is thick on
 *    macOS and draws over the labels); a 3px thumb along the bottom edge shows
 *    on hover and can be dragged, and a plain vertical wheel scrolls the row
 *    sideways, as in VS Code.
 *
 * The strip is also an inline-size container named `unified-panel-strip`, so the
 * chrome parked at its end can condense against the panel's width rather than
 * the viewport's — that is how the repo picker drops its label on a narrow
 * panel.
 */

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { cn } from '../../../ui/cn';
import { POINTER_CONTEXT_DRAG_MIME, type PointerContextDragPayload } from '../../chat/sessionContextDrag';
import { getHorizontalDropPosition } from '../repoTabModel';
import { FileNameIcon } from '../explorer/FileTypeIcon';
import { displayGroupForKind, scopeForKind, type UnifiedPanelTab, type UnifiedTabKind } from './unifiedPanelTabsModel';
import { UnifiedPanelTabContextMenu } from './UnifiedPanelTabContextMenu';
import { dirtyCloseLabel } from './unifiedDirtyClose';
import { compressedCanvasTabs, UnifiedPanelCanvasStack } from './UnifiedPanelCanvasStack';
import { categoryStripTabs, groupStripTabs, isGroupBoundaryMove, stripGroupForKind, type UnifiedTabStripGroup } from './unifiedPanelTabGroups';
import { TAB_GROUP_LABELS, UnifiedPanelTabGroupLabel } from './UnifiedPanelTabGroupLabel';
import { unifiedTabRepoLabel } from './unifiedTabLabels';
import { UnifiedPanelTabOverflowMenu } from './UnifiedPanelTabOverflowMenu';
import { useBrowserTabFavicon } from './browserTabFavicons';
import {
    unifiedPanelTabMenuItems,
    type UnifiedPanelFileActionAvailability,
    type UnifiedPanelTabMenuAction,
} from './unifiedPanelTabMenuModel';
import { browserTabAriaKeyShortcut, browserTabShortcutDigits, browserTabShortcutLabel } from './browserTabShortcuts';

/**
 * The tooltip a tab shows on hover: the full label, its repo if any, and — for
 * the preview slot — what the italics mean. Italics alone say "temporary" only
 * to someone who already knows the convention, so the words are always there
 * too, in the tooltip and in the tab's screen-reader text (AC-03). A source file
 * shows only its name on the strip, so its tooltip carries the repo-qualified
 * path that tells same-name files apart.
 */
export function unifiedTabTooltip(tab: UnifiedPanelTab, hideBrowserRepoLabels = false): string {
    const repoLabel = unifiedTabRepoLabel(tab, hideBrowserRepoLabels);
    const base = tab.kind === 'file'
        ? `${tab.label} — ${dirtyCloseLabel(tab)}`
        : repoLabel ? `${tab.label} — ${repoLabel}` : tab.label;
    return tab.preview ? `${base} (preview — double-click to keep open)` : base;
}

/**
 * Title-independent browser tab sizing: one shared 160px basis that shrinks
 * evenly (equal bases shrink equally) to a 96px floor, then the row scrolls.
 */
const BROWSER_TAB_SIZE = 'min-w-[96px] max-w-[160px] flex-shrink basis-[160px]';
const DEFAULT_TAB_SIZE = 'min-w-0 max-w-[180px] flex-shrink-0';

/** Checklist glyph shared by the To-do tab and the "+" menu's To-do entry. */
export const TODO_ICON = (
    <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <polyline points="2.5,4.5 3.7,5.7 5.8,3.4" />
        <polyline points="2.5,10.5 3.7,11.7 5.8,9.4" />
        <line x1="8" y1="4.6" x2="13.5" y2="4.6" />
        <line x1="8" y1="10.6" x2="13.5" y2="10.6" />
    </svg>
);

export const SETTINGS_ICON = (
    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" aria-hidden="true">
        <path d="m9 3-1 3-3 1-2 3 2 2-1 3 3 2 3-1 2 2 3-1 1-3 3-1 1-3-2-2 1-3-3-2-3 1-2-2z" />
        <circle cx="11" cy="10" r="3" />
    </svg>
);

export const PULL_REQUESTS_ICON = (
    <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" aria-hidden="true">
        <path d="M4 5v6m8 0V7L8 3" /><circle cx="4" cy="3" r="2" /><circle cx="4" cy="13" r="2" /><circle cx="12" cy="13" r="2" />
    </svg>
);

const KIND_ICONS: Readonly<Record<UnifiedTabKind, JSX.Element>> = {
    'work-items': TODO_ICON,
    'pull-requests': PULL_REQUESTS_ICON,
    external: <span aria-hidden="true">↗</span>,
    settings: SETTINGS_ICON,
    todo: TODO_ICON,
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
    paste: (
        <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 3H3v11h10V3h-2" />
            <rect x="5" y="1.5" width="6" height="3" rx="1" />
            <path d="M5 8h6M5 11h4" />
        </svg>
    ),
    file: (
        <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 2.2h5.4L12.5 5.3v8.5H4z" />
            <polyline points="9.2,2.4 9.2,5.5 12.3,5.5" />
        </svg>
    ),
    canvas: (
        // A painter's palette, matching the 🎨 the "+" menu shows for canvases.
        <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" aria-hidden="true" data-icon="canvas-palette">
            <path d="M8 2.2C4.5 2.2 2 4.6 2 7.7c0 3.2 2.6 6.1 5.4 6.1 1 0 1.4-.6 1.1-1.4-.3-.9.1-1.7 1.1-1.7h1.5c1.8 0 2.9-1.2 2.9-2.9 0-3.2-2.7-5.6-6-5.6z" />
            <circle cx="5.2" cy="7.6" r="0.8" fill="currentColor" stroke="none" />
            <circle cx="7" cy="5" r="0.8" fill="currentColor" stroke="none" />
            <circle cx="10.2" cy="5.4" r="0.8" fill="currentColor" stroke="none" />
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
    'html-page': (
        <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" aria-hidden="true">
            <rect x="2" y="3" width="12" height="10" rx="1" />
            <line x1="2" y1="6" x2="14" y2="6" />
        </svg>
    ),
    browser: (
        <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true" data-icon="browser-globe">
            <circle cx="8" cy="8" r="5.8" />
            <ellipse cx="8" cy="8" rx="2.4" ry="5.8" />
            <line x1="2.2" y1="8" x2="13.8" y2="8" />
        </svg>
    ),
};

/**
 * The site's icon in the globe's 12px slot. A missing or undecodable icon keeps
 * the globe, so the tab never shows a broken image or shifts its label.
 */
function BrowserTabIcon({ tabId }: { tabId: string }) {
    const favicon = useBrowserTabFavicon(tabId);
    const [failed, setFailed] = useState<string | null>(null);
    if (!favicon || failed === favicon) return KIND_ICONS.browser;
    return (
        <img
            src={favicon}
            alt=""
            width={12}
            height={12}
            draggable={false}
            className="block h-3 w-3 object-contain"
            data-icon="browser-favicon"
            data-testid={`unified-panel-tab-favicon-${tabId}`}
            onError={() => setFailed(favicon)}
        />
    );
}

const EMPTY_TAB_IDS: ReadonlySet<string> = new Set<string>();
const EMPTY_FOLDED_GROUPS: ReadonlySet<UnifiedTabStripGroup> = new Set();

export interface UnifiedPanelTabStripProps {
    /** Visible tabs in presentation order. */
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
    /** Bulk close keeps dirty/terminal close guards serialized by the panel host. */
    onCloseMany: (ids: readonly string[]) => void;
    /** Put `id` before `beforeId`, or at the end of the permitted ordering. */
    onMove: (id: string, beforeId: string | null) => void;
    /** Mixed-type presentation ordering, gated by the panel's live feature flag. */
    reorderEnabled?: boolean;
    /**
     * Ctrl/Cmd+1–9 numbering of the rendered web tabs (`features.browserTabShortcuts`);
     * `hintsVisible` shows the badges while the panel's platform modifier is held.
     */
    browserShortcuts?: { mac: boolean; hintsVisible: boolean } | null;
    /** Repo-group browser tabs use page names while retaining their owners. */
    hideBrowserRepoLabels?: boolean;
    groupsEnabled?: boolean;
    /**
     * One chip per category showing its last-used tab, each with its own menu
     * (`features.panelTabCategories`). Takes precedence over `groupsEnabled`.
     */
    categoriesEnabled?: boolean;
    foldedGroups?: ReadonlySet<UnifiedTabStripGroup>;
    onToggleGroup?: (group: UnifiedTabStripGroup) => void;
    /** Changing panel/chat scope cancels an in-flight gesture. */
    reorderScope?: string;
    /** Transient excursion tab, excluded from persisted moves. */
    pinnedId?: string | null;
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
    /** The tab a native drag carries, and `null` once it drops, ends or is cancelled. */
    onTabDragChange?: (tabId: string | null) => void;
    /**
     * Chat context a tab drag also carries, so a composer can attach it while
     * reorder and split docking keep reading the tab id.
     */
    contextDragPayload?: (tab: UnifiedPanelTab) => PointerContextDragPayload | null;
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
    onCloseMany,
    onMove,
    reorderEnabled: mixedReorderEnabled = false,
    browserShortcuts = null,
    hideBrowserRepoLabels = false,
    groupsEnabled: inlineGroupsEnabled = false,
    categoriesEnabled = false,
    foldedGroups = EMPTY_FOLDED_GROUPS,
    onToggleGroup,
    reorderScope,
    pinnedId,
    onPromote,
    fileActionAvailability,
    onMenuAction,
    onTabDragChange,
    contextDragPayload,
    onOpenMenu,
    trailing,
    leadingControls,
    className,
}: UnifiedPanelTabStripProps) {
    // Categories keep the inline groups' kind boundaries for moves, menus and
    // keyboard stops; they only change which tabs a section shows.
    const groupsEnabled = inlineGroupsEnabled || categoriesEnabled;
    const reorderEnabled = mixedReorderEnabled || groupsEnabled;
    const tabRefs = useRef(new Map<string, HTMLDivElement>());
    const draggingId = useRef<string | null>(null);
    const [draggedId, setDraggedId] = useState<string | null>(null);
    const [dropIndicator, setDropIndicator] = useState<{ id: string; position: 'before' | 'after' } | null>(null);
    const [liveMessage, setLiveMessage] = useState('');
    const previousActiveId = useRef(activeId);
    const suppressClickUntil = useRef(0);
    const tabDragChangeRef = useRef(onTabDragChange);
    tabDragChangeRef.current = onTabDragChange;
    const cancelDrag = useCallback(() => {
        if (draggingId.current) {
            suppressClickUntil.current = Date.now() + 250;
            tabDragChangeRef.current?.(null);
        }
        draggingId.current = null;
        setDraggedId(null);
        setDropIndicator(null);
    }, []);
    const [contextMenu, setContextMenu] = useState<{ tabId: string; x: number; y: number } | null>(null);
    // The tab each category last showed, so its chip returns to it.
    const [lastUsedIds, setLastUsedIds] = useState<Partial<Record<UnifiedTabStripGroup, string>>>({});
    const activeGroup = useMemo(() => {
        const active = tabs.find(tab => tab.id === activeId);
        return active ? stripGroupForKind(active.kind) : null;
    }, [tabs, activeId]);
    useEffect(() => {
        if (!categoriesEnabled || !activeId || !activeGroup) return;
        setLastUsedIds(current => current[activeGroup] === activeId ? current : { ...current, [activeGroup]: activeId });
    }, [categoriesEnabled, activeId, activeGroup]);
    const groups = useMemo(() => {
        if (categoriesEnabled) return categoryStripTabs(tabs, { activeId, lastUsedIds, dirtyIds, errorIds });
        return groupsEnabled ? groupStripTabs(tabs, {
            activeId, previewId: tabs.find(tab => tab.preview)?.id ?? null, pinnedId,
            cap: 3, folded: foldedGroups, narrow: false, dirtyIds, errorIds,
        }) : [];
    }, [categoriesEnabled, groupsEnabled, tabs, activeId, lastUsedIds, pinnedId, foldedGroups, dirtyIds, errorIds]);
    const { visibleTabs: stripTabs, canvasTabs: stackedCanvasTabs } = useMemo(
        () => groupsEnabled
            ? { visibleTabs: groups.flatMap(group => group.shown), canvasTabs: [] }
            : compressedCanvasTabs(tabs, activeId),
        [activeId, tabs, groupsEnabled, groups],
    );
    // Numbered in render order, so a hint always names the tab its digit selects.
    const shortcutsOn = browserShortcuts !== null;
    const browserShortcutDigitById = useMemo(() => {
        if (!shortcutsOn) return null;
        const browserTabs = stripTabs.filter(tab => tab.kind === 'browser');
        const digits = browserTabShortcutDigits(browserTabs.length);
        return new Map(browserTabs.map((tab, index) => [tab.id, digits[index]]));
    }, [shortcutsOn, stripTabs]);
    const { listRef, thumb, onThumbPointerDown } = useOverlayScrollbar(stripTabs);
    useEffect(() => { cancelDrag(); setContextMenu(null); }, [reorderScope, reorderEnabled, groupsEnabled, categoriesEnabled, cancelDrag]);
    useEffect(() => {
        if (draggedId && !stripTabs.some(tab => tab.id === draggedId)) cancelDrag();
        if (dropIndicator && !stripTabs.some(tab => tab.id === dropIndicator.id)) setDropIndicator(null);
    }, [stripTabs, draggedId, dropIndicator, cancelDrag]);
    useEffect(() => {
        if (!draggedId) return;
        const escape = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            event.stopPropagation();
            cancelDrag();
            setLiveMessage('Tab move cancelled.');
        };
        document.addEventListener('keydown', escape, true);
        return () => document.removeEventListener('keydown', escape, true);
    }, [draggedId, cancelDrag]);

    // Keep the active tab visible: it is routinely activated from far outside
    // the strip — a chat source link, a canvas event, a restored selection —
    // while sitting past the overflow.
    useEffect(() => {
        const activeChanged = previousActiveId.current !== activeId;
        previousActiveId.current = activeId;
        if (activeId === null) return;
        const focused = document.activeElement?.closest<HTMLElement>('[data-tab-id]');
        const node = !activeChanged && focused && listRef.current?.contains(focused) ? focused : tabRefs.current.get(activeId);
        node?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    }, [activeId, stripTabs]);

    useEffect(() => {
        if (contextMenu && !stripTabs.some(tab => tab.id === contextMenu.tabId)) setContextMenu(null);
    }, [contextMenu, stripTabs]);

    const dismissContextMenu = useCallback(() => {
        const originId = contextMenu?.tabId;
        setContextMenu(null);
        if (originId) queueMicrotask(() => tabRefs.current.get(originId)?.focus());
    }, [contextMenu?.tabId]);

    /** The contiguous run of tabs sharing `tab`'s scope and display group — its own section. */
    const sectionOf = (tab: UnifiedPanelTab) => {
        if (groupsEnabled) return tabs.filter(entry => entry.id !== pinnedId && stripGroupForKind(entry.kind) === stripGroupForKind(tab.kind));
        if (reorderEnabled) return tabs.filter(entry => entry.id !== pinnedId);
        const scope = scopeForKind(tab.kind);
        const group = displayGroupForKind(tab.kind);
        return tabs.filter(entry => scopeForKind(entry.kind) === scope && displayGroupForKind(entry.kind) === group);
    };

    const moveAndFocus = (id: string, beforeId: string | null, message: string) => {
        onMove(id, beforeId);
        setLiveMessage(message);
        queueMicrotask(() => {
            const tab = tabs.find(entry => entry.id === id);
            const groupNode = groupsEnabled && tab
                ? listRef.current?.querySelector<HTMLElement>(`[data-strip-group="${stripGroupForKind(tab.kind)}"]`)
                : null;
            // Reordering a non-active tab can move it beyond the visible cap.
            const node = tabRefs.current.get(id)
                ?? groupNode?.querySelector<HTMLElement>('[data-group-overflow]')
                ?? groupNode?.querySelector<HTMLElement>('[data-strip-stop]');
            node?.focus();
            node?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
        });
    };

    /** Alt+Arrow: shift the focused tab one place inside its section. */
    const shift = (tab: UnifiedPanelTab, step: -1 | 1) => {
        if (tab.id === pinnedId) return;
        const section = sectionOf(tab);
        const from = section.findIndex(entry => entry.id === tab.id);
        const to = from + step;
        if (to < 0 || to >= section.length) return;
        // Moving right means landing *after* the neighbour, i.e. before whatever
        // follows it — or at the end of the section when nothing does.
        const beforeId = step === -1 ? section[to].id : (section[to + 1]?.id ?? null);
        moveAndFocus(tab.id, beforeId, `Tab moved ${step === -1 ? 'left' : 'right'}. Position ${to + 1} of ${section.length}.`);
        tabRefs.current.get(tab.id)?.focus?.();
    };

    const onTabKeyDown = (event: ReactKeyboardEvent, tab: UnifiedPanelTab) => {
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
            event.stopPropagation();
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
        if (groupsEnabled) return;
        const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
        if (step !== 0) {
            event.preventDefault();
            const index = stripTabs.findIndex(entry => entry.id === tab.id);
            const next = stripTabs[(index + step + stripTabs.length) % stripTabs.length];
            onActivate(next.id);
            tabRefs.current.get(next.id)?.focus?.();
            return;
        }
        if (event.key === 'Home' || event.key === 'End') {
            event.preventDefault();
            const next = event.key === 'Home' ? stripTabs[0] : stripTabs[stripTabs.length - 1];
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
            <div className="group/strip relative flex min-w-0 flex-1">
            <div
                ref={listRef}
                role="tablist"
                aria-label="Open resources"
                aria-orientation="horizontal"
                className="scrollbar-hide flex min-w-0 flex-1 items-stretch overflow-x-auto overflow-y-hidden"
                data-testid="unified-panel-tab-list"
                onKeyDown={event => {
                    if (!groupsEnabled || event.altKey || event.ctrlKey || event.metaKey) return;
                    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-strip-stop]');
                    if (!target || !event.currentTarget.contains(target)) return;
                    const stops = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[data-strip-stop]'));
                    const index = stops.indexOf(target);
                    const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? stops.length - 1
                        : (index + (event.key === 'ArrowRight' ? 1 : -1) + stops.length) % stops.length;
                    event.preventDefault();
                    const next = stops[nextIndex];
                    next?.focus();
                    if (next?.dataset.tabId) onActivate(next.dataset.tabId);
                }}
                onDragLeave={event => {
                    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropIndicator(null);
                }}
                onDragOver={event => {
                    if (!reorderEnabled || !draggingId.current) return;
                    if (groupsEnabled) {
                        const targetId = (event.target as HTMLElement).closest<HTMLElement>('[data-tab-id]')?.dataset.tabId;
                        if (!targetId || targetId === pinnedId || isGroupBoundaryMove(tabs, draggingId.current, targetId)) {
                            setDropIndicator(null);
                            if (event.dataTransfer) event.dataTransfer.dropEffect = 'none';
                            return;
                        }
                    }
                    event.preventDefault();
                    const list = event.currentTarget;
                    const rect = list.getBoundingClientRect();
                    if (event.clientX < rect.left + 28) list.scrollLeft -= 24;
                    else if (event.clientX > rect.right - 28) list.scrollLeft += 24;
                    if (event.target === list) {
                        if (groupsEnabled) {
                            setDropIndicator(null);
                            return;
                        }
                        const last = stripTabs.filter(tab => tab.id !== pinnedId).at(-1);
                        if (last) setDropIndicator({ id: last.id, position: 'after' });
                    }
                }}
                onDrop={event => {
                    if (groupsEnabled || !reorderEnabled || event.target !== event.currentTarget || !draggingId.current) return;
                    event.preventDefault();
                    moveAndFocus(draggingId.current, null, 'Tab order updated.');
                    cancelDrag();
                }}
            >
                {(groupsEnabled ? groups : [{ group: null, shown: stripTabs }]).map(section => {
                    const tabNodes = section.shown.map((tab, index) => {
                    const repoLabel = unifiedTabRepoLabel(tab, hideBrowserRepoLabels);
                    const showRepoBadge = !!repoLabel && tab.kind !== 'file';
                    const isActive = tab.id === activeId;
                    const isDirty = dirtyIds?.has(tab.id) ?? false;
                    const hasError = errorIds?.has(tab.id) ?? false;
                    const shortcutDigit = browserShortcutDigitById?.get(tab.id) ?? null;
                    // The divider marks where tools (Terminal, Notes, Git, and
                    // the chat's canvases) end and resources (files, diffs)
                    // begin — derived, never passed in.
                    const startsResourceSection = !groupsEnabled && !reorderEnabled && index > 0
                        && displayGroupForKind(tab.kind) === 'resources'
                        && displayGroupForKind(stripTabs[index - 1].kind) === 'tools';
                    return (
                        <Fragment key={tab.id}>
                            {startsResourceSection && (
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
                            draggable={tab.id !== pinnedId}
                            title={unifiedTabTooltip(tab, hideBrowserRepoLabels)}
                            data-testid={`unified-panel-tab-${tab.id}`}
                            data-tab-id={tab.id}
                            data-strip-stop={groupsEnabled ? '' : undefined}
                            data-kind={tab.kind}
                            data-browser-shortcut={shortcutDigit ?? undefined}
                            aria-keyshortcuts={shortcutDigit !== null && browserShortcuts
                                ? browserTabAriaKeyShortcut(shortcutDigit, browserShortcuts.mac) : undefined}
                            data-scope={scopeForKind(tab.kind)}
                            data-active={isActive || undefined}
                            data-dirty={isDirty || undefined}
                            data-preview={tab.preview || undefined}
                            data-section-start={startsResourceSection || undefined}
                            data-dragging={draggedId === tab.id || undefined}
                            onClick={() => { if (Date.now() >= suppressClickUntil.current) onActivate(tab.id); }}
                            onDoubleClick={() => { if (Date.now() >= suppressClickUntil.current) onPromote?.(tab.id); }}
                            onAuxClick={event => {
                                if (event.button !== 1) return;
                                event.preventDefault();
                                if (Date.now() < suppressClickUntil.current || draggingId.current) return;
                                onClose(tab.id);
                            }}
                            onContextMenu={event => {
                                event.preventDefault();
                                setContextMenu({ tabId: tab.id, x: event.clientX, y: event.clientY });
                            }}
                            onKeyDown={event => onTabKeyDown(event, tab)}
                            onDragStart={event => {
                                if (tab.id === pinnedId || (event.target as HTMLElement).closest('button')) {
                                    event.preventDefault();
                                    return;
                                }
                                draggingId.current = tab.id;
                                onTabDragChange?.(tab.id);
                                if (reorderEnabled) {
                                    setDraggedId(tab.id);
                                    setContextMenu(null);
                                }
                                event.dataTransfer?.setData('application/x-coc-panel-tab', tab.id);
                                // No `text/plain`: a tab dropped on an editor must not type into it.
                                const context = contextDragPayload?.(tab);
                                if (context) event.dataTransfer?.setData(POINTER_CONTEXT_DRAG_MIME, JSON.stringify(context));
                                if (event.dataTransfer) event.dataTransfer.effectAllowed = context ? 'copyMove' : 'move';
                            }}
                            onDragEnd={cancelDrag}
                            onDragOver={event => {
                                if (reorderEnabled) {
                                    if (!draggingId.current || tab.id === pinnedId || tab.id === draggingId.current
                                        || (groupsEnabled && isGroupBoundaryMove(tabs, draggingId.current, tab.id))) {
                                        setDropIndicator(null);
                                        return;
                                    }
                                    setDropIndicator({ id: tab.id, position: getHorizontalDropPosition(event) });
                                }
                                event.preventDefault();
                                if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
                            }}
                            onDrop={event => {
                                event.preventDefault();
                                event.stopPropagation();
                                const from = draggingId.current;
                                if (groupsEnabled && from && isGroupBoundaryMove(tabs, from, tab.id)) {
                                    cancelDrag();
                                    return;
                                }
                                if (reorderEnabled && from && tab.id !== pinnedId && from !== tab.id) {
                                    const position = getHorizontalDropPosition(event);
                                    const movable = sectionOf(tab);
                                    const index = movable.findIndex(entry => entry.id === tab.id);
                                    const beforeId = position === 'before' ? tab.id : (movable[index + 1]?.id ?? null);
                                    moveAndFocus(from, beforeId, 'Tab order updated.');
                                    cancelDrag();
                                    return;
                                }
                                cancelDrag();
                                if (reorderEnabled) return;
                                if (!from || from === tab.id) return;
                                // A cross-section drop is rejected by the model,
                                // so ownership survives a wrong-target drag.
                                onMove(from, tab.id);
                            }}
                            className={cn(
                                // `flex-shrink-0` is what makes the row scroll: without it every
                                // tab squeezes and the labels truncate to nothing long before the
                                // strip actually overflows. Browser tabs shrink only to a floor.
                                'group relative flex h-[35px] cursor-pointer select-none',
                                categoriesEnabled ? 'min-w-0 flex-1' : tab.kind === 'browser' ? BROWSER_TAB_SIZE : DEFAULT_TAB_SIZE,
                                'items-center gap-1.5 whitespace-nowrap px-2.5 text-xs',
                                !categoriesEnabled && 'border-r border-[#e5e5e5] dark:border-[#333]',
                                'focus:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[#0078d4] dark:focus-visible:ring-[#3794ff]',
                                isActive
                                    ? 'bg-white text-[#1f1f1f] shadow-[inset_0_-2px_0_0_#0078d4] dark:bg-[#1e1e1e] dark:text-white dark:shadow-[inset_0_-2px_0_0_#3794ff]'
                                    : 'text-[#616161] hover:text-[#1f1f1f] dark:text-[#9d9d9d] dark:hover:text-white',
                                stackedCanvasTabs.length > 0 && tab.kind === 'canvas' && 'min-w-[160px] max-w-[260px]',
                                draggedId === tab.id && 'opacity-50',
                            )}
                        >
                            {dropIndicator?.id === tab.id && (
                                <span
                                    aria-hidden="true"
                                    data-testid="unified-panel-tab-drop-indicator"
                                    data-position={dropIndicator.position}
                                    className={cn('pointer-events-none absolute inset-y-0 z-10 w-0.5 bg-[#0078d4] dark:bg-[#3794ff]',
                                        dropIndicator.position === 'before' ? 'left-0' : 'right-0')}
                                />
                            )}
                            <span className="flex-shrink-0 opacity-80" aria-hidden="true">
                                {tab.kind === 'file'
                                    ? <FileNameIcon fileName={tab.label} showTitle={false} testId={`unified-panel-tab-file-icon-${tab.id}`} />
                                    : tab.kind === 'browser' ? <BrowserTabIcon tabId={tab.id} />
                                    : KIND_ICONS[tab.kind]}
                            </span>
                            {hasError && (
                                <span aria-hidden="true" className="flex-shrink-0" data-testid={`unified-panel-tab-error-${tab.id}`}>⚠</span>
                            )}
                            <span
                                className={cn('truncate', tab.kind === 'browser' && 'min-w-0 flex-1', tab.preview && 'italic')}
                                data-testid={`unified-panel-tab-label-${tab.id}`}
                            >
                                {tab.label}
                            </span>
                            {showRepoBadge && (
                                <span
                                    className="max-w-[64px] flex-shrink truncate text-[10px] opacity-70"
                                    data-testid={`unified-panel-tab-repo-${tab.id}`}
                                >
                                    {repoLabel}
                                </span>
                            )}
                            {/* Overlays the label's tail just before the close slot (padding 10 +
                              * close 16 + gap 6), so no tab width or child position ever moves. */}
                            {browserShortcuts?.hintsVisible && shortcutDigit !== null && (
                                <kbd
                                    aria-hidden="true"
                                    data-testid={`unified-panel-tab-shortcut-${tab.id}`}
                                    className="pointer-events-none absolute right-8 top-1/2 -translate-y-1/2 rounded-full bg-[#ececec] px-1 font-sans text-[10px] leading-4 text-[#616161] dark:bg-[#3a3a3a] dark:text-[#c5c5c5]"
                                >
                                    {browserTabShortcutLabel(shortcutDigit, browserShortcuts.mac)}
                                </kbd>
                            )}
                            <span className="sr-only">
                                {repoLabel && !showRepoBadge ? ` — ${repoLabel}` : ''}
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
                                    if (Date.now() < suppressClickUntil.current) return;
                                    onClose(tab.id);
                                }}
                                draggable={false}
                                onDragStart={event => { event.preventDefault(); event.stopPropagation(); }}
                                className={cn(
                                    'w-4 flex-shrink-0 cursor-pointer border-none bg-transparent p-0 leading-none',
                                    'text-[#848484] hover:text-[#1f1f1f] dark:hover:text-white',
                                    (isDirty || (categoriesEnabled && !isActive)) && 'hidden group-hover:block group-focus-within:block',
                                )}
                            >
                                ✕
                            </button>
                        </div>
                        </Fragment>
                    );
                    });
                    if (section.group === null) return tabNodes;
                    const group = section.group;
                    if (categoriesEnabled) return (
                        <CategoryChip key={group} group={group} section={section} active={section.hasActive}
                            menu={section.tabs.length > 1 && (
                                <UnifiedPanelTabOverflowMenu
                                    title={`${TAB_GROUP_LABELS[group]} tabs`}
                                    tabs={section.tabs} activeId={section.shown[0]?.id ?? null}
                                    hideBrowserRepoLabels={hideBrowserRepoLabels}
                                    dirtyIds={dirtyIds ?? EMPTY_TAB_IDS} errorIds={errorIds ?? EMPTY_TAB_IDS}
                                    onActivate={onActivate} onClose={onClose} onCloseMany={onCloseMany}
                                    strings={{ closeOthers: 'Close others in category', closeAll: 'Close all in category' }}
                                    trigger={<button type="button" data-strip-stop data-group-overflow
                                        data-testid={`unified-panel-category-menu-${group}`}
                                        aria-label={`All ${section.tabs.length} ${TAB_GROUP_LABELS[group]} tabs`
                                            + `${section.hiddenDirty ? ', some unsaved' : ''}${section.hiddenError ? ', some unavailable' : ''}`}
                                        title={`All ${TAB_GROUP_LABELS[group]} tabs`}
                                        className={cn(
                                            'flex flex-shrink-0 cursor-pointer items-center gap-0.5 border-0 bg-transparent px-1.5 text-[11px]',
                                            'text-[#616161] hover:bg-black/5 hover:text-[#1f1f1f] dark:text-[#9d9d9d] dark:hover:bg-white/10 dark:hover:text-white',
                                            'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[#0078d4] dark:focus-visible:ring-[#3794ff]',
                                        )}>
                                        {section.hiddenDirty && <span aria-hidden="true" data-testid={`unified-panel-category-dirty-${group}`}>{'\u25CF'}</span>}
                                        {section.hiddenError && <span aria-hidden="true">{'\u26A0'}</span>}
                                        <span className="rounded-full bg-black/5 px-1 leading-4 dark:bg-white/10">{section.tabs.length}</span>
                                        <span aria-hidden="true">{'\u25BE'}</span>
                                    </button>}
                                />
                            )}>
                            {tabNodes}
                        </CategoryChip>
                    );
                    return (
                        <div key={group} role="group" data-strip-group={group}
                            aria-label={`${TAB_GROUP_LABELS[group]}, ${section.tabs.length} tabs, ${section.hidden.length} hidden`}
                            className="flex flex-shrink-0 items-stretch">
                            <UnifiedPanelTabGroupLabel group={group} count={section.tabs.length}
                                active={section.hasActive} folded={foldedGroups?.has(group) ?? false}
                                onToggle={() => {
                                    onToggleGroup?.(group);
                                    setLiveMessage(`${TAB_GROUP_LABELS[group]} ${foldedGroups?.has(group) ? 'expanded' : 'folded'}.`);
                                }} />
                            {tabNodes}
                            {!foldedGroups?.has(group) && section.hidden.length > 0 && (
                                <UnifiedPanelTabOverflowMenu
                                    title={`${TAB_GROUP_LABELS[group]} tabs`}
                                    tabs={section.tabs} activeId={activeId}
                                    hideBrowserRepoLabels={hideBrowserRepoLabels}
                                    dirtyIds={dirtyIds ?? EMPTY_TAB_IDS} errorIds={errorIds ?? EMPTY_TAB_IDS}
                                    onActivate={onActivate} onClose={onClose} onCloseMany={onCloseMany}
                                    trigger={<button type="button" data-strip-stop data-group-overflow
                                        data-testid={`unified-panel-group-overflow-${group}`}
                                        aria-label={`Show ${section.hidden.length} hidden ${TAB_GROUP_LABELS[group]} tabs`}
                                        className="mx-1 my-1 flex flex-shrink-0 items-center gap-1 rounded border border-[#b6b6b6] px-2 text-[11px] text-[#616161] dark:border-[#555] dark:text-[#b8b8b8]">
                                        +{section.hidden.length} <span aria-hidden="true">{'\u25BE'}</span>
                                        {section.hiddenDirty && <span data-testid={`unified-panel-group-dirty-${group}`} aria-label="Hidden unsaved changes">{'\u25CF'}</span>}
                                        {section.hiddenError && <span aria-label="Hidden unavailable tabs">{'\u26A0'}</span>}
                                    </button>}
                                />
                            )}
                        </div>
                    );
                })}
            </div>
            {thumb && (
                <div
                    aria-hidden="true"
                    data-testid="unified-panel-tab-scroll-thumb"
                    onPointerDown={onThumbPointerDown}
                    style={{ left: thumb.left, width: thumb.width }}
                    className={cn(
                        'absolute bottom-0 z-10 h-[3px] rounded-sm bg-black/35 opacity-0 transition-opacity dark:bg-white/35',
                        'hover:bg-black/55 group-hover/strip:opacity-100 dark:hover:bg-white/55',
                        thumb.dragging && 'opacity-100',
                    )}
                />
            )}
            </div>

            {/* Outside the scrolling row, so they stay reachable at any tab count.
              * An active canvas shows the chip in its own header instead. */}
            {stackedCanvasTabs.length > 0 && !stackedCanvasTabs.some(tab => tab.id === activeId) && (
                <UnifiedPanelCanvasStack
                    tabs={stackedCanvasTabs}
                    activeId={activeId}
                    dirtyIds={dirtyIds ?? EMPTY_TAB_IDS}
                    errorIds={errorIds ?? EMPTY_TAB_IDS}
                    onActivate={onActivate}
                    onClose={onClose}
                    onCloseMany={onCloseMany}
                />
            )}
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
            <span role="status" aria-live="polite" className="sr-only">{liveMessage}</span>
            {contextMenu && (() => {
                const tab = tabs.find(candidate => candidate.id === contextMenu.tabId);
                if (!tab) return null;
                const items = unifiedPanelTabMenuItems(
                    tab,
                    tabs,
                    dirtyIds ?? new Set<string>(),
                    fileActionAvailability?.(tab),
                    reorderEnabled ? sectionOf(tab).map(entry => entry.id) : undefined,
                    groupsEnabled,
                );
                return (
                    <UnifiedPanelTabContextMenu
                        x={contextMenu.x}
                        y={contextMenu.y}
                        items={items}
                        onDismiss={dismissContextMenu}
                        onAction={action => {
                            dismissContextMenu();
                            if (action === 'move-left' || action === 'move-right') shift(tab, action === 'move-left' ? -1 : 1);
                            else onMenuAction?.(action, tab.id);
                        }}
                    />
                );
            })()}
        </div>
    );
}

/**
 * One category's chip: its current tab plus, with more than one tab, the
 * category's menu. The active chip takes the spare width; the others shrink
 * toward their icon so the row stays one line.
 */
function CategoryChip({ group, section, active, menu, children }: {
    group: UnifiedTabStripGroup;
    section: { tabs: readonly UnifiedPanelTab[]; hidden: readonly UnifiedPanelTab[] };
    active: boolean;
    menu: ReactNode;
    children: ReactNode;
}) {
    return (
        <div role="group" data-strip-group={group} data-testid={`unified-panel-category-${group}`}
            data-active={active || undefined}
            aria-label={`${TAB_GROUP_LABELS[group]}, ${section.tabs.length} tabs`}
            className={cn(
                'flex items-stretch border-r border-[#e5e5e5] dark:border-[#333]',
                active
                    ? 'min-w-[120px] max-w-[280px] flex-[1_1_240px] bg-white dark:bg-[#1e1e1e]'
                    : 'min-w-[64px] max-w-[190px] flex-[0_1_170px]',
            )}>
            {children}
            {menu}
        </div>
    );
}

/** Where the overlay thumb sits, in px from the strip's left edge; `null` when nothing overflows. */
interface ThumbGeometry {
    left: number;
    width: number;
    dragging: boolean;
}

/**
 * Drives the tab row's overlay scrollbar: measures the thumb from the row's
 * scroll state, lets the thumb be dragged, and turns a vertical wheel into a
 * horizontal scroll (the row has nothing to scroll vertically).
 */
function useOverlayScrollbar(tabs: readonly UnifiedPanelTab[]) {
    const listRef = useRef<HTMLDivElement>(null);
    const [thumb, setThumb] = useState<ThumbGeometry | null>(null);
    const dragging = useRef(false);

    const measure = useCallback(() => {
        const list = listRef.current;
        if (!list) return;
        const { scrollLeft, scrollWidth, clientWidth } = list;
        if (scrollWidth <= clientWidth) {
            setThumb(null);
            return;
        }
        setThumb({
            left: (scrollLeft / scrollWidth) * clientWidth,
            width: (clientWidth / scrollWidth) * clientWidth,
            dragging: dragging.current,
        });
    }, []);

    useEffect(measure, [measure, tabs]);

    useEffect(() => {
        const list = listRef.current;
        if (!list) return;
        const onWheel = (event: WheelEvent) => {
            if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
            if (list.scrollWidth <= list.clientWidth) return;
            event.preventDefault();
            list.scrollLeft += event.deltaY;
        };
        list.addEventListener('scroll', measure, { passive: true });
        list.addEventListener('wheel', onWheel, { passive: false });
        const observer = new ResizeObserver(measure);
        observer.observe(list);
        return () => {
            list.removeEventListener('scroll', measure);
            list.removeEventListener('wheel', onWheel);
            observer.disconnect();
        };
    }, [measure]);

    const onThumbPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
        const list = listRef.current;
        if (!list || event.button !== 0) return;
        event.preventDefault();
        const startX = event.clientX;
        const startScroll = list.scrollLeft;
        const ratio = list.scrollWidth / list.clientWidth;
        dragging.current = true;
        measure();
        const onMove = (move: PointerEvent) => {
            list.scrollLeft = startScroll + (move.clientX - startX) * ratio;
        };
        const onUp = () => {
            dragging.current = false;
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            measure();
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
    }, [measure]);

    return { listRef, thumb, onThumbPointerDown };
}
