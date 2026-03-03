/**
 * Tests for ChatSessionSidebar component.
 *
 * Validates rendering, empty state, active highlight, and callback wiring.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const SIDEBAR_PATH = path.join(
    __dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'chat', 'ChatSessionSidebar.tsx'
);

describe('ChatSessionSidebar', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(SIDEBAR_PATH, 'utf-8');
    });

    describe('exports', () => {
        it('exports ChatSessionSidebar as a named export', () => {
            expect(source).toContain('export function ChatSessionSidebar');
        });

        it('exports ChatSessionSidebarProps interface', () => {
            expect(source).toContain('export interface ChatSessionSidebarProps');
        });
    });

    describe('props interface', () => {
        it('accepts className prop', () => {
            expect(source).toContain('className?: string');
        });

        it('accepts workspaceId prop', () => {
            expect(source).toContain('workspaceId: string');
        });

        it('accepts sessions array', () => {
            expect(source).toContain('sessions: ChatSessionItem[]');
        });

        it('accepts activeTaskId', () => {
            expect(source).toContain('activeTaskId: string | null');
        });

        it('accepts onSelectSession callback', () => {
            expect(source).toContain('onSelectSession: (taskId: string) => void');
        });

        it('accepts onNewChat callback with readOnly parameter', () => {
            expect(source).toContain('onNewChat: (readOnly: boolean) => void');
        });

        it('accepts loading flag', () => {
            expect(source).toContain('loading: boolean');
        });
    });

    describe('header', () => {
        it('renders "Chats" heading', () => {
            expect(source).toContain('>Chats<');
        });

        it('renders New Chat split button', () => {
            expect(source).toContain('data-testid="new-chat-split-btn"');
            expect(source).toContain('data-testid="new-chat-btn"');
            expect(source).toContain('New Chat');
        });

        it('New Chat primary button calls onNewChat with false', () => {
            expect(source).toContain('onClick={() => onNewChat(false)}');
        });

        it('renders dropdown toggle button', () => {
            expect(source).toContain('data-testid="new-chat-dropdown-toggle"');
        });

        it('New Chat button uses primary variant', () => {
            expect(source).toContain('variant="primary"');
        });
    });

    describe('session list rendering', () => {
        it('renders sidebar with data-testid', () => {
            expect(source).toContain('data-testid="chat-session-sidebar"');
        });

        it('renders session cards with data-testid', () => {
            expect(source).toContain('data-testid="chat-session-card"');
        });

        it('uses statusIcon for each session', () => {
            expect(source).toContain('statusIcon(session.status)');
        });

        it('truncates session display text (title or firstMessage) to 60 chars', () => {
            expect(source).toContain('(session.title || session.firstMessage).length > 60');
            expect(source).toContain('(session.title || session.firstMessage).slice(0, 60)');
        });

        it('renders title when available, falling back to firstMessage', () => {
            expect(source).toContain('session.title || session.firstMessage');
        });

        it('shows turn count', () => {
            expect(source).toContain('session.turnCount');
            expect(source).toContain('turns');
        });

        it('shows relative time using lastActivityAt with createdAt fallback', () => {
            expect(source).toContain('formatRelativeTime(session.lastActivityAt || session.createdAt)');
        });

        it('calls onSelectSession with session id on click', () => {
            // Navigation goes through handleCardClickWithLongPress to suppress long-press clicks
            expect(source).toContain('handleCardClickWithLongPress(session.id)');
            expect(source).toContain('onSelectSession(sessionId)');
        });
    });

    describe('active session highlight', () => {
        it('applies ring-2 ring-[#0078d4] to active session', () => {
            expect(source).toContain('ring-2 ring-[#0078d4]');
        });

        it('conditionally applies highlight based on activeTaskId', () => {
            expect(source).toContain('activeTaskId === session.id');
        });
    });

    describe('empty state', () => {
        it('shows empty state with data-testid', () => {
            expect(source).toContain('data-testid="chat-empty-state"');
        });

        it('shows "No previous chats" message', () => {
            expect(source).toContain('No previous chats');
        });

        it('shows prompt to start a conversation', () => {
            expect(source).toContain('Start a conversation to begin');
        });
    });

    describe('loading state', () => {
        it('renders Spinner when loading', () => {
            expect(source).toContain('Spinner');
            expect(source).toContain('loading');
        });
    });

    describe('imports', () => {
        it('imports useState, useCallback, useRef, useEffect from react', () => {
            expect(source).toContain("import { useState, useCallback, useRef, useEffect } from 'react'");
        });

        it('imports Card, Button, Spinner, cn from shared', () => {
            expect(source).toContain("import { Card, Button, Spinner, cn } from '../shared'");
        });

        it('imports statusIcon and formatRelativeTime from utils/format', () => {
            expect(source).toContain("import { statusIcon, formatRelativeTime } from '../utils/format'");
        });

        it('imports ChatSessionItem type', () => {
            expect(source).toContain("import type { ChatSessionItem } from '../types/dashboard'");
        });

        it('imports useBreakpoint hook', () => {
            expect(source).toContain("import { useBreakpoint } from '../hooks/useBreakpoint'");
        });
    });

    describe('cancel queued session', () => {
        it('accepts optional onCancelSession prop', () => {
            expect(source).toContain('onCancelSession?: (taskId: string) => void');
        });

        it('destructures onCancelSession from props', () => {
            expect(source).toContain('onCancelSession,');
        });

        it('renders cancel button for queued sessions when onCancelSession is provided', () => {
            expect(source).toContain("session.status === 'queued' && onCancelSession");
        });

        it('cancel button has data-testid', () => {
            expect(source).toContain('data-testid="cancel-session-btn"');
        });

        it('cancel button calls onCancelSession with session id', () => {
            expect(source).toContain('onCancelSession(session.id)');
        });

        it('cancel button stops event propagation to prevent selecting the session', () => {
            expect(source).toContain('e.stopPropagation()');
        });

        it('cancel button shows ✕ character', () => {
            expect(source).toContain('>✕<');
        });

        it('cancel button has a title for accessibility', () => {
            expect(source).toContain('title="Cancel queued chat"');
        });

        it('cancel button has hover color for visual feedback', () => {
            expect(source).toContain('hover:text-[#f85149]');
        });
    });

    describe('pin support — props', () => {
        it('accepts optional pinnedIds prop', () => {
            expect(source).toContain('pinnedIds?: string[]');
        });

        it('accepts optional onTogglePin callback', () => {
            expect(source).toContain('onTogglePin?: (taskId: string) => void');
        });

        it('destructures pinnedIds with default empty array', () => {
            expect(source).toContain('pinnedIds = []');
        });

        it('destructures onTogglePin from props', () => {
            expect(source).toContain('onTogglePin,');
        });
    });

    describe('pin support — pinned section', () => {
        it('renders pinned section header with data-testid', () => {
            expect(source).toContain('data-testid="pinned-section-header"');
        });

        it('shows pin emoji and count in section header', () => {
            expect(source).toContain('📌 Pinned (');
            expect(source).toContain('pinnedSessions.length');
        });

        it('renders separator between pinned and unpinned sections', () => {
            expect(source).toContain('data-testid="pinned-separator"');
        });

        it('uses dashed border for separator', () => {
            expect(source).toContain('border-dashed');
        });

        it('only shows pinned section when there are pinned sessions', () => {
            expect(source).toContain('pinnedSessions.length > 0');
        });

        it('partitions sessions into pinned and unpinned', () => {
            expect(source).toContain('pinnedSessions');
            expect(source).toContain('unpinnedSessions');
        });
    });

    describe('pin support — pin icon', () => {
        it('renders active pin icon on pinned cards with data-testid', () => {
            expect(source).toContain('data-testid="pin-icon-active"');
        });

        it('renders hover pin icon on unpinned cards with data-testid', () => {
            expect(source).toContain('data-testid="pin-icon-hover"');
        });

        it('active pin icon has accent color', () => {
            expect(source).toContain('text-[#0078d4]');
        });

        it('hover pin icon is hidden by default and visible on hover', () => {
            expect(source).toContain('opacity-0 group-hover:opacity-100');
        });

        it('active pin icon has unpin title', () => {
            expect(source).toContain('title="Unpin chat"');
        });

        it('hover pin icon has pin title', () => {
            expect(source).toContain('title="Pin chat"');
        });

        it('pin icon click stops propagation', () => {
            // Multiple stopPropagation calls (cancel, pin active, pin hover)
            const matches = source.match(/e\.stopPropagation\(\)/g);
            expect(matches).not.toBeNull();
            expect(matches!.length).toBeGreaterThanOrEqual(3);
        });

        it('pin icon click calls onTogglePin with session id', () => {
            expect(source).toContain('onTogglePin?.(session.id)');
            expect(source).toContain('onTogglePin(session.id)');
        });
    });

    describe('pin support — context menu', () => {
        it('imports ContextMenu component', () => {
            expect(source).toContain("import { ContextMenu } from '../tasks/comments/ContextMenu'");
        });

        it('imports ContextMenuItem type', () => {
            expect(source).toContain("import type { ContextMenuItem } from '../tasks/comments/ContextMenu'");
        });

        it('manages context menu state', () => {
            expect(source).toContain('contextMenu');
            expect(source).toContain('setContextMenu');
        });

        it('attaches onContextMenu handler to cards when onTogglePin is provided', () => {
            expect(source).toContain('onContextMenu');
            expect(source).toContain('handleContextMenu');
        });

        it('context menu items include Pin Chat / Unpin Chat label', () => {
            expect(source).toContain("'Unpin Chat'");
            expect(source).toContain("'Pin Chat'");
        });

        it('prevents default on right-click', () => {
            expect(source).toContain('e.preventDefault()');
        });

        it('renders ContextMenu component when context menu is open', () => {
            expect(source).toContain('<ContextMenu');
            expect(source).toContain('closeContextMenu');
        });
    });

    describe('new chat dropdown — split button', () => {
        it('renders split button container with data-testid', () => {
            expect(source).toContain('data-testid="new-chat-split-btn"');
        });

        it('renders dropdown toggle button with caret', () => {
            expect(source).toContain('data-testid="new-chat-dropdown-toggle"');
            expect(source).toContain('▾');
        });

        it('manages newChatDropdownOpen state', () => {
            expect(source).toContain('newChatDropdownOpen');
            expect(source).toContain('setNewChatDropdownOpen');
        });

        it('uses a ref for outside-click detection', () => {
            expect(source).toContain('newChatDropdownRef');
        });

        it('closes dropdown on outside click via mousedown listener', () => {
            expect(source).toContain("document.addEventListener('mousedown', handler)");
            expect(source).toContain("document.removeEventListener('mousedown', handler)");
        });

        it('renders dropdown menu with data-testid when open', () => {
            expect(source).toContain('data-testid="new-chat-dropdown-menu"');
        });

        it('renders normal new-chat option', () => {
            expect(source).toContain('data-testid="new-chat-option-normal"');
        });

        it('renders read-only new-chat option', () => {
            expect(source).toContain('data-testid="new-chat-option-readonly"');
        });

        it('renders read-only new-chat option only (no project-root option in sidebar)', () => {
            expect(source).toContain('data-testid="new-chat-option-readonly"');
            expect(source).toContain('New Chat (Read-Only)');
            expect(source).not.toContain('data-testid="new-chat-option-project-root"');
            expect(source).not.toContain('New Chat (Project Root)');
        });

        it('normal option calls onNewChat(false)', () => {
            expect(source).toContain('onNewChat(false)');
        });

        it('read-only option calls onNewChat(true)', () => {
            expect(source).toContain('onNewChat(true)');
        });

        it('onNewChat prop accepts only readOnly parameter (no useProjectRoot)', () => {
            expect(source).toContain('onNewChat: (readOnly: boolean) => void');
            expect(source).not.toContain('useProjectRoot');
        });

        it('dropdown options close the dropdown before invoking callback', () => {
            // Both menu items call setNewChatDropdownOpen(false) before onNewChat
            const menu = source.substring(source.indexOf('new-chat-dropdown-menu'));
            expect(menu).toContain('setNewChatDropdownOpen(false); onNewChat(false)');
            expect(menu).toContain('setNewChatDropdownOpen(false); onNewChat(true)');
        });

        it('dropdown toggle button has rounded-l-none class for split appearance', () => {
            expect(source).toContain('rounded-l-none');
        });

        it('primary button has rounded-r-none class for split appearance', () => {
            expect(source).toContain('rounded-r-none');
        });

        it('read-only option text contains "Read-Only"', () => {
            expect(source).toContain('New Chat (Read-Only)');
        });
    });

    describe('unread indicators', () => {
        it('accepts optional isUnread prop', () => {
            expect(source).toContain('isUnread?: (sessionId: string, turnCount?: number) => boolean');
        });

        it('destructures isUnread from props', () => {
            expect(source).toContain('isUnread,');
        });

        it('computes showUnread flag combining isUnread and active check', () => {
            expect(source).toContain('isUnread && activeTaskId !== session.id && isUnread(session.id, session.turnCount)');
        });

        it('renders unread dot with correct styling and data-testid', () => {
            expect(source).toContain('data-testid="unread-dot"');
            expect(source).toContain('w-2 h-2 rounded-full bg-[#3794ff] flex-shrink-0');
        });

        it('applies font-semibold to unread session text', () => {
            expect(source).toContain("cn('truncate', showUnread && 'font-semibold')");
        });

        it('does not show unread dot for active session', () => {
            expect(source).toContain('activeTaskId !== session.id');
        });

        it('only renders unread dot when showUnread is true', () => {
            expect(source).toContain('{showUnread && (');
        });

        it('works without isUnread prop (backward compat)', () => {
            // isUnread is optional with ?:, default undefined means showUnread is always false
            expect(source).toContain('isUnread?: (sessionId: string, turnCount?: number) => boolean');
            expect(source).toContain('!!(isUnread &&');
        });
    });

    describe('mobile improvements — long-press context menu', () => {
        it('declares longPressTimer ref', () => {
            expect(source).toContain('longPressTimer');
        });

        it('declares longPressFired ref', () => {
            expect(source).toContain('longPressFired');
        });

        it('implements handleCardTouchStart', () => {
            expect(source).toContain('handleCardTouchStart');
        });

        it('implements handleCardTouchEnd', () => {
            expect(source).toContain('handleCardTouchEnd');
        });

        it('implements handleCardTouchMove', () => {
            expect(source).toContain('handleCardTouchMove');
        });

        it('implements handleCardClickWithLongPress to suppress click after long-press', () => {
            expect(source).toContain('handleCardClickWithLongPress');
            expect(source).toContain('longPressFired.current');
        });

        it('long-press timer fires after 500ms', () => {
            expect(source).toContain('500');
            expect(source).toContain('setTimeout');
        });

        it('attaches touch handlers to each card', () => {
            expect(source).toContain('onTouchStart={(e: React.TouchEvent) => handleCardTouchStart(e, session.id)}');
            expect(source).toContain('onTouchEnd={handleCardTouchEnd}');
            expect(source).toContain('onTouchMove={handleCardTouchMove}');
        });

        it('uses handleCardClickWithLongPress for card click', () => {
            expect(source).toContain('handleCardClickWithLongPress(session.id)');
        });
    });

    describe('mobile improvements — touch targets', () => {
        it('uses p-3 md:p-2 for larger touch targets on mobile', () => {
            expect(source).toContain('p-3 md:p-2');
        });

        it('uses text-sm md:text-xs for larger text on mobile', () => {
            expect(source).toContain('text-sm md:text-xs');
        });
    });

    describe('mobile improvements — pin button visibility', () => {
        it('uses useBreakpoint to detect mobile', () => {
            expect(source).toContain('const { isMobile } = useBreakpoint()');
        });

        it('pin button uses isMobile to conditionally show opacity', () => {
            expect(source).toContain('isMobile ? \'opacity-100\' : \'opacity-0 group-hover:opacity-100\'');
        });
    });

    describe('mobile improvements — overflow fix', () => {
        it('session list container has overflow-x-hidden', () => {
            expect(source).toContain('overflow-y-auto overflow-x-hidden');
        });
    });

    describe('archive support — props', () => {
        it('accepts optional archiveSet prop', () => {
            expect(source).toContain('archiveSet?: Set<string>');
        });

        it('accepts optional onToggleArchive callback', () => {
            expect(source).toContain('onToggleArchive?: (sessionId: string) => void');
        });

        it('accepts optional showArchived prop', () => {
            expect(source).toContain('showArchived?: boolean');
        });

        it('accepts optional onToggleShowArchived callback', () => {
            expect(source).toContain('onToggleShowArchived?: () => void');
        });

        it('destructures archiveSet with default empty Set', () => {
            expect(source).toContain('archiveSet = new Set()');
        });

        it('destructures onToggleArchive from props', () => {
            expect(source).toContain('onToggleArchive,');
        });

        it('destructures showArchived with default false', () => {
            expect(source).toContain('showArchived = false');
        });
    });

    describe('archive support — session filtering', () => {
        it('excludes archived sessions from the unpinned list', () => {
            expect(source).toContain('archiveSet.has(s.id)');
        });

        it('builds archivedSessions list', () => {
            expect(source).toContain('archivedSessions');
        });
    });

    describe('archive support — context menu', () => {
        it('context menu includes Archive Chat label', () => {
            expect(source).toContain("'Archive Chat'");
        });

        it('context menu includes Unarchive Chat label', () => {
            expect(source).toContain("'Unarchive Chat'");
        });

        it('context menu uses archive emoji', () => {
            expect(source).toContain("'🗄️'");
        });

        it('context menu calls onToggleArchive', () => {
            expect(source).toContain('onToggleArchive(contextMenu.sessionId)');
        });

        it('context menu renders when onToggleArchive provided even without onTogglePin', () => {
            expect(source).toContain('onTogglePin || onToggleArchive');
        });
    });

    describe('archive support — show archived toggle', () => {
        it('renders show-archived toggle row when onToggleShowArchived provided', () => {
            expect(source).toContain('data-testid="show-archived-toggle-row"');
        });

        it('renders show-archived checkbox with data-testid', () => {
            expect(source).toContain('data-testid="show-archived-checkbox"');
        });

        it('checkbox reflects showArchived state', () => {
            expect(source).toContain('checked={showArchived}');
        });

        it('checkbox calls onToggleShowArchived on change', () => {
            expect(source).toContain('onChange={onToggleShowArchived}');
        });

        it('toggle label says "Show Archived"', () => {
            expect(source).toContain('Show Archived');
        });
    });

    describe('archive support — archived section', () => {
        it('renders archived section header with data-testid', () => {
            expect(source).toContain('data-testid="archived-section-header"');
        });

        it('renders archived separator with data-testid', () => {
            expect(source).toContain('data-testid="archived-separator"');
        });

        it('renders no-archived-chats empty state with data-testid', () => {
            expect(source).toContain('data-testid="no-archived-chats"');
        });

        it('shows "No archived chats" message', () => {
            expect(source).toContain('No archived chats');
        });

        it('shows archived section only when showArchived is true', () => {
            expect(source).toContain('{showArchived && (');
        });

        it('renders archived sessions when section is visible', () => {
            expect(source).toContain('archivedSessions.map(session => renderCard(session, false))');
        });
    });
});
