/**
 * Integration tests — WebSocket onMessage → NotificationContext wiring in App.tsx.
 *
 * Strategy: mock useWebSocket to capture the onMessage callback, mock context hooks,
 * render the app shell, then invoke onMessage directly with simulated payloads.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, act } from '@testing-library/react';

// ── Captured onMessage callback ─────────────────────────────────

let capturedOnMessage: ((msg: any) => void) | null = null;

vi.mock('../../src/server/spa/client/react/hooks/useWebSocket', () => ({
    useWebSocket: ({ onMessage }: { onMessage: (msg: any) => void }) => {
        capturedOnMessage = onMessage;
        return { status: 'open', connect: vi.fn(), disconnect: vi.fn() };
    },
}));

// ── Mock fetchApi (bootstrap calls) ─────────────────────────────

vi.mock('../../src/server/spa/client/react/hooks/useApi', () => ({
    fetchApi: vi.fn().mockResolvedValue(null),
}));

// ── Mock contexts ───────────────────────────────────────────────

const mockAppDispatch = vi.fn();
vi.mock('../../src/server/spa/client/react/context/AppContext', () => ({
    AppProvider: ({ children }: any) => children,
    useApp: () => ({
        state: {
            activeTab: 'repos',
            workspaces: [],
            wsStatus: 'open',
            reposSidebarCollapsed: false,
        },
        dispatch: mockAppDispatch,
    }),
}));

const mockQueueDispatch = vi.fn();
vi.mock('../../src/server/spa/client/react/context/QueueContext', () => ({
    QueueProvider: ({ children }: any) => children,
    useQueue: () => ({ state: { queued: [], running: [], history: [] }, dispatch: mockQueueDispatch }),
}));

const mockAddNotification = vi.fn();
vi.mock('../../src/server/spa/client/react/context/NotificationContext', () => ({
    NotificationProvider: ({ children }: any) => children,
    useNotifications: () => ({
        notifications: [],
        unreadCount: 0,
        addNotification: mockAddNotification,
        markAllRead: vi.fn(),
        clearAll: vi.fn(),
    }),
}));

vi.mock('../../src/server/spa/client/react/context/ToastContext', () => ({
    ToastProvider: ({ children, value }: any) => children,
}));

vi.mock('../../src/server/spa/client/react/context/MinimizedDialogsContext', () => ({
    MinimizedDialogsProvider: ({ children }: any) => children,
    useMinimizedDialog: vi.fn(),
    MinimizedDialogsTray: () => null,
}));

vi.mock('../../src/server/spa/client/react/context/PopOutContext', () => ({
    PopOutProvider: ({ children }: any) => children,
}));

vi.mock('../../src/server/spa/client/react/context/FloatingChatsContext', () => ({
    FloatingChatsProvider: ({ children }: any) => children,
}));

vi.mock('../../src/server/spa/client/react/layout/ThemeProvider', () => ({
    ThemeProvider: ({ children }: any) => children,
}));

vi.mock('../../src/server/spa/client/react/layout/TopBar', () => ({
    TopBar: () => null,
}));

vi.mock('../../src/server/spa/client/react/layout/BottomNav', () => ({
    BottomNav: () => null,
}));

vi.mock('../../src/server/spa/client/react/layout/Router', () => ({
    Router: () => null,
}));

vi.mock('../../src/server/spa/client/react/layout/FloatingChatManager', () => ({
    FloatingChatManager: () => null,
}));

vi.mock('../../src/server/spa/client/react/processes/MarkdownReviewDialog', () => ({
    MarkdownReviewDialog: () => null,
}));

vi.mock('../../src/server/spa/client/react/queue/EnqueueDialog', () => ({
    EnqueueDialog: () => null,
}));

vi.mock('../../src/server/spa/client/react/shared', () => ({
    ToastContainer: () => null,
    useToast: () => ({ toasts: [], addToast: vi.fn(), removeToast: vi.fn() }),
}));

// ── Import App after all mocks ──────────────────────────────────

import { App } from '../../src/server/spa/client/react/App';

// ── Helpers ─────────────────────────────────────────────────────

function makeProcessMsg(overrides: Record<string, any> = {}) {
    return {
        type: 'process-updated',
        process: {
            id: 'proc-1',
            status: 'completed',
            promptPreview: 'Summarize code',
            startTime: '2025-01-01T00:00:00.000Z',
            endTime: '2025-01-01T00:00:42.000Z',
            metadata: { workspaceId: 'frontend' },
            ...overrides,
        },
    };
}

// ── Tests ───────────────────────────────────────────────────────

describe('App WebSocket → Notification wiring', () => {
    beforeEach(() => {
        capturedOnMessage = null;
        mockAddNotification.mockClear();
        mockAppDispatch.mockClear();
        mockQueueDispatch.mockClear();
    });

    function renderAndCapture() {
        render(<App />);
        expect(capturedOnMessage).toBeTruthy();
        return capturedOnMessage!;
    }

    it('completed process triggers addNotification with success type', () => {
        const onMessage = renderAndCapture();
        act(() => onMessage(makeProcessMsg({ status: 'completed' })));

        expect(mockAddNotification).toHaveBeenCalledOnce();
        expect(mockAddNotification.mock.calls[0][0].type).toBe('success');
    });

    it('failed process triggers addNotification with error type', () => {
        const onMessage = renderAndCapture();
        act(() => onMessage(makeProcessMsg({ status: 'failed' })));

        expect(mockAddNotification).toHaveBeenCalledOnce();
        expect(mockAddNotification.mock.calls[0][0].type).toBe('error');
    });

    it('running process does NOT trigger notification', () => {
        const onMessage = renderAndCapture();
        act(() => onMessage(makeProcessMsg({ status: 'running' })));

        expect(mockAddNotification).not.toHaveBeenCalled();
    });

    it('queued process does NOT trigger notification', () => {
        const onMessage = renderAndCapture();
        act(() => onMessage(makeProcessMsg({ status: 'queued' })));

        expect(mockAddNotification).not.toHaveBeenCalled();
    });

    it('wiki-error triggers addNotification with warning type', () => {
        const onMessage = renderAndCapture();
        act(() => onMessage({ type: 'wiki-error', wikiId: 'w1', error: 'Something broke' }));

        expect(mockAddNotification).toHaveBeenCalledOnce();
        expect(mockAddNotification.mock.calls[0][0]).toEqual({
            type: 'warning',
            title: 'Wiki error',
            detail: 'Something broke',
        });
    });

    it('cancelled process triggers addNotification with warning type', () => {
        const onMessage = renderAndCapture();
        act(() => onMessage(makeProcessMsg({ status: 'cancelled' })));

        expect(mockAddNotification).toHaveBeenCalledOnce();
        expect(mockAddNotification.mock.calls[0][0].type).toBe('warning');
    });

    it('notification includes processId from process payload', () => {
        const onMessage = renderAndCapture();
        act(() => onMessage(makeProcessMsg({ id: 'proc-xyz' })));

        expect(mockAddNotification).toHaveBeenCalledOnce();
        expect(mockAddNotification.mock.calls[0][0].processId).toBe('proc-xyz');
    });
});
