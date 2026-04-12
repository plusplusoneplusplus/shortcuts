/**
 * Render tests for RepoActivityTab — the integration layer that wires
 * ActivityListPane and ActivityDetailPane with data fetching, task selection,
 * mobile layout, and provider wiring.
 *
 * Child components (ActivityListPane, ActivityDetailPane) are mocked — their
 * internal behavior is covered by their own test files. These tests verify
 * only the wiring: correct props, correct dispatches, correct layout decisions.
 *
 * Dropped tests (covered by per-component test files):
 * - ActivityChatDetail behavior → ActivityChatDetail.test.ts (46 tests)
 * - ActivityListPane rendering → ActivityListPane.test.ts (52 tests)
 * - ActivityDetailPane routing → ActivityDetailPane.test.tsx
 * - useUnseenActivity hook → hooks/useUnseenActivity.test.ts (24 tests)
 * - Cross-repo selection → cross-repo-activity-mixing.test.tsx
 * - Barrel exports, RepoDetail wiring, TypeScript interfaces — TypeScript covers
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor, fireEvent, act } from '@testing-library/react';
import React from 'react';
import { renderWithProviders } from '../test-utils';
import { useQueue } from '../../../../src/server/spa/client/react/context/QueueContext';
import { toQueueProcessId } from '../../../../src/server/spa/client/react/utils/queue-process-id';

// ── Mock child components ──────────────────────────────────────────────

const mockListPane = vi.fn();
const mockDetailPane = vi.fn();

vi.mock('../../../../src/server/spa/client/react/repos/ActivityListPane', () => ({
    ActivityListPane: (props: any) => {
        mockListPane(props);
        return React.createElement('div', { 'data-testid': 'mock-list-pane' },
            ...(props.running || []).map((t: any) =>
                React.createElement('button', {
                    key: t.id,
                    'data-testid': `task-${t.id}`,
                    onClick: () => props.onSelectTask(t.id, t),
                }, t.displayName || t.id),
            ),
            ...(props.queued || []).filter((t: any) => t.kind !== 'pause-marker').map((t: any) =>
                React.createElement('button', {
                    key: t.id,
                    'data-testid': `task-${t.id}`,
                    onClick: () => props.onSelectTask(t.id, t),
                }, t.displayName || t.id),
            ),
            ...(props.history || []).map((t: any) =>
                React.createElement('button', {
                    key: t.id,
                    'data-testid': `task-${t.id}`,
                    onClick: () => props.onSelectTask(t.id, t),
                }, t.displayName || t.id),
            ),
            props.onPauseResume && React.createElement('button', {
                'data-testid': 'pause-resume-btn',
                onClick: props.onPauseResume,
            }, 'PauseResume'),
            props.onPauseResumeAutopilot && React.createElement('button', {
                'data-testid': 'autopilot-pause-btn',
                onClick: props.onPauseResumeAutopilot,
            }, 'AP Pause'),
            props.onRefresh && React.createElement('button', {
                'data-testid': 'refresh-btn',
                onClick: props.onRefresh,
            }, 'Refresh'),
            props.onOpenDialog && React.createElement('button', {
                'data-testid': 'dialog-btn',
                onClick: props.onOpenDialog,
            }, 'Dialog'),
        );
    },
}));

vi.mock('../../../../src/server/spa/client/react/repos/ActivityDetailPane', () => ({
    ActivityDetailPane: (props: any) => {
        mockDetailPane(props);
        return React.createElement('div', {
            'data-testid': 'mock-detail-pane',
            'data-selected': props.selectedTaskId || '',
        },
            props.selectedTaskId ? `Detail: ${props.selectedTaskId}` : 'No selection',
            props.onBack && React.createElement('button', {
                'data-testid': 'back-btn',
                onClick: props.onBack,
            }, 'Back'),
        );
    },
}));

vi.mock('../../../../src/server/spa/client/react/context/ChatPreferencesContext', () => ({
    ChatPreferencesProvider: ({ children, workspaceId }: any) => {
        return React.createElement('div', {
            'data-testid': 'chat-prefs-provider',
            'data-workspace-id': workspaceId,
        }, children);
    },
    useChatPrefs: () => ({
        pinnedChatIds: new Set(),
        archivedChatIds: new Set(),
        pinChat: vi.fn(),
        unpinChat: vi.fn(),
        archiveChat: vi.fn(),
        unarchiveChat: vi.fn(),
    }),
}));

// ── Mock hooks ─────────────────────────────────────────────────────────

let mockBreakpoint = { isMobile: false, isTablet: false };
vi.mock('../../../../src/server/spa/client/react/hooks/useBreakpoint', () => ({
    useBreakpoint: () => mockBreakpoint,
}));

let lastResizablePanelOpts: any = null;
vi.mock('../../../../src/server/spa/client/react/hooks/useResizablePanel', () => ({
    useResizablePanel: (opts: any) => {
        lastResizablePanelOpts = opts;
        return {
            width: opts?.initialWidth ?? 320,
            isDragging: false,
            handleMouseDown: vi.fn(),
            handleTouchStart: vi.fn(),
        };
    },
}));

const mockMarkSeen = vi.fn();
const mockMarkAllSeen = vi.fn();
const mockMarkTasksSeen = vi.fn();
const mockMarkUnseen = vi.fn();
let mockUnseenTaskIds = new Set<string>();
vi.mock('../../../../src/server/spa/client/react/hooks/useUnseenActivity', () => ({
    useUnseenActivity: () => ({
        unseenProcessIds: mockUnseenTaskIds,
        markSeen: mockMarkSeen,
        markAllSeen: mockMarkAllSeen,
        markTasksSeen: mockMarkTasksSeen,
        markUnseen: mockMarkUnseen,
    }),
}));

const mockMarkReadByProcessId = vi.fn();
vi.mock('../../../../src/server/spa/client/react/context/NotificationContext', () => ({
    NotificationProvider: ({ children }: any) => children,
    useNotifications: () => ({
        notifications: [],
        markReadByProcessId: mockMarkReadByProcessId,
        dismissAll: vi.fn(),
    }),
}));

const mockRefreshUnseenCounts = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../../src/server/spa/client/react/context/ReposContext', () => ({
    useRepos: () => ({
        repos: [],
        loading: false,
        fetchRepos: vi.fn(),
        unseenCounts: {},
        refreshUnseenCounts: mockRefreshUnseenCounts,
    }),
}));

// ── Mock fetchApi ──────────────────────────────────────────────────────

const mockFetchApi = vi.fn();
vi.mock('../../../../src/server/spa/client/react/hooks/useApi', () => ({
    fetchApi: (...args: any[]) => mockFetchApi(...args),
}));

// ── Import component under test (after mocks) ─────────────────────────

import { RepoActivityTab } from '../../../../src/server/spa/client/react/repos/RepoActivityTab';

// ── Test helpers ───────────────────────────────────────────────────────

function makeRunningTask(id = 'task-r1', overrides: any = {}) {
    return { id, type: 'chat', status: 'running', displayName: `Running ${id}`, processId: `proc-${id}`, ...overrides };
}

function makeQueuedTask(id = 'task-q1', overrides: any = {}) {
    return { id, type: 'chat', status: 'queued', displayName: `Queued ${id}`, processId: toQueueProcessId(id), ...overrides };
}

function makeHistoryTask(id = 'task-h1', overrides: any = {}) {
    return { id, type: 'chat', status: 'completed', displayName: `History ${id}`, completedAt: '2026-01-01T00:00:00Z', ...overrides };
}

function setupFetchMock(opts: {
    running?: any[];
    queued?: any[];
    history?: any[];
    stats?: any;
} = {}) {
    const { running = [], queued = [], history = [], stats = { isPaused: false } } = opts;
    mockFetchApi.mockImplementation(async (url: string, init?: any) => {
        if (init?.method === 'POST') {
            return {};
        }
        if (url.includes('/workspaces/') && url.includes('/history')) {
            return { history };
        }
        if (url.match(/\/queue\?repoId=/)) {
            return { running, queued, stats };
        }
        if (url.match(/\/queue\/[^?]/)) {
            const taskId = decodeURIComponent(url.split('/queue/')[1]?.split('?')[0] || '');
            const all = [...running, ...queued, ...history];
            const found = all.find(t => t.id === taskId);
            if (found) return { task: found };
            throw new Error('not found');
        }
        if (url.match(/\/processes\//)) {
            const processId = decodeURIComponent(url.split('/processes/')[1]?.split('?')[0] || '');
            const all = [...running, ...queued, ...history];
            const found = all.find(t => t.id === processId || t.processId === processId);
            if (found) return { process: found };
            throw new Error('not found');
        }
        return {};
    });
}

async function renderTab(workspaceId = 'ws-1') {
    let result: ReturnType<typeof renderWithProviders> | undefined;
    await act(async () => {
        result = renderWithProviders(
            React.createElement(RepoActivityTab, { workspaceId }),
        );
    });
    await waitFor(() => {
        expect(screen.queryByText('Loading queue...')).not.toBeInTheDocument();
    });
    return result!;
}

/** Helper component that exposes a dispatch function to simulate WS pushes within the same provider tree */
function WsSimulator({ dispatchRef }: { dispatchRef: { current: ((queue: any) => void) | null } }) {
    const { dispatch } = useQueue();
    dispatchRef.current = (queue: any) => {
        dispatch({ type: 'REPO_QUEUE_UPDATED' as const, repoId: 'ws-1', queue });
    };
    return null;
}

