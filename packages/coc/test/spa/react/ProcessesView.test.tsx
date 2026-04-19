import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, act, fireEvent } from '@testing-library/react';
import type { BreakpointState } from '../../../src/server/spa/client/react/hooks/useBreakpoint';

// ── Mutable mock state ─────────────────────────────────────────────────

let mockBreakpoint: BreakpointState = { breakpoint: 'desktop', isMobile: false, isTablet: false, isDesktop: true };
const mockQueueDispatch = vi.fn();
let mockQueueState: any = {
    selectedTaskId: null,
    running: [],
    queued: [],
    history: [],
    stats: { isPaused: false },
    queueInitialized: true,
};

// ── Module mocks ───────────────────────────────────────────────────────

vi.mock('../../../src/server/spa/client/react/hooks/useBreakpoint', () => ({
    useBreakpoint: () => mockBreakpoint,
}));

vi.mock('../../../src/server/spa/client/react/context/QueueContext', () => ({
    useQueue: () => ({
        state: mockQueueState,
        dispatch: mockQueueDispatch,
    }),
}));

vi.mock('../../../src/server/spa/client/react/context/AppContext', () => ({
    useApp: () => ({
        state: { selectedRepoId: null },
        dispatch: vi.fn(),
    }),
}));

vi.mock('../../../src/server/spa/client/react/context/ChatPreferencesContext', () => ({
    ChatPreferencesProvider: ({ children }: { children: any }) => children,
    ChatPrefsSync: () => null,
    useChatPrefs: () => ({
        pinnedChatIds: new Set(),
        archivedChatIds: new Set(),
        pinChat: vi.fn(),
        unpinChat: vi.fn(),
        archiveChat: vi.fn(),
        unarchiveChat: vi.fn(),
        loaded: true,
    }),
}));

vi.mock('../../../src/server/spa/client/react/hooks/useApi', () => ({
    fetchApi: vi.fn().mockResolvedValue({ running: [], queued: [], history: [], stats: {} }),
}));

vi.mock('../../../src/server/spa/client/react/repos/ChatListPane', () => ({
    ChatListPane: (props: any) => (
        <div
            data-testid="activity-list-pane"
            data-workspace-id={props.workspaceId ?? ''}
            data-running-count={String(props.running?.length ?? 0)}
            data-queued-count={String(props.queued?.length ?? 0)}
            data-history-count={String(props.history?.length ?? 0)}
        >
            <button data-testid="select-task-a" onClick={() => props.onSelectTask?.('task-A')}>select</button>
            ChatListPane
        </div>
    ),
}));

vi.mock('../../../src/server/spa/client/react/repos/ChatDetailPane', () => ({
    ChatDetailPane: (props: any) => (
        <div data-testid="activity-detail-pane" data-selected-task-id={props.selectedTaskId ?? ''}>
            {props.onBack && <button data-testid="detail-back-btn" onClick={props.onBack}>back</button>}
            ChatDetailPane
        </div>
    ),
}));

// ── Import after mocks ─────────────────────────────────────────────────

import { ProcessesView } from '../../../src/server/spa/client/react/processes/ProcessesView';

// ── Helpers ────────────────────────────────────────────────────────────

