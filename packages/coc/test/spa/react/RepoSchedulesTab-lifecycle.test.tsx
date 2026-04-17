/**
 * RepoSchedulesTab lifecycle tests: delete, pause/resume, and [Prompt] badge.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { AppProvider } from '../../../src/server/spa/client/react/context/AppContext';
import { QueueProvider } from '../../../src/server/spa/client/react/context/QueueContext';
import { ToastProvider } from '../../../src/server/spa/client/react/context/ToastContext';

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

async function renderWithSchedules(schedules: any[]) {
    mockFetchApi.mockImplementation((url: string) => {
        if (url.includes('/history')) return Promise.resolve({ history: [] });
        return Promise.resolve({ schedules });
    });
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });

    const { RepoSchedulesTab } = await import(
        '../../../src/server/spa/client/react/repos/RepoSchedulesTab'
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
// [Prompt] badge
// ============================================================================

describe('RepoSchedulesTab — [Prompt] and [Script] badges', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('shows [Prompt] badge for prompt-type schedule', async () => {
        await renderWithSchedules([MOCK_SCHEDULE_PROMPT]);
        expect(screen.getByText('[Prompt]')).toBeTruthy();
    });

    it('shows [Script] badge for script-type schedule', async () => {
        await renderWithSchedules([MOCK_SCHEDULE_SCRIPT]);
        expect(screen.getByText('[Script]')).toBeTruthy();
    });

    it('shows [Prompt] badge when targetType is undefined', async () => {
        const noType = { ...MOCK_SCHEDULE_PROMPT, targetType: undefined };
        await renderWithSchedules([noType]);
        expect(screen.getByText('[Prompt]')).toBeTruthy();
    });

    it('renders both badges when both schedule types are in the list', async () => {
        await renderWithSchedules([MOCK_SCHEDULE_PROMPT, MOCK_SCHEDULE_SCRIPT]);
        expect(screen.getByText('[Prompt]')).toBeTruthy();
        expect(screen.getByText('[Script]')).toBeTruthy();
    });
});

// ============================================================================
// Pause / Resume
// ============================================================================

describe('RepoSchedulesTab — pause and resume', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('clicking Pause sends PATCH with status=paused for active schedule', async () => {
        await renderWithSchedules([MOCK_SCHEDULE_PROMPT]);

        await waitFor(() => expect(screen.getByRole('button', { name: /pause schedule/i })).toBeTruthy());
        fireEvent.click(screen.getByRole('button', { name: /pause schedule/i }));

        await waitFor(() => {
            const patchCall = mockFetch.mock.calls.find(
                (c: any[]) => c[1]?.method === 'PATCH' && (c[0] as string).includes('/schedules/'),
            );
            expect(patchCall).toBeTruthy();
            const body = JSON.parse(patchCall![1].body);
            expect(body.status).toBe('paused');
        });
    });

    it('clicking Resume sends PATCH with status=active for paused schedule', async () => {
        await renderWithSchedules([MOCK_SCHEDULE_PAUSED]);

        await waitFor(() => expect(screen.getByRole('button', { name: /resume schedule/i })).toBeTruthy());
        fireEvent.click(screen.getByRole('button', { name: /resume schedule/i }));

        await waitFor(() => {
            const patchCall = mockFetch.mock.calls.find(
                (c: any[]) => c[1]?.method === 'PATCH' && (c[0] as string).includes('/schedules/'),
            );
            expect(patchCall).toBeTruthy();
            const body = JSON.parse(patchCall![1].body);
            expect(body.status).toBe('active');
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

    it('clicking Delete sends DELETE request to schedules endpoint', async () => {
        await renderWithSchedules([MOCK_SCHEDULE_PROMPT]);

        await waitFor(() => expect(screen.getByRole('button', { name: /delete schedule/i })).toBeTruthy());
        fireEvent.click(screen.getByRole('button', { name: /delete schedule/i }));

        await waitFor(() => {
            const deleteCall = mockFetch.mock.calls.find(
                (c: any[]) => c[1]?.method === 'DELETE' && (c[0] as string).includes('/schedules/'),
            );
            expect(deleteCall).toBeTruthy();
        });
    });

    it('clicking Delete does NOT send request when confirm is cancelled', async () => {
        vi.stubGlobal('confirm', () => false);
        await renderWithSchedules([MOCK_SCHEDULE_PROMPT]);

        await waitFor(() => expect(screen.getByRole('button', { name: /delete schedule/i })).toBeTruthy());
        fireEvent.click(screen.getByRole('button', { name: /delete schedule/i }));

        await new Promise(r => setTimeout(r, 100));
        const deleteCall = mockFetch.mock.calls.find(
            (c: any[]) => c[1]?.method === 'DELETE',
        );
        expect(deleteCall).toBeFalsy();
    });

    it('DELETE request targets the correct schedule ID', async () => {
        await renderWithSchedules([MOCK_SCHEDULE_PROMPT]);

        await waitFor(() => expect(screen.getByRole('button', { name: /delete schedule/i })).toBeTruthy());
        fireEvent.click(screen.getByRole('button', { name: /delete schedule/i }));

        await waitFor(() => {
            const deleteCall = mockFetch.mock.calls.find(
                (c: any[]) => c[1]?.method === 'DELETE' && (c[0] as string).includes('/sched-prompt'),
            );
            expect(deleteCall).toBeTruthy();
        });
    });
});
