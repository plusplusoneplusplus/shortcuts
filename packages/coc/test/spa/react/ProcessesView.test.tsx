import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
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

vi.mock('../../../src/server/spa/client/react/hooks/useApi', () => ({
    fetchApi: vi.fn().mockResolvedValue({ running: [], queued: [], history: [], stats: {} }),
}));

vi.mock('../../../src/server/spa/client/react/repos/ActivityListPane', () => ({
    ActivityListPane: (props: any) => (
        <div data-testid="activity-list-pane" data-workspace-id={props.workspaceId ?? ''}>
            ActivityListPane
        </div>
    ),
}));

vi.mock('../../../src/server/spa/client/react/repos/ActivityDetailPane', () => ({
    ActivityDetailPane: (props: any) => (
        <div data-testid="activity-detail-pane" data-selected-task-id={props.selectedTaskId ?? ''}>
            ActivityDetailPane
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

    // Test 1: Desktop — two-pane layout with ActivityListPane + ActivityDetailPane
    it('Desktop: renders two-pane layout with ActivityListPane and ActivityDetailPane', async () => {
        await act(async () => {
            render(<ProcessesView />);
        });

        const panel = screen.getByTestId('activity-split-panel');
        expect(panel).toBeDefined();

        expect(screen.getByTestId('activity-list-pane')).toBeDefined();
        expect(screen.getByTestId('activity-detail-pane')).toBeDefined();
    });

    // Test 2: Desktop — ActivityListPane has no workspaceId (global queue)
    it('Desktop: ActivityListPane has no workspaceId for global queue', async () => {
        await act(async () => {
            render(<ProcessesView />);
        });

        const listPane = screen.getByTestId('activity-list-pane');
        expect(listPane.getAttribute('data-workspace-id')).toBe('');
    });

    // Test 3: Desktop — height calculation excludes bottom nav
    it('Desktop: container height excludes bottom nav', async () => {
        await act(async () => {
            render(<ProcessesView />);
        });

        const container = document.getElementById('view-processes')!;
        expect(container.className).toContain('h-[calc(100vh-48px)]');
        expect(container.className).not.toContain('h-[calc(100vh-48px-56px)]');
    });

    // Test 4: Mobile — no selection shows list only
    it('Mobile: no selection renders list pane only', async () => {
        setBreakpoint('mobile');
        await act(async () => {
            render(<ProcessesView />);
        });

        expect(screen.getByTestId('activity-mobile-list')).toBeDefined();
        expect(screen.getByTestId('activity-list-pane')).toBeDefined();
        expect(screen.queryByTestId('activity-detail-pane')).toBeNull();
    });

    // Test 5: Mobile — height includes bottom nav offset
    it('Mobile: container height accounts for bottom nav', async () => {
        setBreakpoint('mobile');
        await act(async () => {
            render(<ProcessesView />);
        });

        const container = document.getElementById('view-processes')!;
        expect(container.className).toContain('h-[calc(100vh-48px-56px)]');
    });

    // Test 6: Tablet — uses narrower left panel
    it('Tablet: renders two-pane layout with ActivityListPane', async () => {
        setBreakpoint('tablet');
        await act(async () => {
            render(<ProcessesView />);
        });

        expect(screen.getByTestId('activity-list-pane')).toBeDefined();
        expect(screen.getByTestId('activity-detail-pane')).toBeDefined();
    });

    // Test 7: Desktop — detail pane shows selected task ID
    it('Desktop: detail pane receives selectedTaskId', async () => {
        mockQueueState.selectedTaskId = 'task-789';
        await act(async () => {
            render(<ProcessesView />);
        });

        const detailPane = screen.getByTestId('activity-detail-pane');
        expect(detailPane.getAttribute('data-selected-task-id')).toBe('task-789');
    });
});