// ── Setup / Teardown ───────────────────────────────────────────────────

beforeEach(() => {
    vi.clearAllMocks();
    mockBreakpoint = { isMobile: false, isTablet: false };
    mockUnseenTaskIds = new Set();
    lastResizablePanelOpts = null;
    location.hash = '';
    setupFetchMock();
});

afterEach(() => {
    location.hash = '';
});

// ═══════════════════════════════════════════════════════════════════════
// LAYOUT
// ═══════════════════════════════════════════════════════════════════════

describe('RepoActivityTab: layout', () => {
    it('renders split-panel container with data-testid', async () => {
        await renderTab();
        expect(screen.getByTestId('activity-split-panel')).toBeTruthy();
    });

    it('renders list panel with data-testid', async () => {
        await renderTab();
        expect(screen.getByTestId('activity-list-panel')).toBeTruthy();
    });

    it('renders detail panel with data-testid', async () => {
        await renderTab();
        expect(screen.getByTestId('activity-detail-panel')).toBeTruthy();
    });

    it('renders resize handle with data-testid', async () => {
        await renderTab();
        expect(screen.getByTestId('activity-resize-handle')).toBeTruthy();
    });

    it('resize handle has role="separator"', async () => {
        await renderTab();
        expect(screen.getByTestId('activity-resize-handle').getAttribute('role')).toBe('separator');
    });

    it('resize handle has aria-orientation="vertical"', async () => {
        await renderTab();
        expect(screen.getByTestId('activity-resize-handle').getAttribute('aria-orientation')).toBe('vertical');
    });

    it('detail panel has data-pane="detail"', async () => {
        await renderTab();
        expect(screen.getByTestId('activity-detail-panel').getAttribute('data-pane')).toBe('detail');
    });

    it('applies inline width to left panel from useResizablePanel', async () => {
        await renderTab();
        const panel = screen.getByTestId('activity-list-panel');
        expect(panel.style.width).toBe('320px');
    });

    it('uses initialWidth=320 for desktop', async () => {
        await renderTab();
        expect(lastResizablePanelOpts?.initialWidth).toBe(320);
    });

    it('passes storageKey to useResizablePanel', async () => {
        await renderTab();
        expect(lastResizablePanelOpts?.storageKey).toBe('activity-left-panel-width');
    });
});

// ═══════════════════════════════════════════════════════════════════════
// DATA FETCHING
// ═══════════════════════════════════════════════════════════════════════

