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

        it('accepts onNewChat callback', () => {
            expect(source).toContain('onNewChat: () => void');
        });

        it('accepts loading flag', () => {
            expect(source).toContain('loading: boolean');
        });
    });

    describe('header', () => {
        it('renders "Chats" heading', () => {
            expect(source).toContain('>Chats<');
        });

        it('renders New Chat button', () => {
            expect(source).toContain('data-testid="new-chat-btn"');
            expect(source).toContain('New Chat');
        });

        it('New Chat button calls onNewChat', () => {
            expect(source).toContain('onClick={onNewChat}');
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

        it('truncates firstMessage to 60 chars', () => {
            expect(source).toContain('session.firstMessage.length > 60');
            expect(source).toContain('session.firstMessage.slice(0, 60)');
        });

        it('shows turn count', () => {
            expect(source).toContain('session.turnCount');
            expect(source).toContain('turns');
        });

        it('shows relative time', () => {
            expect(source).toContain('formatRelativeTime(session.createdAt)');
        });

        it('calls onSelectSession with session id on click', () => {
            expect(source).toContain('onSelectSession(session.id)');
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
        it('imports Card, Button, Spinner, cn from shared', () => {
            expect(source).toContain("import { Card, Button, Spinner, cn } from '../shared'");
        });

        it('imports statusIcon and formatRelativeTime from utils/format', () => {
            expect(source).toContain("import { statusIcon, formatRelativeTime } from '../utils/format'");
        });

        it('imports ChatSessionItem type', () => {
            expect(source).toContain("import type { ChatSessionItem } from '../types/dashboard'");
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
});
