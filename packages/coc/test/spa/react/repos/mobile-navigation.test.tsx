/**
 * Tests for mobile-first chat/workspace navigation:
 * - Hamburger/menu icon in ChatHeader on mobile (replaces "← Back")
 * - Floating action button (FAB) in ChatListPane on mobile
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { mockViewport } from '../../helpers/viewport-mock';

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
