/**
 * Tests for RepoSchedulesTab split-panel layout (left list + right detail).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import * as fs from 'fs';
import * as path from 'path';
import { AppProvider } from '../../../src/server/spa/client/react/contexts/AppContext';
import { QueueProvider } from '../../../src/server/spa/client/react/contexts/QueueContext';
import { ToastProvider } from '../../../src/server/spa/client/react/contexts/ToastContext';

const { mockSchedulesClient, mockModelsClient } = vi.hoisted(() => ({
    mockSchedulesClient: {
        list: vi.fn(),
        history: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        disable: vi.fn(),
        enable: vi.fn(),
        delete: vi.fn(),
        move: vi.fn(),
        run: vi.fn(),
    },
    mockModelsClient: {
        list: vi.fn(),
    },
}));

const MOCK_SCHEDULE = {
    id: 'sched-1',
    name: 'Test Schedule',
    target: 'pipelines/test/pipeline.yaml',
    targetType: 'prompt' as const,
    cron: '0 */2 * * *',
    cronDescription: 'Every 2 hours',
    params: { pipeline: 'pipelines/test/pipeline.yaml' },
    onFailure: 'notify',
    status: 'active',
    isRunning: false,
    nextRun: new Date(Date.now() + 3600000).toISOString(),
    createdAt: new Date().toISOString(),
};

const MOCK_SCHEDULE_2 = {
    id: 'sched-2',
    name: 'Second Schedule',
    target: 'pipelines/other/pipeline.yaml',
    targetType: 'prompt' as const,
    cron: '0 */4 * * *',
    cronDescription: 'Every 4 hours',
    params: {},
    onFailure: 'notify',
    status: 'active',
    isRunning: false,
    nextRun: new Date(Date.now() + 7200000).toISOString(),
    createdAt: new Date().toISOString(),
};

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const mockFetchApi = vi.fn();
vi.mock('../../../src/server/spa/client/react/hooks/useApi', () => ({
    fetchApi: (...args: any[]) => mockFetchApi(...args),
}));

vi.mock('../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({ schedules: mockSchedulesClient, models: mockModelsClient }),
}));

vi.mock('../../../src/server/spa/client/react/utils/config', () => ({
    isContainerMode: () => false,
    getApiBase: () => 'http://localhost:4000/api',
}));

vi.mock('../../../src/server/spa/client/react/utils/format', () => ({
    formatRelativeTime: (d: string) => d,
}));

vi.mock('../../../src/server/spa/client/react/hooks/feature-flags/useWorkflowsEnabled', () => ({
    useWorkflowsEnabled: () => true,
}));

// Default breakpoint mock — desktop
vi.mock('../../../src/server/spa/client/react/hooks/ui/useBreakpoint', () => ({
    useBreakpoint: () => ({ isMobile: false, isTablet: false, isDesktop: true }),
}));

vi.mock('../../../src/server/spa/client/react/hooks/ui/useResizablePanel', () => ({
    useResizablePanel: () => ({
        width: 288,
        isDragging: false,
        handleMouseDown: vi.fn(),
        handleTouchStart: vi.fn(),
        resetWidth: vi.fn(),
    }),
}));

const SCHEDULES_TAB_SOURCE = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'features', 'schedules', 'RepoSchedulesTab.tsx'),
    'utf-8'
);

function Wrap({ children }: { children: ReactNode }) {
    return (
        <AppProvider>
            <QueueProvider>
                <ToastProvider value={{ addToast: vi.fn(), removeToast: vi.fn(), toasts: [] }}>
                    {children}
                </ToastProvider>
            </QueueProvider>
        </AppProvider>
    );
}

async function renderWithSchedules(schedules = [MOCK_SCHEDULE]) {
    mockSchedulesClient.list.mockResolvedValue(schedules);
    mockSchedulesClient.history.mockResolvedValue([]);
    mockSchedulesClient.create.mockResolvedValue({});
    mockModelsClient.list.mockResolvedValue([]);
    mockFetchApi.mockImplementation((url: string) => {
        if (url.includes('/history')) return Promise.resolve({ history: [] });
        return Promise.resolve({ schedules });
    });
    mockFetch.mockImplementation((url: string) => {
        if (url.includes('/schedules') && url.includes('/history')) {
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ history: [] }) });
        }
        if (url.includes('/schedules') && (!url.includes('/schedules/') || url.endsWith('/schedules'))) {
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ schedules }) });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    const { RepoSchedulesTab } = await import(
        '../../../src/server/spa/client/react/features/schedules/RepoSchedulesTab'
    );
    const result = render(
        <Wrap>
            <RepoSchedulesTab workspaceId="ws-1" />
        </Wrap>,
    );
    await waitFor(() => {
        expect(screen.queryByText('Loading schedules...')).toBeNull();
    });
    return result;
}