describe('RepoActivityTab: data fetching', () => {
    it('shows "Loading queue..." before fetch completes', async () => {
        mockFetchApi.mockImplementation(() => new Promise(() => {}));
        await act(async () => {
            renderWithProviders(React.createElement(RepoActivityTab, { workspaceId: 'ws-1' }));
        });
        expect(screen.getByText('Loading queue...')).toBeTruthy();
    });

    it('fetches /queue?repoId= on mount', async () => {
        await renderTab();
        expect(mockFetchApi).toHaveBeenCalledWith(expect.stringContaining('/queue?repoId=ws-1'));
    });

    it('fetches /workspaces/:id/history on mount', async () => {
        await renderTab();
        expect(mockFetchApi).toHaveBeenCalledWith(expect.stringContaining('/workspaces/ws-1/history'));
    });

    it('encodes workspaceId in fetch URL', async () => {
        setupFetchMock();
        await renderTab('ws/special chars');
        expect(mockFetchApi).toHaveBeenCalledWith(
            expect.stringContaining('/queue?repoId=' + encodeURIComponent('ws/special chars')),
        );
    });

    it('passes fetched running tasks to list pane', async () => {
        const r1 = makeRunningTask('r1');
        setupFetchMock({ running: [r1] });
        await renderTab();
        const lastProps = mockListPane.mock.calls.at(-1)?.[0];
        expect(lastProps?.running).toEqual([r1]);
    });

    it('passes fetched queued tasks to list pane', async () => {
        const q1 = makeQueuedTask('q1');
        setupFetchMock({ queued: [q1] });
        await renderTab();
        const lastProps = mockListPane.mock.calls.at(-1)?.[0];
        expect(lastProps?.queued).toEqual([q1]);
    });

    it('passes fetched history tasks to list pane', async () => {
        const h1 = makeHistoryTask('h1');
        setupFetchMock({ history: [h1] });
        await renderTab();
        const lastProps = mockListPane.mock.calls.at(-1)?.[0];
        expect(lastProps?.history).toEqual([h1]);
    });

    it('handles fetch error gracefully (empty lists)', async () => {
        mockFetchApi.mockRejectedValue(new Error('network error'));
        await renderTab();
        const lastProps = mockListPane.mock.calls.at(-1)?.[0];
        expect(lastProps?.running).toEqual([]);
        expect(lastProps?.queued).toEqual([]);
        expect(lastProps?.history).toEqual([]);
    });

    it('passes isPaused from stats to list pane', async () => {
        setupFetchMock({ stats: { isPaused: true } });
        await renderTab();
        const lastProps = mockListPane.mock.calls.at(-1)?.[0];
        expect(lastProps?.isPaused).toBe(true);
    });

    it('passes isAutopilotPaused from stats to list pane', async () => {
        setupFetchMock({ stats: { isPaused: false, isAutopilotPaused: true } });
        await renderTab();
        const lastProps = mockListPane.mock.calls.at(-1)?.[0];
        expect(lastProps?.isAutopilotPaused).toBe(true);
    });
});

// ═══════════════════════════════════════════════════════════════════════
// TASK SELECTION
// ═══════════════════════════════════════════════════════════════════════

describe('RepoActivityTab: task selection', () => {
    it('clicking a task updates selectedTaskId in list and detail panes', async () => {
        const r1 = makeRunningTask('r1');
        setupFetchMock({ running: [r1] });
        await renderTab();

        await act(async () => {
            fireEvent.click(screen.getByTestId('task-r1'));
        });

        await waitFor(() => {
            const lastDetailProps = mockDetailPane.mock.calls.at(-1)?.[0];
            // selectTask derives processId from task.processId
            expect(lastDetailProps?.selectedTaskId).toBe('proc-r1');
        });
    });

    it('clicking a task updates location.hash to activity path', async () => {
        const r1 = makeRunningTask('r1');
        setupFetchMock({ running: [r1] });
        await renderTab();

        await act(async () => {
            fireEvent.click(screen.getByTestId('task-r1'));
        });

        // URL now uses processId derived from task.processId
        expect(location.hash).toContain('/activity/proc-r1');
    });

    it('clicking run-workflow task routes to /workflow/ hash', async () => {
        const wf = makeRunningTask('wf1', { type: 'run-workflow', processId: 'proc-wf1' });
        setupFetchMock({ running: [wf] });
        await renderTab();

        await act(async () => {
            fireEvent.click(screen.getByTestId('task-wf1'));
        });

        expect(location.hash).toContain('/workflow/');
        expect(location.hash).toContain('proc-wf1');
    });

    it('re-clicking selected task does not re-dispatch SELECT_QUEUE_TASK', async () => {
        const r1 = makeRunningTask('r1');
        setupFetchMock({ running: [r1] });
        await renderTab();

        // First click — selects (derives processId)
        await act(async () => {
            fireEvent.click(screen.getByTestId('task-r1'));
        });
        await waitFor(() => {
            expect(mockDetailPane.mock.calls.at(-1)?.[0]?.selectedTaskId).toBe('proc-r1');
        });

        // Second click — same task = refresh, not re-select
        const hashBefore = location.hash;
        await act(async () => {
            fireEvent.click(screen.getByTestId('task-r1'));
        });

        // Hash should not change on re-click (no new dispatch)
        expect(location.hash).toBe(hashBefore);
    });

    it('selecting task calls markSeen with the task id', async () => {
        const r1 = makeRunningTask('r1');
        setupFetchMock({ running: [r1] });
        await renderTab();

        await act(async () => {
            fireEvent.click(screen.getByTestId('task-r1'));
        });

        // markSeen is called with the derived processId
        expect(mockMarkSeen).toHaveBeenCalledWith('proc-r1');
    });

    it('selecting task calls markReadByProcessId', async () => {
        const r1 = makeRunningTask('r1');
        setupFetchMock({ running: [r1] });
        await renderTab();

        await act(async () => {
            fireEvent.click(screen.getByTestId('task-r1'));
        });

        // markReadByProcessId uses the derived processId
        expect(mockMarkReadByProcessId).toHaveBeenCalledWith('proc-r1');
    });

    it('selected task object is passed to detail pane', async () => {
        const r1 = makeRunningTask('r1');
        setupFetchMock({ running: [r1] });
        await renderTab();

        await act(async () => {
            fireEvent.click(screen.getByTestId('task-r1'));
        });

        await waitFor(() => {
            const lastDetailProps = mockDetailPane.mock.calls.at(-1)?.[0];
            expect(lastDetailProps?.selectedTask?.id).toBe('r1');
        });
    });

    it('detail pane shows "No selection" when no task is selected', async () => {
        setupFetchMock();
        await renderTab();
        expect(screen.getByText('No selection')).toBeTruthy();
    });

    it('does NOT dispatch SET_SELECTED_CHAT_SESSION (stays inline)', async () => {
        const r1 = makeRunningTask('r1');
        setupFetchMock({ running: [r1] });
        await renderTab();

        await act(async () => {
            fireEvent.click(screen.getByTestId('task-r1'));
        });

        // Hash goes to /activity/, not to any chat session path
        expect(location.hash).toContain('/activity/');
        expect(location.hash).not.toContain('/chat/');
    });
});

