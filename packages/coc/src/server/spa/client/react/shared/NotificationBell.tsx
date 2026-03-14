/**
 * NotificationBell — bell icon button with badge and dropdown notification panel.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { useNotifications, type NotificationEntry } from '../context/NotificationContext';
import { useApp } from '../context/AppContext';
import { cn } from './cn';

const TYPE_ICONS: Record<NotificationEntry['type'], string> = {
    success: '✅',
    error: '❌',
    warning: '⚠️',
    info: 'ℹ️',
};

function formatTimeAgo(timestamp: number): string {
    const diff = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
    if (diff < 60) return `${diff}s ago`;
    const mins = Math.floor(diff / 60);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
}

export function NotificationBell() {
    const { notifications, unreadCount, markAllRead, clearAll } = useNotifications();
    const { dispatch } = useApp();
    const [open, setOpen] = useState(false);
    const bellRef = useRef<HTMLButtonElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);

    const toggle = useCallback(() => setOpen(prev => !prev), []);

    // Close on Escape
    useEffect(() => {
        if (!open) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setOpen(false);
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [open]);

    // Close on outside click
    useEffect(() => {
        if (!open) return;
        const handleClick = (e: MouseEvent) => {
            if (
                panelRef.current && !panelRef.current.contains(e.target as Node) &&
                bellRef.current && !bellRef.current.contains(e.target as Node)
            ) {
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, [open]);

    const navigateToProcess = useCallback(
        (processId: string) => {
            dispatch({ type: 'SET_SELECTED_ID', id: processId });
            dispatch({ type: 'SET_ACTIVE_TAB', tab: 'processes' });
            setOpen(false);
        },
        [dispatch],
    );

    const badgeText = unreadCount > 9 ? '9+' : String(unreadCount);

    return (
        <div className="relative">
            <button
                ref={bellRef}
                className={cn(
                    'h-7 w-7 md:h-8 md:w-8 inline-flex items-center justify-center rounded touch-target relative',
                    open
                        ? 'bg-[#0078d4] text-white'
                        : 'hover:bg-black/[0.05] dark:hover:bg-white/[0.08]',
                )}
                aria-label="Notifications"
                title="Notifications"
                data-testid="notification-bell"
                onClick={toggle}
            >
                🔔
                {unreadCount > 0 && (
                    <span
                        className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold leading-none"
                        data-testid="notification-badge"
                    >
                        {badgeText}
                    </span>
                )}
            </button>

            {open && (
                <div
                    ref={panelRef}
                    className="absolute right-0 top-full mt-1 w-[340px] max-h-[400px] flex flex-col rounded-lg border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] shadow-lg z-[10002]"
                    data-testid="notification-panel"
                    role="dialog"
                    aria-label="Notifications panel"
                >
                    {/* Header */}
                    <div className="flex items-center justify-between px-3 py-2 border-b border-[#e0e0e0] dark:border-[#3c3c3c]">
                        <span className="text-sm font-semibold text-[#1e1e1e] dark:text-[#cccccc]">Notifications</span>
                        <button
                            className="text-xs text-[#0078d4] hover:underline"
                            onClick={markAllRead}
                            data-testid="mark-all-read"
                        >
                            Mark all read
                        </button>
                    </div>

                    {/* Entry list */}
                    <div className="flex-1 overflow-y-auto">
                        {notifications.length === 0 ? (
                            <div className="py-8 text-center text-sm text-[#6e6e6e] dark:text-[#999]" data-testid="empty-state">
                                No notifications yet
                            </div>
                        ) : (
                            notifications.map(entry => (
                                <div
                                    key={entry.id}
                                    className={cn(
                                        'flex items-start gap-2 px-3 py-2 border-b border-[#f0f0f0] dark:border-[#2d2d2d] last:border-b-0',
                                        !entry.read && 'bg-[#e8f0fe] dark:bg-[#0d2137]',
                                    )}
                                    data-testid="notification-entry"
                                    data-read={String(entry.read)}
                                >
                                    <span className="text-base leading-none mt-0.5" aria-hidden>
                                        {TYPE_ICONS[entry.type]}
                                    </span>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-1">
                                            <span className="text-sm font-medium truncate text-[#1e1e1e] dark:text-[#cccccc]" data-testid="notification-title">
                                                {entry.title}
                                            </span>
                                            <span className="text-[10px] text-[#6e6e6e] dark:text-[#999] whitespace-nowrap ml-auto">
                                                {formatTimeAgo(entry.timestamp)}
                                            </span>
                                        </div>
                                        {entry.detail && (
                                            <span className="text-xs text-[#6e6e6e] dark:text-[#999] truncate block" data-testid="notification-detail">
                                                {entry.detail}
                                            </span>
                                        )}
                                    </div>
                                    {entry.processId && (
                                        <button
                                            className="text-sm text-[#0078d4] hover:underline shrink-0 mt-0.5"
                                            aria-label={`Go to process ${entry.processId}`}
                                            data-testid="notification-navigate"
                                            onClick={() => navigateToProcess(entry.processId!)}
                                        >
                                            →
                                        </button>
                                    )}
                                </div>
                            ))
                        )}
                    </div>

                    {/* Footer */}
                    {notifications.length > 0 && (
                        <div className="flex items-center justify-center px-3 py-2 border-t border-[#e0e0e0] dark:border-[#3c3c3c]">
                            <button
                                className="text-xs text-[#f14c4c] hover:underline"
                                onClick={clearAll}
                                data-testid="clear-all"
                            >
                                Clear all
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
