/**
 * ChatSessionSidebar — left sidebar listing past chat sessions.
 *
 * Renders session cards with status icon, first-message preview,
 * turn count, and relative timestamp. Highlights the active session.
 * Supports pinning chats to the top of the list.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { Card, Button, Spinner, cn } from '../shared';
import { statusIcon, formatRelativeTime } from '../utils/format';
import { ContextMenu } from '../tasks/comments/ContextMenu';
import type { ContextMenuItem } from '../tasks/comments/ContextMenu';
import type { ChatSessionItem } from '../types/dashboard';
import { useBreakpoint } from '../hooks/useBreakpoint';

export interface ChatSessionSidebarProps {
    className?: string;
    workspaceId: string;
    sessions: ChatSessionItem[];
    activeTaskId: string | null;
    onSelectSession: (taskId: string) => void;
    onNewChat: (readOnly: boolean) => void;
    onCancelSession?: (taskId: string) => void;
    loading: boolean;
    pinnedIds?: string[];
    onTogglePin?: (taskId: string) => void;
    isUnread?: (sessionId: string, turnCount?: number) => boolean;
    archiveSet?: Set<string>;
    onToggleArchive?: (sessionId: string) => void;
    showArchived?: boolean;
    onToggleShowArchived?: () => void;
    onRefresh?: () => void;
    isRefreshing?: boolean;
}

export function ChatSessionSidebar({
    className,
    sessions,
    activeTaskId,
    onSelectSession,
    onNewChat,
    onCancelSession,
    loading,
    pinnedIds = [],
    onTogglePin,
    isUnread,
    archiveSet = new Set(),
    onToggleArchive,
    showArchived = false,
    onToggleShowArchived,
    onRefresh,
    isRefreshing = false,
}: ChatSessionSidebarProps) {
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number; sessionId: string } | null>(null);
    const [newChatDropdownOpen, setNewChatDropdownOpen] = useState(false);
    const newChatDropdownRef = useRef<HTMLDivElement>(null);
    const { isMobile } = useBreakpoint();

    // Long-press refs for mobile context menu trigger
    const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const longPressFired = useRef(false);

    const handleCardTouchStart = useCallback((e: React.TouchEvent, sessionId: string) => {
        longPressFired.current = false;
        const touch = e.touches[0];
        const x = touch.clientX;
        const y = touch.clientY;
        longPressTimer.current = setTimeout(() => {
            longPressFired.current = true;
            setContextMenu({ x, y, sessionId });
        }, 500);
    }, []);

    const handleCardTouchEnd = useCallback(() => {
        if (longPressTimer.current !== null) {
            clearTimeout(longPressTimer.current);
            longPressTimer.current = null;
        }
    }, []);

    const handleCardTouchMove = useCallback(() => {
        if (longPressTimer.current !== null) {
            clearTimeout(longPressTimer.current);
            longPressTimer.current = null;
        }
    }, []);

    const handleCardClickWithLongPress = useCallback((sessionId: string) => {
        if (longPressFired.current) {
            longPressFired.current = false;
            return;
        }
        onSelectSession(sessionId);
    }, [onSelectSession]);

    // Close dropdown when clicking outside
    useEffect(() => {
        if (!newChatDropdownOpen) return;
        const handler = (e: MouseEvent) => {
            if (newChatDropdownRef.current && !newChatDropdownRef.current.contains(e.target as Node)) {
                setNewChatDropdownOpen(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [newChatDropdownOpen]);

    const pinSet = new Set(pinnedIds);
    const pinnedSessions = pinnedIds
        .map(id => sessions.find(s => s.id === id))
        .filter((s): s is ChatSessionItem => s != null);
    const unpinnedSessions = sessions.filter(s => !pinSet.has(s.id) && !archiveSet.has(s.id));
    const archivedSessions = sessions.filter(s => archiveSet.has(s.id));

    const handleContextMenu = useCallback((e: React.MouseEvent, sessionId: string) => {
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY, sessionId });
    }, []);

    const closeContextMenu = useCallback(() => setContextMenu(null), []);

    const contextMenuItems: ContextMenuItem[] = contextMenu ? [
        ...(onTogglePin ? [{
            label: pinSet.has(contextMenu.sessionId) ? 'Unpin Chat' : 'Pin Chat',
            icon: '📌',
            onClick: () => onTogglePin(contextMenu.sessionId),
        }] : []),
        ...(onToggleArchive ? [{
            label: archiveSet.has(contextMenu.sessionId) ? 'Unarchive Chat' : 'Archive Chat',
            icon: '🗄️',
            onClick: () => onToggleArchive(contextMenu.sessionId),
        }] : []),
    ] : [];

    const renderCard = (session: ChatSessionItem, isPinned: boolean) => {
        const showUnread = !!(isUnread && activeTaskId !== session.id && isUnread(session.id, session.turnCount));
        return (
        <Card
            key={session.id}
            className={cn(
                'p-3 md:p-2 cursor-pointer group',
                activeTaskId === session.id && 'ring-2 ring-[#0078d4]'
            )}
            onClick={() => handleCardClickWithLongPress(session.id)}
            onContextMenu={(onTogglePin || onToggleArchive) ? (e: React.MouseEvent) => handleContextMenu(e, session.id) : undefined}
            onTouchStart={(e: React.TouchEvent) => handleCardTouchStart(e, session.id)}
            onTouchEnd={handleCardTouchEnd}
            onTouchMove={handleCardTouchMove}
            data-testid="chat-session-card"
        >
            <div className="flex items-start gap-1.5 text-sm md:text-xs text-[#1e1e1e] dark:text-[#cccccc]">
                {isPinned ? (
                    <button
                        className="flex-shrink-0 text-[#0078d4] cursor-pointer"
                        title="Unpin chat"
                        data-testid="pin-icon-active"
                        onClick={(e) => { e.stopPropagation(); onTogglePin?.(session.id); }}
                    >📌</button>
                ) : (
                    <span className="flex-shrink-0">{statusIcon(session.status)}</span>
                )}
                {showUnread && (
                    <span className="w-2 h-2 rounded-full bg-[#3794ff] flex-shrink-0 mt-1" data-testid="unread-dot" />
                )}
                <span className={cn('truncate', showUnread && 'font-semibold')}>
                    {(session.title || session.firstMessage).length > 60
                        ? (session.title || session.firstMessage).slice(0, 60) + '…'
                        : session.title || session.firstMessage || 'Chat session'}
                </span>
                {!isPinned && onTogglePin && (
                    <button
                        className={cn(
                            'flex-shrink-0 ml-auto transition-opacity text-[#848484] hover:text-[#0078d4] cursor-pointer',
                            isMobile ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                        )}
                        title="Pin chat"
                        data-testid="pin-icon-hover"
                        onClick={(e) => { e.stopPropagation(); onTogglePin(session.id); }}
                    >📌</button>
                )}
            </div>
            <div className="flex items-center gap-1.5 text-[10px] text-[#848484] mt-0.5 ml-5">
                <span>{session.turnCount != null ? `${session.turnCount} turns` : '—'}</span>
                <span>·</span>
                <span>{formatRelativeTime(session.lastActivityAt || session.createdAt)}</span>
                {session.status === 'failed' && (
                    <>
                        <span>·</span>
                        <span className="text-[#f85149]" title="Session expired">expired</span>
                    </>
                )}
                {session.status === 'queued' && onCancelSession && (
                    <>
                        <span>·</span>
                        <button
                            className="text-[#848484] hover:text-[#f85149] cursor-pointer"
                            title="Cancel queued chat"
                            data-testid="cancel-session-btn"
                            onClick={(e) => { e.stopPropagation(); onCancelSession(session.id); }}
                        >✕</button>
                    </>
                )}
            </div>
        </Card>
        );
    };

    return (
        <div className={cn('flex flex-col overflow-hidden', className)} data-testid="chat-session-sidebar">
            {/* Header with New Chat button */}
            <div className="px-3 py-2 border-b border-[#e0e0e0] dark:border-[#3c3c3c]">
                <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-[#1e1e1e] dark:text-[#cccccc] flex-shrink-0">Chats</span>
                    {onRefresh && (
                        <Button
                            variant="ghost"
                            size="sm"
                            disabled={isRefreshing}
                            loading={isRefreshing}
                            onClick={onRefresh}
                            title="Refresh chat sessions"
                            data-testid="chat-refresh-btn"
                        >
                            {!isRefreshing && '↺'}
                        </Button>
                    )}
                    {onToggleShowArchived && (
                        <label className="flex items-center gap-1 text-[10px] text-[#848484] cursor-pointer select-none ml-auto mr-1 flex-shrink-0" data-testid="show-archived-toggle-row">
                            <input
                                type="checkbox"
                                checked={showArchived}
                                onChange={onToggleShowArchived}
                                data-testid="show-archived-checkbox"
                                className="cursor-pointer"
                            />
                            Show Archived
                        </label>
                    )}
                    <div className={cn('relative inline-flex flex-shrink-0', onToggleShowArchived ? '' : 'ml-auto')} ref={newChatDropdownRef} data-testid="new-chat-split-btn">
                        <Button variant="primary" size="sm" onClick={() => onNewChat(false)} data-testid="new-chat-btn" className="rounded-r-none">
                            New Chat
                        </Button>
                        <Button
                            variant="primary"
                            size="sm"
                            onClick={() => setNewChatDropdownOpen(prev => !prev)}
                            data-testid="new-chat-dropdown-toggle"
                            className="rounded-l-none border-l border-white/30 px-1.5"
                        >
                            ▾
                        </Button>
                        {newChatDropdownOpen && (
                            <div
                                className="absolute right-0 top-full mt-1 w-52 bg-white dark:bg-[#252526] border border-[#e0e0e0] dark:border-[#3c3c3c] rounded shadow-lg z-50"
                                data-testid="new-chat-dropdown-menu"
                            >
                                <button
                                    className="w-full text-left px-3 py-2 text-xs hover:bg-[#0078d4]/10 text-[#1e1e1e] dark:text-[#cccccc]"
                                    data-testid="new-chat-option-normal"
                                    onClick={() => { setNewChatDropdownOpen(false); onNewChat(false); }}
                                >
                                    New Chat
                                </button>
                                <button
                                    className="w-full text-left px-3 py-2 text-xs hover:bg-[#0078d4]/10 text-[#1e1e1e] dark:text-[#cccccc]"
                                    data-testid="new-chat-option-readonly"
                                    onClick={() => { setNewChatDropdownOpen(false); onNewChat(true); }}
                                >
                                    New Chat (Read-Only)
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Session list */}
            <div className="flex-1 overflow-y-auto overflow-x-hidden p-3 space-y-1.5">
                {loading ? (
                    <div className="flex justify-center py-4"><Spinner /></div>
                ) : sessions.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-8 text-sm text-[#848484]" data-testid="chat-empty-state">
                        <div className="text-2xl mb-2">💬</div>
                        <div>No previous chats</div>
                        <div className="text-xs mt-1">Start a conversation to begin</div>
                    </div>
                ) : (
                    <>
                        {pinnedSessions.length > 0 && (
                            <>
                                <div className="text-[10px] text-[#848484] font-medium px-1 pb-0.5" data-testid="pinned-section-header">
                                    📌 Pinned ({pinnedSessions.length})
                                </div>
                                {pinnedSessions.map(session => renderCard(session, true))}
                                <div className="border-t border-dashed border-[#e0e0e0] dark:border-[#3c3c3c] my-1.5" data-testid="pinned-separator" />
                            </>
                        )}
                        {unpinnedSessions.map(session => renderCard(session, false))}
                        {showArchived && (
                            <>
                                <div className="border-t border-dashed border-[#e0e0e0] dark:border-[#3c3c3c] my-1.5" data-testid="archived-separator" />
                                <div className="text-[10px] text-[#848484] font-medium px-1 pb-0.5" data-testid="archived-section-header">
                                    🗄️ Archived
                                </div>
                                {archivedSessions.length === 0 ? (
                                    <div className="text-[10px] text-[#848484] px-1 py-2 italic" data-testid="no-archived-chats">
                                        No archived chats
                                    </div>
                                ) : (
                                    archivedSessions.map(session => renderCard(session, false))
                                )}
                            </>
                        )}
                    </>
                )}
            </div>

            {/* Context menu for pin/unpin/archive */}
            {contextMenu && (onTogglePin || onToggleArchive) && (
                <ContextMenu
                    position={{ x: contextMenu.x, y: contextMenu.y }}
                    items={contextMenuItems}
                    onClose={closeContextMenu}
                />
            )}
        </div>
    );
}
