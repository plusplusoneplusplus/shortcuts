/**
 * Tests for the redesigned ScheduleDetail component.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { AppProvider } from '../../../src/server/spa/client/react/context/AppContext';
import { QueueProvider } from '../../../src/server/spa/client/react/context/QueueContext';
import { ToastProvider } from '../../../src/server/spa/client/react/context/ToastContext';

const MOCK_SCHEDULE = {
    id: 'sched-1',
    name: 'Test Schedule',
    target: 'pipelines/test/pipeline.yaml',
    targetType: 'prompt' as const,
    cron: '0 */2 * * *',
    cronDescription: 'Every 2 hours',
    params: { pipeline: 'pipelines/test/pipeline.yaml', env: 'prod' },
    onFailure: 'continue',
    status: 'active',
    isRunning: false,
    nextRun: new Date(Date.now() + 3600000).toISOString(),
    createdAt: new Date().toISOString(),
    outputFolder: '~/.coc/repos/ws-1/tasks',
};

const MOCK_SCHEDULE_PAUSED = {
    ...MOCK_SCHEDULE,
    id: 'sched-2',
    status: 'paused',
    nextRun: null,
};

const MOCK_SCHEDULE_RUNNING = {
    ...MOCK_SCHEDULE,
    id: 'sched-3',
    isRunning: true,
    status: 'active',
};

const MOCK_SCHEDULE_SCRIPT = {
    ...MOCK_SCHEDULE,
    id: 'sched-4',
    targetType: 'script' as const,
    target: 'scripts/run.sh',
    params: {},
};

const MOCK_HISTORY = [
    {
        id: 'run-1',
        scheduleId: 'sched-1',
        startedAt: new Date(Date.now() - 120000).toISOString(),
        completedAt: new Date(Date.now() - 60000).toISOString(),
        status: 'completed',
        durationMs: 60000,
        exitCode: 0,
        stdout: 'Success output',
        stderr: '',
    },
    {
        id: 'run-2',
        scheduleId: 'sched-1',
        startedAt: new Date(Date.now() - 240000).toISOString(),
        completedAt: new Date(Date.now() - 180000).toISOString(),
        status: 'failed',
        durationMs: 60000,
        exitCode: 1,
        stdout: '',
        stderr: 'Error occurred',
    },
    {
        id: 'run-3',
        scheduleId: 'sched-1',
        startedAt: new Date().toISOString(),
        status: 'running',
        durationMs: undefined,
        exitCode: undefined,
        stdout: undefined,
        stderr: undefined,
    },
];

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const mockFetchApi = vi.fn();
vi.mock('../../../src/server/spa/client/react/hooks/useApi', () => ({
    fetchApi: (...args: any[]) => mockFetchApi(...args),
}));

vi.mock('../../../src/server/spa/client/react/utils/config', () => ({
    getApiBase: () => 'http://localhost:4000/api',
}));

vi.mock('../../../src/server/spa/client/react/utils/format', () => ({
    formatRelativeTime: (d: string) => `rel:${d}`,
}));

vi.mock('../../../src/server/spa/client/react/hooks/useBreakpoint', () => ({
    useBreakpoint: () => ({ isMobile: false, isTablet: false, isDesktop: true }),
}));

vi.mock('../../../src/server/spa/client/react/hooks/useResizablePanel', () => ({
    useResizablePanel: () => ({
        width: 288,
        isDragging: false,
        handleMouseDown: vi.fn(),
        handleTouchStart: vi.fn(),
        resetWidth: vi.fn(),
    }),
}));

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

async function getScheduleDetail() {
    const { ScheduleDetail } = await import(
        '../../../src/server/spa/client/react/repos/RepoSchedulesTab'
    );
    return ScheduleDetail;
}