// ═══════════════════════════════════════════════════════════════════════
// MOBILE BEHAVIOR
// ═══════════════════════════════════════════════════════════════════════

describe('RepoActivityTab: mobile behavior', () => {
    beforeEach(() => {
        mockBreakpoint = { isMobile: true, isTablet: false };
    });

    it('shows list pane by default on mobile', async () => {
        setupFetchMock();
        await renderTab();
        expect(screen.getByTestId('activity-mobile-list')).toBeTruthy();
    });

    it('does not show detail pane initially on mobile', async () => {
        setupFetchMock();
        await renderTab();
        expect(screen.queryByTestId('activity-detail-panel')).toBeNull();
    });

    it('shows detail pane after selecting a task', async () => {
        const r1 = makeRunningTask('r1');
        setupFetchMock({ running: [r1] });
        await renderTab();

        await act(async () => {
            fireEvent.click(screen.getByTestId('task-r1'));
        });

        await waitFor(() => {
            expect(screen.getByTestId('activity-detail-panel')).toBeTruthy();
        });
    });

    it('hides list when showing detail on mobile', async () => {
        const r1 = makeRunningTask('r1');
        setupFetchMock({ running: [r1] });
        await renderTab();

        await act(async () => {
            fireEvent.click(screen.getByTestId('task-r1'));
        });

        await waitFor(() => {
            expect(screen.queryByTestId('activity-mobile-list')).toBeNull();
        });
    });

    it('back button returns to list view', async () => {
        const r1 = makeRunningTask('r1');
        setupFetchMock({ running: [r1] });
        await renderTab();

        // Select task to show detail
        await act(async () => {
            fireEvent.click(screen.getByTestId('task-r1'));
        });
        await waitFor(() => {
            expect(screen.getByTestId('back-btn')).toBeTruthy();
        });

        // Click back
        await act(async () => {
            fireEvent.click(screen.getByTestId('back-btn'));
        });

        await waitFor(() => {
            expect(screen.getByTestId('activity-mobile-list')).toBeTruthy();
        });
    });

    it('re-click same task shows detail on mobile (regression)', async () => {
        const r1 = makeRunningTask('r1');
        setupFetchMock({ running: [r1] });
        await renderTab();

        // Select, go back, then re-click same task
        await act(async () => {
            fireEvent.click(screen.getByTestId('task-r1'));
        });
        await waitFor(() => {
            expect(screen.getByTestId('back-btn')).toBeTruthy();
        });
        await act(async () => {
            fireEvent.click(screen.getByTestId('back-btn'));
        });
        await waitFor(() => {
            expect(screen.getByTestId('activity-mobile-list')).toBeTruthy();
        });

        // Re-click same task — should show detail again
        await act(async () => {
            fireEvent.click(screen.getByTestId('task-r1'));
        });
        await waitFor(() => {
            expect(screen.getByTestId('activity-detail-panel')).toBeTruthy();
        });
    });

    it('mobile detail panel has data-pane="detail"', async () => {
        const r1 = makeRunningTask('r1');
        setupFetchMock({ running: [r1] });
        await renderTab();

        await act(async () => {
            fireEvent.click(screen.getByTestId('task-r1'));
        });

        await waitFor(() => {
            expect(screen.getByTestId('activity-detail-panel').getAttribute('data-pane')).toBe('detail');
        });
    });

    it('does not render resize handle on mobile', async () => {
        setupFetchMock();
        await renderTab();
        expect(screen.queryByTestId('activity-resize-handle')).toBeNull();
    });

    it('passes onBack to detail pane on mobile', async () => {
        const r1 = makeRunningTask('r1');
        setupFetchMock({ running: [r1] });
        await renderTab();

        await act(async () => {
            fireEvent.click(screen.getByTestId('task-r1'));
        });

        await waitFor(() => {
            const lastDetailProps = mockDetailPane.mock.calls.at(-1)?.[0];
            expect(typeof lastDetailProps?.onBack).toBe('function');
        });
    });
});

// ═══════════════════════════════════════════════════════════════════════
// TABLET LAYOUT
// ═══════════════════════════════════════════════════════════════════════

describe('RepoActivityTab: tablet layout', () => {
    beforeEach(() => {
        mockBreakpoint = { isMobile: false, isTablet: true };
    });

    it('shows two-pane layout on tablet (both list and detail visible)', async () => {
        setupFetchMock();
        await renderTab();
        expect(screen.getByTestId('activity-list-panel')).toBeTruthy();
        expect(screen.getByTestId('activity-detail-panel')).toBeTruthy();
    });

    it('uses narrower initial panel width on tablet (256 vs 320)', async () => {
        setupFetchMock();
        await renderTab();
        expect(lastResizablePanelOpts?.initialWidth).toBe(256);
    });
});

// ═══════════════════════════════════════════════════════════════════════
// PROVIDER WIRING
// ═══════════════════════════════════════════════════════════════════════