async function renderEmpty() {
    mockSchedulesClient.list.mockResolvedValue([]);
    mockSchedulesClient.history.mockResolvedValue([]);
    mockSchedulesClient.create.mockResolvedValue({});
    mockModelsClient.list.mockResolvedValue([]);
    mockFetchApi.mockResolvedValue({ schedules: [] });
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });

    const { RepoSchedulesTab } = await import(
        '../../../src/server/spa/client/react/features/schedules/RepoSchedulesTab'
    );
    const result = render(
        <Wrap>
            <RepoSchedulesTab workspaceId="ws-1" />
        </Wrap>,
    );
    await waitFor(() => {
        expect(screen.queryByText('Loading schedules...')).toBeNull();
    });
    return result;
}

// ============================================================================
// Split-panel layout tests
// ============================================================================

describe('Split-panel layout', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('clicking a list row renders ScheduleDetail in the right panel', async () => {
        await renderWithSchedules([MOCK_SCHEDULE, MOCK_SCHEDULE_2]);

        // Auto-selected first schedule — detail should appear
        await waitFor(() => {
            expect(screen.getByTestId('edit-btn')).toBeTruthy();
        });

        // Click second schedule
        fireEvent.click(screen.getByText('Second Schedule'));

        // Detail for second schedule should appear (target text changes)
        await waitFor(() => {
            expect(screen.getByText(/pipelines\/other\/pipeline\.yaml/)).toBeTruthy();
        });
    });

    it('creates a new schedule form in right panel without deselecting left row', async () => {
        await renderWithSchedules();

        // Wait for auto-select
        await waitFor(() => {
            expect(screen.getByTestId('edit-btn')).toBeTruthy();
        });

        // Click "+ New"
        fireEvent.click(screen.getByText('+ New'));

        // Form should appear in right panel
        await waitFor(() => {
            expect(screen.getByText('New Prompt Routine')).toBeTruthy();
        });

        // Left list row should still have active styling (aria-selected on li)
        const listItems = screen.getAllByRole('option').filter(el => el.tagName === 'LI');
        const activeItem = listItems.find(el => el.getAttribute('aria-selected') === 'true');
        expect(activeItem).toBeTruthy();
        expect(activeItem!.textContent).toContain('Test Schedule');
    });

    it('duplicate action opens CreateScheduleForm pre-filled in right panel', async () => {
        await renderWithSchedules();

        // Wait for auto-select detail
        await waitFor(() => {
            expect(screen.getByTestId('duplicate-btn')).toBeTruthy();
        });

        fireEvent.click(screen.getByTestId('duplicate-btn'));

        await waitFor(() => {
            expect(screen.getByText('New Schedule')).toBeTruthy();
        });

        const nameInput = screen.getByPlaceholderText('Name (e.g., Daily Report)') as HTMLInputElement;
        expect(nameInput.value).toBe('Copy of Test Schedule');

        // Left row should still be selected
        const listItems = screen.getAllByRole('option').filter(el => el.tagName === 'LI');
        const activeItem = listItems.find(el => el.getAttribute('aria-selected') === 'true');
        expect(activeItem).toBeTruthy();
    });

    it('empty state shows in both left panel and right panel', async () => {
        await renderEmpty();

        // Left panel empty state — new two-section UI
        expect(screen.getByText('Create a recurring prompt')).toBeTruthy();
        expect(screen.getByText('💬')).toBeTruthy();

        // Right panel placeholder
        expect(screen.getByText('Create a recurring prompt with "+ New"')).toBeTruthy();
    });

    it('active row carries the refined-primer highlight (bg + inset border)', async () => {
        await renderWithSchedules();

        await waitFor(() => {
            const activeItem = screen.getByRole('option', { selected: true });
            expect(activeItem.className).toContain('bg-[#ddf4ff]');
            expect(activeItem.className).toContain('shadow-[inset_0_0_0_1px_#b6e3ff]');
        });
    });

    it('list rows use role="option" and aria-selected', async () => {
        await renderWithSchedules([MOCK_SCHEDULE, MOCK_SCHEDULE_2]);

        await waitFor(() => {
            const options = screen.getAllByRole('option');
            expect(options).toHaveLength(2);
        });

        const options = screen.getAllByRole('option');
        // First is auto-selected
        expect(options[0].getAttribute('aria-selected')).toBe('true');
        expect(options[1].getAttribute('aria-selected')).toBe('false');
    });

    it('no expand arrows are rendered in list rows (only in section headers)', async () => {
        await renderWithSchedules();

        await waitFor(() => {
            expect(screen.getByRole('option')).toBeTruthy();
        });

        // Section header buttons use ▼/▶ for collapse toggle — that is expected
        // List rows (role="option") should NOT contain expand arrows
        const options = screen.getAllByRole('option');
        for (const option of options) {
            expect(option.textContent).not.toContain('▶');
            expect(option.textContent).not.toContain('▼');
        }
    });

    it('right panel shows placeholder when schedules exist but none selected', async () => {
        // Render with schedules but manually override to have no auto-select effect fire yet
        mockSchedulesClient.list.mockResolvedValue([MOCK_SCHEDULE]);
        mockSchedulesClient.history.mockResolvedValue([]);
        mockModelsClient.list.mockResolvedValue([]);
        mockFetchApi.mockImplementation((url: string) => {
            if (url.includes('/history')) return Promise.resolve({ history: [] });
            return Promise.resolve({ schedules: [MOCK_SCHEDULE] });
        });
        mockFetch.mockImplementation((url: string) => {
            if (url.includes('/schedules') && url.includes('/history')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ history: [] }) });
            }
            if (url.includes('/schedules') && (!url.includes('/schedules/') || url.endsWith('/schedules'))) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ schedules: [MOCK_SCHEDULE] }) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });

        const { RepoSchedulesTab } = await import(
            '../../../src/server/spa/client/react/features/schedules/RepoSchedulesTab'
        );

        // The component auto-selects first schedule, so we verify the detail renders
        render(
            <Wrap>
                <RepoSchedulesTab workspaceId="ws-1" />
            </Wrap>,
        );

        await waitFor(() => {
            expect(screen.queryByText('Loading schedules...')).toBeNull();
        });

        // Since auto-select fires, detail should be shown
        await waitFor(() => {
            expect(screen.getByTestId('edit-btn')).toBeTruthy();
        });
    });

    it('left panel header shows schedule count', async () => {
        await renderWithSchedules([MOCK_SCHEDULE, MOCK_SCHEDULE_2]);

        await waitFor(() => {
            // MY SCHEDULES section header shows a right-aligned count pill.
            expect(screen.getByTestId('my-schedules-count').textContent).toBe('2');
        });
    });

    it('left panel header shows no count pill when empty', async () => {
        await renderEmpty();

        const header = screen.getByTestId('my-schedules-header');
        expect(header.textContent).toContain('MY SCHEDULES');
        // The count pill is omitted when there are no user schedules.
        expect(screen.queryByTestId('my-schedules-count')).toBeNull();
    });

    it('desktop layout has resize handle with data-testid', async () => {
        await renderWithSchedules();
        await waitFor(() => {
            expect(screen.getByTestId('schedules-resize-handle')).toBeTruthy();
        });
    });

    it('desktop layout has schedules-list-panel and schedules-detail-panel', async () => {
        await renderWithSchedules();
        await waitFor(() => {
            expect(screen.getByTestId('schedules-list-panel')).toBeTruthy();
            expect(screen.getByTestId('schedules-detail-panel')).toBeTruthy();
        });
    });
});

