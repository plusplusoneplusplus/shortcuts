/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ForEachRun, ForEachRunSummary } from '@plusplusoneplusplus/coc-client';

const mocks = vi.hoisted(() => ({
    forEachEnabled: true,
    isMobile: false,
    queueList: vi.fn(),
    history: vi.fn(),
    forEachList: vi.fn(),
    forEachGet: vi.fn(),
    forEachStart: vi.fn(),
    forEachContinue: vi.fn(),
    forEachRetryItem: vi.fn(),
    forEachSkipItem: vi.fn(),
    forEachCancel: vi.fn(),
    appDispatch: vi.fn(),
    refreshUnseenCounts: vi.fn(),
    markReadByProcessId: vi.fn(),
}));

vi.mock('../../../../../src/server/spa/client/react/utils/config', () => ({
    isContainerMode: () => false,
    isForEachEnabled: () => mocks.forEachEnabled,
    isMapReduceEnabled: () => false,
    isSchedulesInScheduledSlideEnabled: () => false,
    DASHBOARD_CONFIG_UPDATED_EVENT: 'coc-dashboard-config-updated',
}));

vi.mock('../../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        queue: {
            list: mocks.queueList,
            pause: vi.fn(),
            resume: vi.fn(),
            pauseAutopilot: vi.fn(),
            resumeAutopilot: vi.fn(),
            getTask: vi.fn(),
        },
        workspaces: {
            history: mocks.history,
        },
        processes: {
            get: vi.fn(),
        },
        forEach: {
            list: mocks.forEachList,
            get: mocks.forEachGet,
            start: mocks.forEachStart,
            continue: mocks.forEachContinue,
            retryItem: mocks.forEachRetryItem,
            skipItem: mocks.forEachSkipItem,
            cancel: mocks.forEachCancel,
        },
    }),
    getSpaCocClientErrorMessage: (err: unknown, fallback: string) => err instanceof Error ? err.message : fallback,
}));

vi.mock('../../../../../src/server/spa/client/react/contexts/AppContext', () => ({
    useApp: () => ({
        state: { currentAgentId: null, processes: [] },
        dispatch: mocks.appDispatch,
    }),
}));

vi.mock('../../../../../src/server/spa/client/react/contexts/ReposContext', () => ({
    useRepos: () => ({
        refreshUnseenCounts: mocks.refreshUnseenCounts,
    }),
}));

vi.mock('../../../../../src/server/spa/client/react/contexts/NotificationContext', () => ({
    useNotifications: () => ({
        markReadByProcessId: mocks.markReadByProcessId,
    }),
}));

vi.mock('../../../../../src/server/spa/client/react/contexts/ChatPreferencesContext', () => ({
    ChatPreferencesProvider: ({ children }: any) => <>{children}</>,
    ChatPrefsSync: () => null,
}));

vi.mock('../../../../../src/server/spa/client/react/hooks/ui/useBreakpoint', () => ({
    useBreakpoint: () => ({
        isMobile: mocks.isMobile,
        isTablet: false,
        isDesktop: !mocks.isMobile,
        breakpoint: mocks.isMobile ? 'mobile' : 'desktop',
    }),
}));

vi.mock('../../../../../src/server/spa/client/react/hooks/ui/useResizablePanel', () => ({
    useResizablePanel: () => ({
        width: 320,
        isDragging: false,
        handleMouseDown: vi.fn(),
        handleTouchStart: vi.fn(),
    }),
}));

vi.mock('../../../../../src/server/spa/client/react/features/chat/hooks/useUnseenChat', () => ({
    useUnseenChat: () => ({
        unseenProcessIds: new Set<string>(),
        markSeen: vi.fn(),
        markAllSeen: vi.fn(),
        markTasksSeen: vi.fn(),
        markUnseen: vi.fn(),
    }),
}));

vi.mock('../../../../../src/server/spa/client/react/processes/hooks/useProcessSearch', () => ({
    useProcessSearch: () => ({
        results: [],
        total: 0,
        loading: false,
        hasMore: false,
        loadMore: vi.fn(),
        loadingMore: false,
    }),
}));

vi.mock('../../../../../src/server/spa/client/react/utils/search-adapter', () => ({
    adaptSearchResults: () => [],
}));

vi.mock('../../../../../src/server/spa/client/react/features/chat/hooks/useChatPaneNavigation', () => ({
    useChatPaneNavigation: () => ({
        focusedPane: null,
        cursorTaskId: null,
    }),
}));

vi.mock('../../../../../src/server/spa/client/react/features/chat/ChatListPane', () => ({
    ChatListPane: ({ forEachRuns, selectedForEachRunId, onSelectForEachRun }: any) => (
        <div data-testid="chat-list-pane" data-selected-for-each-run-id={selectedForEachRunId ?? ''}>
            {forEachRuns?.map((run: ForEachRunSummary) => (
                <button
                    key={run.runId}
                    type="button"
                    data-testid={`open-for-each-${run.runId}`}
                    onClick={() => onSelectForEachRun?.(run.runId)}
                >
                    {run.originalRequest}
                </button>
            ))}
        </div>
    ),
}));

vi.mock('../../../../../src/server/spa/client/react/features/chat/ChatDetailPane', () => ({
    ChatDetailPane: () => <div data-testid="chat-detail-pane" />,
}));

vi.mock('../../../../../src/server/spa/client/react/features/chat/RalphWorkflowPaneContainer', () => ({
    RalphWorkflowPaneContainer: () => <div data-testid="ralph-workflow-pane" />,
}));

vi.mock('../../../../../src/server/spa/client/react/utils/format', () => ({
    formatRelativeTime: (value: string) => `relative:${value}`,
}));

