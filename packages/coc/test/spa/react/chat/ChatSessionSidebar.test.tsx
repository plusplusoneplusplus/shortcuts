/**
 * Tests for ChatSessionSidebar — pinned chat status visibility.
 *
 * Verifies that:
 * - Status icon always appears in the leading slot (both pinned and non-pinned cards)
 * - Pinned cards show the active-pin button in the trailing slot
 * - Non-pinned cards show the hover-pin button (not the active-pin button)
 * - Clicking the active-pin button calls onTogglePin with the correct id
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChatSessionSidebar } from '../../../../src/server/spa/client/react/chat/ChatSessionSidebar';
import type { ChatSessionItem } from '../../../../src/server/spa/client/react/types/dashboard';

// ── Mocks ──────────────────────────────────────────────────────────────

vi.mock('../../../../src/server/spa/client/react/hooks/useBreakpoint', () => ({
    useBreakpoint: () => ({ isMobile: false, isTablet: false, isDesktop: true, breakpoint: 'desktop' }),
}));

vi.mock('../../../../src/server/spa/client/react/tasks/comments/ContextMenu', () => ({
    ContextMenu: () => null,
}));

// ── Helpers ────────────────────────────────────────────────────────────

function makeSession(overrides: Partial<ChatSessionItem> = {}): ChatSessionItem {
    return {
        id: 'session-1',
        title: 'Test Chat',
        firstMessage: 'Hello',
        status: 'running',
        turnCount: 3,
        createdAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
        workspaceId: 'ws-1',
        ...overrides,
    };
}

const defaultProps = {
    workspaceId: 'ws-1',
    sessions: [],
    activeTaskId: null,
    onSelectSession: vi.fn(),
    onNewChat: vi.fn(),
    loading: false,
};

// ── Tests ──────────────────────────────────────────────────────────────

describe('ChatSessionSidebar — pinned card status visibility', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('non-pinned running card: shows 🔄 status icon in leading slot, no active-pin button', () => {
        const session = makeSession({ id: 'sess-1', status: 'running' });
        render(
            <ChatSessionSidebar
                {...defaultProps}
                sessions={[session]}
                pinnedIds={[]}
                onTogglePin={vi.fn()}
            />
        );

        // Status icon visible
        expect(screen.getByText('🔄')).toBeTruthy();
        // Active pin button not present
        expect(screen.queryByTestId('pin-icon-active')).toBeNull();
        // Hover pin button present (desktop: hidden via CSS but in DOM)
        expect(screen.getByTestId('pin-icon-hover')).toBeTruthy();
    });

    it('pinned running card: shows 🔄 status icon AND trailing active-pin button', () => {
        const session = makeSession({ id: 'sess-1', status: 'running' });
        render(
            <ChatSessionSidebar
                {...defaultProps}
                sessions={[session]}
                pinnedIds={['sess-1']}
                onTogglePin={vi.fn()}
            />
        );

        // Status icon visible
        expect(screen.getByText('🔄')).toBeTruthy();
        // Active pin button visible in trailing slot
        expect(screen.getByTestId('pin-icon-active')).toBeTruthy();
        // Hover pin button not present for pinned card
        expect(screen.queryByTestId('pin-icon-hover')).toBeNull();
    });

    it('pinned completed card: shows ✅ status icon AND trailing active-pin button', () => {
        const session = makeSession({ id: 'sess-2', status: 'completed' });
        render(
            <ChatSessionSidebar
                {...defaultProps}
                sessions={[session]}
                pinnedIds={['sess-2']}
                onTogglePin={vi.fn()}
            />
        );

        expect(screen.getByText('✅')).toBeTruthy();
        expect(screen.getByTestId('pin-icon-active')).toBeTruthy();
        expect(screen.queryByTestId('pin-icon-hover')).toBeNull();
    });

    it('non-pinned card: hover-pin button is present in DOM (opacity-0 on desktop)', () => {
        const session = makeSession({ id: 'sess-3', status: 'completed' });
        render(
            <ChatSessionSidebar
                {...defaultProps}
                sessions={[session]}
                pinnedIds={[]}
                onTogglePin={vi.fn()}
            />
        );

        const hoverBtn = screen.getByTestId('pin-icon-hover');
        expect(hoverBtn).toBeTruthy();
        // On desktop it has opacity-0 (hidden until hover) via CSS class
        expect(hoverBtn.className).toContain('opacity-0');
    });

    it('clicking trailing active-pin button on pinned card calls onTogglePin with session id', () => {
        const onTogglePin = vi.fn();
        const session = makeSession({ id: 'sess-pin', status: 'running' });
        render(
            <ChatSessionSidebar
                {...defaultProps}
                sessions={[session]}
                pinnedIds={['sess-pin']}
                onTogglePin={onTogglePin}
            />
        );

        const pinBtn = screen.getByTestId('pin-icon-active');
        fireEvent.click(pinBtn);
        expect(onTogglePin).toHaveBeenCalledTimes(1);
        expect(onTogglePin).toHaveBeenCalledWith('sess-pin');
    });
});
