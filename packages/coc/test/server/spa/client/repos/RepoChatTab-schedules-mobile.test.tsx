/**
 * @vitest-environment jsdom
 *
 * Mobile main-pane host for the schedules-in-Scheduled-slide feature (AC-03).
 *
 * On mobile the list and detail share one column (`mobileShowDetail`). A
 * `#repos/{ws}/schedules/{id|new}` route must take over the detail pane and,
 * on close (route → bare hash), drop back to the list. These tests exercise
 * only RepoChatTab's mobile wiring — `ScheduleMainPane` is stubbed while the
 * real route parsers are kept — and confirm the flag-off path is unchanged.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
    schedulesEnabled: true,
    isMobile: true,
    queueList: vi.fn(),
    history: vi.fn(),
    appDispatch: vi.fn(),
    refreshUnseenCounts: vi.fn(),
    markReadByProcessId: vi.fn(),
}));

vi.mock('../../../../../src/server/spa/client/react/utils/config', () => ({
    isContainerMode: () => false,
    isForEachEnabled: () => false,
    isMapReduceEnabled: () => false,
    isSchedulesInScheduledSlideEnabled: () => mocks.schedulesEnabled,
    DASHBOARD_CONFIG_UPDATED_EVENT: 'coc-dashboard-config-updated',
}));

// Keep the real route parsers (parseScheduleMainPaneRoute / isSchedulesRoute)
// so the hash → route wiring under test is exercised for real; stub only the
// heavy component so we don't need the schedules client.
vi.mock('../../../../../src/server/spa/client/react/features/schedules/ScheduleMainPane', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../../../src/server/spa/client/react/features/schedules/ScheduleMainPane')>();
    return {
        ...actual,
        ScheduleMainPane: ({ route }: { route: { kind: string; scheduleId?: string } }) => (
            <div data-testid="schedule-main-pane" data-route-kind={route.kind} data-route-id={route.scheduleId ?? ''} />
        ),
    };
});

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
    ChatListPane: () => <div data-testid="chat-list-pane" />,
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

function renderRepoChatTab(workspaceId = 'ws-1') {
    return render(
        <QueueProvider>
            <RepoChatTab workspaceId={workspaceId} />
        </QueueProvider>,
    );
}

function setHash(hash: string) {
    act(() => {
        window.location.hash = hash;
        window.dispatchEvent(new Event('hashchange'));
    });
}

describe('RepoChatTab: schedules mobile main-pane host', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.schedulesEnabled = true;
        mocks.isMobile = true;
        window.location.hash = '';
        try { localStorage.clear(); } catch { /* ignore */ }
        mocks.queueList.mockResolvedValue({ running: [], queued: [], stats: { isPaused: false, isAutopilotPaused: false } });
        mocks.history.mockResolvedValue({ history: [], hasMore: false });
    });

    it('shows the schedule detail in the mobile detail pane on a deep-linked route', async () => {
        window.location.hash = '#repos/ws-1/schedules/sched-1';

        renderRepoChatTab();

        await waitFor(() => expect(screen.getByTestId('schedule-main-pane')).toBeTruthy());
        expect(screen.getByTestId('schedule-main-pane').getAttribute('data-route-kind')).toBe('detail');
        expect(screen.getByTestId('schedule-main-pane').getAttribute('data-route-id')).toBe('sched-1');
        expect(screen.getByTestId('activity-detail-panel')).toBeTruthy();
        expect(screen.queryByTestId('activity-mobile-list')).toBeNull();
    });

    it('shows the create form in the mobile detail pane for the /new route', async () => {
        window.location.hash = '#repos/ws-1/schedules/new';

        renderRepoChatTab();

        await waitFor(() => expect(screen.getByTestId('schedule-main-pane')).toBeTruthy());
        expect(screen.getByTestId('schedule-main-pane').getAttribute('data-route-kind')).toBe('new');
        expect(screen.queryByTestId('activity-mobile-list')).toBeNull();
    });

    it('opens the pane when navigating to a schedule route from the list', async () => {
        renderRepoChatTab();

        // No route yet → the mobile list is shown.
        await waitFor(() => expect(screen.getByTestId('activity-mobile-list')).toBeTruthy());
        expect(screen.queryByTestId('schedule-main-pane')).toBeNull();

        setHash('#repos/ws-1/schedules/sched-2');

        await waitFor(() => expect(screen.getByTestId('schedule-main-pane')).toBeTruthy());
        expect(screen.queryByTestId('activity-mobile-list')).toBeNull();
    });

    it('returns to the mobile list when the schedule pane closes to the bare hash', async () => {
        window.location.hash = '#repos/ws-1/schedules/sched-1';

        renderRepoChatTab();

        await waitFor(() => expect(screen.getByTestId('schedule-main-pane')).toBeTruthy());

        // Closing navigates to the bare schedules hash (route → null).
        setHash('#repos/ws-1/schedules');

        await waitFor(() => expect(screen.getByTestId('activity-mobile-list')).toBeTruthy());
        expect(screen.queryByTestId('schedule-main-pane')).toBeNull();
    });

    it('does not take over the mobile pane when the flag is OFF', async () => {
        mocks.schedulesEnabled = false;
        window.location.hash = '#repos/ws-1/schedules/sched-1';

        renderRepoChatTab();

        await waitFor(() => expect(screen.getByTestId('activity-mobile-list')).toBeTruthy());
        expect(screen.queryByTestId('schedule-main-pane')).toBeNull();
    });

    it('hosts the schedule route in the desktop detail pane too (regression)', async () => {
        mocks.isMobile = false;
        window.location.hash = '#repos/ws-1/schedules/sched-1';

        renderRepoChatTab();

        await waitFor(() => expect(screen.getByTestId('schedule-main-pane')).toBeTruthy());
        expect(screen.getByTestId('activity-detail-panel')).toBeTruthy();
    });
});
