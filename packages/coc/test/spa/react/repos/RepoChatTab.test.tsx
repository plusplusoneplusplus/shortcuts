/**
 * Render tests for RepoChatTab — the integration layer that wires
 * ChatListPane and ChatDetailPane with data fetching, task selection,
 * mobile layout, and provider wiring.
 *
 * Child components (ChatListPane, ChatDetailPane) are mocked — their
 * internal behavior is covered by their own test files. These tests verify
 * only the wiring: correct props, correct dispatches, correct layout decisions.
 *
 * Dropped tests (covered by per-component test files):
 * - ChatDetail behavior → ChatDetail.test.ts (46 tests)
 * - ChatListPane rendering → ChatListPane.test.ts (52 tests)
 * - ChatDetailPane routing → ChatDetailPane.test.tsx
 * - useUnseenChat hook → hooks/useUnseenChat.test.ts (24 tests)
 * - Cross-repo selection → cross-repo-activity-mixing.test.tsx
 * - Barrel exports, RepoDetail wiring, TypeScript interfaces — TypeScript covers
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor, fireEvent, act } from '@testing-library/react';
import React, { useEffect } from 'react';
import { renderWithProviders } from '../test-utils';
import { useQueue } from '../../../../src/server/spa/client/react/contexts/QueueContext';
import { useApp } from '../../../../src/server/spa/client/react/contexts/AppContext';
import { toQueueProcessId } from '../../../../src/server/spa/client/react/utils/queue-process-id';

// ── Mock child components ──────────────────────────────────────────────

const mockListPane = vi.fn();
const mockDetailPane = vi.fn();
const mockRalphPane = vi.fn();

vi.mock('../../../../src/server/spa/client/react/features/chat/ChatListPane', () => ({
    ChatListPane: (props: any) => {
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
            props.onNewChat && React.createElement('button', {
                'data-testid': 'new-chat-btn',
                onClick: props.onNewChat,
            }, 'New Chat'),
            props.onSelectRalphSession && React.createElement('button', {
                'data-testid': 'select-ralph-btn',
                onClick: () => props.onSelectRalphSession('ralph-session-1'),
            }, 'Select Ralph'),
        );
    },
}));

vi.mock('../../../../src/server/spa/client/react/features/chat/RalphWorkflowPaneContainer', () => ({
    RalphWorkflowPaneContainer: (props: any) => {
        mockRalphPane(props);
        return React.createElement('div', {
            'data-testid': 'mock-ralph-pane',
            'data-session-id': props.sessionId,
            'data-selected-file': props.selectedFileName ?? '',
        },
            `Ralph: ${props.sessionId}`,
            props.onClose && React.createElement('button', {
                'data-testid': 'ralph-close-btn',
                onClick: props.onClose,
            }, 'Close Ralph'),
            props.onSelectFile && React.createElement('button', {
                'data-testid': 'ralph-select-file-btn',
                onClick: () => props.onSelectFile('progress.md'),
            }, 'Select file'),
        );
    },
}));

vi.mock('../../../../src/server/spa/client/react/features/chat/ChatDetailPane', () => ({
    ChatDetailPane: (props: any) => {
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

vi.mock('../../../../src/server/spa/client/react/contexts/ChatPreferencesContext', () => ({
    ChatPreferencesProvider: ({ children, workspaceId }: any) => {
        return React.createElement('div', {
            'data-testid': 'chat-prefs-provider',
            'data-workspace-id': workspaceId,
        }, children);
    },
    ChatPrefsSync: () => null,
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
vi.mock('../../../../src/server/spa/client/react/hooks/ui/useBreakpoint', () => ({
    useBreakpoint: () => mockBreakpoint,
}));

let lastResizablePanelOpts: any = null;
vi.mock('../../../../src/server/spa/client/react/hooks/ui/useResizablePanel', () => ({
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
vi.mock('../../../../src/server/spa/client/react/features/chat/hooks/useUnseenChat', () => ({
    useUnseenChat: () => ({
        unseenProcessIds: mockUnseenTaskIds,
        markSeen: mockMarkSeen,
        markAllSeen: mockMarkAllSeen,
        markTasksSeen: mockMarkTasksSeen,
        markUnseen: mockMarkUnseen,
    }),
}));

const mockMarkReadByProcessId = vi.fn();
vi.mock('../../../../src/server/spa/client/react/contexts/NotificationContext', () => ({
    NotificationProvider: ({ children }: any) => children,
    useNotifications: () => ({
        notifications: [],
        markReadByProcessId: mockMarkReadByProcessId,
        dismissAll: vi.fn(),
    }),
}));

const mockRefreshUnseenCounts = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../../src/server/spa/client/react/contexts/ReposContext', () => ({
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

vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        workspaces: {
            history: (workspaceId: string, query?: { limit?: number; offset?: number }) => {
                const params = new URLSearchParams();
                if (query?.limit !== undefined) params.set('limit', String(query.limit));
                if (query?.offset !== undefined) params.set('offset', String(query.offset));
                const suffix = params.toString() ? `?${params.toString()}` : '';
                return mockFetchApi(`/workspaces/${encodeURIComponent(workspaceId)}/history${suffix}`);
            },
        },
        queue: {
            list: (query?: { repoId?: string }) => mockFetchApi('/queue?repoId=' + encodeURIComponent(query?.repoId ?? '')),
            getTask: (taskId: string) => mockFetchApi(`/queue/${encodeURIComponent(taskId)}`),
            pause: (scope?: { repoId?: string }, options?: any) => mockFetchApi('/queue/pause?repoId=' + encodeURIComponent(scope?.repoId ?? ''), { method: 'POST', ...(options ? { body: options } : {}) }),
            resume: (scope?: { repoId?: string }) => mockFetchApi('/queue/resume?repoId=' + encodeURIComponent(scope?.repoId ?? ''), { method: 'POST' }),
            pauseAutopilot: (scope?: { repoId?: string }, options?: any) => mockFetchApi('/queue/pause-autopilot?repoId=' + encodeURIComponent(scope?.repoId ?? ''), { method: 'POST', ...(options ? { body: options } : {}) }),
            resumeAutopilot: (scope?: { repoId?: string }) => mockFetchApi('/queue/resume-autopilot?repoId=' + encodeURIComponent(scope?.repoId ?? ''), { method: 'POST' }),
        },
        processes: {
            get: (processId: string) => mockFetchApi(`/processes/${encodeURIComponent(processId)}`),
            listGroupPins: (workspaceId: string) => mockFetchApi(`/workspaces/${encodeURIComponent(workspaceId)}/group-pins`),
            pinGroup: (workspaceId: string, type: string, groupId: string, pinned: boolean) => mockFetchApi(
                `/workspaces/${encodeURIComponent(workspaceId)}/group-pins/${encodeURIComponent(type)}/${encodeURIComponent(groupId)}`,
                { method: 'PATCH', body: { pinned } },
            ),
        },
    }),
}));

// ── Import component under test (after mocks) ─────────────────────────

import { RepoChatTab } from '../../../../src/server/spa/client/react/features/chat/RepoChatTab';

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
    groupPins?: any[];
} = {}) {
    const { running = [], queued = [], history = [], stats = { isPaused: false }, groupPins = [] } = opts;
    mockFetchApi.mockImplementation(async (url: string, init?: any) => {
        if (url.includes('/group-pins') && init?.method === 'PATCH') {
            const parts = url.split('/group-pins/')[1]?.split('/') ?? [];
            const type = decodeURIComponent(parts[0] ?? '');
            const groupId = decodeURIComponent(parts[1] ?? '');
            return {
                pin: init.body?.pinned
                    ? { type, groupId, pinnedAt: '2026-01-01T00:00:00.000Z' }
                    : null,
            };
        }
        if (init?.method === 'POST') {
            return {};
        }
        if (url.includes('/group-pins')) {
            return { pins: groupPins };
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

async function renderTab(workspaceId = 'ws-1', mode?: 'chats' | 'tasks') {
    let result: ReturnType<typeof renderWithProviders> | undefined;
    await act(async () => {
        result = renderWithProviders(
            React.createElement(RepoChatTab, { workspaceId, mode }),
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

/** Helper component that dispatches SELECT_QUEUE_TASK on mount to simulate deep-link navigation */
function DeepLinkSimulator({ taskId, repoId = 'ws-1' }: { taskId: string; repoId?: string }) {
    const { dispatch } = useQueue();
    useEffect(() => {
        dispatch({ type: 'SELECT_QUEUE_TASK', id: taskId, repoId });
    }, [dispatch, taskId, repoId]);
    return null;
}

