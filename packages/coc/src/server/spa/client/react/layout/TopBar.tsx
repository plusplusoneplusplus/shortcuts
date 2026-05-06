/**
 * TopBar — top navigation bar with tab switching and theme toggle.
 */

import { useCallback, useContext, useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { getSpaCocClient, getSpaCocClientErrorMessage } from '../api/cocClient';
import { useApp } from '../contexts/AppContext';
import { useQueue } from '../contexts/QueueContext';
import { useRepos } from '../contexts/ReposContext';
import { ToastContext } from '../contexts/ToastContext';
import { useTheme } from './ThemeProvider';
import { buildNoteHash, buildRepoSubTabSuffix } from './Router';
import { NotificationBell } from '../shared/NotificationBell';
import { RepoTabStrip } from '../features/repo-detail/RepoTabStrip';
import { MY_WORK_WORKSPACE_ID } from '../repos/MyWorkView';
import { MY_LIFE_WORKSPACE_ID } from '../repos/MyLifeView';
import { useMyWorkEnabled } from '../hooks/feature-flags/useMyWorkEnabled';
import { useMyLifeEnabled } from '../hooks/feature-flags/useMyLifeEnabled';
import { RepoManagementPopover } from '../repos/RepoManagementPopover';
import { useBreakpoint } from '../hooks/ui/useBreakpoint';
import { getHostname, isServersEnabled } from '../utils/config';
import type { DashboardTab } from '../types/dashboard';
import type { WsStatus } from '../hooks/useWebSocket';
import {
    mergeVisibleTopBarOrder,
    moveTopBarItem,
    moveTopBarItemToIndex,
    resolveTopBarItemOrder,
    type TopBarItemId,
} from './topBarOrder';

/** Set to `true` to re-enable the top-level Wiki tab in navigation. */
export const SHOW_WIKI_TAB = false;
/** Set to `true` to re-enable the topbar Memory icon. */
export const SHOW_MEMORY_TAB = false;

export const ALL_TABS: { label: string; tab: DashboardTab }[] = [
    { label: 'Wiki', tab: 'wiki' },
];

export const TABS: { label: string; tab: DashboardTab }[] = SHOW_WIKI_TAB
    ? ALL_TABS
    : ALL_TABS.filter(t => t.tab !== 'wiki');

const themeEmoji: Record<string, string> = {
    auto: '🌗',
    dark: '🌙',
    light: '☀️',
};

const wsStatusConfig: Record<WsStatus, { color: string; label: string; pulse: boolean }> = {
    open: { color: 'bg-[#16825d] dark:bg-[#89d185]', label: 'Connected', pulse: false },
    connecting: { color: 'bg-[#cca700] dark:bg-[#cca700]', label: 'Connecting…', pulse: true },
    reconnecting: { color: 'bg-[#cca700] dark:bg-[#cca700]', label: 'Reconnecting…', pulse: true },
    closing: { color: 'bg-[#cca700] dark:bg-[#cca700]', label: 'Disconnecting…', pulse: true },
    closed: { color: 'bg-[#f14c4c] dark:bg-[#f48771]', label: 'Disconnected', pulse: false },
};

export interface TopBarProps {
    onAdminOpen?: () => void;
    onLogsOpen?: () => void;
}

interface ReorderableTopBarItem {
    id: TopBarItemId;
    label: string;
    tab?: DashboardTab;
    icon: string;
    desktopOnly?: boolean;
    active: boolean;
    onActivate?: () => void;
}

type DropIndicator = { targetId: TopBarItemId; position: 'before' | 'after' } | null;

function getDropPosition(event: DragEvent<HTMLElement>): 'before' | 'after' {
    const rect = event.currentTarget.getBoundingClientRect();
    return event.clientX < rect.left + rect.width / 2 ? 'before' : 'after';
}

function getDropPositionLabel(items: ReorderableTopBarItem[], index: number): string {
    if (index <= 0) {
        return 'before first item';
    }
    const previous = items[index - 1];
    return previous ? `after ${previous.label}` : 'at the end';
}

export function TopBar({ onAdminOpen, onLogsOpen }: TopBarProps = {}) {
    const { state, dispatch } = useApp();
    const { state: queueState } = useQueue();
    const { repos, unseenCounts, fetchRepos } = useRepos();
    const { theme, toggleTheme } = useTheme();
    const { breakpoint } = useBreakpoint();
    const isMobile = breakpoint === 'mobile';
    const [popoverOpen, setPopoverOpen] = useState(false);
    const hostname = getHostname();
    const brandLabel = hostname ? `CoC @ ${hostname}` : 'CoC';
    const brandTooltip = hostname ? `Copilot of Copilot @ ${hostname}` : 'Copilot of Copilot';
    const myWorkEnabled = useMyWorkEnabled();
    const myLifeEnabled = useMyLifeEnabled();
    const serversEnabled = isServersEnabled();
    const toast = useContext(ToastContext);
    const longPressTimer = useRef<number | null>(null);
    const pointerDragId = useRef<TopBarItemId | null>(null);
    const dropIndicatorRef = useRef<DropIndicator>(null);
    const suppressNextClick = useRef(false);
    const [savedTopBarOrder, setSavedTopBarOrder] = useState<string[] | undefined>();
    const [customizeMode, setCustomizeMode] = useState(false);
    const [draggedId, setDraggedId] = useState<TopBarItemId | null>(null);
    const [dropIndicator, setDropIndicator] = useState<DropIndicator>(null);
    const [keyboardDragId, setKeyboardDragId] = useState<TopBarItemId | null>(null);
    const [keyboardDropIndex, setKeyboardDropIndex] = useState<number | null>(null);
    const [liveMessage, setLiveMessage] = useState('');

    const switchTab = useCallback((tab: DashboardTab) => {
        dispatch({ type: 'SET_ACTIVE_TAB', tab });
        location.hash = '#' + tab;
    }, [dispatch]);

    const goToRepos = useCallback(() => {
        dispatch({ type: 'SET_ACTIVE_TAB', tab: 'repos' });
        location.hash = '#repos';
    }, [dispatch]);

    const goToMyWork = useCallback(() => {
        const savedPath = state.notePathState?.[MY_WORK_WORKSPACE_ID];
        dispatch({ type: 'SET_ACTIVE_TAB', tab: 'repos' });
        dispatch({ type: 'SET_SELECTED_REPO', id: MY_WORK_WORKSPACE_ID });
        location.hash = savedPath
            ? buildNoteHash(MY_WORK_WORKSPACE_ID, savedPath)
            : '#repos/' + MY_WORK_WORKSPACE_ID + '/notes';
    }, [dispatch, state.notePathState]);

    const goToMyLife = useCallback(() => {
        const savedPath = state.notePathState?.[MY_LIFE_WORKSPACE_ID];
        dispatch({ type: 'SET_ACTIVE_TAB', tab: 'repos' });
        dispatch({ type: 'SET_SELECTED_REPO', id: MY_LIFE_WORKSPACE_ID });
        location.hash = savedPath
            ? buildNoteHash(MY_LIFE_WORKSPACE_ID, savedPath)
            : '#repos/' + MY_LIFE_WORKSPACE_ID + '/notes';
    }, [dispatch, state.notePathState]);

    const toggleRepoManagement = useCallback(() => {
        if (state.activeTab !== 'repos') {
            location.hash = '#repos';
            return;
        }
        setPopoverOpen(prev => !prev);
    }, [state.activeTab]);

    const selectRepo = useCallback((id: string) => {
        dispatch({ type: 'SET_SELECTED_REPO', id });
        const subTab = state.repoTabState[id] ?? 'chats';
        const selectedTaskId = queueState.selectedTaskIdByRepo?.[id] ?? null;
        const suffix = buildRepoSubTabSuffix(
            subTab,
            { ...state, selectedNotePath: state.notePathState?.[id] ?? null },
            selectedTaskId
        );
        location.hash = '#repos/' + encodeURIComponent(id) + suffix;
    }, [dispatch, queueState.selectedTaskIdByRepo, state]);

    const isOnReposTab = state.activeTab === 'repos';
    const visibleTopBarItems = useMemo<ReorderableTopBarItem[]>(() => {
        const optionalTabs = TABS.map(({ label, tab }) => ({
            id: tab as TopBarItemId,
            label,
            tab,
            icon: label.slice(0, 1),
            desktopOnly: true,
            active: state.activeTab === tab,
            onActivate: () => switchTab(tab),
        }));

        return [
            ...optionalTabs,
            {
                id: 'skills',
                label: 'Skills',
                tab: 'skills',
                icon: '\u26a1',
                desktopOnly: true,
                active: state.activeTab === 'skills',
                onActivate: () => switchTab('skills'),
            },
            {
                id: 'logs',
                label: 'Logs',
                tab: 'logs',
                icon: '\ud83d\udccb',
                desktopOnly: true,
                active: false,
                onActivate: onLogsOpen,
            },
            ...(SHOW_MEMORY_TAB ? [{
                id: 'memory' as const,
                label: 'Memory',
                tab: 'memory' as const,
                icon: '\ud83e\udde0',
                desktopOnly: true,
                active: state.activeTab === 'memory',
                onActivate: () => switchTab('memory'),
            }] : []),
            {
                id: 'stats',
                label: 'Usage',
                tab: 'stats',
                icon: '\ud83d\udcca',
                desktopOnly: true,
                active: state.activeTab === 'stats',
                onActivate: () => switchTab('stats'),
            },
            {
                id: 'models',
                label: 'Models',
                tab: 'models',
                icon: '\u269b',
                desktopOnly: true,
                active: state.activeTab === 'models',
                onActivate: () => switchTab('models'),
            },
            ...(serversEnabled ? [{
                id: 'servers' as const,
                label: 'Servers',
                tab: 'servers' as const,
                icon: '\ud83d\udda5',
                desktopOnly: true,
                active: state.activeTab === 'servers',
                onActivate: () => switchTab('servers'),
            }] : []),
            {
                id: 'admin',
                label: 'Admin',
                tab: 'admin',
                icon: '\u2699',
                active: state.activeTab === 'admin',
                onActivate: onAdminOpen,
            },
        ];
    }, [onAdminOpen, onLogsOpen, serversEnabled, state.activeTab, switchTab]);

    const visibleDefaultOrder = useMemo(
        () => visibleTopBarItems.map(item => item.id),
        [visibleTopBarItems],
    );

    const orderedTopBarItems = useMemo(() => {
        const order = resolveTopBarItemOrder(visibleDefaultOrder, savedTopBarOrder);
        return order
            .map(id => visibleTopBarItems.find(item => item.id === id))
            .filter((item): item is ReorderableTopBarItem => Boolean(item));
    }, [savedTopBarOrder, visibleDefaultOrder, visibleTopBarItems]);

    const orderedTopBarIds = useMemo(
        () => orderedTopBarItems.map(item => item.id),
        [orderedTopBarItems],
    );

    const updateDropIndicator = useCallback((indicator: DropIndicator) => {
        dropIndicatorRef.current = indicator;
        setDropIndicator(indicator);
    }, []);

    useEffect(() => {
        let cancelled = false;
        getSpaCocClient().preferences.getGlobal()
            .then(prefs => {
                if (cancelled) {
                    return;
                }
                setSavedTopBarOrder(Array.isArray(prefs.topBarItemOrder) ? prefs.topBarItemOrder : undefined);
            })
            .catch(error => {
                if (!cancelled) {
                    toast?.addToast(getSpaCocClientErrorMessage(error, 'Failed to load top bar order'), 'error');
                }
            });
        return () => { cancelled = true; };
    }, [toast]);

    const persistVisibleOrder = useCallback(async (nextVisibleOrder: TopBarItemId[]) => {
        const nextSavedOrder = mergeVisibleTopBarOrder(savedTopBarOrder, nextVisibleOrder);
        setSavedTopBarOrder(nextSavedOrder);
        try {
            await getSpaCocClient().preferences.patchGlobal({ topBarItemOrder: nextSavedOrder });
        } catch (error) {
            toast?.addToast(`${getSpaCocClientErrorMessage(error, 'Failed to save top bar order')}. The order will stay for this session and retry on the next reorder.`, 'error');
        }
    }, [savedTopBarOrder, toast]);

    const resetTopBarOrder = useCallback(async () => {
        setSavedTopBarOrder(undefined);
        try {
            const prefs = await getSpaCocClient().preferences.getGlobal();
            const { topBarItemOrder: _topBarItemOrder, ...rest } = prefs;
            await getSpaCocClient().preferences.replaceGlobal(rest);
            setCustomizeMode(false);
            toast?.addToast('Top bar order reset', 'success');
        } catch (error) {
            toast?.addToast(getSpaCocClientErrorMessage(error, 'Failed to reset top bar order'), 'error');
        }
    }, [toast]);

    const enterCustomizeMode = useCallback(() => {
        setCustomizeMode(true);
    }, []);

    useEffect(() => {
        const handler = () => enterCustomizeMode();
        window.addEventListener('coc-customize-top-bar', handler);
        return () => window.removeEventListener('coc-customize-top-bar', handler);
    }, [enterCustomizeMode]);

    useEffect(() => {
        if (!customizeMode && !keyboardDragId) {
            return;
        }
        const handler = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') {
                return;
            }
            if (keyboardDragId) {
                event.preventDefault();
                setKeyboardDragId(null);
                setKeyboardDropIndex(null);
                setLiveMessage('Cancelled top bar drag.');
                return;
            }
            setCustomizeMode(false);
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [customizeMode, keyboardDragId]);

    const clearLongPress = useCallback(() => {
        if (longPressTimer.current !== null) {
            window.clearTimeout(longPressTimer.current);
            longPressTimer.current = null;
        }
    }, []);

    const scheduleLongPressCustomize = useCallback((item: ReorderableTopBarItem, event: ReactPointerEvent<HTMLButtonElement>) => {
        clearLongPress();
        event.currentTarget.setPointerCapture?.(event.pointerId);
        longPressTimer.current = window.setTimeout(() => {
            setCustomizeMode(true);
            setDraggedId(item.id);
            pointerDragId.current = item.id;
            suppressNextClick.current = true;
            setLiveMessage(`Picked up ${item.label}, position ${orderedTopBarIds.indexOf(item.id) + 1} of ${orderedTopBarIds.length}.`);
            longPressTimer.current = null;
        }, 500);
    }, [clearLongPress, orderedTopBarIds]);

    const finishDrop = useCallback((nextOrder: TopBarItemId[]) => {
        pointerDragId.current = null;
        setDraggedId(null);
        updateDropIndicator(null);
        void persistVisibleOrder(nextOrder);
    }, [persistVisibleOrder, updateDropIndicator]);

    const updatePointerDropTarget = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
        const sourceId = pointerDragId.current;
        if (!sourceId) {
            return;
        }
        const element = document.elementFromPoint(event.clientX, event.clientY);
        const target = element?.closest<HTMLElement>('[data-topbar-item-id]');
        const targetId = target?.getAttribute('data-topbar-item-id') as TopBarItemId | null;
        if (!targetId || targetId === sourceId || !orderedTopBarIds.includes(targetId)) {
            updateDropIndicator(null);
            return;
        }
        const rect = target.getBoundingClientRect();
        const position = event.clientX < rect.left + rect.width / 2 ? 'before' : 'after';
        updateDropIndicator({ targetId, position });
    }, [orderedTopBarIds, updateDropIndicator]);

    const finishPointerDrag = useCallback(() => {
        clearLongPress();
        const sourceId = pointerDragId.current;
        const indicator = dropIndicatorRef.current;
        if (!sourceId) {
            return;
        }
        if (indicator && indicator.targetId !== sourceId) {
            finishDrop(moveTopBarItem(orderedTopBarIds, sourceId, indicator.targetId, indicator.position));
            return;
        }
        pointerDragId.current = null;
        setDraggedId(null);
        updateDropIndicator(null);
    }, [clearLongPress, finishDrop, orderedTopBarIds, updateDropIndicator]);

    const handleKeyboardDrag = useCallback((event: ReactKeyboardEvent<HTMLButtonElement>, item: ReorderableTopBarItem, index: number) => {
        if (event.key === ' ' || event.key === 'Enter') {
            event.preventDefault();
            if (!keyboardDragId) {
                setKeyboardDragId(item.id);
                setKeyboardDropIndex(index);
                setCustomizeMode(true);
                setLiveMessage(`Picked up ${item.label}, position ${index + 1} of ${orderedTopBarItems.length}.`);
                return;
            }
            if (keyboardDragId === item.id && keyboardDropIndex !== null) {
                const nextOrder = moveTopBarItemToIndex(orderedTopBarIds, item.id, keyboardDropIndex);
                setKeyboardDragId(null);
                setKeyboardDropIndex(null);
                const finalIndex = nextOrder.indexOf(item.id);
                setLiveMessage(`Dropped ${item.label}, position ${finalIndex + 1} of ${nextOrder.length}.`);
                void persistVisibleOrder(nextOrder);
            }
            return;
        }

        if (keyboardDragId !== item.id) {
            return;
        }

        if (event.key === 'Escape') {
            event.preventDefault();
            setKeyboardDragId(null);
            setKeyboardDropIndex(null);
            setLiveMessage('Cancelled top bar drag.');
            return;
        }

        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'Home' || event.key === 'End') {
            event.preventDefault();
            const maxIndex = orderedTopBarItems.length;
            const current = keyboardDropIndex ?? index;
            const nextIndex = event.key === 'Home'
                ? 0
                : event.key === 'End'
                    ? maxIndex
                    : Math.max(0, Math.min(maxIndex, current + (event.key === 'ArrowLeft' ? -1 : 1)));
            setKeyboardDropIndex(nextIndex);
            setLiveMessage(`Drop position ${getDropPositionLabel(orderedTopBarItems, nextIndex)}.`);
        }
    }, [keyboardDragId, keyboardDropIndex, orderedTopBarIds, orderedTopBarItems, persistVisibleOrder]);

    return (
        <>
        <header
            className="h-10 md:h-12 px-3 flex items-center justify-between border-b border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#f3f3f3] dark:bg-[#252526] text-[#1e1e1e] dark:text-[#cccccc]"
            data-react
        >
            <div className="flex items-center gap-2 min-w-0 flex-1">
                <button
                    className="h-7 w-7 md:h-8 md:w-8 flex-shrink-0 rounded border border-transparent hover:border-[#c8c8c8] dark:hover:border-[#3c3c3c] hover:bg-black/[0.04] dark:hover:bg-white/[0.06] text-base leading-none touch-target"
                    id="hamburger-btn"
                    aria-label={isOnReposTab ? 'Manage repositories' : 'Go to repositories'}
                    aria-pressed={isOnReposTab ? popoverOpen : false}
                    title={isOnReposTab ? 'Manage repositories' : 'Go to repositories'}
                    onClick={toggleRepoManagement}
                >
                    &#9776;
                </button>
                <a
                    href="#"
                    data-tab-mobile="repos"
                    className={`text-sm font-semibold whitespace-nowrap md:hidden flex-shrink-0 px-2 h-7 transition-colors inline-flex items-center ${isOnReposTab ? 'active border-b-2 border-[#0078d4] text-[#0078d4] dark:border-[#60b4ff] dark:text-[#60b4ff]' : 'hover:underline'}`}
                    onClick={e => { e.preventDefault(); goToRepos(); }}
                >{ brandLabel }</a>
                <a
                    href="#"
                    data-tab="repos"
                    className={`text-sm font-semibold whitespace-nowrap hidden md:inline-flex flex-shrink-0 px-2 h-8 transition-colors items-center ${isOnReposTab ? 'active border-b-2 border-[#0078d4] text-[#0078d4] dark:border-[#60b4ff] dark:text-[#60b4ff]' : 'hover:bg-black/[0.05] dark:hover:bg-white/[0.08]'}`}
                    title={brandTooltip}
                    onClick={e => { e.preventDefault(); goToRepos(); }}
                >{ brandLabel }</a>
                {myWorkEnabled && (
                    <button
                        id="my-work-toggle"
                        className={
                            `h-7 w-7 md:h-8 md:w-8 flex-shrink-0 inline-flex items-center justify-center rounded touch-target ` +
                            (isOnReposTab && state.selectedRepoId === MY_WORK_WORKSPACE_ID
                                ? 'bg-[#0078d4] text-white'
                                : 'hover:bg-black/[0.05] dark:hover:bg-white/[0.08]')
                        }
                        aria-label="My Work"
                        title="My Work"
                        onClick={goToMyWork}
                    >
                        💼
                    </button>
                )}
                {myLifeEnabled && (
                    <button
                        id="my-life-toggle"
                        className={
                            `h-7 w-7 md:h-8 md:w-8 flex-shrink-0 inline-flex items-center justify-center rounded touch-target ` +
                            (isOnReposTab && state.selectedRepoId === MY_LIFE_WORKSPACE_ID
                                ? 'bg-[#0078d4] text-white'
                                : 'hover:bg-black/[0.05] dark:hover:bg-white/[0.08]')
                        }
                        aria-label="My Life"
                        title="My Life"
                        onClick={goToMyLife}
                    >
                        🏠
                    </button>
                )}
                {!isMobile && (
                    <RepoTabStrip
                        repos={repos}
                        selectedRepoId={state.selectedRepoId}
                        onSelect={selectRepo}
                        unseenCounts={unseenCounts}
                        onRefresh={fetchRepos}
                    />
                )}
                {TABS.length > 0 && null}
            </div>
            <div className="flex items-center gap-1 min-w-0 overflow-hidden">
                <span
                    className="inline-flex items-center justify-center h-7 w-7 md:h-8 md:w-8"
                    title={wsStatusConfig[state.wsStatus ?? 'closed']?.label}
                    aria-label={`Connection: ${wsStatusConfig[state.wsStatus ?? 'closed']?.label}`}
                    data-testid="ws-status-indicator"
                >
                    <span
                        className={`inline-block w-2 h-2 rounded-full ${wsStatusConfig[state.wsStatus ?? 'closed']?.color}${wsStatusConfig[state.wsStatus ?? 'closed']?.pulse ? ' animate-pulse' : ''}`}
                    />
                </span>
                <NotificationBell />
                <div className="flex items-center gap-1 min-w-0 overflow-hidden" data-testid="topbar-reorder-group">
                    {orderedTopBarItems.map((item, index) => {
                        const showBefore = dropIndicator?.targetId === item.id && dropIndicator.position === 'before';
                        const showAfter = dropIndicator?.targetId === item.id && dropIndicator.position === 'after';
                        const isPickedUp = keyboardDragId === item.id;
                        const isDragging = draggedId === item.id;
                        const className =
                            `h-7 w-7 md:h-8 md:w-8 ${item.desktopOnly ? 'hidden md:inline-flex' : 'inline-flex'} items-center justify-center rounded touch-target text-base leading-none relative ` +
                            (item.active
                                ? 'bg-[#0078d4] text-white'
                                : 'hover:bg-black/[0.05] dark:hover:bg-white/[0.08]') +
                            (isPickedUp ? ' ring-2 ring-[#0078d4] dark:ring-[#60b4ff]' : '') +
                            (isDragging ? ' opacity-50 outline outline-1 outline-dashed outline-[#8c8c8c]' : '');

                        return (
                            <div
                                key={item.id}
                                className="relative group flex-shrink-0"
                                draggable={!isMobile}
                                onDragStart={event => {
                                    if (event.dataTransfer) {
                                        event.dataTransfer.effectAllowed = 'move';
                                        event.dataTransfer.setData('text/plain', item.id);
                                    }
                                    setDraggedId(item.id);
                                    setCustomizeMode(true);
                                }}
                                onDragEnter={event => {
                                    if (!draggedId || draggedId === item.id) {
                                        return;
                                    }
                                    event.preventDefault();
                                    updateDropIndicator({ targetId: item.id, position: getDropPosition(event) });
                                }}
                                onDragOver={event => {
                                    if (!draggedId || draggedId === item.id) {
                                        return;
                                    }
                                    event.preventDefault();
                                    updateDropIndicator({ targetId: item.id, position: getDropPosition(event) });
                                }}
                                onDrop={event => {
                                    event.preventDefault();
                                    const sourceId = ((event.dataTransfer?.getData('text/plain') ?? '') || draggedId) as TopBarItemId | null;
                                    if (!sourceId || sourceId === item.id) {
                                        setDraggedId(null);
                                        updateDropIndicator(null);
                                        return;
                                    }
                                    const position = dropIndicator?.targetId === item.id ? dropIndicator.position : getDropPosition(event);
                                    finishDrop(moveTopBarItem(orderedTopBarIds, sourceId, item.id, position));
                                }}
                                onDragEnd={() => {
                                    setDraggedId(null);
                                    updateDropIndicator(null);
                                }}
                            >
                                {showBefore && <span className="absolute -left-0.5 top-1 bottom-1 w-0.5 rounded bg-[#0078d4] dark:bg-[#60b4ff]" aria-hidden />}
                                <button
                                    id={`${item.id}-toggle`}
                                    data-tab={item.tab}
                                    data-topbar-item-id={item.id}
                                    className={className}
                                    aria-label={item.label}
                                    aria-pressed={isPickedUp ? true : undefined}
                                    title={item.label}
                                    onPointerDown={event => scheduleLongPressCustomize(item, event)}
                                    onPointerMove={updatePointerDropTarget}
                                    onPointerUp={finishPointerDrag}
                                    onPointerCancel={finishPointerDrag}
                                    onPointerLeave={clearLongPress}
                                    onKeyDown={event => handleKeyboardDrag(event, item, index)}
                                    onClick={event => {
                                        if (suppressNextClick.current) {
                                            suppressNextClick.current = false;
                                            event.preventDefault();
                                            return;
                                        }
                                        if (isPickedUp) {
                                            event.preventDefault();
                                            return;
                                        }
                                        item.onActivate?.();
                                    }}
                                >
                                    <span
                                        className={`absolute -left-1 top-0.5 text-[9px] leading-none text-[#616161] dark:text-[#999] ${customizeMode || isPickedUp ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'}`}
                                        aria-hidden
                                    >
                                        ⠿
                                    </span>
                                    {item.icon}
                                </button>
                                {showAfter && <span className="absolute -right-0.5 top-1 bottom-1 w-0.5 rounded bg-[#0078d4] dark:bg-[#60b4ff]" aria-hidden />}
                            </div>
                        );
                    })}
                </div>
                <button
                    id="theme-toggle"
                    className="h-7 w-7 md:h-8 md:w-8 inline-flex items-center justify-center rounded hover:bg-black/[0.05] dark:hover:bg-white/[0.08] touch-target text-base leading-none"
                    aria-label="Toggle theme"
                    onClick={toggleTheme}
                >
                    {themeEmoji[theme] || '🌗'}
                </button>
            </div>
        </header>
        <div className="sr-only" aria-live="polite">{liveMessage}</div>
        {customizeMode && (
            <div className="fixed top-12 right-3 z-[9000] flex items-center gap-2 rounded-full border border-[#d0d0d0] dark:border-[#3c3c3c] bg-white dark:bg-[#252526] shadow px-3 py-1 text-xs">
                <span>Drag icons to reorder. Long-press an icon to pick it up. Esc to finish.</span>
                <button className="text-[#0078d4] dark:text-[#60b4ff] hover:underline" onClick={() => void resetTopBarOrder()}>Reset order</button>
                <button className="text-[#0078d4] dark:text-[#60b4ff] hover:underline" onClick={() => setCustomizeMode(false)}>Done</button>
            </div>
        )}
        {isOnReposTab && (
            <RepoManagementPopover
                open={popoverOpen}
                onClose={() => setPopoverOpen(false)}
                repos={repos}
                onRefresh={fetchRepos}
            />
        )}
        </>
    );
}