function renderDetail(
    schedule = MOCK_SCHEDULE,
    history: any[] = [],
    overrides: Record<string, any> = {},
) {
    const props = {
        schedule,
        workspaceId: 'ws-1',
        history,
        editingId: null,
        onRunNow: vi.fn(),
        onPauseResume: vi.fn(),
        onEdit: vi.fn(),
        onDuplicate: vi.fn(),
        onDelete: vi.fn(),
        onCancelEdit: vi.fn(),
        onSaved: vi.fn(),
        ...overrides,
    };
    return props;
}

// ============================================================================
// Header zone
// ============================================================================

describe('ScheduleDetail — header zone', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
        mockFetchApi.mockResolvedValue({ history: [] });
    });

    it('renders schedule name in header',async () => {
        const ScheduleDetail = await getScheduleDetail();
        render(
            <Wrap>
                <ScheduleDetail {...renderDetail()} />
            </Wrap>,
        );
        expect(screen.getByTestId('schedule-name').textContent).toContain('Test Schedule');
    });

    it('renders prompt icon for prompt targetType', async () => {
        const ScheduleDetail = await getScheduleDetail();
        render(
            <Wrap>
                <ScheduleDetail {...renderDetail()} />
            </Wrap>,
        );
        expect(screen.getByTestId('schedule-name').textContent).toContain('📄');
    });

    it('renders script icon for script targetType', async () => {
        const ScheduleDetail = await getScheduleDetail();
        render(
            <Wrap>
                <ScheduleDetail {...renderDetail(MOCK_SCHEDULE_SCRIPT)} />
            </Wrap>,
        );
        expect(screen.getByTestId('schedule-name').textContent).toContain('⚡');
    });

    it('shows Active status badge for active schedule', async () => {
        const ScheduleDetail = await getScheduleDetail();
        render(
            <Wrap>
                <ScheduleDetail {...renderDetail()} />
            </Wrap>,
        );
        const badge = screen.getByTestId('status-badge');
        expect(badge.textContent).toContain('Active');
        expect(badge.getAttribute('aria-label')).toBe('Status: Active');
    });

    it('shows Paused status badge for paused schedule', async () => {
        const ScheduleDetail = await getScheduleDetail();
        render(
            <Wrap>
                <ScheduleDetail {...renderDetail(MOCK_SCHEDULE_PAUSED)} />
            </Wrap>,
        );
        const badge = screen.getByTestId('status-badge');
        expect(badge.textContent).toContain('Paused');
        expect(badge.getAttribute('aria-label')).toBe('Status: Paused');
    });

    it('shows Running status badge when isRunning=true', async () => {
        const ScheduleDetail = await getScheduleDetail();
        render(
            <Wrap>
                <ScheduleDetail {...renderDetail(MOCK_SCHEDULE_RUNNING)} />
            </Wrap>,
        );
        const badge = screen.getByTestId('status-badge');
        expect(badge.textContent).toContain('Running');
        expect(badge.getAttribute('aria-label')).toBe('Status: Running');
    });

    it('shows spinning indicator when isRunning=true', async () => {
        const ScheduleDetail = await getScheduleDetail();
        render(
            <Wrap>
                <ScheduleDetail {...renderDetail(MOCK_SCHEDULE_RUNNING)} />
            </Wrap>,
        );
        expect(screen.getByTestId('running-spinner')).toBeTruthy();
    });

    it('does not show spinner when isRunning=false', async () => {
        const ScheduleDetail = await getScheduleDetail();
        render(
            <Wrap>
                <ScheduleDetail {...renderDetail()} />
            </Wrap>,
        );
        expect(screen.queryByTestId('running-spinner')).toBeNull();
    });

    it('shows next run time for active schedule', async () => {
        const ScheduleDetail = await getScheduleDetail();
        render(
            <Wrap>
                <ScheduleDetail {...renderDetail()} />
            </Wrap>,
        );
        const nextRun = screen.getByTestId('schedule-next-run');
        expect(nextRun.textContent).toContain('Next run:');
    });

    it('shows Paused in next-run area for paused schedule', async () => {
        const ScheduleDetail = await getScheduleDetail();
        render(
            <Wrap>
                <ScheduleDetail {...renderDetail(MOCK_SCHEDULE_PAUSED)} />
            </Wrap>,
        );
        expect(screen.getByTestId('schedule-next-run').textContent).toBe('Paused');
    });

    it('shows Running now for running schedule', async () => {
        const ScheduleDetail = await getScheduleDetail();
        render(
            <Wrap>
                <ScheduleDetail {...renderDetail(MOCK_SCHEDULE_RUNNING)} />
            </Wrap>,
        );
        expect(screen.getByTestId('schedule-next-run').textContent).toContain('Running now');
    });
});