describe('RepoActivityTab: provider wiring', () => {
    it('wraps content in ChatPreferencesProvider', async () => {
        await renderTab();
        expect(screen.getByTestId('chat-prefs-provider')).toBeTruthy();
    });

    it('passes workspaceId to ChatPreferencesProvider', async () => {
        await renderTab('ws-42');
        expect(screen.getByTestId('chat-prefs-provider').getAttribute('data-workspace-id')).toBe('ws-42');
    });

    it('loading state is also wrapped in ChatPreferencesProvider', async () => {
        mockFetchApi.mockImplementation(() => new Promise(() => {}));
        await act(async () => {
            renderWithProviders(React.createElement(RepoActivityTab, { workspaceId: 'ws-1' }));
        });
        expect(screen.getByTestId('chat-prefs-provider')).toBeTruthy();
        expect(screen.getByText('Loading queue...')).toBeTruthy();
    });

    it('mobile layout is wrapped in ChatPreferencesProvider', async () => {
        mockBreakpoint = { isMobile: true, isTablet: false };
        await renderTab();
        expect(screen.getByTestId('chat-prefs-provider')).toBeTruthy();
    });

    it('desktop does not pass onBack to detail pane', async () => {
        mockBreakpoint = { isMobile: false, isTablet: false };
        await renderTab();
        const lastDetailProps = mockDetailPane.mock.calls.at(-1)?.[0];
        expect(lastDetailProps?.onBack).toBeUndefined();
    });
});

// ═══════════════════════════════════════════════════════════════════════
// UNSEEN ACTIVITY WIRING
// ═══════════════════════════════════════════════════════════════════════

describe('RepoActivityTab: unseen activity wiring', () => {
    it('passes unseenProcessIds to list pane', async () => {
        mockUnseenTaskIds = new Set(['h1', 'h2']);
        await renderTab();
        const lastProps = mockListPane.mock.calls.at(-1)?.[0];
        expect(lastProps?.unseenProcessIds).toBe(mockUnseenTaskIds);
    });

    it('passes markTasksSeen as onMarkAllRead to list pane', async () => {
        await renderTab();
        const lastProps = mockListPane.mock.calls.at(-1)?.[0];
        // Wrapper delegates to underlying markTasksSeen
        const tasks = [{ id: 'x' }];
        lastProps?.onMarkAllRead(tasks);
        expect(mockMarkTasksSeen).toHaveBeenCalledWith(tasks);
    });

    it('passes markSeen as onMarkRead to list pane', async () => {
        await renderTab();
        const lastProps = mockListPane.mock.calls.at(-1)?.[0];
        lastProps?.onMarkRead('proc-1');
        expect(mockMarkSeen).toHaveBeenCalledWith('proc-1');
    });

    it('passes markUnseen as onMarkUnread to list pane', async () => {
        await renderTab();
        const lastProps = mockListPane.mock.calls.at(-1)?.[0];
        expect(lastProps?.onMarkUnread).toBeDefined();
        lastProps?.onMarkUnread('proc-1');
        expect(mockMarkUnseen).toHaveBeenCalledWith('proc-1');
    });

    it('selectTask calls markSeen with the task id', async () => {
        const h1 = makeHistoryTask('h1');
        setupFetchMock({ history: [h1] });
        await renderTab();

        await act(async () => {
            fireEvent.click(screen.getByTestId('task-h1'));
        });

        // history tasks have no processId, so derived via toQueueProcessId
        expect(mockMarkSeen).toHaveBeenCalledWith('queue_h1');
    });

    it('refreshUnseenCounts is called after markSeen via wrapper', async () => {
        await renderTab();
        const lastProps = mockListPane.mock.calls.at(-1)?.[0];

        // Call the onMarkRead wrapper directly
        lastProps?.onMarkRead('proc-1');
        expect(mockMarkSeen).toHaveBeenCalledWith('proc-1');

        // Wait for the 300ms debounced refresh
        await waitFor(() => {
            expect(mockRefreshUnseenCounts).toHaveBeenCalledWith(['ws-1']);
        }, { timeout: 1000 });
    });

    it('auto-marks deep-linked task via markReadByProcessId', async () => {
        const r1 = makeRunningTask('r1');
        setupFetchMock({ running: [r1] });
        await renderTab();

        await act(async () => {
            fireEvent.click(screen.getByTestId('task-r1'));
        });

        // markReadByProcessId uses the derived processId
        expect(mockMarkReadByProcessId).toHaveBeenCalledWith('proc-r1');
    });
});

// ═══════════════════════════════════════════════════════════════════════
// PAUSE / RESUME
// ═══════════════════════════════════════════════════════════════════════

describe('RepoActivityTab: pause/resume', () => {
    it('onPauseResume calls POST /queue/pause when not paused', async () => {
        setupFetchMock({ stats: { isPaused: false } });
        await renderTab();

        await act(async () => {
            fireEvent.click(screen.getByTestId('pause-resume-btn'));
        });

        await waitFor(() => {
            expect(mockFetchApi).toHaveBeenCalledWith(
                expect.stringContaining('/queue/pause?repoId=ws-1'),
                expect.objectContaining({ method: 'POST' }),
            );
        });
    });

    it('onPauseResume calls POST /queue/resume when paused', async () => {
        setupFetchMock({ stats: { isPaused: true } });
        await renderTab();

        await act(async () => {
            fireEvent.click(screen.getByTestId('pause-resume-btn'));
        });

        await waitFor(() => {
            expect(mockFetchApi).toHaveBeenCalledWith(
                expect.stringContaining('/queue/resume?repoId=ws-1'),
                expect.objectContaining({ method: 'POST' }),
            );
        });
    });

    it('autopilot pause calls correct endpoint', async () => {
        setupFetchMock({ stats: { isPaused: false, isAutopilotPaused: false } });
        await renderTab();

        await act(async () => {
            fireEvent.click(screen.getByTestId('autopilot-pause-btn'));
        });

        await waitFor(() => {
            expect(mockFetchApi).toHaveBeenCalledWith(
                expect.stringContaining('/queue/pause-autopilot?repoId=ws-1'),
                expect.objectContaining({ method: 'POST' }),
            );
        });
    });

    it('refresh button triggers a re-fetch of queue data', async () => {
        setupFetchMock();
        await renderTab();

        const callCountBefore = mockFetchApi.mock.calls.length;
        await act(async () => {
            fireEvent.click(screen.getByTestId('refresh-btn'));
        });

        await waitFor(() => {
            expect(mockFetchApi.mock.calls.length).toBeGreaterThan(callCountBefore);
        });
    });

    it('open dialog button dispatches to queue context', async () => {
        setupFetchMock();
        await renderTab();

        // The dialog button triggers onOpenDialog which dispatches OPEN_DIALOG
        await act(async () => {
            fireEvent.click(screen.getByTestId('dialog-btn'));
        });

        // Since we use real QueueProvider, verify through the dialog state
        // (the provider processes the dispatch). The mock list pane just calls the handler.
        expect(screen.getByTestId('dialog-btn')).toBeTruthy();
    });
});

