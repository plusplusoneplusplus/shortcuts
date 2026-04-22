/**
 * Tests for mobile-first chat/workspace navigation:
 * - Hamburger/menu icon in ChatHeader on mobile (replaces "← Back")
 * - Floating action button (FAB) in ChatListPane on mobile
 * - ProcessesView passes onNewChat for FAB support
 */

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import * as fs from 'fs';
import * as path from 'path';
import { mockViewport } from '../../helpers/viewport-mock';

const REACT_SRC = path.join(__dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react');
const CHAT_HEADER_SRC = path.join(REACT_SRC, 'features', 'chat', 'ChatHeader.tsx');
const ACTIVITY_LIST_PANE_SRC = path.join(REACT_SRC, 'features', 'chat', 'ChatListPane.tsx');
const PROCESSES_VIEW_SRC = path.join(REACT_SRC, 'processes', 'ProcessesView.tsx');
const TAILWIND_CSS_SRC = path.join(__dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'tailwind.css');

// ---------------------------------------------------------------------------
// Source-code inspection tests (structural verification)
// ---------------------------------------------------------------------------

describe('ChatHeader — mobile back navigation (source)', () => {
    let src: string;

    beforeAll(() => {
        src = fs.readFileSync(CHAT_HEADER_SRC, 'utf-8');
    });

    it('uses useBreakpoint to detect mobile', () => {
        expect(src).toContain("useBreakpoint()");
        expect(src).toContain('isMobile');
    });

    it('renders back button with "← Back" text', () => {
        expect(src).toContain('← Back');
    });

    it('keeps the same data-testid for backward compatibility', () => {
        expect(src).toContain('data-testid="activity-chat-back-btn"');
    });

    it('applies text-colored styling matching nav links on mobile', () => {
        expect(src).toContain('text-[#0078d4]');
    });
});

describe('ChatListPane — mobile FAB (source)', () => {
    let src: string;

    beforeAll(() => {
        src = fs.readFileSync(ACTIVITY_LIST_PANE_SRC, 'utf-8');
    });

    it('renders FAB only when isMobile and onNewChat are both truthy', () => {
        expect(src).toContain('{isMobile && onNewChat && (');
    });

    it('uses the mobile-fab CSS class', () => {
        expect(src).toContain('className="mobile-fab"');
    });

    it('has data-testid for the FAB', () => {
        expect(src).toContain('data-testid="mobile-new-chat-fab"');
    });

    it('has accessible aria-label on the FAB', () => {
        expect(src).toContain('aria-label="New chat"');
    });

    it('FAB click calls onNewChat', () => {
        expect(src).toContain('onClick={onNewChat}');
    });

    it('wraps content in a scrollable container', () => {
        expect(src).toContain('overflow');
    });

    it('renders a "+" icon SVG inside the FAB', () => {
        // Plus icon: vertical + horizontal lines
        expect(src).toContain('M12 5v14M5 12h14');
    });
});

describe('ProcessesView — queue task selection (source)', () => {
    let src: string;

    beforeAll(() => {
        src = fs.readFileSync(PROCESSES_VIEW_SRC, 'utf-8');
    });

    it('supports SELECT_QUEUE_TASK dispatch with null id', () => {
        expect(src).toContain("type: 'SELECT_QUEUE_TASK', id: null");
    });
});

describe('tailwind.css — mobile-fab utility class (source)', () => {
    let src: string;

    beforeAll(() => {
        src = fs.readFileSync(TAILWIND_CSS_SRC, 'utf-8');
    });

    it('defines .mobile-fab class', () => {
        expect(src).toContain('.mobile-fab');
    });

    it('uses position fixed', () => {
        const fabSection = src.slice(src.indexOf('.mobile-fab'), src.indexOf('.mobile-fab:hover'));
        expect(fabSection).toContain('position: fixed');
    });

    it('sets bottom and right offsets', () => {
        const fabSection = src.slice(src.indexOf('.mobile-fab'), src.indexOf('.mobile-fab:hover'));
        expect(fabSection).toContain('bottom: 1rem');
        expect(fabSection).toContain('right: 1rem');
    });

    it('uses accent color background', () => {
        const fabSection = src.slice(src.indexOf('.mobile-fab'), src.indexOf('.mobile-fab:hover'));
        expect(fabSection).toContain('background-color: #0078d4');
    });

    it('has minimum 44px touch target', () => {
        const fabSection = src.slice(src.indexOf('.mobile-fab'), src.indexOf('.mobile-fab:hover'));
        expect(fabSection).toContain('min-width: 44px');
    });

    it('is fully rounded', () => {
        const fabSection = src.slice(src.indexOf('.mobile-fab'), src.indexOf('.mobile-fab:hover'));
        expect(fabSection).toContain('border-radius: 9999px');
    });

    it('has shadow for elevation', () => {
        const fabSection = src.slice(src.indexOf('.mobile-fab'), src.indexOf('.mobile-fab:hover'));
        expect(fabSection).toContain('box-shadow');
    });
});

// ---------------------------------------------------------------------------
// Rendering tests (interactive behavior verification)
// ---------------------------------------------------------------------------

// Mock contexts that ChatHeader depends on
vi.mock('../../../../src/server/spa/client/react/contexts/FloatingChatsContext', () => ({
    useFloatingChats: () => ({
        isFloating: () => false,
        floatingChats: new Set(),
        floatChat: vi.fn(),
        unfloatChat: vi.fn(),
    }),
}));

vi.mock('../../../../src/server/spa/client/react/contexts/QueueContext', () => ({
    useQueue: () => ({ state: {}, dispatch: vi.fn() }),
}));

vi.mock('../../../../src/server/spa/client/react/contexts/AppContext', () => ({
    useApp: () => ({
        state: { myWorkExcludedTypes: [], preferencesLoaded: true },
        dispatch: vi.fn(),
    }),
}));

// Mock heavy ChatHeader dependencies to prevent timeout during dynamic import
vi.mock('../../../../src/server/spa/client/react/features/chat/hooks/useContainerWidth', () => ({
    useContainerWidth: () => 800,
}));

vi.mock('../../../../src/server/spa/client/react/ui/ReferencesDropdown', () => ({
    ReferencesDropdown: () => null,
    ReferenceList: () => null,
}));

vi.mock('../../../../src/server/spa/client/react/ui/BottomSheet', () => ({
    BottomSheet: () => null,
}));

vi.mock('../../../../src/server/spa/client/react/features/chat/conversation/ConversationMetadataPopover', () => ({
    ConversationMetadataPopover: () => null,
}));

vi.mock('../../../../src/server/spa/client/react/ui/ContextWindowIndicator', () => ({
    ContextWindowIndicator: () => null,
}));

vi.mock('../../../../src/server/spa/client/react/utils/format', () => ({
    copyToClipboard: vi.fn().mockResolvedValue(undefined),
    copyHtmlToClipboard: vi.fn().mockResolvedValue(undefined),
    formatConversationAsText: vi.fn().mockReturnValue('text'),
    formatConversationAsHtml: vi.fn().mockReturnValue('<html>'),
    formatDuration: (ms: number) => `${ms}ms`,
    statusIcon: (s: string) => s === 'completed' ? '✅' : '⏳',
    statusLabel: (s: string) => s,
}));

vi.mock('../../../../src/server/spa/client/react/features/chat/conversation/ConversationTurnBubble', () => ({
    chatMarkdownToHtml: vi.fn().mockReturnValue('<p>html</p>'),
}));

vi.mock('../../../../src/server/spa/client/react/ui/cn', () => ({
    cn: (...args: any[]) => args.filter(Boolean).join(' '),
}));

vi.mock('../../../../src/server/spa/client/react/features/chat/ChatHeaderOverflowMenu', () => ({
    ChatHeaderOverflowMenu: () => null,
}));

describe('ChatListPane — mobile FAB rendering', () => {
    let cleanup: (() => void) | undefined;

    afterEach(() => {
        cleanup?.();
        cleanup = undefined;
    });

    function makeListPaneProps(overrides: Record<string, any> = {}) {
        return {
            running: [],
            queued: [],
            history: [],
            isPaused: false,
            isPauseResumeLoading: false,
            isRefreshing: false,
            selectedTaskId: null,
            isMobile: false,
            now: Date.now(),
            activeTab: 'chats' as const,
            onTabChange: vi.fn(),
            onSelectTask: vi.fn(),
            onPauseResume: vi.fn(),
            onRefresh: vi.fn(),
            onOpenDialog: vi.fn(),
            onNewChat: vi.fn(),
            fetchQueue: vi.fn().mockResolvedValue(undefined),
            ...overrides,
        };
    }

    async function renderWithProviders(props: Record<string, any>) {
        const { ChatListPane } = await import('../../../../src/server/spa/client/react/features/chat/ChatListPane');
        const { ChatPreferencesProvider } = await import('../../../../src/server/spa/client/react/contexts/ChatPreferencesContext');
        return render(
            <ChatPreferencesProvider workspaceId="test-ws">
                <ChatListPane {...makeListPaneProps(props)} />
            </ChatPreferencesProvider>
        );
    }

    it('does not render FAB when isMobile=false', async () => {
        cleanup = mockViewport(1280);
        await renderWithProviders({ isMobile: false });

        expect(screen.queryByTestId('mobile-new-chat-fab')).toBeNull();
    });

    it('does not render FAB when onNewChat is not provided', async () => {
        cleanup = mockViewport(375);
        await renderWithProviders({ isMobile: true, onNewChat: undefined });

        expect(screen.queryByTestId('mobile-new-chat-fab')).toBeNull();
    });
});
