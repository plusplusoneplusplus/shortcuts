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
});