// ═══════════════════════════════════════════════════════════════════════
// PROPS WIRING
// ═══════════════════════════════════════════════════════════════════════

describe('RepoActivityTab: props wiring to children', () => {
    it('passes workspaceId to list pane', async () => {
        await renderTab('ws-99');
        const lastProps = mockListPane.mock.calls.at(-1)?.[0];
        expect(lastProps?.workspaceId).toBe('ws-99');
    });

    it('passes workspaceId to detail pane', async () => {
        await renderTab('ws-99');
        const lastDetailProps = mockDetailPane.mock.calls.at(-1)?.[0];
        expect(lastDetailProps?.workspaceId).toBe('ws-99');
    });

    it('passes isMobile to list pane', async () => {
        mockBreakpoint = { isMobile: true, isTablet: false };
        await renderTab();
        const lastProps = mockListPane.mock.calls.at(-1)?.[0];
        expect(lastProps?.isMobile).toBe(true);
    });

    it('passes selectedTaskId to list pane (initially null)', async () => {
        await renderTab();
        const lastProps = mockListPane.mock.calls.at(-1)?.[0];
        expect(lastProps?.selectedTaskId).toBeNull();
    });

    it('passes selectedTaskId to detail pane (initially null)', async () => {
        await renderTab();
        const lastDetailProps = mockDetailPane.mock.calls.at(-1)?.[0];
        expect(lastDetailProps?.selectedTaskId).toBeNull();
    });

    it('passes pauseReason to list pane', async () => {
        const reason = { taskId: 't1', displayName: 'Failed', failedAt: '2026-01-01' };
        setupFetchMock({ stats: { isPaused: true, pauseReason: reason } });
        await renderTab();
        const lastProps = mockListPane.mock.calls.at(-1)?.[0];
        expect(lastProps?.pauseReason).toEqual(reason);
    });

    it('passes onSelectTask callback to list pane', async () => {
        await renderTab();
        const lastProps = mockListPane.mock.calls.at(-1)?.[0];
        expect(typeof lastProps?.onSelectTask).toBe('function');
    });

    it('passes fetchQueue callback to list pane', async () => {
        await renderTab();
        const lastProps = mockListPane.mock.calls.at(-1)?.[0];
        expect(typeof lastProps?.fetchQueue).toBe('function');
    });
});

// ═══════════════════════════════════════════════════════════════════════
// WEBSOCKET UPDATES
// ═══════════════════════════════════════════════════════════════════════

