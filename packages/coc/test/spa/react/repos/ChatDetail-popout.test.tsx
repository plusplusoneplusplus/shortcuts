/**
 * Render tests for pop-out button visibility (ChatHeader), pop-out placeholder
 * (ChatDetailPane), and the handlePopOut hook (useChatWindowActions).
 *
 * Dropped from the previous source-level tests:
 * - PopOutContext structure tests (TypeScript compiler covers exports/interfaces)
 * - BroadcastChannel internals (popout-closed listener, popout-restore message)
 * - URL encoding details (workspace= query param, window name) — covered by E2E
 */
/* @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { renderHook, act } from '@testing-library/react';
import React, { type ReactNode } from 'react';

// ── Hoisted mock state (available to vi.mock factories) ───────────────────────

const {
    mockBreakpoint,
    mockMarkPoppedOut, mockMarkRestored, mockPoppedOutTasks,
    mockFloatChat, mockUnfloatChat, mockFloatingChats,
    mockAddToast,
} = vi.hoisted(() => ({
    mockBreakpoint: { isMobile: false, isTablet: false, isDesktop: true },
    mockMarkPoppedOut: vi.fn(),
    mockMarkRestored: vi.fn(),
    mockPoppedOutTasks: new Set<string>(),
    mockFloatChat: vi.fn(),
    mockUnfloatChat: vi.fn(),
    mockFloatingChats: new Map<string, any>(),
    mockAddToast: vi.fn(),
}));

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../../../../src/server/spa/client/react/hooks/useBreakpoint', () => ({
    useBreakpoint: () => mockBreakpoint,
}));

vi.mock('../../../../src/server/spa/client/react/hooks/useContainerWidth', () => ({
    useContainerWidth: () => ({ width: 800, tier: 'wide', isWide: true, isMedium: false, isNarrow: false }),
}));

vi.mock('../../../../src/server/spa/client/react/context/PopOutContext', () => ({
    usePopOut: () => ({
        poppedOutTasks: mockPoppedOutTasks,
        markPoppedOut: mockMarkPoppedOut,
        markRestored: mockMarkRestored,
        postMessage: vi.fn(),
    }),
}));

vi.mock('../../../../src/server/spa/client/react/context/FloatingChatsContext', () => ({
    useFloatingChats: () => ({
        floatingChats: mockFloatingChats,
        floatChat: mockFloatChat,
        unfloatChat: mockUnfloatChat,
        isFloating: (id: string) => mockFloatingChats.has(id),
    }),
}));

vi.mock('../../../../src/server/spa/client/react/context/ToastContext', () => ({
    ToastContext: React.createContext({ addToast: mockAddToast, removeToast: vi.fn(), toasts: [] }),
    ToastProvider: ({ children }: any) => children,
}));

// Mock child components for ChatDetailPane
vi.mock('../../../../src/server/spa/client/react/repos/ChatDetail', () => ({
    ChatDetail: (props: any) =>
        React.createElement('div', { 'data-testid': 'activity-chat-detail' }, `task=${props.taskId}`),
}));
vi.mock('../../../../src/server/spa/client/react/repos/NewChatArea', () => ({
    NewChatArea: () => React.createElement('div', { 'data-testid': 'new-chat-area' }),
}));

// Mock heavy ChatHeader dependencies
vi.mock('../../../../src/server/spa/client/react/shared', () => ({
    Badge: ({ children }: any) => React.createElement('span', null, children),
    Button: ({ children, onClick }: any) => React.createElement('button', { onClick }, children),
}));
vi.mock('../../../../src/server/spa/client/react/shared/ReferencesDropdown', () => ({
    deduplicateReferenceFiles: (_planPath: any, files: any) => files ?? [],
    normalizeRefPath: (p: string) => p,
    ReferencesDropdown: () => null,
    ReferenceList: () => null,
}));
vi.mock('../../../../src/server/spa/client/react/shared/BottomSheet', () => ({
    BottomSheet: () => null,
}));
vi.mock('../../../../src/server/spa/client/react/chat/ConversationMetadataPopover', () => ({
    ConversationMetadataPopover: () => null,
}));
vi.mock('../../../../src/server/spa/client/react/shared/ContextWindowIndicator', () => ({
    ContextWindowIndicator: () => null,
}));
vi.mock('../../../../src/server/spa/client/react/utils/format', () => ({
    copyToClipboard: vi.fn().mockResolvedValue(undefined),
    copyHtmlToClipboard: vi.fn().mockResolvedValue(undefined),
    formatConversationAsText: vi.fn().mockReturnValue(''),
    formatConversationAsHtml: vi.fn().mockReturnValue(''),
    formatDuration: vi.fn().mockReturnValue('0s'),
    statusIcon: vi.fn().mockReturnValue(''),
    statusLabel: vi.fn().mockReturnValue(''),
}));
vi.mock('../../../../src/server/spa/client/react/chat/ConversationTurnBubble', () => ({
    chatMarkdownToHtml: vi.fn().mockReturnValue(''),
}));
vi.mock('../../../../src/server/spa/client/react/shared/cn', () => ({
    cn: (...args: any[]) => args.filter(Boolean).join(' '),
}));

// Imports (after mocks)
import { ChatHeader, type ChatHeaderProps } from '../../../../src/server/spa/client/react/repos/ChatHeader';
import { ChatDetailPane } from '../../../../src/server/spa/client/react/repos/ChatDetailPane';
import { useChatWindowActions } from '../../../../src/server/spa/client/react/hooks/useChatWindowActions';

// ── Helpers ───────────────────────────────────────────────────────────────────

function defaultHeaderProps(overrides: Partial<ChatHeaderProps> = {}): ChatHeaderProps {
    return {
        task: { status: 'completed' },
        metadataProcess: null,
        planPath: '',
        createdFiles: [],
        pinnedFile: undefined,
        variant: 'inline',
        isPopOut: false,
        loading: false,
        turns: [],
        resumeLaunching: false,
        resumeSessionId: null,
        isPending: false,
        sessionTokenLimit: undefined,
        sessionCurrentTokens: undefined,
        sessionModel: undefined,
        copied: false,
        setCopied: vi.fn(),
        taskId: 'task-1',
        onLaunchInteractiveResume: vi.fn(),
        onPopOut: vi.fn(),
        onFloat: vi.fn(),
        ...overrides,
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    mockPoppedOutTasks.clear();
    mockFloatingChats.clear();
    mockBreakpoint.isMobile = false;
    mockBreakpoint.isDesktop = true;
});

// ── ChatHeader: pop-out button visibility ─────────────────────────────────────

describe('ChatHeader: pop-out button', () => {
    it('renders pop-out button with data-testid', () => {
        render(<ChatHeader {...defaultHeaderProps()} />);
        expect(screen.getByTestId('activity-chat-popout-btn')).toBeTruthy();
    });

    it('hides pop-out button when isPopOut is true', () => {
        render(<ChatHeader {...defaultHeaderProps({ isPopOut: true })} />);
        expect(screen.queryByTestId('activity-chat-popout-btn')).toBeNull();
    });

    it('hides pop-out button on mobile', () => {
        mockBreakpoint.isMobile = true;
        render(<ChatHeader {...defaultHeaderProps()} />);
        expect(screen.queryByTestId('activity-chat-popout-btn')).toBeNull();
    });

    it('hides pop-out button when variant is floating', () => {
        render(<ChatHeader {...defaultHeaderProps({ variant: 'floating' })} />);
        expect(screen.queryByTestId('activity-chat-popout-btn')).toBeNull();
    });

    it('calls onPopOut callback when clicked', () => {
        const onPopOut = vi.fn();
        render(<ChatHeader {...defaultHeaderProps({ onPopOut })} />);
        fireEvent.click(screen.getByTestId('activity-chat-popout-btn'));
        expect(onPopOut).toHaveBeenCalledOnce();
    });
});

// ── ChatDetailPane: pop-out placeholder ───────────────────────────────────

describe('ChatDetailPane: pop-out placeholder', () => {
    it('renders placeholder when task is popped out', () => {
        mockPoppedOutTasks.add('task-1');
        render(<ChatDetailPane selectedTaskId="task-1" selectedTask={{}} workspaceId="ws-1" />);
        expect(screen.getByTestId('activity-popped-out-placeholder')).toBeTruthy();
    });

    it('shows "Chat is open in a separate window" message', () => {
        mockPoppedOutTasks.add('task-1');
        render(<ChatDetailPane selectedTaskId="task-1" selectedTask={{}} workspaceId="ws-1" />);
        expect(screen.getByText('Chat is open in a separate window')).toBeTruthy();
    });

    it('renders restore button with correct data-testid', () => {
        mockPoppedOutTasks.add('task-1');
        render(<ChatDetailPane selectedTaskId="task-1" selectedTask={{}} workspaceId="ws-1" />);
        expect(screen.getByTestId('activity-chat-restore-btn')).toBeTruthy();
    });

    it('calls markRestored when restore button is clicked', () => {
        mockPoppedOutTasks.add('task-1');
        render(<ChatDetailPane selectedTaskId="task-1" selectedTask={{}} workspaceId="ws-1" />);
        fireEvent.click(screen.getByTestId('activity-chat-restore-btn'));
        expect(mockMarkRestored).toHaveBeenCalledWith('task-1');
    });

    it('renders ChatDetail when task is not popped out', () => {
        render(<ChatDetailPane selectedTaskId="task-1" selectedTask={{}} workspaceId="ws-1" />);
        expect(screen.getByTestId('activity-chat-detail')).toBeTruthy();
        expect(screen.queryByTestId('activity-popped-out-placeholder')).toBeNull();
    });
});

// ── useChatWindowActions: handlePopOut ─────────────────────────────────────────

describe('useChatWindowActions: handlePopOut', () => {
    it('calls window.open with popout URL containing task ID', () => {
        const openSpy = vi.spyOn(window, 'open').mockReturnValue({} as Window);
        const { result } = renderHook(() =>
            useChatWindowActions({ task: {}, taskId: 'task-42', workspaceId: 'ws-1' }),
        );
        act(() => result.current.handlePopOut());
        expect(openSpy).toHaveBeenCalledOnce();
        const url = openSpy.mock.calls[0][0] as string;
        expect(url).toContain('#popout/activity/task-42');
        openSpy.mockRestore();
    });

    it('marks task as popped out after successful window.open', () => {
        const openSpy = vi.spyOn(window, 'open').mockReturnValue({} as Window);
        const { result } = renderHook(() =>
            useChatWindowActions({ task: {}, taskId: 'task-42', workspaceId: 'ws-1' }),
        );
        act(() => result.current.handlePopOut());
        expect(mockMarkPoppedOut).toHaveBeenCalledWith('task-42');
        openSpy.mockRestore();
    });

    it('shows toast when popup is blocked', () => {
        const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
        const { result } = renderHook(() =>
            useChatWindowActions({ task: {}, taskId: 'task-42', workspaceId: 'ws-1' }),
        );
        act(() => result.current.handlePopOut());
        expect(mockAddToast).toHaveBeenCalledWith(expect.stringContaining('blocked'), 'error');
        expect(mockMarkPoppedOut).not.toHaveBeenCalled();
        openSpy.mockRestore();
    });
});
