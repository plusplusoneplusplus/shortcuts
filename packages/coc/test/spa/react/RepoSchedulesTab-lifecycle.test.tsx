/**
 * RepoSchedulesTab lifecycle tests: delete, pause/resume, and type label pills.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { AppProvider } from '../../../src/server/spa/client/react/contexts/AppContext';
import { QueueProvider } from '../../../src/server/spa/client/react/contexts/QueueContext';
import { ToastProvider } from '../../../src/server/spa/client/react/contexts/ToastContext';

const { mockSchedulesClient } = vi.hoisted(() => ({
    mockSchedulesClient: {
        list: vi.fn(),
        history: vi.fn(),
        disable: vi.fn(),
        enable: vi.fn(),
        delete: vi.fn(),
        move: vi.fn(),
        run: vi.fn(),
    },
}));

const MOCK_SCHEDULE_PROMPT = {
    id: 'sched-prompt',
    name: 'Prompt Schedule',
    target: 'pipelines/test/pipeline.yaml',
    targetType: 'prompt' as const,
    cron: '0 9 * * *',
    cronDescription: 'Every day at 09:00',
    params: {},
    onFailure: 'notify',
    status: 'active',
    isRunning: false,
    nextRun: new Date(Date.now() + 3600000).toISOString(),
    createdAt: new Date().toISOString(),
};

const MOCK_SCHEDULE_SCRIPT = {
    id: 'sched-script',
    name: 'Script Schedule',
    target: 'scripts/run.sh',
    targetType: 'script' as const,
    cron: '*/5 * * * *',
    cronDescription: 'Every 5 minutes',
    params: {},
    onFailure: 'notify',
    status: 'active',
    isRunning: false,
    nextRun: new Date(Date.now() + 1800000).toISOString(),
    createdAt: new Date().toISOString(),
};

const MOCK_SCHEDULE_PAUSED = {
    ...MOCK_SCHEDULE_PROMPT,
    id: 'sched-paused',
    status: 'paused' as const,
    nextRun: null,
};

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const mockFetchApi = vi.fn();
vi.mock('../../../src/server/spa/client/react/hooks/useApi', () => ({
    fetchApi: (...args: any[]) => mockFetchApi(...args),
}));

vi.mock('../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({ schedules: mockSchedulesClient }),
}));

vi.mock('../../../src/server/spa/client/react/utils/config', () => ({
    isContainerMode: () => false,
    getApiBase: () => 'http://localhost:4000/api',
    isRalphEnabled: () => false,
}));

vi.mock('../../../src/server/spa/client/react/utils/format', () => ({
    formatRelativeTime: (d: string) => `rel:${d}`,
}));

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

async function renderWithSchedules(schedules: any[]) {
    mockSchedulesClient.list.mockResolvedValue(schedules);
    mockSchedulesClient.history.mockResolvedValue([]);
    mockSchedulesClient.disable.mockResolvedValue({});
    mockSchedulesClient.enable.mockResolvedValue({});
    mockSchedulesClient.delete.mockResolvedValue({ deleted: true });
    mockSchedulesClient.move.mockResolvedValue({});
    mockSchedulesClient.run.mockResolvedValue({ run: {} });
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

// ============================================================================
// Type label pills (no brackets)
// ============================================================================

describe('RepoSchedulesTab — Prompt and Script type labels', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('shows Prompt label pill for prompt-type schedule', async () => {
        await renderWithSchedules([MOCK_SCHEDULE_PROMPT]);
        // List row and detail header both render the same pill testid.
        const pills = screen.getAllByTestId('type-label-prompt');
        expect(pills.length).toBeGreaterThan(0);
        expect(pills[0].textContent).toBe('Prompt');
    });

    it('shows Script label pill for script-type schedule', async () => {
        await renderWithSchedules([MOCK_SCHEDULE_SCRIPT]);
        const pills = screen.getAllByTestId('type-label-script');
        expect(pills.length).toBeGreaterThan(0);
        expect(pills[0].textContent).toBe('Script');
    });

    it('shows Prompt label pill when targetType is undefined', async () => {
        const noType = { ...MOCK_SCHEDULE_PROMPT, targetType: undefined };
        await renderWithSchedules([noType]);
        expect(screen.getAllByTestId('type-label-prompt').length).toBeGreaterThan(0);
    });

    it('renders both pills when both schedule types are in the list', async () => {
        await renderWithSchedules([MOCK_SCHEDULE_PROMPT, MOCK_SCHEDULE_SCRIPT]);
        expect(screen.getAllByTestId('type-label-prompt').length).toBeGreaterThan(0);
        expect(screen.getAllByTestId('type-label-script').length).toBeGreaterThan(0);
    });

    it('does not render type labels with bracket syntax', async () => {
        await renderWithSchedules([MOCK_SCHEDULE_PROMPT, MOCK_SCHEDULE_SCRIPT]);
        expect(screen.queryByText('[Prompt]')).toBeNull();
        expect(screen.queryByText('[Script]')).toBeNull();
    });
});