// ============================================================================
// Action toolbar
// ============================================================================

describe('ScheduleDetail — action toolbar', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
        mockFetchApi.mockResolvedValue({ history: [] });
    });

    it('Run Now button is present with aria-label', async () => {
        const ScheduleDetail = await getScheduleDetail();
        render(
            <Wrap>
                <ScheduleDetail {...renderDetail()} />
            </Wrap>,
        );
        const btn = screen.getByRole('button', { name: /run schedule now/i });
        expect(btn).toBeTruthy();
    });

    it('Run Now button is disabled when isRunning=true', async () => {
        const ScheduleDetail = await getScheduleDetail();
        render(
            <Wrap>
                <ScheduleDetail {...renderDetail(MOCK_SCHEDULE_RUNNING)} />
            </Wrap>,
        );
        const btn = screen.getByRole('button', { name: /run schedule now/i }) as HTMLButtonElement;
        expect(btn.disabled).toBe(true);
    });

    it('Run Now button is enabled when not running', async () => {
        const ScheduleDetail = await getScheduleDetail();
        render(
            <Wrap>
                <ScheduleDetail {...renderDetail()} />
            </Wrap>,
        );
        const btn = screen.getByRole('button', { name: /run schedule now/i }) as HTMLButtonElement;
        expect(btn.disabled).toBe(false);
    });

    it('calls onRunNow with schedule id when Run Now clicked', async () => {
        const onRunNow = vi.fn();
        const ScheduleDetail = await getScheduleDetail();
        render(
            <Wrap>
                <ScheduleDetail {...renderDetail(MOCK_SCHEDULE, [], { onRunNow })} />
            </Wrap>,
        );
        fireEvent.click(screen.getByRole('button', { name: /run schedule now/i }));
        expect(onRunNow).toHaveBeenCalledWith('sched-1');
    });

    it('Pause button shown for active schedule', async () => {
        const ScheduleDetail = await getScheduleDetail();
        render(
            <Wrap>
                <ScheduleDetail {...renderDetail()} />
            </Wrap>,
        );
        expect(screen.getByRole('button', { name: /pause schedule/i })).toBeTruthy();
    });

    it('Resume button shown for paused schedule', async () => {
        const ScheduleDetail = await getScheduleDetail();
        render(
            <Wrap>
                <ScheduleDetail {...renderDetail(MOCK_SCHEDULE_PAUSED)} />
            </Wrap>,
        );
        expect(screen.getByRole('button', { name: /resume schedule/i })).toBeTruthy();
    });

    it('calls onPauseResume when Pause clicked', async () => {
        const onPauseResume = vi.fn();
        const ScheduleDetail = await getScheduleDetail();
        render(
            <Wrap>
                <ScheduleDetail {...renderDetail(MOCK_SCHEDULE, [], { onPauseResume })} />
            </Wrap>,
        );
        fireEvent.click(screen.getByRole('button', { name: /pause schedule/i }));
        expect(onPauseResume).toHaveBeenCalledWith(MOCK_SCHEDULE);
    });

    it('Edit button is present', async () => {
        const ScheduleDetail = await getScheduleDetail();
        render(
            <Wrap>
                <ScheduleDetail {...renderDetail()} />
            </Wrap>,
        );
        expect(screen.getByTestId('edit-btn')).toBeTruthy();
    });

    it('Edit button disabled when isRunning=true', async () => {
        const ScheduleDetail = await getScheduleDetail();
        render(
            <Wrap>
                <ScheduleDetail {...renderDetail(MOCK_SCHEDULE_RUNNING)} />
            </Wrap>,
        );
        const editBtn = screen.getByTestId('edit-btn') as HTMLButtonElement;
        expect(editBtn.disabled).toBe(true);
    });

    it('Duplicate button is present', async () => {
        const ScheduleDetail = await getScheduleDetail();
        render(
            <Wrap>
                <ScheduleDetail {...renderDetail()} />
            </Wrap>,
        );
        expect(screen.getByTestId('duplicate-btn')).toBeTruthy();
    });

    it('Delete button has aria-label', async () => {
        const ScheduleDetail = await getScheduleDetail();
        render(
            <Wrap>
                <ScheduleDetail {...renderDetail()} />
            </Wrap>,
        );
        expect(screen.getByRole('button', { name: /delete schedule/i })).toBeTruthy();
    });
});

