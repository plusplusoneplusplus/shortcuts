/**
 * Render tests for float button visibility (ChatHeader), floating placeholder
 * (ActivityDetailPane), handleFloat hook, FloatingChatManager, and FloatingChatContent.
 *
 * Dropped from the previous source-level tests:
 * - FloatingChatsContext structure tests (TypeScript compiler covers exports/interfaces)
 * - FloatingChatManager internal layout (80vh/60vh height, nesting order assertions)
 * - Minimize-returns-null — internal layout detail, covered by E2E
 * - variant prop type checks — TypeScript covers these
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

// Mock child components for ActivityDetailPane
vi.mock('../../../../src/server/spa/client/react/repos/ActivityChatDetail', () => ({
    ActivityChatDetail: (props: any) =>
        React.createElement('div', {
            'data-testid': 'activity-chat-detail',
            'data-variant': props.variant,
            'data-task-id': props.taskId,
            'data-workspace-id': props.workspaceId,
        }, `task=${props.taskId} variant=${props.variant ?? 'inline'}`),
}));
vi.mock('../../../../src/server/spa/client/react/repos/NewChatArea', () => ({
    NewChatArea: () => React.createElement('div', { 'data-testid': 'new-chat-area' }),
}));

// Mock heavy ChatHeader dependencies
vi.mock('../../../../src/server/spa/client/react/shared', () => ({
    Badge: ({ children }: any) => React.createElement('span', null, children),
    Button: ({ children, onClick }: any) => React.createElement('button', { onClick }, children),
    Spinner: ({ size }: any) => React.createElement('span', { 'data-testid': 'spinner', 'data-size': size }),
}));
vi.mock('../../../../src/server/spa/client/react/shared/ReferencesDropdown', () => ({
    ReferencesDropdown: () => null,
}));
vi.mock('../../../../src/server/spa/client/react/processes/ConversationMetadataPopover', () => ({
    ConversationMetadataPopover: () => null,
}));
vi.mock('../../../../src/server/spa/client/react/components/ContextWindowIndicator', () => ({
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
vi.mock('../../../../src/server/spa/client/react/processes/ConversationTurnBubble', () => ({
    chatMarkdownToHtml: vi.fn().mockReturnValue(''),
}));
vi.mock('../../../../src/server/spa/client/react/shared/cn', () => ({
    cn: (...args: any[]) => args.filter(Boolean).join(' '),
}));

// FloatingChatManager dependencies
vi.mock('../../../../src/server/spa/client/react/shared/FloatingDialog', () => ({
    FloatingDialog: ({ children, title, onClose, noPadding, id }: any) =>
        React.createElement('div', {
            'data-testid': `floating-dialog-${id ?? 'unknown'}`,
            'data-title': title,
            'data-no-padding': noPadding ? 'true' : 'false',
        },
            React.createElement('button', {
                'data-testid': `close-btn-${id ?? 'unknown'}`,
                onClick: onClose,
            }, 'Close'),
            children,
        ),
}));
vi.mock('../../../../src/server/spa/client/react/context/MinimizedDialogsContext', () => ({
    useMinimizedDialog: vi.fn(),
}));
vi.mock('../../../../src/server/spa/client/react/context/AppContext', () => ({
    useApp: () => ({
        state: {
            workspaces: [
                { id: 'ws-1', name: 'my-repo' },
                { id: 'ws-2', name: 'other-repo' },
            ],
        },
        dispatch: vi.fn(),
    }),
    AppProvider: ({ children }: any) => children,
}));
vi.mock('../../../../src/server/spa/client/react/context/ChatPreferencesContext', () => ({
    ChatPreferencesProvider: ({ children, workspaceId }: any) =>
        React.createElement('div', {
            'data-testid': 'chat-prefs-provider',
            'data-workspace-id': workspaceId,
        }, children),
}));

// Imports (after mocks)
import { ChatHeader, type ChatHeaderProps } from '../../../../src/server/spa/client/react/repos/ChatHeader';
import { ActivityDetailPane } from '../../../../src/server/spa/client/react/repos/ActivityDetailPane';
import { useChatWindowActions } from '../../../../src/server/spa/client/react/hooks/useChatWindowActions';
import { FloatingChatManager } from '../../../../src/server/spa/client/react/layout/FloatingChatManager';
import { FloatingChatContent } from '../../../../src/server/spa/client/react/repos/FloatingChatContent';

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

// ── ChatHeader: float button visibility ───────────────────────────────────────

describe('ChatHeader: float button', () => {
    it('renders float button with data-testid', () => {
        render(<ChatHeader {...defaultHeaderProps()} />);
        expect(screen.getByTestId('activity-chat-float-btn')).toBeTruthy();
    });

    it('hides float button when variant is floating', () => {
        render(<ChatHeader {...defaultHeaderProps({ variant: 'floating' })} />);
        expect(screen.queryByTestId('activity-chat-float-btn')).toBeNull();
    });

    it('hides float button on mobile', () => {
        mockBreakpoint.isMobile = true;
        render(<ChatHeader {...defaultHeaderProps()} />);
        expect(screen.queryByTestId('activity-chat-float-btn')).toBeNull();
    });

    it('hides float button when already floating', () => {
        mockFloatingChats.set('task-1', { taskId: 'task-1', title: 'Chat', status: 'running' });
        render(<ChatHeader {...defaultHeaderProps()} />);
        expect(screen.queryByTestId('activity-chat-float-btn')).toBeNull();
    });

    it('hides float button when isPopOut is true', () => {
        render(<ChatHeader {...defaultHeaderProps({ isPopOut: true })} />);
        expect(screen.queryByTestId('activity-chat-float-btn')).toBeNull();
    });

    it('calls onFloat callback when clicked', () => {
        const onFloat = vi.fn();
        render(<ChatHeader {...defaultHeaderProps({ onFloat })} />);
        fireEvent.click(screen.getByTestId('activity-chat-float-btn'));
        expect(onFloat).toHaveBeenCalledOnce();
    });
});

// ── ActivityDetailPane: floating placeholder ──────────────────────────────────

describe('ActivityDetailPane: floating placeholder', () => {
    it('renders floating placeholder when task is floating', () => {
        mockFloatingChats.set('task-1', { taskId: 'task-1', title: 'Chat', status: 'running' });
        render(<ActivityDetailPane selectedTaskId="task-1" selectedTask={{}} workspaceId="ws-1" />);
        expect(screen.getByTestId('activity-floating-placeholder')).toBeTruthy();
    });

    it('shows "Chat is floating" message', () => {
        mockFloatingChats.set('task-1', { taskId: 'task-1', title: 'Chat', status: 'running' });
        render(<ActivityDetailPane selectedTaskId="task-1" selectedTask={{}} workspaceId="ws-1" />);
        expect(screen.getByText('Chat is floating')).toBeTruthy();
    });

    it('renders restore inline button with data-testid', () => {
        mockFloatingChats.set('task-1', { taskId: 'task-1', title: 'Chat', status: 'running' });
        render(<ActivityDetailPane selectedTaskId="task-1" selectedTask={{}} workspaceId="ws-1" />);
        expect(screen.getByTestId('activity-chat-restore-inline-btn')).toBeTruthy();
    });

    it('calls unfloatChat when restore inline button is clicked', () => {
        mockFloatingChats.set('task-1', { taskId: 'task-1', title: 'Chat', status: 'running' });
        render(<ActivityDetailPane selectedTaskId="task-1" selectedTask={{}} workspaceId="ws-1" />);
        fireEvent.click(screen.getByTestId('activity-chat-restore-inline-btn'));
        expect(mockUnfloatChat).toHaveBeenCalledWith('task-1');
    });

    it('renders ActivityChatDetail when task is not floating', () => {
        render(<ActivityDetailPane selectedTaskId="task-1" selectedTask={{}} workspaceId="ws-1" />);
        expect(screen.getByTestId('activity-chat-detail')).toBeTruthy();
        expect(screen.queryByTestId('activity-floating-placeholder')).toBeNull();
    });
});

// ── useChatWindowActions: handleFloat ─────────────────────────────────────────

describe('useChatWindowActions: handleFloat', () => {
    it('calls floatChat with correct args', () => {
        const task = { status: 'running', payload: { prompt: 'Help me fix the bug' } };
        const { result } = renderHook(() =>
            useChatWindowActions({ task, taskId: 'task-42', workspaceId: 'ws-1' }),
        );
        act(() => result.current.handleFloat());
        expect(mockFloatChat).toHaveBeenCalledWith({
            taskId: 'task-42',
            workspaceId: 'ws-1',
            title: 'Help me fix the bug',
            status: 'running',
        });
    });

    it('truncates title to 60 chars', () => {
        const longPrompt = 'A'.repeat(100);
        const task = { status: 'running', payload: { prompt: longPrompt } };
        const { result } = renderHook(() =>
            useChatWindowActions({ task, taskId: 'task-42', workspaceId: 'ws-1' }),
        );
        act(() => result.current.handleFloat());
        const calledTitle = mockFloatChat.mock.calls[0][0].title;
        expect(calledTitle).toHaveLength(60);
    });

    it('defaults title to "Chat" when task has no prompt', () => {
        const task = { status: 'completed' };
        const { result } = renderHook(() =>
            useChatWindowActions({ task, taskId: 'task-42' }),
        );
        act(() => result.current.handleFloat());
        expect(mockFloatChat).toHaveBeenCalledWith(
            expect.objectContaining({ title: 'Chat' }),
        );
    });
});

// ── FloatingChatManager ───────────────────────────────────────────────────────

describe('FloatingChatManager', () => {
    it('renders nothing when no floating chats', () => {
        const { container } = render(<FloatingChatManager />);
        expect(container.innerHTML).toBe('');
    });

    it('renders a FloatingDialog for each floating entry', () => {
        mockFloatingChats.set('task-1', { taskId: 'task-1', workspaceId: 'ws-1', title: 'Chat A', status: 'running' });
        mockFloatingChats.set('task-2', { taskId: 'task-2', workspaceId: 'ws-2', title: 'Chat B', status: 'completed' });
        render(<FloatingChatManager />);
        expect(screen.getByTestId('floating-dialog-floating-chat-task-1')).toBeTruthy();
        expect(screen.getByTestId('floating-dialog-floating-chat-task-2')).toBeTruthy();
    });

    it('calls unfloatChat when dialog close is triggered', () => {
        mockFloatingChats.set('task-1', { taskId: 'task-1', workspaceId: 'ws-1', title: 'Chat', status: 'running' });
        render(<FloatingChatManager />);
        fireEvent.click(screen.getByTestId('close-btn-floating-chat-task-1'));
        expect(mockUnfloatChat).toHaveBeenCalledWith('task-1');
    });

    it('wraps content with ChatPreferencesProvider', () => {
        mockFloatingChats.set('task-1', { taskId: 'task-1', workspaceId: 'ws-1', title: 'Chat', status: 'running' });
        render(<FloatingChatManager />);
        const provider = screen.getByTestId('chat-prefs-provider');
        expect(provider).toBeTruthy();
        expect(provider.getAttribute('data-workspace-id')).toBe('ws-1');
    });

    it('passes empty string as workspaceId fallback to ChatPreferencesProvider', () => {
        mockFloatingChats.set('task-1', { taskId: 'task-1', title: 'Chat', status: 'running' });
        render(<FloatingChatManager />);
        const provider = screen.getByTestId('chat-prefs-provider');
        expect(provider.getAttribute('data-workspace-id')).toBe('');
    });

    it('sets noPadding on FloatingDialog', () => {
        mockFloatingChats.set('task-1', { taskId: 'task-1', workspaceId: 'ws-1', title: 'Chat', status: 'running' });
        render(<FloatingChatManager />);
        const dialog = screen.getByTestId('floating-dialog-floating-chat-task-1');
        expect(dialog.getAttribute('data-no-padding')).toBe('true');
    });

    it('renders FloatingChatContent inside the dialog', () => {
        mockFloatingChats.set('task-1', { taskId: 'task-1', workspaceId: 'ws-1', title: 'Chat', status: 'running' });
        render(<FloatingChatManager />);
        const detail = screen.getByTestId('activity-chat-detail');
        expect(detail).toBeTruthy();
        expect(detail.getAttribute('data-variant')).toBe('floating');
    });
});

// ── FloatingChatContent ───────────────────────────────────────────────────────

describe('FloatingChatContent', () => {
    it('renders ActivityChatDetail with variant="floating"', () => {
        render(<FloatingChatContent taskId="task-1" workspaceId="ws-1" />);
        const detail = screen.getByTestId('activity-chat-detail');
        expect(detail.getAttribute('data-variant')).toBe('floating');
    });

    it('passes taskId and workspaceId', () => {
        render(<FloatingChatContent taskId="task-99" workspaceId="ws-42" />);
        const detail = screen.getByTestId('activity-chat-detail');
        expect(detail.getAttribute('data-task-id')).toBe('task-99');
        expect(detail.getAttribute('data-workspace-id')).toBe('ws-42');
    });
});
