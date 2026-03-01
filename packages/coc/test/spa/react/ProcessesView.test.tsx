import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { BreakpointState } from '../../../src/server/spa/client/react/hooks/useBreakpoint';

// ── Mutable mock state ─────────────────────────────────────────────────

let mockBreakpoint: BreakpointState = { breakpoint: 'desktop', isMobile: false, isTablet: false, isDesktop: true };
const mockAppDispatch = vi.fn();
let mockAppSelectedId: string | null = null;
const mockQueueDispatch = vi.fn();
let mockQueueSelectedTaskId: string | null = null;

// ── Module mocks ───────────────────────────────────────────────────────

vi.mock('../../../src/server/spa/client/react/hooks/useBreakpoint', () => ({
    useBreakpoint: () => mockBreakpoint,
}));

vi.mock('../../../src/server/spa/client/react/context/AppContext', () => ({
    useApp: () => ({
        state: { selectedId: mockAppSelectedId },
        dispatch: mockAppDispatch,
    }),
}));

vi.mock('../../../src/server/spa/client/react/context/QueueContext', () => ({
    useQueue: () => ({
        state: { selectedTaskId: mockQueueSelectedTaskId },
        dispatch: mockQueueDispatch,
    }),
}));

vi.mock('../../../src/server/spa/client/react/processes/ProcessFilters', () => ({
    ProcessFilters: () => <div data-testid="process-filters">ProcessFilters</div>,
}));

vi.mock('../../../src/server/spa/client/react/processes/ProcessesSidebar', () => ({
    ProcessesSidebar: () => <div data-testid="processes-sidebar">ProcessesSidebar</div>,
}));

vi.mock('../../../src/server/spa/client/react/processes/ProcessDetail', () => ({
    ProcessDetail: () => <div data-testid="process-detail">ProcessDetail</div>,
}));

vi.mock('../../../src/server/spa/client/react/queue/QueueTaskDetail', () => ({
    QueueTaskDetail: () => <div data-testid="queue-task-detail">QueueTaskDetail</div>,
}));