// ============================================================================
// Pause / Resume
// ============================================================================

describe('RepoSchedulesTab — pause and resume', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('clicking Pause disables the active schedule through the typed client', async () => {
        await renderWithSchedules([MOCK_SCHEDULE_PROMPT]);

        await waitFor(() => expect(screen.getByRole('button', { name: /pause schedule/i })).toBeTruthy());
        fireEvent.click(screen.getByRole('button', { name: /pause schedule/i }));

        await waitFor(() => {
            expect(mockSchedulesClient.disable).toHaveBeenCalledWith('ws-1', 'sched-prompt');
        });
    });

    it('clicking Resume enables the paused schedule through the typed client', async () => {
        await renderWithSchedules([MOCK_SCHEDULE_PAUSED]);

        await waitFor(() => expect(screen.getByRole('button', { name: /resume schedule/i })).toBeTruthy());
        fireEvent.click(screen.getByRole('button', { name: /resume schedule/i }));

        await waitFor(() => {
            expect(mockSchedulesClient.enable).toHaveBeenCalledWith('ws-1', 'sched-paused');
        });
    });
});

// ============================================================================
// Delete
// ============================================================================

describe('RepoSchedulesTab — delete', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Allow confirm dialog
        vi.stubGlobal('confirm', () => true);
    });

    it('clicking Delete deletes through the typed client', async () => {
        await renderWithSchedules([MOCK_SCHEDULE_PROMPT]);

        await waitFor(() => expect(screen.getByRole('button', { name: /delete schedule/i })).toBeTruthy());
        fireEvent.click(screen.getByRole('button', { name: /delete schedule/i }));

        await waitFor(() => {
            expect(mockSchedulesClient.delete).toHaveBeenCalledWith('ws-1', 'sched-prompt');
        });
    });

    it('clicking Delete does NOT send request when confirm is cancelled', async () => {
        vi.stubGlobal('confirm', () => false);
        await renderWithSchedules([MOCK_SCHEDULE_PROMPT]);

        await waitFor(() => expect(screen.getByRole('button', { name: /delete schedule/i })).toBeTruthy());
        fireEvent.click(screen.getByRole('button', { name: /delete schedule/i }));

        await new Promise(r => setTimeout(r, 100));
        expect(mockSchedulesClient.delete).not.toHaveBeenCalled();
    });

    it('delete targets the correct schedule ID', async () => {
        await renderWithSchedules([MOCK_SCHEDULE_PROMPT]);

        await waitFor(() => expect(screen.getByRole('button', { name: /delete schedule/i })).toBeTruthy());
        fireEvent.click(screen.getByRole('button', { name: /delete schedule/i }));

        await waitFor(() => {
            expect(mockSchedulesClient.delete).toHaveBeenCalledWith('ws-1', 'sched-prompt');
        });
    });
});
