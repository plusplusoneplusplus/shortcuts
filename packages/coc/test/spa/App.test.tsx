/**
 * Unit tests for App.tsx — bootstrap, review-dialog lifecycle,
 * WebSocket event dispatch, and connection-lost toast.
 *
 * WS notification-dispatch deduplication tests live in
 * AppNotificationWiring.test.tsx.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act, waitFor } from '@testing-library/react';

// ── Captured hook callbacks ──────────────────────────────────────

let capturedOnMessage: ((msg: any) => void) | null = null;
let capturedOnConnect: (() => void) | null = null;
let mockWsStatus: 'open' | 'closed' | 'connecting' = 'open';
const mockWsConnect = vi.fn();

vi.mock('../../src/server/spa/client/react/hooks/useWebSocket', () => ({
    useWebSocket: ({ onMessage, onConnect }: any) => {
        capturedOnMessage = onMessage;
        capturedOnConnect = onConnect;
        return { status: mockWsStatus, connect: mockWsConnect, disconnect: vi.fn() };
    },
}));

// ── Bootstrap: fetchApi ──────────────────────────────────────────

const mockFetchApi = vi.fn();
vi.mock('../../src/server/spa/client/react/hooks/useApi', () => ({
    fetchApi: (...args: any[]) => mockFetchApi(...args),
}));

const mockQueueList = vi.fn();
const mockModelsList = vi.fn();
const mockAgentProviderModelsList = vi.fn();
vi.mock('../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        agentProviders: {
            listModels: mockAgentProviderModelsList,
        },
        models: {
            list: mockModelsList,
        },
        queue: {
            list: mockQueueList,
        },
    }),
}));

// ── Contexts ─────────────────────────────────────────────────────

const mockAppDispatch = vi.fn();
let mockAppState: Record<string, any> = {};

vi.mock('../../src/server/spa/client/react/contexts/AppContext', () => ({
    AppProvider: ({ children }: any) => children,
    useApp: () => ({ state: mockAppState, dispatch: mockAppDispatch }),
}));

const mockQueueDispatch = vi.fn();
vi.mock('../../src/server/spa/client/react/contexts/QueueContext', () => ({
    QueueProvider: ({ children }: any) => children,
    useQueue: () => ({
        state: { queued: [], running: [], history: [], showScriptDialog: false },
        dispatch: mockQueueDispatch,
    }),
}));

const mockAddNotification = vi.fn();
vi.mock('../../src/server/spa/client/react/contexts/NotificationContext', () => ({
    NotificationProvider: ({ children }: any) => children,
    useNotifications: () => ({
        notifications: [],
        unreadCount: 0,
        addNotification: mockAddNotification,
        markAllRead: vi.fn(),
        clearAll: vi.fn(),
    }),
}));

vi.mock('../../src/server/spa/client/react/contexts/ReposContext', () => ({
    ReposProvider: ({ children }: any) => children,
    useRepos: () => ({ repos: [], unseenCounts: {}, fetchRepos: vi.fn(), loading: false }),
}));

vi.mock('../../src/server/spa/client/react/contexts/ToastContext', () => ({
    ToastProvider: ({ children }: any) => children,
}));

vi.mock('../../src/server/spa/client/react/contexts/MinimizedDialogsContext', () => ({
    MinimizedDialogsProvider: ({ children }: any) => children,
    useMinimizedDialog: vi.fn(),
    MinimizedDialogsTray: () => null,
}));

vi.mock('../../src/server/spa/client/react/contexts/PopOutContext', () => ({
    PopOutProvider: ({ children }: any) => children,
}));

vi.mock('../../src/server/spa/client/react/contexts/FloatingChatsContext', () => ({
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

// Capture MarkdownReviewDialog props to assert on review-dialog state.
let capturedReviewProps: Record<string, any> | null = null;
vi.mock('../../src/server/spa/client/react/processes/MarkdownReviewDialog', () => ({
    MarkdownReviewDialog: (props: any) => {
        capturedReviewProps = props;
        return null;
    },
}));

vi.mock('../../src/server/spa/client/react/queue/EnqueueDialog', () => ({
    EnqueueDialog: () => null,
}));

const mockAddToast = vi.fn();
vi.mock('../../src/server/spa/client/react/ui', () => ({
    ToastContainer: () => null,
    useToast: () => ({ toasts: [], addToast: mockAddToast, removeToast: vi.fn() }),
}));

// ── Import App after all mocks ───────────────────────────────────

import { App } from '../../src/server/spa/client/react/App';

// ── Shared helpers ───────────────────────────────────────────────

function makeAppState(overrides: Record<string, any> = {}): Record<string, any> {
    return {
        activeTab: 'repos',
        workspaces: [],
        wsStatus: 'open',
        reposSidebarCollapsed: false,
        hasSeenWelcome: false,
        preferencesLoaded: false,
        preferencesLoadFailed: false,
        ...overrides,
    };
}

// ── Bootstrap tests ──────────────────────────────────────────────

describe('App bootstrap', () => {
    beforeEach(() => {
        capturedOnMessage = null;
        capturedOnConnect = null;
        capturedReviewProps = null;
        mockWsStatus = 'open';
        mockAppState = makeAppState();
        mockAppDispatch.mockClear();
        mockQueueDispatch.mockClear();
        mockAddNotification.mockClear();
        mockAddToast.mockClear();
        mockFetchApi.mockClear();
        mockWsConnect.mockClear();
        mockQueueList.mockReset();
        mockQueueList.mockResolvedValue({ queued: [], running: [] });
        mockModelsList.mockReset();
        mockModelsList.mockResolvedValue([]);
        mockAgentProviderModelsList.mockReset();
        mockAgentProviderModelsList.mockResolvedValue({ models: [] });
    });

    it('fetches /preferences on mount and dispatches SET_WELCOME_PREFERENCES', async () => {
        mockFetchApi.mockResolvedValueOnce({
            hasSeenWelcome: true,
            onboardingProgress: { step1: true },
            dismissedTips: ['tip1'],
        });

        render(<App />);

        await waitFor(() => expect(mockFetchApi).toHaveBeenCalledWith('/preferences'));

        expect(mockAppDispatch).toHaveBeenCalledWith({
            type: 'SET_WELCOME_PREFERENCES',
            payload: {
                hasSeenWelcome: true,
                onboardingProgress: { step1: true },
                dismissedTips: ['tip1'],
            },
        });
    });

    it('dispatches SET_REPOS_SIDEBAR_COLLAPSED and writes localStorage when reposSidebarCollapsed is boolean', async () => {
        const spy = vi.spyOn(Storage.prototype, 'setItem');
        mockFetchApi.mockResolvedValueOnce({ reposSidebarCollapsed: true });

        render(<App />);

        await waitFor(() =>
            expect(mockAppDispatch).toHaveBeenCalledWith({
                type: 'SET_REPOS_SIDEBAR_COLLAPSED',
                value: true,
            }),
        );

        expect(spy).toHaveBeenCalledWith('coc-repos-sidebar-collapsed', 'true');
        spy.mockRestore();
    });

    it('dispatches SET_WELCOME_PREFERENCES for an empty successful preferences response', async () => {
        mockFetchApi.mockResolvedValueOnce({});

        render(<App />);

        await waitFor(() =>
            expect(mockAppDispatch).toHaveBeenCalledWith({
                type: 'SET_WELCOME_PREFERENCES',
                payload: {
                    hasSeenWelcome: undefined,
                    onboardingProgress: undefined,
                    dismissedTips: undefined,
                    activityFilters: undefined,
                },
            }),
        );
    });

    it('dispatches SET_PREFERENCES_LOAD_FAILED when /preferences returns null so UI does not stall', async () => {
        mockFetchApi.mockResolvedValueOnce(null);

        render(<App />);

        await waitFor(() =>
            expect(mockAppDispatch).toHaveBeenCalledWith({
                type: 'SET_PREFERENCES_LOAD_FAILED',
            }),
        );
    });

    it('dispatches SET_PREFERENCES_LOAD_FAILED on network failure so UI does not stall', async () => {
        mockFetchApi.mockRejectedValueOnce(new Error('network failure'));

        render(<App />);

        await waitFor(() =>
            expect(mockAppDispatch).toHaveBeenCalledWith({
                type: 'SET_PREFERENCES_LOAD_FAILED',
            }),
        );
    });

    it('calls WebSocket connect after preferences fetch succeeds', async () => {
        mockFetchApi.mockResolvedValueOnce({ hasSeenWelcome: false });

        render(<App />);

        await waitFor(() => expect(mockWsConnect).toHaveBeenCalled());
    });

    it('calls WebSocket connect even when preferences fetch fails', async () => {
        mockFetchApi.mockRejectedValueOnce(new Error('network failure'));

        render(<App />);

        await waitFor(() => expect(mockWsConnect).toHaveBeenCalled());
    });

    it('refreshes welcome preferences when WebSocket reconnects after server restart', async () => {
        mockFetchApi
            .mockResolvedValueOnce({
                hasSeenWelcome: true,
                onboardingProgress: { hasCompletedTour: false },
                dismissedTips: [],
            })
            .mockResolvedValueOnce({
                hasSeenWelcome: true,
                onboardingProgress: { hasCompletedTour: true },
                dismissedTips: [],
            });

        render(<App />);

        await waitFor(() =>
            expect(mockAppDispatch).toHaveBeenCalledWith({
                type: 'SET_WELCOME_PREFERENCES',
                payload: {
                    hasSeenWelcome: true,
                    onboardingProgress: { hasCompletedTour: false },
                    dismissedTips: [],
                    activityFilters: undefined,
                },
            }),
        );

        await act(async () => {
            await capturedOnConnect?.();
        });

        expect(mockFetchApi).toHaveBeenNthCalledWith(2, '/preferences');
        expect(mockAppDispatch).toHaveBeenCalledWith({
            type: 'SET_WELCOME_PREFERENCES',
            payload: {
                hasSeenWelcome: true,
                onboardingProgress: { hasCompletedTour: true },
                dismissedTips: [],
                activityFilters: undefined,
            },
        });
    });
});

// ── WebSocket event → context dispatch ──────────────────────────

describe('App WebSocket events dispatch to correct context slice', () => {
    beforeEach(() => {
        capturedOnMessage = null;
        mockWsStatus = 'open';
        mockAppState = makeAppState();
        mockAppDispatch.mockClear();
        mockQueueDispatch.mockClear();
        mockAddNotification.mockClear();
        mockFetchApi.mockResolvedValue(null);
        mockQueueList.mockReset();
        mockQueueList.mockResolvedValue({ queued: [], running: [] });
        mockModelsList.mockReset();
        mockModelsList.mockResolvedValue([]);
    });

    function renderAndCapture() {
        render(<App />);
        expect(capturedOnMessage).toBeTruthy();
        return capturedOnMessage!;
    }

    it('process-added dispatches PROCESS_ADDED to AppContext', () => {
        const onMessage = renderAndCapture();
        const process = { id: 'p1', status: 'running', promptPreview: 'hello' };

        act(() => onMessage({ type: 'process-added', process }));

        expect(mockAppDispatch).toHaveBeenCalledWith({ type: 'PROCESS_ADDED', process });
    });

    it('process-removed dispatches PROCESS_REMOVED to AppContext', () => {
        const onMessage = renderAndCapture();

        act(() => onMessage({ type: 'process-removed', processId: 'p-del' }));

        expect(mockAppDispatch).toHaveBeenCalledWith({ type: 'PROCESS_REMOVED', processId: 'p-del' });
    });

    it('queue-updated with repoId dispatches REPO_QUEUE_UPDATED to QueueContext', () => {
        const onMessage = renderAndCapture();
        const queue = { repoId: 'ws-abc', queued: [], running: [], history: [] };

        act(() => onMessage({ type: 'queue-updated', queue }));

        expect(mockQueueDispatch).toHaveBeenCalledWith({
            type: 'REPO_QUEUE_UPDATED',
            repoId: 'ws-abc',
            queue,
        });
    });

    it('queue-updated without repoId dispatches QUEUE_UPDATED to QueueContext', () => {
        const onMessage = renderAndCapture();
        const queue = { queued: [], running: [], history: [{ id: 'h1' }] };

        act(() => onMessage({ type: 'queue-updated', queue }));

        expect(mockQueueDispatch).toHaveBeenCalledWith({ type: 'QUEUE_UPDATED', queue });
    });

    it('wiki-reload dispatches WIKI_RELOAD to AppContext', () => {
        const onMessage = renderAndCapture();
        const wiki = { id: 'wiki-1', name: 'My Wiki' };

        act(() => onMessage({ type: 'wiki-reload', wiki }));

        expect(mockAppDispatch).toHaveBeenCalledWith({ type: 'WIKI_RELOAD', wiki });
    });

    it('wiki-rebuilding dispatches WIKI_REBUILDING to AppContext', () => {
        const onMessage = renderAndCapture();

        act(() => onMessage({ type: 'wiki-rebuilding', wikiId: 'wiki-2' }));

        expect(mockAppDispatch).toHaveBeenCalledWith({ type: 'WIKI_REBUILDING', wikiId: 'wiki-2' });
    });

    it('message with unknown type is silently ignored', () => {
        const onMessage = renderAndCapture();

        act(() => onMessage({ type: 'completely-unknown-event', data: 'noop' }));

        // No dispatch to either context
        const processDispatch = mockAppDispatch.mock.calls.filter(
            ([a]: [any]) => a.type !== 'SET_WS_STATUS',
        );
        expect(processDispatch).toHaveLength(0);
        expect(mockQueueDispatch).not.toHaveBeenCalled();
    });

    it('null or typeless message is silently ignored', () => {
        const onMessage = renderAndCapture();

        act(() => onMessage(null));
        act(() => onMessage({ noType: true }));

        const processDispatch = mockAppDispatch.mock.calls.filter(
            ([a]: [any]) => a.type !== 'SET_WS_STATUS',
        );
        expect(processDispatch).toHaveLength(0);
        expect(mockQueueDispatch).not.toHaveBeenCalled();
    });
});

// ── Connection-lost toast ────────────────────────────────────────

describe('App connection-lost toast', () => {
    beforeEach(() => {
        mockAddToast.mockClear();
        mockFetchApi.mockResolvedValue(null);
        mockWsConnect.mockClear();
        mockQueueList.mockReset();
        mockQueueList.mockResolvedValue({ queued: [], running: [] });
        mockModelsList.mockReset();
        mockModelsList.mockResolvedValue([]);
    });

    it('shows connection-lost toast when WS status transitions open→closed', async () => {
        // prevWsStatusRef is initialised from appState.wsStatus ('open').
        // Returning 'closed' from useWebSocket mock simulates the open→closed transition on mount.
        mockWsStatus = 'closed';
        mockAppState = makeAppState({ wsStatus: 'open' });

        render(<App />);

        await waitFor(() =>
            expect(mockAddToast).toHaveBeenCalledWith('Connection lost — reconnecting…', 'error'),
        );
    });
});

// ── Review dialog lifecycle ──────────────────────────────────────

describe('App review dialog lifecycle', () => {
    const workspaces = [
        { id: 'ws-1', name: 'My Repo', rootPath: '/projects/my-repo' },
    ];

    beforeEach(() => {
        capturedReviewProps = null;
        mockWsStatus = 'open';
        mockAppState = makeAppState({ workspaces });
        mockAppDispatch.mockClear();
        mockFetchApi.mockResolvedValue(null);
        mockQueueList.mockReset();
        mockQueueList.mockResolvedValue({ queued: [], running: [] });
        mockModelsList.mockReset();
        mockModelsList.mockResolvedValue([]);
    });

    it('opens MarkdownReviewDialog with task-relative filePath when wsId hint is provided', async () => {
        render(<App />);

        act(() => {
            window.dispatchEvent(
                new CustomEvent('coc-open-markdown-review', {
                    detail: { wsId: 'ws-1', filePath: 'tasks/plan.md' },
                }),
            );
        });

        await waitFor(() => {
            expect(capturedReviewProps?.open).toBe(true);
            expect(capturedReviewProps?.wsId).toBe('ws-1');
            expect(capturedReviewProps?.filePath).toBe('tasks/plan.md');
            expect(capturedReviewProps?.fetchMode).toBe('tasks');
        });
    });

    it('closes MarkdownReviewDialog when onClose callback is invoked', async () => {
        render(<App />);

        // Open the dialog
        act(() => {
            window.dispatchEvent(
                new CustomEvent('coc-open-markdown-review', {
                    detail: { wsId: 'ws-1', filePath: 'tasks/plan.md' },
                }),
            );
        });

        await waitFor(() => expect(capturedReviewProps?.open).toBe(true));

        // Invoke the onClose callback
        act(() => capturedReviewProps?.onClose());

        await waitFor(() => expect(capturedReviewProps?.open).toBe(false));
    });

    it('resolves workspace by longest-prefix match when no wsId hint is provided', async () => {
        render(<App />);

        act(() => {
            window.dispatchEvent(
                new CustomEvent('coc-open-markdown-review', {
                    detail: { filePath: '/projects/my-repo/docs/readme.md' },
                }),
            );
        });

        await waitFor(() => {
            expect(capturedReviewProps?.open).toBe(true);
            expect(capturedReviewProps?.wsId).toBe('ws-1');
        });
    });

    it('does not open dialog when filePath is empty', async () => {
        render(<App />);

        act(() => {
            window.dispatchEvent(
                new CustomEvent('coc-open-markdown-review', {
                    detail: { wsId: 'ws-1', filePath: '' },
                }),
            );
        });

        // Give React time to process
        await act(async () => {});

        expect(capturedReviewProps?.open).toBe(false);
    });

    it('does not open dialog when no matching workspace is found for the path', async () => {
        render(<App />);

        act(() => {
            window.dispatchEvent(
                new CustomEvent('coc-open-markdown-review', {
                    detail: { filePath: '/some/unrelated/path/file.md' },
                }),
            );
        });

        await act(async () => {});

        expect(capturedReviewProps?.open).toBe(false);
    });
});