// ============================================================================
// Info section
// ============================================================================

describe('ScheduleDetail — info section', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
        mockFetchApi.mockResolvedValue({ history: [] });
    });

    it('shows target basename prominently', async () => {
        const ScheduleDetail = await getScheduleDetail();
        render(
            <Wrap>
                <ScheduleDetail {...renderDetail()} />
            </Wrap>,
        );
        const basename = screen.getByTestId('target-basename');
        expect(basename.textContent).toBe('pipeline.yaml');
    });

    it('basename has title tooltip with full path', async () => {
        const ScheduleDetail = await getScheduleDetail();
        render(
            <Wrap>
                <ScheduleDetail {...renderDetail()} />
            </Wrap>,
        );
        const basename = screen.getByTestId('target-basename');
        expect(basename.getAttribute('title')).toBe('pipelines/test/pipeline.yaml');
    });

    it('renders params as pills', async () => {
        const ScheduleDetail = await getScheduleDetail();
        render(
            <Wrap>
                <ScheduleDetail {...renderDetail()} />
            </Wrap>,
        );
        const pills = screen.getByTestId('params-pills');
        expect(pills).toBeTruthy();
        expect(screen.getByTestId('param-pill-pipeline')).toBeTruthy();
        expect(screen.getByTestId('param-pill-env')).toBeTruthy();
        expect(screen.getByTestId('param-pill-env').textContent).toBe('env=prod');
    });

    it('shows None when params are empty', async () => {
        const ScheduleDetail = await getScheduleDetail();
        render(
            <Wrap>
                <ScheduleDetail {...renderDetail(MOCK_SCHEDULE_SCRIPT)} />
            </Wrap>,
        );
        expect(screen.queryByTestId('params-pills')).toBeNull();
        expect(screen.getByText('None')).toBeTruthy();
    });

    it('shows friendly onFailure label for continue', async () => {
        const ScheduleDetail = await getScheduleDetail();
        render(
            <Wrap>
                <ScheduleDetail {...renderDetail()} />
            </Wrap>,
        );
        expect(screen.getByText('Continue on failure')).toBeTruthy();
    });

    it('shows output folder when set', async () => {
        const ScheduleDetail = await getScheduleDetail();
        render(
            <Wrap>
                <ScheduleDetail {...renderDetail()} />
            </Wrap>,
        );
        expect(screen.getByTestId('output-folder')).toBeTruthy();
        expect(screen.getByTestId('output-folder').textContent).toBe('~/.coc/repos/ws-1/tasks');
    });

    it('hides output folder row when not set', async () => {
        const schedule = { ...MOCK_SCHEDULE, outputFolder: undefined };
        const ScheduleDetail = await getScheduleDetail();
        render(
            <Wrap>
                <ScheduleDetail {...renderDetail(schedule)} />
            </Wrap>,
        );
        expect(screen.queryByTestId('output-folder')).toBeNull();
    });

    it('shows cron description and expression', async () => {
        const ScheduleDetail = await getScheduleDetail();
        render(
            <Wrap>
                <ScheduleDetail {...renderDetail()} />
            </Wrap>,
        );
        const info = screen.getByTestId('schedule-info');
        expect(info.textContent).toContain('Every 2 hours');
        expect(info.textContent).toContain('0 */2 * * *');
    });

    it('shows created time', async () => {
        const ScheduleDetail = await getScheduleDetail();
        render(
            <Wrap>
                <ScheduleDetail {...renderDetail()} />
            </Wrap>,
        );
        const info = screen.getByTestId('schedule-info');
        expect(info.textContent).toContain('rel:');
    });
});

