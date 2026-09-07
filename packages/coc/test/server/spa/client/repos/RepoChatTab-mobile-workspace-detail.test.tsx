/**
 * @vitest-environment jsdom
 *
 * AC-02 — RepoChatTab driving the mobile Workspace panel's full-screen detail.
 *
 * Inside the mobile Workspace panel the SHELL owns the detail push, so this
 * tab's `mobileShowDetail` has to become the shell's `detailOpen`. Selecting a
 * conversation must push the shell detail; the shell's Back must drop this tab
 * back to its list. Outside that panel the context is null and the tab keeps
 * its own local state — the desktop / standalone-mobile paths are unchanged.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

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
            // The tab probes /processes/{id} for a selection it can't find in the
            // loaded lists and deselects on a miss — resolve so the selection sticks.
            get: vi.fn().mockResolvedValue({ process: { id: 'queue_task-1' } }),
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
    // Exposes the real selection callback so a test can "tap a conversation".
    ChatListPane: ({ onSelectTask }: { onSelectTask?: (id: string, task?: unknown) => void }) => (
        <div data-testid="chat-list-pane">
            <button data-testid="stub-select-chat" onClick={() => onSelectTask?.('queue_task-1', { id: 'task-1', processId: 'queue_task-1' })}>
                select chat
            </button>
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
import {
    MobileWorkspacePaneProvider,
    useMobileWorkspacePaneState,
} from '../../../../../src/server/spa/client/react/features/repo-detail/mobileWorkspacePane';

/** Mirrors how SplitWorkspacePanel hosts the tab on the mobile Workspace path. */
function MobileWorkspaceHarness({ workspaceId = 'ws-1' }: { workspaceId?: string }) {
    const pane = useMobileWorkspacePaneState(workspaceId);
    const [detailContainer, setDetailContainer] = useState<HTMLElement | null>(null);
    return (
        <MobileWorkspacePaneProvider value={pane}>
            <div data-testid="harness" data-detail-open={pane.detailOpen ? 'true' : 'false'} />
            <button data-testid="harness-back" onClick={() => pane.setDetailOpen(false)}>back</button>
            <QueueProvider>
                <RepoChatTab
                    workspaceId={workspaceId}
                    layout="split-workspace"
                    detailContainer={detailContainer}
                    detailActive
                />
            </QueueProvider>
            <div ref={setDetailContainer} data-testid="harness-detail-slot" />
        </MobileWorkspacePaneProvider>
    );
}

describe('RepoChatTab: mobile Workspace detail push', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.schedulesEnabled = true;
        mocks.isMobile = true;
        window.location.hash = '';
        try { localStorage.clear(); } catch { /* ignore */ }
        mocks.queueList.mockResolvedValue({ running: [], queued: [], stats: { isPaused: false, isAutopilotPaused: false } });
        mocks.history.mockResolvedValue({ history: [], hasMore: false });
    });

    it('starts on the list with the shell detail not pushed', async () => {
        render(<MobileWorkspaceHarness />);
        await waitFor(() => expect(screen.getByTestId('chat-list-pane')).toBeTruthy());
        expect(screen.getByTestId('harness').getAttribute('data-detail-open')).toBe('false');
    });

    it('pushes the shell detail when a conversation is selected', async () => {
        render(<MobileWorkspaceHarness />);
        await waitFor(() => expect(screen.getByTestId('stub-select-chat')).toBeTruthy());

        fireEvent.click(screen.getByTestId('stub-select-chat'));

        await waitFor(() =>
            expect(screen.getByTestId('harness').getAttribute('data-detail-open')).toBe('true'));
    });

    it('drops back to the list when the shell pops the detail', async () => {
        render(<MobileWorkspaceHarness />);
        await waitFor(() => expect(screen.getByTestId('stub-select-chat')).toBeTruthy());
        fireEvent.click(screen.getByTestId('stub-select-chat'));
        await waitFor(() =>
            expect(screen.getByTestId('harness').getAttribute('data-detail-open')).toBe('true'));

        fireEvent.click(screen.getByTestId('harness-back'));

        await waitFor(() =>
            expect(screen.getByTestId('harness').getAttribute('data-detail-open')).toBe('false'));
        // The list stays mounted throughout — the shell hides it, not this tab.
        expect(screen.getByTestId('chat-list-pane')).toBeTruthy();
    });

    it('keeps its own local detail state outside the mobile Workspace panel', async () => {
        // No provider: the standalone mobile branch still owns mobileShowDetail,
        // so selecting a chat swaps this tab's own list for its own detail pane.
        render(
            <QueueProvider>
                <RepoChatTab workspaceId="ws-1" />
            </QueueProvider>,
        );
        await waitFor(() => expect(screen.getByTestId('activity-mobile-list')).toBeTruthy());

        fireEvent.click(screen.getByTestId('stub-select-chat'));

        await waitFor(() => expect(screen.getByTestId('activity-detail-panel')).toBeTruthy());
        expect(screen.queryByTestId('activity-mobile-list')).toBeNull();
    });
});
