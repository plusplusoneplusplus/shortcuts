/**
 * Tests for ActivityChatDetail float button and ActivityDetailPane floating placeholder.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const REPOS_DIR = path.join(
    __dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos'
);
const CONTEXT_DIR = path.join(
    __dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'context'
);
const LAYOUT_DIR = path.join(
    __dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'layout'
);

const CHAT_DETAIL_SOURCE = fs.readFileSync(path.join(REPOS_DIR, 'ActivityChatDetail.tsx'), 'utf-8');
const DETAIL_PANE_SOURCE = fs.readFileSync(path.join(REPOS_DIR, 'ActivityDetailPane.tsx'), 'utf-8');
const FLOATING_CONTEXT_SOURCE = fs.readFileSync(path.join(CONTEXT_DIR, 'FloatingChatsContext.tsx'), 'utf-8');
const FLOATING_MANAGER_SOURCE = fs.readFileSync(path.join(LAYOUT_DIR, 'FloatingChatManager.tsx'), 'utf-8');
const FLOATING_CONTENT_SOURCE = fs.readFileSync(path.join(REPOS_DIR, 'FloatingChatContent.tsx'), 'utf-8');

// ── ActivityChatDetail: variant prop ─────────────────────────────────────────

describe('ActivityChatDetail: variant prop', () => {
    it('accepts variant prop in interface', () => {
        expect(CHAT_DETAIL_SOURCE).toContain("variant?: 'inline' | 'floating'");
    });

    it('defaults variant to inline', () => {
        expect(CHAT_DETAIL_SOURCE).toContain("variant = 'inline'");
    });

    it('applies compact padding when variant is floating', () => {
        expect(CHAT_DETAIL_SOURCE).toContain("variant === 'floating'");
        expect(CHAT_DETAIL_SOURCE).toContain("p-2");
    });

    it('hides back button when variant is floating', () => {
        expect(CHAT_DETAIL_SOURCE).toContain("variant !== 'floating'");
    });
});

// ── ActivityChatDetail: float button ─────────────────────────────────────────

describe('ActivityChatDetail: float button', () => {
    it('renders float button with correct data-testid', () => {
        expect(CHAT_DETAIL_SOURCE).toContain('data-testid="activity-chat-float-btn"');
    });

    it('hides float button when variant is floating', () => {
        expect(CHAT_DETAIL_SOURCE).toContain("variant !== 'floating'");
    });

    it('hides float button on mobile', () => {
        expect(CHAT_DETAIL_SOURCE).toContain('!isMobile');
    });

    it('hides float button when already floating', () => {
        expect(CHAT_DETAIL_SOURCE).toContain('!isFloating(taskId)');
    });

    it('hides float button when isPopOut is true', () => {
        expect(CHAT_DETAIL_SOURCE).toContain('!isPopOut');
    });

    it('uses useFloatingChats context', () => {
        expect(CHAT_DETAIL_SOURCE).toContain('useFloatingChats');
    });

    it('calls floatChat on click', () => {
        expect(CHAT_DETAIL_SOURCE).toContain('floatChat(');
    });

    it('passes taskId, workspaceId, title and status to floatChat', () => {
        expect(CHAT_DETAIL_SOURCE).toContain('taskId,');
        expect(CHAT_DETAIL_SOURCE).toContain('workspaceId,');
        expect(CHAT_DETAIL_SOURCE).toContain('title:');
        expect(CHAT_DETAIL_SOURCE).toContain('status:');
    });

    it('derives title from task payload prompt', () => {
        expect(CHAT_DETAIL_SOURCE).toContain("task?.payload?.prompt");
    });
});

// ── ActivityDetailPane: floating placeholder ──────────────────────────────────

describe('ActivityDetailPane: floating placeholder', () => {
    it('imports useFloatingChats', () => {
        expect(DETAIL_PANE_SOURCE).toContain("import { useFloatingChats }");
    });

    it('uses floatingChats from context', () => {
        expect(DETAIL_PANE_SOURCE).toContain('floatingChats');
    });

    it('checks if selected task is floating', () => {
        expect(DETAIL_PANE_SOURCE).toContain('floatingChats.has(selectedTaskId)');
    });

    it('renders floating placeholder with data-testid', () => {
        expect(DETAIL_PANE_SOURCE).toContain('data-testid="activity-floating-placeholder"');
    });

    it('renders restore inline button with data-testid', () => {
        expect(DETAIL_PANE_SOURCE).toContain('data-testid="activity-chat-restore-inline-btn"');
    });

    it('calls unfloatChat on restore button click', () => {
        expect(DETAIL_PANE_SOURCE).toContain('unfloatChat(selectedTaskId)');
    });

    it('shows "Chat is floating" message', () => {
        expect(DETAIL_PANE_SOURCE).toContain('Chat is floating');
    });
});

// ── FloatingChatsContext: structure ───────────────────────────────────────────

describe('FloatingChatsContext: structure', () => {
    it('exports FloatingChatsProvider', () => {
        expect(FLOATING_CONTEXT_SOURCE).toContain('export function FloatingChatsProvider');
    });

    it('exports useFloatingChats hook', () => {
        expect(FLOATING_CONTEXT_SOURCE).toContain('export function useFloatingChats');
    });

    it('exports FloatingChatEntry interface', () => {
        expect(FLOATING_CONTEXT_SOURCE).toContain('export interface FloatingChatEntry');
    });

    it('exports FloatingChatsContextValue interface', () => {
        expect(FLOATING_CONTEXT_SOURCE).toContain('export interface FloatingChatsContextValue');
    });

    it('tracks floatingChats as a Map', () => {
        expect(FLOATING_CONTEXT_SOURCE).toContain('Map<string, FloatingChatEntry>');
    });

    it('exposes floatChat method', () => {
        expect(FLOATING_CONTEXT_SOURCE).toContain('floatChat(');
    });

    it('exposes unfloatChat method', () => {
        expect(FLOATING_CONTEXT_SOURCE).toContain('unfloatChat(');
    });

    it('exposes isFloating method', () => {
        expect(FLOATING_CONTEXT_SOURCE).toContain('isFloating(');
    });

    it('FloatingChatEntry has required fields', () => {
        expect(FLOATING_CONTEXT_SOURCE).toContain('taskId: string');
        expect(FLOATING_CONTEXT_SOURCE).toContain('title: string');
        expect(FLOATING_CONTEXT_SOURCE).toContain('status: string');
    });
});

// ── FloatingChatManager: structure ───────────────────────────────────────────

describe('FloatingChatManager: structure', () => {
    it('exports FloatingChatManager component', () => {
        expect(FLOATING_MANAGER_SOURCE).toContain('export function FloatingChatManager');
    });

    it('uses useFloatingChats', () => {
        expect(FLOATING_MANAGER_SOURCE).toContain('useFloatingChats');
    });

    it('renders FloatingDialog for each entry', () => {
        expect(FLOATING_MANAGER_SOURCE).toContain('<FloatingDialog');
    });

    it('uses useMinimizedDialog for tray integration', () => {
        expect(FLOATING_MANAGER_SOURCE).toContain('useMinimizedDialog');
    });

    it('handles minimize by returning null', () => {
        expect(FLOATING_MANAGER_SOURCE).toContain('if (minimized) return null');
    });

    it('calls unfloatChat on close', () => {
        expect(FLOATING_MANAGER_SOURCE).toContain('unfloatChat(');
    });

    it('sets noPadding on FloatingDialog', () => {
        expect(FLOATING_MANAGER_SOURCE).toContain('noPadding');
    });

    it('uses resizable FloatingDialog', () => {
        expect(FLOATING_MANAGER_SOURCE).toContain('resizable');
    });
});

// ── FloatingChatContent: structure ───────────────────────────────────────────

describe('FloatingChatContent: structure', () => {
    it('exports FloatingChatContent component', () => {
        expect(FLOATING_CONTENT_SOURCE).toContain('export function FloatingChatContent');
    });

    it('renders ActivityChatDetail', () => {
        expect(FLOATING_CONTENT_SOURCE).toContain('<ActivityChatDetail');
    });

    it('passes variant="floating" to ActivityChatDetail', () => {
        expect(FLOATING_CONTENT_SOURCE).toContain('variant="floating"');
    });

    it('passes taskId and workspaceId', () => {
        expect(FLOATING_CONTENT_SOURCE).toContain('taskId={taskId}');
        expect(FLOATING_CONTENT_SOURCE).toContain('workspaceId={workspaceId}');
    });
});
