/**
 * ChatSessionSidebar — left sidebar listing past chat sessions.
 *
 * Renders session cards with status icon, first-message preview,
 * turn count, and relative timestamp. Highlights the active session.
 * Supports pinning chats to the top of the list.
 */

import { useState, useCallback } from 'react';
import { Card, Button, Spinner, cn } from '../shared';
import { statusIcon, formatRelativeTime } from '../utils/format';
import { ContextMenu } from '../tasks/comments/ContextMenu';
import type { ContextMenuItem } from '../tasks/comments/ContextMenu';
import type { ChatSessionItem } from '../types/dashboard';

export interface ChatSessionSidebarProps {
    className?: string;
    workspaceId: string;
    sessions: ChatSessionItem[];
    activeTaskId: string | null;
    onSelectSession: (taskId: string) => void;
    onNewChat: () => void;
    onCancelSession?: (taskId: string) => void;
    loading: boolean;
    pinnedIds?: string[];
    onTogglePin?: (taskId: string) => void;
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
}: ChatSessionSidebarProps) {
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number; sessionId: string } | null>(null);

    const pinSet = new Set(pinnedIds);
    const pinnedSessions = pinnedIds
        .map(id => sessions.find(s => s.id === id))
        .filter((s): s is ChatSessionItem => s != null);
    const unpinnedSessions = sessions.filter(s => !pinSet.has(s.id));

    const handleContextMenu = useCallback((e: React.MouseEvent, sessionId: string) => {
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY, sessionId });
    }, []);

    const closeContextMenu = useCallback(() => setContextMenu(null), []);

    const contextMenuItems: ContextMenuItem[] = contextMenu && onTogglePin ? [
        {
            label: pinSet.has(contextMenu.sessionId) ? 'Unpin Chat' : 'Pin Chat',
            icon: '📌',
            onClick: () => onTogglePin(contextMenu.sessionId),
        },
    ] : [];

    const renderCard = (session: ChatSessionItem, isPinned: boolean) => (
        <Card
            key={session.id}
            className={cn(
                'p-2 cursor-pointer group',
                activeTaskId === session.id && 'ring-2 ring-[#0078d4]'
            )}
            onClick={() => onSelectSession(session.id)}
            onContextMenu={onTogglePin ? (e: React.MouseEvent) => handleContextMenu(e, session.id) : undefined}
            data-testid="chat-session-card"
        >
            <div className="flex items-start gap-1.5 text-xs text-[#1e1e1e] dark:text-[#cccccc]">
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
                <span className="truncate">
                    {session.firstMessage.length > 60
                        ? session.firstMessage.slice(0, 60) + '…'
                        : session.firstMessage || 'Chat session'}
                </span>
                {!isPinned && onTogglePin && (
                    <button
                        className="flex-shrink-0 ml-auto opacity-0 group-hover:opacity-100 text-[#848484] hover:text-[#0078d4] cursor-pointer transition-opacity"
                        title="Pin chat"
                        data-testid="pin-icon-hover"
                        onClick={(e) => { e.stopPropagation(); onTogglePin(session.id); }}
                    >📌</button>
                )}
            </div>
            <div className="flex items-center gap-1.5 text-[10px] text-[#848484] mt-0.5 ml-5">
                <span>{session.turnCount != null ? `${session.turnCount} turns` : '—'}</span>
                <span>·</span>
                <span>{formatRelativeTime(session.createdAt)}</span>
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

    return (
        <div className={cn('flex flex-col overflow-hidden', className)} data-testid="chat-session-sidebar">
            {/* Header with New Chat button */}
            <div className="p-3 border-b border-[#e0e0e0] dark:border-[#3c3c3c] flex items-center justify-between">
                <span className="text-sm font-medium text-[#1e1e1e] dark:text-[#cccccc]">Chats</span>
                <Button variant="primary" size="sm" onClick={onNewChat} data-testid="new-chat-btn">
                    New Chat
                </Button>
            </div>

            {/* Session list */}
            <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
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
                    </>
                )}
            </div>

            {/* Context menu for pin/unpin */}
            {contextMenu && onTogglePin && (
                <ContextMenu
                    position={{ x: contextMenu.x, y: contextMenu.y }}
                    items={contextMenuItems}
                    onClose={closeContextMenu}
                />
            )}
        </div>
    );
}