// ============================================================================
// Run history
// ============================================================================

describe('ScheduleDetail — run history', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
        mockFetchApi.mockResolvedValue({ history: [] });
    });

    it('shows empty state when no history', async () => {
        const ScheduleDetail = await getScheduleDetail();
        render(
            <Wrap>
                <ScheduleDetail {...renderDetail()} />
            </Wrap>,
        );
        expect(screen.getByTestId('no-runs-empty')).toBeTruthy();
    });

    it('empty state includes Run Now link', async () => {
        const onRunNow = vi.fn();
        const ScheduleDetail = await getScheduleDetail();
        render(
            <Wrap>
                <ScheduleDetail {...renderDetail(MOCK_SCHEDULE, [], { onRunNow })} />
            </Wrap>,
        );
        const emptyState = screen.getByTestId('no-runs-empty');
        const runLink = emptyState.querySelector('button') as HTMLButtonElement;
        expect(runLink).toBeTruthy();
        fireEvent.click(runLink);
        expect(onRunNow).toHaveBeenCalledWith('sched-1');
    });

    it('shows history header with count', async () => {
        const ScheduleDetail = await getScheduleDetail();
        render(
            <Wrap>
                <ScheduleDetail {...renderDetail(MOCK_SCHEDULE, MOCK_HISTORY)} />
            </Wrap>,
        );
        const history = screen.getByTestId('run-history');
        expect(history.textContent).toContain('Run History (3)');
    });

    it('shows Refresh button', async () => {
        const ScheduleDetail = await getScheduleDetail();
        render(
            <Wrap>
                <ScheduleDetail {...renderDetail(MOCK_SCHEDULE, MOCK_HISTORY)} />
            </Wrap>,
        );
        expect(screen.getByTestId('refresh-history-btn')).toBeTruthy();
    });

    it('Refresh button calls history API', async () => {
        mockFetchApi.mockResolvedValue({ history: MOCK_HISTORY });
        const ScheduleDetail = await getScheduleDetail();
        render(
            <Wrap>
                <ScheduleDetail {...renderDetail(MOCK_SCHEDULE, [])} />
            </Wrap>,
        );
        fireEvent.click(screen.getByTestId('refresh-history-btn'));
        await waitFor(() => {
            expect(mockFetchApi).toHaveBeenCalledWith(
                expect.stringContaining('/history'),
            );
        });
    });

    it('renders each run row with data-testid', async () => {
        const ScheduleDetail = await getScheduleDetail();
        render(
            <Wrap>
                <ScheduleDetail {...renderDetail(MOCK_SCHEDULE, MOCK_HISTORY)} />
            </Wrap>,
        );
        expect(screen.getByTestId('run-row-run-1')).toBeTruthy();
        expect(screen.getByTestId('run-row-run-2')).toBeTruthy();
        expect(screen.getByTestId('run-row-run-3')).toBeTruthy();
    });

    it('shows exit code badge for completed run', async () => {
        const ScheduleDetail = await getScheduleDetail();
        render(
            <Wrap>
                <ScheduleDetail {...renderDetail(MOCK_SCHEDULE, MOCK_HISTORY)} />
            </Wrap>,
        );
        const exitCode = screen.getByTestId('exit-code-run-1');
        expect(exitCode.textContent).toBe('0');
    });

    it('shows red exit code badge for failed run', async () => {
        const ScheduleDetail = await getScheduleDetail();
        render(
            <Wrap>
                <ScheduleDetail {...renderDetail(MOCK_SCHEDULE, MOCK_HISTORY)} />
            </Wrap>,
        );
        const exitCode = screen.getByTestId('exit-code-run-2');
        expect(exitCode.textContent).toBe('1');
        expect(exitCode.className).toContain('red');
    });

    it('shows "Show output" link for runs with stdout', async () => {
        const ScheduleDetail = await getScheduleDetail();
        render(
            <Wrap>
                <ScheduleDetail {...renderDetail(MOCK_SCHEDULE, MOCK_HISTORY)} />
            </Wrap>,
        );
        const row = screen.getByTestId('run-row-run-1');
        const showLink = row.querySelector('button[aria-expanded]');
        expect(showLink).toBeTruthy();
        expect(showLink!.textContent).toBe('Show output');
    });

    it('toggles output block on click', async () => {
        const ScheduleDetail = await getScheduleDetail();
        render(
            <Wrap>
                <ScheduleDetail {...renderDetail(MOCK_SCHEDULE, MOCK_HISTORY)} />
            </Wrap>,
        );
        const row = screen.getByTestId('run-row-run-1');
        const showLink = row.querySelector('button[aria-expanded]') as HTMLButtonElement;

        // Initially hidden
        expect(screen.queryByTestId('output-block-run-1')).toBeNull();

        // Show
        fireEvent.click(showLink);
        expect(screen.getByTestId('output-block-run-1')).toBeTruthy();
        expect(showLink.textContent).toBe('Hide output');

        // Hide
        fireEvent.click(showLink);
        expect(screen.queryByTestId('output-block-run-1')).toBeNull();
    });

    it('output block contains stdout content', async () => {
        const ScheduleDetail = await getScheduleDetail();
        render(
            <Wrap>
                <ScheduleDetail {...renderDetail(MOCK_SCHEDULE, MOCK_HISTORY)} />
            </Wrap>,
        );
        const row = screen.getByTestId('run-row-run-1');
        const showLink = row.querySelector('button[aria-expanded]') as HTMLButtonElement;
        fireEvent.click(showLink);
        const block = screen.getByTestId('output-block-run-1');
        expect(block.textContent).toContain('Success output');
    });

    it('output block contains stderr content with red styling', async () => {
        const ScheduleDetail = await getScheduleDetail();
        render(
            <Wrap>
                <ScheduleDetail {...renderDetail(MOCK_SCHEDULE, MOCK_HISTORY)} />
            </Wrap>,
        );
        const row2 = screen.getByTestId('run-row-run-2');
        const showLink = row2.querySelector('button[aria-expanded]') as HTMLButtonElement;
        fireEvent.click(showLink);
        const block = screen.getByTestId('output-block-run-2');
        expect(block.textContent).toContain('Error occurred');
        const stderrSpan = block.querySelector('.text-red-400');
        expect(stderrSpan).toBeTruthy();
    });

    it('running row shows spinner instead of static icon', async () => {
        const ScheduleDetail = await getScheduleDetail();
        render(
            <Wrap>
                <ScheduleDetail {...renderDetail(MOCK_SCHEDULE, MOCK_HISTORY)} />
            </Wrap>,
        );
        const runRow = screen.getByTestId('run-row-run-3');
        const spinner = runRow.querySelector('.animate-spin');
        expect(spinner).toBeTruthy();
    });

    it('does not show output toggle for runs with no output', async () => {
        const ScheduleDetail = await getScheduleDetail();
        render(
            <Wrap>
                <ScheduleDetail {...renderDetail(MOCK_SCHEDULE, MOCK_HISTORY)} />
            </Wrap>,
        );
        const runRow = screen.getByTestId('run-row-run-3');
        const showLink = runRow.querySelector('button[aria-expanded]');
        expect(showLink).toBeNull();
    });

    it('limits visible history to 20 and shows Load more', async () => {
        const largeHistory = Array.from({ length: 25 }, (_, i) => ({
            id: `run-${i}`,
            scheduleId: 'sched-1',
            startedAt: new Date().toISOString(),
            status: 'completed',
            durationMs: 1000,
            exitCode: 0,
        }));
        const ScheduleDetail = await getScheduleDetail();
        render(
            <Wrap>
                <ScheduleDetail {...renderDetail(MOCK_SCHEDULE, largeHistory)} />
            </Wrap>,
        );
        expect(screen.getByTestId('load-more-history')).toBeTruthy();
        expect(screen.getByTestId('load-more-history').textContent).toContain('5 remaining');
    });

    it('Load more shows additional runs on click', async () => {
        const largeHistory = Array.from({ length: 25 }, (_, i) => ({
            id: `run-${i}`,
            scheduleId: 'sched-1',
            startedAt: new Date().toISOString(),
            status: 'completed',
            durationMs: 1000,
            exitCode: 0,
        }));
        const ScheduleDetail = await getScheduleDetail();
        render(
            <Wrap>
                <ScheduleDetail {...renderDetail(MOCK_SCHEDULE, largeHistory)} />
            </Wrap>,
        );
        expect(screen.queryByTestId('run-row-run-24')).toBeNull();
        fireEvent.click(screen.getByTestId('load-more-history'));
        await waitFor(() => {
            expect(screen.getByTestId('run-row-run-24')).toBeTruthy();
        });
    });
});