vi.mock('../../../src/server/spa/client/react/shared/ResponsiveSidebar', () => ({
    ResponsiveSidebar: ({ children, width, tabletWidth }: any) => (
        <aside data-testid="responsive-sidebar" data-width={width} data-tablet-width={tabletWidth}>
            {children}
        </aside>
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
        mockAppSelectedId = null;
        mockQueueSelectedTaskId = null;
        location.hash = '';
    });

    // Test 1: Desktop — two-pane layout with 320px sidebar
    it('Desktop: renders two-pane layout with ResponsiveSidebar at width 320', () => {
        setBreakpoint('desktop');
        render(<ProcessesView />);

        const sidebar = screen.getByTestId('responsive-sidebar');
        expect(sidebar).toBeDefined();
        expect(sidebar.getAttribute('data-width')).toBe('320');
        expect(sidebar.getAttribute('data-tablet-width')).toBe('260');

        // Sidebar contains filters and list
        expect(screen.getByTestId('process-filters')).toBeDefined();
        expect(screen.getByTestId('processes-sidebar')).toBeDefined();
        expect(sidebar.contains(screen.getByTestId('process-filters'))).toBe(true);
        expect(sidebar.contains(screen.getByTestId('processes-sidebar'))).toBe(true);

        // Main panel renders detail
        expect(screen.getByTestId('process-detail')).toBeDefined();

        // No mobile components
        expect(screen.queryByTestId('mobile-back-button')).toBeNull();
        expect(screen.queryByTestId('mobile-filters-toggle')).toBeNull();
    });

    // Test 2: Tablet — sidebar at 260px
    it('Tablet: renders two-pane layout with ResponsiveSidebar', () => {
        setBreakpoint('tablet');
        render(<ProcessesView />);

        const sidebar = screen.getByTestId('responsive-sidebar');
        expect(sidebar).toBeDefined();
        expect(sidebar.getAttribute('data-width')).toBe('320');
        expect(sidebar.getAttribute('data-tablet-width')).toBe('260');

        expect(screen.getByTestId('process-filters')).toBeDefined();
        expect(screen.getByTestId('processes-sidebar')).toBeDefined();
    });

    // Test 3: Mobile — no selection shows full-width list
    it('Mobile: no selection renders list with collapsible filters', () => {
        setBreakpoint('mobile');
        mockAppSelectedId = null;
        mockQueueSelectedTaskId = null;
        render(<ProcessesView />);

        // List view visible
        expect(screen.getByTestId('processes-sidebar')).toBeDefined();
        expect(screen.getByTestId('mobile-filters-toggle')).toBeDefined();

        // Detail view hidden
        expect(screen.queryByTestId('process-detail')).toBeNull();
        expect(screen.queryByTestId('queue-task-detail')).toBeNull();

        // Filters collapsed by default
        expect(screen.queryByTestId('mobile-filters-panel')).toBeNull();

        // Height includes bottom nav offset
        const container = document.getElementById('view-processes')!;
        expect(container.className).toContain('h-[calc(100vh-48px-56px)]');
    });

    // Test 4: Mobile — selected process shows full-screen detail with back button
    it('Mobile: selected process shows detail view with back button', () => {
        setBreakpoint('mobile');
        mockAppSelectedId = 'proc-123';
        render(<ProcessesView />);

        // Detail view visible
        expect(screen.getByTestId('process-detail')).toBeDefined();
        expect(screen.getByTestId('mobile-back-button')).toBeDefined();

        // List view hidden
        expect(screen.queryByTestId('processes-sidebar')).toBeNull();
        expect(screen.queryByTestId('mobile-filters-toggle')).toBeNull();
    });

    // Test 5: Mobile — selected queue task shows QueueTaskDetail
    it('Mobile: selected queue task shows QueueTaskDetail with back button', () => {
        setBreakpoint('mobile');
        mockQueueSelectedTaskId = 'task-456';
        render(<ProcessesView />);

        // QueueTaskDetail rendered (not ProcessDetail)
        expect(screen.getByTestId('queue-task-detail')).toBeDefined();
        expect(screen.queryByTestId('process-detail')).toBeNull();

        // Back button present
        expect(screen.getByTestId('mobile-back-button')).toBeDefined();
    });

    // Test 6: Mobile — back button clears selection and returns to list
    it('Mobile: back button dispatches clear actions', () => {
        setBreakpoint('mobile');
        mockAppSelectedId = 'proc-123';
        location.hash = '#process/proc-123';
        render(<ProcessesView />);

        fireEvent.click(screen.getByTestId('mobile-back-button'));

        expect(mockAppDispatch).toHaveBeenCalledWith({ type: 'SELECT_PROCESS', id: null });
        expect(mockQueueDispatch).toHaveBeenCalledWith({ type: 'SELECT_QUEUE_TASK', id: null });
        expect(location.hash).toBe('#processes');
    });

    // Test 7: Mobile — filters accordion toggle
    it('Mobile: filters accordion toggles on click', () => {
        setBreakpoint('mobile');
        render(<ProcessesView />);

        const toggle = screen.getByTestId('mobile-filters-toggle');
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        expect(screen.queryByTestId('mobile-filters-panel')).toBeNull();

        // Expand
        fireEvent.click(toggle);
        expect(toggle.getAttribute('aria-expanded')).toBe('true');
        expect(screen.getByTestId('mobile-filters-panel')).toBeDefined();
        expect(screen.getByTestId('process-filters')).toBeDefined();

        // Collapse again
        fireEvent.click(toggle);
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        expect(screen.queryByTestId('mobile-filters-panel')).toBeNull();
    });

    // Test 8: Mobile — height calculation includes bottom nav
    it('Mobile: container height accounts for bottom nav', () => {
        setBreakpoint('mobile');
        render(<ProcessesView />);

        const container = document.getElementById('view-processes')!;
        expect(container.className).toContain('h-[calc(100vh-48px-56px)]');
    });

    // Test 9: Desktop — height calculation excludes bottom nav
    it('Desktop: container height excludes bottom nav', () => {
        setBreakpoint('desktop');
        render(<ProcessesView />);

        const container = document.getElementById('view-processes')!;
        expect(container.className).toContain('h-[calc(100vh-48px)]');
        expect(container.className).not.toContain('h-[calc(100vh-48px-56px)]');
    });

    // Additional: back button does not change hash when not on process route
    it('Mobile: back button does not change hash when not on process route', () => {
        setBreakpoint('mobile');
        mockAppSelectedId = 'proc-123';
        location.hash = '#queue/task-456';
        render(<ProcessesView />);

        fireEvent.click(screen.getByTestId('mobile-back-button'));

        expect(mockAppDispatch).toHaveBeenCalledWith({ type: 'SELECT_PROCESS', id: null });
        expect(mockQueueDispatch).toHaveBeenCalledWith({ type: 'SELECT_QUEUE_TASK', id: null });
        expect(location.hash).toBe('#queue/task-456');
    });

    // Additional: Desktop renders QueueTaskDetail when queue task is selected
    it('Desktop: renders QueueTaskDetail when queue task is selected', () => {
        setBreakpoint('desktop');
        mockQueueSelectedTaskId = 'task-789';
        render(<ProcessesView />);

        expect(screen.getByTestId('queue-task-detail')).toBeDefined();
        expect(screen.queryByTestId('process-detail')).toBeNull();
    });
});