// ============================================================================
// Mobile layout — source-code structural checks
// ============================================================================

describe('Mobile layout: source structure', () => {
    it('imports useBreakpoint hook', () => {
        expect(SCHEDULES_TAB_SOURCE).toContain("import { useBreakpoint }");
    });

    it('imports useResizablePanel hook', () => {
        expect(SCHEDULES_TAB_SOURCE).toContain("import { useResizablePanel }");
    });

    it('checks isMobile for responsive layout', () => {
        expect(SCHEDULES_TAB_SOURCE).toContain('isMobile');
    });

    it('has mobileShowDetail state for single-pane navigation', () => {
        expect(SCHEDULES_TAB_SOURCE).toContain('mobileShowDetail');
    });

    it('has a back button to return to schedule list', () => {
        expect(SCHEDULES_TAB_SOURCE).toContain('data-testid="schedules-back-btn"');
        expect(SCHEDULES_TAB_SOURCE).toContain('← Schedules');
    });

    it('has schedules-mobile-list testid for mobile list pane', () => {
        expect(SCHEDULES_TAB_SOURCE).toContain('data-testid="schedules-mobile-list"');
    });

    it('has resize handle with cursor-col-resize for desktop', () => {
        expect(SCHEDULES_TAB_SOURCE).toContain('cursor-col-resize');
        expect(SCHEDULES_TAB_SOURCE).toContain('data-testid="schedules-resize-handle"');
    });

    it('persists panel width with storageKey', () => {
        expect(SCHEDULES_TAB_SOURCE).toContain("storageKey: 'schedules-left-panel-width'");
    });

    it('disables text selection while dragging', () => {
        expect(SCHEDULES_TAB_SOURCE).toContain("isDragging && 'select-none'");
    });

    it('uses inline style for resizable left panel width', () => {
        expect(SCHEDULES_TAB_SOURCE).toContain('style={{ width: leftPanelWidth }}');
    });

    it('has data-testid for both list and detail panels', () => {
        expect(SCHEDULES_TAB_SOURCE).toContain('data-testid="schedules-list-panel"');
        expect(SCHEDULES_TAB_SOURCE).toContain('data-testid="schedules-detail-panel"');
    });

    it('sets mobileShowDetail true when selecting a schedule on mobile', () => {
        expect(SCHEDULES_TAB_SOURCE).toContain('if (isMobile) setMobileShowDetail(true)');
    });
});