import { QueueProvider } from '../../../../../src/server/spa/client/react/contexts/QueueContext';
import { RepoChatTab } from '../../../../../src/server/spa/client/react/features/chat/RepoChatTab';

function makeRunSummary(overrides: Partial<ForEachRunSummary> = {}): ForEachRunSummary {
    return {
        runId: 'run-1',
        workspaceId: 'ws-1',
        status: 'approved',
        originalRequest: 'Split durable parent work',
        childMode: 'ask',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:01:00.000Z',
        itemCount: 1,
        itemStatusCounts: {
            pending: 1,
            running: 0,
            completed: 0,
            failed: 0,
            skipped: 0,
        },
        ...overrides,
    };
}

function makeRun(overrides: Partial<ForEachRun> = {}): ForEachRun {
    return {
        ...makeRunSummary(),
        items: [{
            id: 'item-1',
            title: 'Item one',
            prompt: 'Do item one',
            status: 'pending',
        }],
        ...overrides,
    };
}

function renderRepoChatTab(workspaceId = 'ws-1') {
    return render(
        <QueueProvider>
            <RepoChatTab workspaceId={workspaceId} />
        </QueueProvider>,
    );
}

const ws1CollapsedKey = 'activity-list-collapsed-ws-1';

describe('RepoChatTab For Each navigation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.forEachEnabled = true;
        mocks.isMobile = false;
        window.location.hash = '';
        mocks.queueList.mockResolvedValue({
            running: [],
            queued: [],
            stats: { isPaused: false, isAutopilotPaused: false },
        });
        mocks.history.mockResolvedValue({ history: [], hasMore: false });
        mocks.forEachList.mockResolvedValue([makeRunSummary()]);
        mocks.forEachGet.mockResolvedValue(makeRun());
    });

    it('writes a durable For Each hash and opens the parent pane when a group is selected', async () => {
        renderRepoChatTab();

        fireEvent.click(await screen.findByTestId('open-for-each-run-1'));

        await waitFor(() => expect(window.location.hash).toBe('#repos/ws-1/activity/for-each/run-1'));
        await waitFor(() => expect(screen.getByTestId('for-each-run-pane')).toBeTruthy());
        expect(mocks.forEachGet).toHaveBeenCalledWith('ws-1', 'run-1');
    });

    it('restores the parent pane from a For Each hash on mobile refresh', async () => {
        mocks.isMobile = true;
        window.location.hash = '#repos/ws-1/activity/for-each/run-1';

        renderRepoChatTab();

        await waitFor(() => expect(screen.getByTestId('for-each-run-pane')).toBeTruthy());
        expect(screen.getByTestId('activity-detail-panel')).toBeTruthy();
        expect(screen.queryByTestId('activity-mobile-list')).toBeNull();
    });

    it('does not open For Each routes when the feature is disabled', async () => {
        mocks.forEachEnabled = false;
        window.location.hash = '#repos/ws-1/activity/for-each/run-1';

        renderRepoChatTab();

        await waitFor(() => expect(screen.getByTestId('chat-detail-pane')).toBeTruthy());
        expect(screen.queryByTestId('for-each-run-pane')).toBeNull();
        expect(mocks.forEachList).not.toHaveBeenCalled();
        expect(mocks.forEachGet).not.toHaveBeenCalled();
    });
});

describe('RepoChatTab chat list collapse', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.isMobile = false;
        window.location.hash = '';
        try { localStorage.clear(); } catch { /* ignore */ }
        mocks.queueList.mockResolvedValue({ running: [], queued: [], stats: { isPaused: false, isAutopilotPaused: false } });
        mocks.history.mockResolvedValue({ history: [], hasMore: false });
    });

    it('collapses and expands the chat list, persisting the choice', async () => {
        renderRepoChatTab();

        await screen.findByTestId('activity-list-panel');
        expect(screen.queryByTestId('activity-list-collapsed')).toBeNull();

        fireEvent.click(screen.getByTestId('activity-list-collapse'));

        await waitFor(() => expect(screen.getByTestId('activity-list-collapsed')).toBeTruthy());
        expect(screen.queryByTestId('activity-list-panel')).toBeNull();
        expect(localStorage.getItem(ws1CollapsedKey)).toBe('true');

        fireEvent.click(screen.getByTestId('activity-list-expand'));

        await waitFor(() => expect(screen.getByTestId('activity-list-panel')).toBeTruthy());
        expect(localStorage.getItem(ws1CollapsedKey)).toBe('false');
    });

    it('starts collapsed when the workspace-scoped persisted preference is set', async () => {
        try { localStorage.setItem(ws1CollapsedKey, 'true'); } catch { /* ignore */ }

        renderRepoChatTab();

        await waitFor(() => expect(screen.getByTestId('activity-list-collapsed')).toBeTruthy());
        expect(screen.queryByTestId('activity-list-panel')).toBeNull();
    });

    it('does not apply another workspace collapsed preference', async () => {
        try { localStorage.setItem(ws1CollapsedKey, 'true'); } catch { /* ignore */ }

        renderRepoChatTab('ws-2');

        await screen.findByTestId('activity-list-panel');
        expect(screen.queryByTestId('activity-list-collapsed')).toBeNull();
        expect(localStorage.getItem('activity-list-collapsed-ws-2')).toBeNull();
    });

    it('ignores the abandoned global collapsed preference on first workspace visit', async () => {
        try { localStorage.setItem('activity-list-collapsed', 'true'); } catch { /* ignore */ }

        renderRepoChatTab();

        await screen.findByTestId('activity-list-panel');
        expect(screen.queryByTestId('activity-list-collapsed')).toBeNull();
        expect(localStorage.getItem(ws1CollapsedKey)).toBeNull();
    });
});