function setBreakpoint(bp: 'mobile' | 'tablet' | 'desktop') {
    mockBreakpoint = {
        breakpoint: bp,
        isMobile: bp === 'mobile',
        isTablet: bp === 'tablet',
        isDesktop: bp === 'desktop',
    };
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('ProcessesView', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();
        setBreakpoint('desktop');
        mockQueueState = {
            selectedTaskId: null,
            running: [],
            queued: [],
            history: [],
            stats: { isPaused: false },
            queueInitialized: true,
        };
        location.hash = '';
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    /** Render, flush async fetches, then flush the skeleton minimum-display timer. */
    async function renderView(el: React.ReactElement = <ProcessesView />) {
        await act(async () => { render(el); });
        await act(async () => { vi.advanceTimersByTime(350); });
    }

    // Test 1: Desktop — two-pane layout with ChatListPane + ChatDetailPane
    it('Desktop: renders two-pane layout with ChatListPane and ChatDetailPane', async () => {
        await renderView();

        const panel = screen.getByTestId('activity-split-panel');
        expect(panel).toBeDefined();

        expect(screen.getByTestId('activity-list-pane')).toBeDefined();
        expect(screen.getByTestId('activity-detail-pane')).toBeDefined();
    });

    // Test 2: Desktop — ChatListPane has no workspaceId (global queue)
    it('Desktop: ChatListPane has no workspaceId for global queue', async () => {
        await renderView();

        const listPane = screen.getByTestId('activity-list-pane');
        expect(listPane.getAttribute('data-workspace-id')).toBe('');
    });

    // Test 3: Desktop — height calculation excludes bottom nav
    it('Desktop: container height excludes bottom nav', async () => {
        await renderView();

        const container = document.getElementById('view-processes')!;
        expect(container.className).toContain('h-[calc(100vh-48px)]');
        expect(container.className).not.toContain('h-[calc(100vh-48px-48px)]');
    });

    // Test 4: Mobile — no selection shows list only
    it('Mobile: no selection renders list pane only', async () => {
        setBreakpoint('mobile');
        await renderView();

        expect(screen.getByTestId('activity-mobile-list')).toBeDefined();
        expect(screen.getByTestId('activity-list-pane')).toBeDefined();
        expect(screen.queryByTestId('activity-detail-pane')).toBeNull();
    });

    // Test 5: Mobile — height includes bottom nav offset
    it('Mobile: container height accounts for bottom nav', async () => {
        setBreakpoint('mobile');
        await renderView();

        const container = document.getElementById('view-processes')!;
        expect(container.className).toContain('h-[calc(100vh-48px-48px)]');
    });

    // Test 6: Tablet — uses narrower left panel
    it('Tablet: renders two-pane layout with ChatListPane', async () => {
        setBreakpoint('tablet');
        await renderView();

        expect(screen.getByTestId('activity-list-pane')).toBeDefined();
        expect(screen.getByTestId('activity-detail-pane')).toBeDefined();
    });

    // Test 7: Desktop — detail pane shows selected task ID
    it('Desktop: detail pane receives selectedTaskId', async () => {
        mockQueueState.selectedTaskId = 'task-789';
        await renderView();

        const detailPane = screen.getByTestId('activity-detail-pane');
        expect(detailPane.getAttribute('data-selected-task-id')).toBe('task-789');
    });

    // Test 8: fetchQueue filters out tasks with a repoId (repo-specific tasks)
    it('passes through all tasks from server (server scopes to global workspace)', async () => {
        const { fetchApi } = await import('../../../src/server/spa/client/react/hooks/useApi');
        (fetchApi as ReturnType<typeof vi.fn>)
            .mockResolvedValueOnce({
                running: [
                    { id: 'r2', type: 'chat' },                          // global task
                ],
                queued: [
                    { id: 'q2', type: 'chat' },                          // global task
                    { id: 'pm1', kind: 'pause-marker' },                 // pause-marker — always keep
                ],
                stats: {},
            })
            .mockResolvedValueOnce({ history: [
                { id: 'h2', type: 'chat' },                              // global task
            ] });

        await renderView();

        const listPane = screen.getByTestId('activity-list-pane');
        expect(listPane.getAttribute('data-running-count')).toBe('1');
        expect(listPane.getAttribute('data-queued-count')).toBe('2'); // q2 + pause-marker
        expect(listPane.getAttribute('data-history-count')).toBe('1');
    });

    // Test 9: Mobile — re-clicking the already-selected task re-opens the detail panel
    // Regression: back button only clears mobileShowDetail but not selectedTaskId,
    // so re-clicking the same task must still re-show the detail panel.
    it('Mobile: re-clicking the already-selected task re-opens the detail panel', async () => {
        setBreakpoint('mobile');
        mockQueueState.selectedTaskId = 'task-A';

        await renderView();

        // useEffect syncs mobileShowDetail=true → detail pane is shown
        expect(screen.getByTestId('activity-detail-pane')).toBeDefined();
        expect(screen.queryByTestId('activity-mobile-list')).toBeNull();

        // Click back → mobileShowDetail=false → list is shown
        await act(async () => {
            fireEvent.click(screen.getByTestId('detail-back-btn'));
        });
        expect(screen.getByTestId('activity-mobile-list')).toBeDefined();
        expect(screen.queryByTestId('activity-detail-pane')).toBeNull();

        // Re-click the same task-A → should re-open detail
        await act(async () => {
            fireEvent.click(screen.getByTestId('select-task-a'));
        });
        expect(screen.getByTestId('activity-detail-pane')).toBeDefined();
        expect(screen.queryByTestId('activity-mobile-list')).toBeNull();
    });

    // Test 10: WS context updates pass through directly (no client-side filtering needed)
    it('WS context update: all tasks pass through (server-scoped)', async () => {
        const { fetchApi } = await import('../../../src/server/spa/client/react/hooks/useApi');
        // fetchQueue also runs on mount
        (fetchApi as ReturnType<typeof vi.fn>)
            .mockResolvedValueOnce({
                running: [
                    { id: 'r2', type: 'chat' },
                ],
                queued: [
                    { id: 'q2', type: 'chat' },
                ],
                stats: {},
            })
            .mockResolvedValueOnce({ history: [
                { id: 'h2', type: 'chat' },
            ] });

        mockQueueState = {
            selectedTaskId: null,
            running: [
                { id: 'r2', type: 'chat' },
            ],
            queued: [
                { id: 'q2', type: 'chat' },
            ],
            history: [
                { id: 'h2', type: 'chat' },
            ],
            stats: { isPaused: false },
            queueInitialized: true,
        };

        await renderView();

        const listPane = screen.getByTestId('activity-list-pane');
        expect(listPane.getAttribute('data-running-count')).toBe('1');
        expect(listPane.getAttribute('data-queued-count')).toBe('1');
        expect(listPane.getAttribute('data-history-count')).toBe('1');
    });
});