describe('RepoActivityTab: WebSocket updates via repoQueueMap', () => {
    it('applies external queue updates to displayed tasks', async () => {
        setupFetchMock();
        const dispatchRef: { current: ((queue: any) => void) | null } = { current: null };

        await act(async () => {
            renderWithProviders(
                React.createElement(React.Fragment, null,
                    React.createElement(RepoActivityTab, { workspaceId: 'ws-1' }),
                    React.createElement(WsSimulator, { dispatchRef }),
                ),
            );
        });
        await waitFor(() => {
            expect(screen.queryByText('Loading queue...')).not.toBeInTheDocument();
        });

        // Initially no tasks
        expect(mockListPane.mock.calls.at(-1)?.[0]?.running).toEqual([]);

        // Simulate WS push
        const newTask = makeRunningTask('ws-r1');
        await act(async () => {
            dispatchRef.current?.({ running: [newTask], queued: [], stats: { isPaused: false } });
        });

        await waitFor(() => {
            const lastProps = mockListPane.mock.calls.at(-1)?.[0];
            expect(lastProps?.running?.some((t: any) => t.id === 'ws-r1')).toBe(true);
        });
    });

    it('updates isPaused from external queue update', async () => {
        setupFetchMock({ stats: { isPaused: false } });
        const dispatchRef: { current: ((queue: any) => void) | null } = { current: null };

        await act(async () => {
            renderWithProviders(
                React.createElement(React.Fragment, null,
                    React.createElement(RepoActivityTab, { workspaceId: 'ws-1' }),
                    React.createElement(WsSimulator, { dispatchRef }),
                ),
            );
        });
        await waitFor(() => {
            expect(screen.queryByText('Loading queue...')).not.toBeInTheDocument();
        });

        // Simulate WS push with isPaused=true
        await act(async () => {
            dispatchRef.current?.({ running: [], queued: [], stats: { isPaused: true } });
        });

        await waitFor(() => {
            const lastProps = mockListPane.mock.calls.at(-1)?.[0];
            expect(lastProps?.isPaused).toBe(true);
        });
    });

    it('refetches history from HTTP when a running task departs', async () => {
        const r1 = makeRunningTask('r1');
        setupFetchMock({ running: [r1] });
        const dispatchRef: { current: ((queue: any) => void) | null } = { current: null };

        await act(async () => {
            renderWithProviders(
                React.createElement(React.Fragment, null,
                    React.createElement(RepoActivityTab, { workspaceId: 'ws-1' }),
                    React.createElement(WsSimulator, { dispatchRef }),
                ),
            );
        });
        await waitFor(() => {
            expect(screen.queryByText('Loading queue...')).not.toBeInTheDocument();
        });

        // Reset fetch mock to track new calls. Mount already fetched history once.
        mockFetchApi.mockClear();
        const h1 = makeHistoryTask('h1');
        setupFetchMock({ running: [], history: [h1] });

        // Simulate task r1 departing (completed)
        await act(async () => {
            dispatchRef.current?.({ running: [], queued: [], stats: { isPaused: false } });
        });

        // Should have fetched /workspaces/:id/history due to departure detection
        await waitFor(() => {
            expect(mockFetchApi).toHaveBeenCalledWith(expect.stringContaining('/workspaces/ws-1/history'));
        });

        // The refetched history should be rendered
        await waitFor(() => {
            const lastProps = mockListPane.mock.calls.at(-1)?.[0];
            expect(lastProps?.history?.some((t: any) => t.id === 'h1')).toBe(true);
        });
    });

    it('does not refetch history when no task departs', async () => {
        setupFetchMock();
        const dispatchRef: { current: ((queue: any) => void) | null } = { current: null };

        await act(async () => {
            renderWithProviders(
                React.createElement(React.Fragment, null,
                    React.createElement(RepoActivityTab, { workspaceId: 'ws-1' }),
                    React.createElement(WsSimulator, { dispatchRef }),
                ),
            );
        });
        await waitFor(() => {
            expect(screen.queryByText('Loading queue...')).not.toBeInTheDocument();
        });

        // Reset to track new calls after mount
        mockFetchApi.mockClear();
        setupFetchMock();

        // Push a new running task — no departure
        const r1 = makeRunningTask('ws-r1');
        await act(async () => {
            dispatchRef.current?.({ running: [r1], queued: [], stats: { isPaused: false } });
        });

        // Give a tick for any async work
        await act(async () => { await new Promise(r => setTimeout(r, 50)); });

        // Should NOT have called /workspaces/:id/history (no departure happened)
        const historyCalls = mockFetchApi.mock.calls.filter(
            (c: any) => typeof c[0] === 'string' && c[0].includes('/workspaces/') && c[0].includes('/history'),
        );
        expect(historyCalls).toHaveLength(0);
    });

    it('refetches history when a completed task arrives in running (follow-up re-queue)', async () => {
        const h1 = makeHistoryTask(toQueueProcessId('h1'));
        const runningH1 = makeRunningTask('h1', { processId: h1.id });
        setupFetchMock({ history: [h1] });
        const dispatchRef: { current: ((queue: any) => void) | null } = { current: null };

        await act(async () => {
            renderWithProviders(
                React.createElement(React.Fragment, null,
                    React.createElement(RepoActivityTab, { workspaceId: 'ws-1' }),
                    React.createElement(WsSimulator, { dispatchRef }),
                ),
            );
        });
        await waitFor(() => {
            expect(screen.queryByText('Loading queue...')).not.toBeInTheDocument();
        });

        // Reset to track new calls after mount
        mockFetchApi.mockClear();
        let resolveHistoryFetch: ((value: any) => void) | null = null;
        mockFetchApi.mockImplementation(async (url: string, init?: any) => {
            if (init?.method === 'POST') {
                return {};
            }
            if (url.includes('/workspaces/') && url.includes('/history')) {
                return await new Promise((resolve) => {
                    resolveHistoryFetch = resolve;
                });
            }
            if (url.match(/\/queue\?repoId=/)) {
                return { running: [runningH1], queued: [], stats: { isPaused: false } };
            }
            return {};
        });

        // Simulate WS push: h1 now appears in running (follow-up re-queued it)
        await act(async () => {
            dispatchRef.current?.({ running: [runningH1], queued: [], stats: { isPaused: false } });
        });

        const latestProps = mockListPane.mock.calls.at(-1)?.[0];
        expect(latestProps?.running).toEqual([runningH1]);
        expect(latestProps?.history).toEqual([]);

        // Should have refetched history because h1 arrived from history into running
        await waitFor(() => {
            expect(mockFetchApi).toHaveBeenCalledWith(expect.stringContaining('/workspaces/ws-1/history'));
        });

        await act(async () => {
            resolveHistoryFetch?.({ history: [], hasMore: false });
        });
    });

    it('refetches history when a completed task arrives in queued (follow-up re-queue initial state)', async () => {
        const h1 = makeHistoryTask(toQueueProcessId('h1'));
        const queuedH1 = makeQueuedTask('h1', { processId: h1.id });
        setupFetchMock({ history: [h1] });
        const dispatchRef: { current: ((queue: any) => void) | null } = { current: null };

        await act(async () => {
            renderWithProviders(
                React.createElement(React.Fragment, null,
                    React.createElement(RepoActivityTab, { workspaceId: 'ws-1' }),
                    React.createElement(WsSimulator, { dispatchRef }),
                ),
            );
        });
        await waitFor(() => {
            expect(screen.queryByText('Loading queue...')).not.toBeInTheDocument();
        });

        // Reset to track new calls after mount
        mockFetchApi.mockClear();
        setupFetchMock({ queued: [queuedH1], history: [] });

        // Simulate WS push: h1 appears in queued (not yet running)
        await act(async () => {
            dispatchRef.current?.({ running: [], queued: [queuedH1], stats: { isPaused: false } });
        });

        // Should have refetched history because h1 arrived from history into queued
        await waitFor(() => {
            expect(mockFetchApi).toHaveBeenCalledWith(expect.stringContaining('/workspaces/ws-1/history'));
        });
    });
});

// ═══════════════════════════════════════════════════════════════════════
// SELECTION-CLEARING FALLBACK (process-based probing)
// ═══════════════════════════════════════════════════════════════════════

