/**
 * ChatSessionSidebar — left sidebar listing past chat sessions.
 *
 * Renders session cards with status icon, first-message preview,
 * turn count, and relative timestamp. Highlights the active session.
 */

import { Card, Button, Spinner, cn } from '../shared';
import { statusIcon, formatRelativeTime } from '../utils/format';
import type { ChatSessionItem } from '../types/dashboard';

export interface ChatSessionSidebarProps {
    className?: string;
    workspaceId: string;
    sessions: ChatSessionItem[];
    activeTaskId: string | null;
    onSelectSession: (taskId: string) => void;
    onNewChat: () => void;
    loading: boolean;
}

export function ChatSessionSidebar({
    className,
    sessions,
    activeTaskId,
    onSelectSession,
    onNewChat,
    loading,
}: ChatSessionSidebarProps) {
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
                    sessions.map(session => (
                        <Card
                            key={session.id}
                            className={cn(
                                'p-2 cursor-pointer',
                                activeTaskId === session.id && 'ring-2 ring-[#0078d4]'
                            )}
                            onClick={() => onSelectSession(session.id)}
                            data-testid="chat-session-card"
                        >
                            <div className="flex items-start gap-1.5 text-xs text-[#1e1e1e] dark:text-[#cccccc]">
                                <span className="flex-shrink-0">{statusIcon(session.status)}</span>
                                <span className="truncate">
                                    {session.firstMessage.length > 60
                                        ? session.firstMessage.slice(0, 60) + '…'
                                        : session.firstMessage || 'Chat session'}
                                </span>
                            </div>
                            <div className="flex items-center gap-1.5 text-[10px] text-[#848484] mt-0.5 ml-5">
                                <span>{session.turnCount != null ? `${session.turnCount} turns` : '—'}</span>
                                <span>·</span>
                                <span>{formatRelativeTime(session.createdAt)}</span>
                            </div>
                        </Card>
                    ))
                )}
            </div>
        </div>
    );
}