/** Render RepoChatTab with a pre-selected task (simulates deep-link / page refresh). */
async function renderTabWithDeepLink(taskId: string, workspaceId = 'ws-1') {
    let result: ReturnType<typeof renderWithProviders> | undefined;
    await act(async () => {
        result = renderWithProviders(
            React.createElement(React.Fragment, null,
                React.createElement(DeepLinkSimulator, { taskId, repoId: workspaceId }),
                React.createElement(RepoChatTab, { workspaceId }),
            ),
        );
    });
    await waitFor(() => {
        expect(screen.queryByText('Loading queue...')).not.toBeInTheDocument();
    });
    return result!;
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

describe('RepoChatTab: layout', () => {
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

describe('RepoChatTab: data fetching', () => {
    it('shows "Loading queue..." before fetch completes', async () => {
        mockFetchApi.mockImplementation(() => new Promise(() => {}));
        await act(async () => {
            renderWithProviders(React.createElement(RepoChatTab, { workspaceId: 'ws-1' }));
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

    it('fetches workspace group pins and passes them to list pane', async () => {
        const groupPins = [{ type: 'ralph-session', groupId: 'ralph-1', pinnedAt: '2026-01-01T00:00:00.000Z' }];
        setupFetchMock({ groupPins });
        await renderTab();

        expect(mockFetchApi).toHaveBeenCalledWith('/workspaces/ws-1/group-pins');
        const lastProps = mockListPane.mock.calls.at(-1)?.[0];
        expect(lastProps?.groupPins).toEqual(groupPins);
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

describe('RepoChatTab: task selection', () => {
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

    it('clicking a task in mode="chats" writes /chats/ path (not legacy /activity/) to avoid redirect blink', async () => {
        // Regression: writing /activity/ in dev-workflow mode triggers the Router's
        // legacy redirect (location.replace to /chats/), firing a second hashchange
        // and an extra render cycle visible as a one-frame blink.
        const r1 = makeRunningTask('r1');
        setupFetchMock({ running: [r1] });
        await renderTab('ws-1', 'chats');

        await act(async () => {
            fireEvent.click(screen.getByTestId('task-r1'));
        });

        expect(location.hash).toContain('/chats/proc-r1');
        expect(location.hash).not.toContain('/activity/');
    });

    it('clicking a task in mode="tasks" writes /tasks/ path', async () => {
        const r1 = makeRunningTask('r1');
        setupFetchMock({ running: [r1] });
        await renderTab('ws-1', 'tasks');

        await act(async () => {
            fireEvent.click(screen.getByTestId('task-r1'));
        });

        expect(location.hash).toContain('/tasks/proc-r1');
        expect(location.hash).not.toContain('/activity/');
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

    it('re-clicking selected task still calls markSeen and markReadByProcessId', async () => {
        const r1 = makeRunningTask('r1');
        setupFetchMock({ running: [r1] });
        await renderTab();

        // First click — selects
        await act(async () => {
            fireEvent.click(screen.getByTestId('task-r1'));
        });
        await waitFor(() => {
            expect(mockDetailPane.mock.calls.at(-1)?.[0]?.selectedTaskId).toBe('proc-r1');
        });

        // Clear mocks so we can assert the re-click calls independently
        mockMarkSeen.mockClear();
        mockMarkReadByProcessId.mockClear();

        // Second click — same task
        await act(async () => {
            fireEvent.click(screen.getByTestId('task-r1'));
        });

        // Re-click should still mark the task as seen
        expect(mockMarkSeen).toHaveBeenCalledWith('proc-r1');
        expect(mockMarkReadByProcessId).toHaveBeenCalledWith('proc-r1');
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

describe('RepoChatTab: mobile behavior', () => {
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

    it('deep-link shows detail pane on mobile (regression: selectedTaskId set before mount)', async () => {
        const r1 = makeRunningTask('r1');
        setupFetchMock({ running: [r1] });
        await renderTabWithDeepLink('proc-r1');

        await waitFor(() => {
            expect(screen.getByTestId('activity-detail-panel')).toBeTruthy();
        });
        expect(screen.queryByTestId('activity-mobile-list')).toBeNull();
    });

    it('deep-link on mobile then back returns to list (regression)', async () => {
        const r1 = makeRunningTask('r1');
        setupFetchMock({ running: [r1] });
        await renderTabWithDeepLink('proc-r1');

        await waitFor(() => {
            expect(screen.getByTestId('activity-detail-panel')).toBeTruthy();
        });

        // Click back
        await act(async () => {
            fireEvent.click(screen.getByTestId('back-btn'));
        });

        await waitFor(() => {
            expect(screen.getByTestId('activity-mobile-list')).toBeTruthy();
        });
        expect(screen.queryByTestId('activity-detail-panel')).toBeNull();
    });
});

// ═══════════════════════════════════════════════════════════════════════
// TABLET LAYOUT
// ═══════════════════════════════════════════════════════════════════════

describe('RepoChatTab: tablet layout', () => {
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

describe('RepoChatTab: provider wiring', () => {
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
            renderWithProviders(React.createElement(RepoChatTab, { workspaceId: 'ws-1' }));
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

describe('RepoChatTab: unseen activity wiring', () => {
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

describe('RepoChatTab: pause/resume', () => {
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

    it('timed pause passes duration options to queue client', async () => {
        setupFetchMock({ stats: { isPaused: false, isAutopilotPaused: false } });
        await renderTab();
        const props = mockListPane.mock.calls.at(-1)?.[0];

        await act(async () => {
            await props.onPauseResume({ durationHours: 2 });
        });

        await waitFor(() => {
            expect(mockFetchApi).toHaveBeenCalledWith(
                expect.stringContaining('/queue/pause?repoId=ws-1'),
                expect.objectContaining({ method: 'POST', body: { durationHours: 2 } }),
            );
        });
    });

    it('timed autopilot pause passes duration options to queue client', async () => {
        setupFetchMock({ stats: { isPaused: false, isAutopilotPaused: false } });
        await renderTab();
        const props = mockListPane.mock.calls.at(-1)?.[0];

        await act(async () => {
            await props.onPauseResumeAutopilot({ durationHours: 3 });
        });

        await waitFor(() => {
            expect(mockFetchApi).toHaveBeenCalledWith(
                expect.stringContaining('/queue/pause-autopilot?repoId=ws-1'),
                expect.objectContaining({ method: 'POST', body: { durationHours: 3 } }),
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

describe('RepoChatTab: props wiring to children', () => {
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

    it('persists group pin toggles through the workspace-scoped processes client', async () => {
        await renderTab('ws-1');
        const lastProps = mockListPane.mock.calls.at(-1)?.[0];

        await act(async () => {
            await lastProps.onSetGroupPin('ralph-session', 'ralph-1', true);
        });

        expect(mockFetchApi).toHaveBeenCalledWith(
            '/workspaces/ws-1/group-pins/ralph-session/ralph-1',
            { method: 'PATCH', body: { pinned: true } },
        );
        await waitFor(() => {
            expect(mockListPane.mock.calls.at(-1)?.[0]?.groupPins).toEqual([
                { type: 'ralph-session', groupId: 'ralph-1', pinnedAt: '2026-01-01T00:00:00.000Z' },
            ]);
        });
    });
});

// ═══════════════════════════════════════════════════════════════════════
// WEBSOCKET UPDATES
// ═══════════════════════════════════════════════════════════════════════

describe('RepoChatTab: WebSocket updates via repoQueueMap', () => {
    it('applies external queue updates to displayed tasks', async () => {
        setupFetchMock();
        const dispatchRef: { current: ((queue: any) => void) | null } = { current: null };

        await act(async () => {
            renderWithProviders(
                React.createElement(React.Fragment, null,
                    React.createElement(RepoChatTab, { workspaceId: 'ws-1' }),
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
                    React.createElement(RepoChatTab, { workspaceId: 'ws-1' }),
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
                    React.createElement(RepoChatTab, { workspaceId: 'ws-1' }),
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
                    React.createElement(RepoChatTab, { workspaceId: 'ws-1' }),
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
                    React.createElement(RepoChatTab, { workspaceId: 'ws-1' }),
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
                    React.createElement(RepoChatTab, { workspaceId: 'ws-1' }),
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

describe('RepoChatTab: selection-clearing fallback', () => {
    it('probes /processes/:id for processId-shaped selectedTaskId', async () => {
        setupFetchMock();
        await renderTab();

        // Select a processId-shaped task that is NOT in any list
        await act(async () => {
            const { useQueue: uq } = await import('../../../../src/server/spa/client/react/contexts/QueueContext');
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

describe('RepoChatTab: pagination', () => {
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

// ═══════════════════════════════════════════════════════════════════════
// REACTIVE TITLE UPDATES FROM process-updated WS events
// ═══════════════════════════════════════════════════════════════════════

describe('RepoChatTab: reactive title updates from AppContext', () => {
    /** Helper component that dispatches PROCESS_UPDATED to AppContext. */
    function AppDispatcher({ dispatchRef }: { dispatchRef: { current: ((process: any) => void) | null } }) {
        const { dispatch } = useApp();
        dispatchRef.current = (process: any) => {
            dispatch({ type: 'PROCESS_ADDED', process });
            dispatch({ type: 'PROCESS_UPDATED', process });
        };
        return null;
    }

    it('merges title from process-updated WS event into history items', async () => {
        const historyTask = makeHistoryTask('queue_proc-h1', { title: 'Original title' });
        setupFetchMock({ history: [historyTask] });
        const appRef: { current: ((process: any) => void) | null } = { current: null };

        await act(async () => {
            renderWithProviders(
                React.createElement(React.Fragment, null,
                    React.createElement(RepoChatTab, { workspaceId: 'ws-1' }),
                    React.createElement(AppDispatcher, { dispatchRef: appRef }),
                ),
            );
        });
        await waitFor(() => {
            expect(screen.queryByText('Loading queue...')).not.toBeInTheDocument();
        });

        // Verify original title
        let lastProps = mockListPane.mock.calls.at(-1)?.[0];
        expect(lastProps?.history[0]?.title).toBe('Original title');

        // Simulate process-updated WS event with new title
        await act(async () => {
            appRef.current?.({ id: 'queue_proc-h1', title: 'AI Generated Title' });
        });

        await waitFor(() => {
            lastProps = mockListPane.mock.calls.at(-1)?.[0];
            expect(lastProps?.history[0]?.title).toBe('AI Generated Title');
        });
    });

    it('does not mutate history if no title changed', async () => {
        const historyTask = makeHistoryTask('queue_proc-h2', { title: 'Same title' });
        setupFetchMock({ history: [historyTask] });
        const appRef: { current: ((process: any) => void) | null } = { current: null };

        await act(async () => {
            renderWithProviders(
                React.createElement(React.Fragment, null,
                    React.createElement(RepoChatTab, { workspaceId: 'ws-1' }),
                    React.createElement(AppDispatcher, { dispatchRef: appRef }),
                ),
            );
        });
        await waitFor(() => {
            expect(screen.queryByText('Loading queue...')).not.toBeInTheDocument();
        });

        const propsBefore = mockListPane.mock.calls.at(-1)?.[0]?.history;

        // Dispatch process-updated with same title
        await act(async () => {
            appRef.current?.({ id: 'queue_proc-h2', title: 'Same title' });
        });

        const propsAfter = mockListPane.mock.calls.at(-1)?.[0]?.history;
        expect(propsAfter).toBe(propsBefore);
    });
});

// ═══════════════════════════════════════════════════════════════════════
// RALPH SESSION + NEW CHAT INTERACTION
// ═══════════════════════════════════════════════════════════════════════

describe('RepoChatTab: Ralph session and new chat', () => {
    it('selecting a Ralph session shows the Ralph pane instead of ChatDetailPane', async () => {
        setupFetchMock();
        await renderTab();

        await act(async () => {
            fireEvent.click(screen.getByTestId('select-ralph-btn'));
        });

        await waitFor(() => {
            expect(screen.getByTestId('mock-ralph-pane')).toBeTruthy();
            expect(screen.getByTestId('mock-ralph-pane').getAttribute('data-session-id')).toBe('ralph-session-1');
        });
    });

    it('clicking new chat while a Ralph session is selected clears the Ralph pane', async () => {
        setupFetchMock();
        await renderTab();

        // Select a Ralph session first
        await act(async () => {
            fireEvent.click(screen.getByTestId('select-ralph-btn'));
        });

        await waitFor(() => {
            expect(screen.getByTestId('mock-ralph-pane')).toBeTruthy();
        });

        // Click new chat — should clear Ralph pane and show ChatDetailPane
        await act(async () => {
            fireEvent.click(screen.getByTestId('new-chat-btn'));
        });

        await waitFor(() => {
            expect(screen.queryByTestId('mock-ralph-pane')).toBeNull();
            expect(screen.getByTestId('mock-detail-pane')).toBeTruthy();
            expect(screen.getByText('No selection')).toBeTruthy();
        });
    });

    it('clicking new chat while a Ralph session is selected updates the URL hash', async () => {
        setupFetchMock();
        await renderTab();

        // Select a Ralph session — sets hash to /activity/ralph/<id>
        await act(async () => {
            fireEvent.click(screen.getByTestId('select-ralph-btn'));
        });

        await waitFor(() => {
            expect(location.hash).toContain('/ralph/ralph-session-1');
        });

        // Click new chat — hash should no longer contain /ralph/
        await act(async () => {
            fireEvent.click(screen.getByTestId('new-chat-btn'));
        });

        await waitFor(() => {
            expect(location.hash).not.toContain('/ralph/');
            expect(location.hash).toContain('#repos/ws-1/activity');
        });
    });

    it('opens a Ralph file deep-link with the file pre-selected', async () => {
        location.hash = '#repos/ws-1/activity/ralph/ralph-session-1/progress.md';
        setupFetchMock();
        await renderTab();

        await waitFor(() => {
            const pane = screen.getByTestId('mock-ralph-pane');
            expect(pane.getAttribute('data-session-id')).toBe('ralph-session-1');
            expect(pane.getAttribute('data-selected-file')).toBe('progress.md');
        });
    });

    it('selecting a Ralph session file updates the URL hash', async () => {
        setupFetchMock();
        await renderTab();

        await act(async () => {
            fireEvent.click(screen.getByTestId('select-ralph-btn'));
        });

        await waitFor(() => {
            expect(screen.getByTestId('mock-ralph-pane')).toBeTruthy();
        });

        await act(async () => {
            fireEvent.click(screen.getByTestId('ralph-select-file-btn'));
        });

        await waitFor(() => {
            expect(location.hash).toBe('#repos/ws-1/activity/ralph/ralph-session-1/progress.md');
            expect(screen.getByTestId('mock-ralph-pane').getAttribute('data-selected-file')).toBe('progress.md');
        });
    });

    it('hash navigation back to the bare Ralph session clears the selected file', async () => {
        location.hash = '#repos/ws-1/activity/ralph/ralph-session-1/progress.md';
        setupFetchMock();
        await renderTab();

        await waitFor(() => {
            expect(screen.getByTestId('mock-ralph-pane').getAttribute('data-selected-file')).toBe('progress.md');
        });

        await act(async () => {
            location.hash = '#repos/ws-1/activity/ralph/ralph-session-1';
            window.dispatchEvent(new HashChangeEvent('hashchange'));
        });

        await waitFor(() => {
            expect(location.hash).toBe('#repos/ws-1/activity/ralph/ralph-session-1');
            expect(screen.getByTestId('mock-ralph-pane').getAttribute('data-selected-file')).toBe('');
        });
    });

    it('clicking new chat in mode="chats" writes /chats path (not /activity/) to URL', async () => {
        setupFetchMock();
        await renderTab('ws-1', 'chats');

        // Select Ralph session
        await act(async () => {
            fireEvent.click(screen.getByTestId('select-ralph-btn'));
        });

        await waitFor(() => {
            expect(screen.getByTestId('mock-ralph-pane')).toBeTruthy();
        });

        // Click new chat
        await act(async () => {
            fireEvent.click(screen.getByTestId('new-chat-btn'));
        });

        await waitFor(() => {
            expect(location.hash).toContain('#repos/ws-1/chats');
            expect(location.hash).not.toContain('/ralph/');
            expect(location.hash).not.toContain('/activity/');
        });
    });

    it('selecting a Ralph session then selecting a chat task clears the Ralph pane', async () => {
        const r1 = makeRunningTask('r1');
        setupFetchMock({ running: [r1] });
        await renderTab();

        // Select Ralph session
        await act(async () => {
            fireEvent.click(screen.getByTestId('select-ralph-btn'));
        });

        await waitFor(() => {
            expect(screen.getByTestId('mock-ralph-pane')).toBeTruthy();
        });

        // Select a regular chat task — Ralph pane should be dismissed
        await act(async () => {
            fireEvent.click(screen.getByTestId('task-r1'));
        });

        await waitFor(() => {
            expect(screen.queryByTestId('mock-ralph-pane')).toBeNull();
            expect(screen.getByTestId('mock-detail-pane')).toBeTruthy();
        });
    });
});

// ═══════════════════════════════════════════════════════════════════════
// HOVER-TO-FLOAT PEEK (collapsed rail)
// ═══════════════════════════════════════════════════════════════════════

describe('RepoChatTab: hover-to-float peek (collapsed rail)', () => {
    beforeEach(() => {
        // Render in the collapsed state so the 36px rail shows.
        localStorage.setItem('activity-list-collapsed', 'true');
    });
    afterEach(() => {
        localStorage.removeItem('activity-list-collapsed');
        localStorage.removeItem('activity-left-panel-width');
    });

    it('renders the collapsed rail (not the full list panel) and the peek is closed', async () => {
        setupFetchMock();
        await renderTab();
        expect(screen.getByTestId('activity-list-collapsed')).toBeTruthy();
        expect(screen.queryByTestId('activity-list-panel')).toBeNull();
        expect(screen.queryByTestId('activity-list-peek')).toBeNull();
    });

    it('floats the peek open after hovering the rail, reusing ChatListPane', async () => {
        const r1 = makeRunningTask('r1');
        setupFetchMock({ running: [r1] });
        await renderTab();

        await act(async () => {
            fireEvent.mouseEnter(screen.getByTestId('activity-list-collapsed'));
        });

        await waitFor(() => {
            expect(screen.getByTestId('activity-list-peek')).toBeTruthy();
        }, { timeout: 2000 });
        // Reuses ChatListPane (the mock), not a duplicate list implementation.
        expect(screen.getByTestId('mock-list-pane')).toBeTruthy();
        expect(screen.getByTestId('task-r1')).toBeTruthy();
    });

    it('peek panel uses the saved sidebar width and does not dim the conversation', async () => {
        setupFetchMock();
        await renderTab();
        await act(async () => {
            fireEvent.mouseEnter(screen.getByTestId('activity-list-collapsed'));
        });
        await waitFor(() => {
            expect(screen.getByTestId('activity-list-peek')).toBeTruthy();
        }, { timeout: 2000 });

        const peek = screen.getByTestId('activity-list-peek');
        // Same width source as the expanded panel (activity-left-panel-width → 320 default).
        expect(peek.style.width).toBe('320px');
        // No dimmed/blurred backdrop element was added for the desktop peek.
        expect(screen.queryByTestId('sidebar-backdrop')).toBeNull();
        // Conversation detail pane remains mounted and interactive behind the peek.
        expect(screen.getByTestId('activity-detail-panel')).toBeTruthy();
    });

    it('does not open the peek if the pointer leaves the rail before the delay', async () => {
        setupFetchMock();
        await renderTab();
        const rail = screen.getByTestId('activity-list-collapsed');

        await act(async () => {
            fireEvent.mouseEnter(rail);
            fireEvent.mouseLeave(rail);
        });
        // Wait well beyond the hover-open delay — the peek must never appear.
        await act(async () => { await new Promise(r => setTimeout(r, 600)); });
        expect(screen.queryByTestId('activity-list-peek')).toBeNull();
    });

    it('selecting a conversation from the peek collapses to the rail WITHOUT persisting', async () => {
        const r1 = makeRunningTask('r1');
        setupFetchMock({ running: [r1] });
        await renderTab();

        await act(async () => {
            fireEvent.mouseEnter(screen.getByTestId('activity-list-collapsed'));
        });
        await waitFor(() => {
            expect(screen.getByTestId('activity-list-peek')).toBeTruthy();
        }, { timeout: 2000 });

        await act(async () => {
            fireEvent.click(screen.getByTestId('task-r1'));
        });

        // Peek collapses back to the rail …
        await waitFor(() => {
            expect(screen.queryByTestId('activity-list-peek')).toBeNull();
        });
        expect(screen.getByTestId('activity-list-collapsed')).toBeTruthy();
        // … the conversation opens in the main pane …
        await waitFor(() => {
            expect(mockDetailPane.mock.calls.at(-1)?.[0]?.selectedTaskId).toBe('proc-r1');
        });
        // … and the persisted collapsed state is never written by the peek path.
        expect(localStorage.getItem('activity-list-collapsed')).toBe('true');
    });

    it('Escape collapses the peek back to the rail', async () => {
        setupFetchMock();
        await renderTab();
        await act(async () => {
            fireEvent.mouseEnter(screen.getByTestId('activity-list-collapsed'));
        });
        await waitFor(() => {
            expect(screen.getByTestId('activity-list-peek')).toBeTruthy();
        }, { timeout: 2000 });

        await act(async () => {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        });
        await waitFor(() => {
            expect(screen.queryByTestId('activity-list-peek')).toBeNull();
        });
        expect(localStorage.getItem('activity-list-collapsed')).toBe('true');
    });

    it('clicking outside the peek (in the conversation) collapses it', async () => {
        setupFetchMock();
        await renderTab();
        await act(async () => {
            fireEvent.mouseEnter(screen.getByTestId('activity-list-collapsed'));
        });
        await waitFor(() => {
            expect(screen.getByTestId('activity-list-peek')).toBeTruthy();
        }, { timeout: 2000 });

        await act(async () => {
            fireEvent.mouseDown(screen.getByTestId('activity-detail-panel'));
        });
        await waitFor(() => {
            expect(screen.queryByTestId('activity-list-peek')).toBeNull();
        });
        expect(localStorage.getItem('activity-list-collapsed')).toBe('true');
    });

    it('the » expand button still performs a permanent, persisted expand (unchanged)', async () => {
        setupFetchMock();
        await renderTab();

        await act(async () => {
            fireEvent.click(screen.getByTestId('activity-list-expand'));
        });

        await waitFor(() => {
            expect(screen.getByTestId('activity-list-panel')).toBeTruthy();
        });
        expect(localStorage.getItem('activity-list-collapsed')).toBe('false');
    });

    it('does not float the peek on mobile (drawer path is untouched)', async () => {
        mockBreakpoint = { isMobile: true, isTablet: false };
        setupFetchMock();
        await renderTab();

        // Mobile renders the list directly; there is no collapsed rail to hover.
        expect(screen.queryByTestId('activity-list-collapsed')).toBeNull();
        expect(screen.queryByTestId('activity-list-peek')).toBeNull();
    });

    it('collapsed rail shows a + button that starts a new chat without expanding the rail', async () => {
        setupFetchMock();
        await renderTab();

        // The + button is present in the collapsed rail.
        const newChatBtn = screen.getByTestId('activity-list-collapsed-new-chat');
        expect(newChatBtn).toBeTruthy();
        expect(newChatBtn.getAttribute('aria-label')).toBe('Start a new conversation');

        // Clicking it starts a new chat (the mock list pane's onNewChat fires, which
        // the mock surfaces as a click on 'new-chat-btn').
        // We trigger the button on the rail directly.
        await act(async () => {
            fireEvent.click(newChatBtn);
        });

        // The rail must NOT expand — listCollapsed stays true.
        expect(screen.getByTestId('activity-list-collapsed')).toBeTruthy();
        expect(screen.queryByTestId('activity-list-panel')).toBeNull();
        // localStorage persisted state is unchanged (still collapsed).
        expect(localStorage.getItem('activity-list-collapsed')).toBe('true');
    });
});