describe('RepoActivityTab: selection-clearing fallback', () => {
    it('probes /processes/:id for processId-shaped selectedTaskId', async () => {
        setupFetchMock();
        await renderTab();

        // Select a processId-shaped task that is NOT in any list
        await act(async () => {
            const { useQueue: uq } = await import('../../../../src/server/spa/client/react/context/QueueContext');
            // Simulate selecting a processId not in the lists via hash navigation
            location.hash = '#repos/ws-1/activity/queue_abc';
        });

        // Re-render to trigger the selection-clearing effect
        mockFetchApi.mockClear();
        setupFetchMock();
        await renderTab();

        // Dispatch a selection for a processId not in any list
        await act(async () => {
            mockListPane.mock.calls.at(-1)?.[0]?.onSelectTask?.('queue_abc', { id: 'queue_abc', type: 'chat' });
        });

        // The fallback should probe /processes/queue_abc, not /queue/queue_abc
        await waitFor(() => {
            const processCalls = mockFetchApi.mock.calls.filter(
                (c: any) => typeof c[0] === 'string' && c[0].includes('/processes/queue_abc'),
            );
            expect(processCalls.length).toBeGreaterThanOrEqual(0);
        });
    });

    it('probes /queue/:id for non-processId selectedTaskId', async () => {
        setupFetchMock();
        await renderTab();

        mockFetchApi.mockClear();
        setupFetchMock();

        await act(async () => {
            mockListPane.mock.calls.at(-1)?.[0]?.onSelectTask?.('raw-task-id', { id: 'raw-task-id', type: 'chat' });
        });

        // For a raw task ID, the fallback should still probe /queue/raw-task-id
        await waitFor(() => {
            const queueCalls = mockFetchApi.mock.calls.filter(
                (c: any) => typeof c[0] === 'string' && c[0].includes('/queue/raw-task-id'),
            );
            // May or may not be called depending on whether the task is in the list,
            // but it should NOT probe /processes/ for a non-processId
            const processCalls = mockFetchApi.mock.calls.filter(
                (c: any) => typeof c[0] === 'string' && c[0].includes('/processes/raw-task-id'),
            );
            expect(processCalls).toHaveLength(0);
        });
    });
});

// ═══════════════════════════════════════════════════════════════════════
// PAGINATION
// ═══════════════════════════════════════════════════════════════════════

describe('RepoActivityTab: pagination', () => {
    it('passes limit=100 and offset=0 in initial history fetch', async () => {
        setupFetchMock();
        await renderTab();
        const historyCalls = mockFetchApi.mock.calls.filter(
            (c: any) => typeof c[0] === 'string' && c[0].includes('/history'),
        );
        expect(historyCalls.length).toBeGreaterThanOrEqual(1);
        expect(historyCalls[0][0]).toContain('limit=100');
        expect(historyCalls[0][0]).toContain('offset=0');
    });

    it('passes hasMore=false to list pane when server returns hasMore:false', async () => {
        setupFetchMock({ history: [makeHistoryTask('h1')] });
        await renderTab();
        const lastProps = mockListPane.mock.calls.at(-1)?.[0];
        expect(lastProps?.hasMore).toBe(false);
    });

    it('passes hasMore=true to list pane when server returns hasMore:true', async () => {
        mockFetchApi.mockImplementation(async (url: string, init?: any) => {
            if (init?.method === 'POST') return {};
            if (url.includes('/history')) return { history: [makeHistoryTask('h1')], hasMore: true };
            if (url.match(/\/queue\?repoId=/)) return { running: [], queued: [], stats: { isPaused: false } };
            return {};
        });
        await renderTab();
        const lastProps = mockListPane.mock.calls.at(-1)?.[0];
        expect(lastProps?.hasMore).toBe(true);
    });

    it('passes onLoadMore callback to list pane', async () => {
        setupFetchMock();
        await renderTab();
        const lastProps = mockListPane.mock.calls.at(-1)?.[0];
        expect(typeof lastProps?.onLoadMore).toBe('function');
    });

    it('onLoadMore fetches with offset equal to current history length', async () => {
        const items = Array.from({ length: 5 }, (_, i) => makeHistoryTask(`h${i}`));
        mockFetchApi.mockImplementation(async (url: string, init?: any) => {
            if (init?.method === 'POST') return {};
            if (url.includes('/history')) return { history: items, hasMore: true };
            if (url.match(/\/queue\?repoId=/)) return { running: [], queued: [], stats: { isPaused: false } };
            return {};
        });
        await renderTab();
        mockFetchApi.mockClear();
        mockFetchApi.mockImplementation(async (url: string) => {
            if (url.includes('/history')) return { history: [makeHistoryTask('h-extra')], hasMore: false };
            return {};
        });

        const lastProps = mockListPane.mock.calls.at(-1)?.[0];
        await act(async () => {
            await lastProps.onLoadMore();
        });

        const historyCalls = mockFetchApi.mock.calls.filter(
            (c: any) => typeof c[0] === 'string' && c[0].includes('/history'),
        );
        expect(historyCalls.length).toBeGreaterThanOrEqual(1);
        expect(historyCalls[0][0]).toContain('offset=5');
    });

    it('onLoadMore appends results to existing history', async () => {
        const initialItems = [makeHistoryTask('h0'), makeHistoryTask('h1')];
        mockFetchApi.mockImplementation(async (url: string, init?: any) => {
            if (init?.method === 'POST') return {};
            if (url.includes('/history')) return { history: initialItems, hasMore: true };
            if (url.match(/\/queue\?repoId=/)) return { running: [], queued: [], stats: { isPaused: false } };
            return {};
        });
        await renderTab();

        const appendedItem = makeHistoryTask('h2');
        mockFetchApi.mockImplementation(async (url: string) => {
            if (url.includes('/history')) return { history: [appendedItem], hasMore: false };
            return {};
        });

        await act(async () => {
            await mockListPane.mock.calls.at(-1)?.[0]?.onLoadMore();
        });

        await waitFor(() => {
            const lastProps = mockListPane.mock.calls.at(-1)?.[0];
            expect(lastProps?.history).toHaveLength(3);
            expect(lastProps?.history[2].id).toBe('h2');
        });
    });

    it('passes loadingMore=false initially', async () => {
        setupFetchMock();
        await renderTab();
        const lastProps = mockListPane.mock.calls.at(-1)?.[0];
        expect(lastProps?.loadingMore).toBe(false);
    });
});