// ============================================================================
// Utility functions
// ============================================================================

describe('failureLabel mapping', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
        mockFetchApi.mockResolvedValue({ history: [] });
    });

    it.each([
        ['continue', 'Continue on failure'],
        ['stop', 'Stop on failure'],
        ['notify', 'Notify on failure'],
    ])('maps %s to %s', async (raw, label) => {
        const schedule = { ...MOCK_SCHEDULE, onFailure: raw };
        const ScheduleDetail = await getScheduleDetail();
        render(
            <Wrap>
                <ScheduleDetail {...renderDetail(schedule)} />
            </Wrap>,
        );
        expect(screen.getByText(label)).toBeTruthy();
    });
});

describe('formatDuration', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
        mockFetchApi.mockResolvedValue({ history: [] });
    });

    it('shows duration in seconds for completed run', async () => {
        const history = [{
            id: 'r1',
            scheduleId: 'sched-1',
            startedAt: new Date().toISOString(),
            status: 'completed',
            durationMs: 12000,
            exitCode: 0,
        }];
        const ScheduleDetail = await getScheduleDetail();
        render(
            <Wrap>
                <ScheduleDetail {...renderDetail(MOCK_SCHEDULE, history)} />
            </Wrap>,
        );
        const row = screen.getByTestId('run-row-r1');
        expect(row.textContent).toContain('12s');
    });

    it('shows — for runs without duration', async () => {
        const history = [{
            id: 'r1',
            scheduleId: 'sched-1',
            startedAt: new Date().toISOString(),
            status: 'running',
            durationMs: undefined,
            exitCode: undefined,
        }];
        const ScheduleDetail = await getScheduleDetail();
        render(
            <Wrap>
                <ScheduleDetail {...renderDetail(MOCK_SCHEDULE, history)} />
            </Wrap>,
        );
        const row = screen.getByTestId('run-row-r1');
        expect(row.textContent).toContain('—');
    });
});
