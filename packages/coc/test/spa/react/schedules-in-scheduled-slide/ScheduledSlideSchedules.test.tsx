/**
 * @vitest-environment jsdom
 *
 * AC-01 — the Scheduled slide lists schedule definitions.
 *
 * These tests cover the standalone `ScheduledSlideSchedules` section that renders
 * at the top of the chat-list "Scheduled" slide:
 *  - flag OFF → renders nothing and never fetches (slide stays runs-only);
 *  - flag ON  → definitions render with source/type/mode/next-run, plus a
 *    "+ New schedule" affordance; loading / empty / error states behave;
 *  - clicking "+ New schedule" and a row navigate via the schedules hash;
 *  - a `schedule-changed` WS event live-refreshes the list.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { AppProvider } from '../../../../src/server/spa/client/react/contexts/AppContext';

const { mockSchedulesClient, flag } = vi.hoisted(() => ({
    mockSchedulesClient: {
        list: vi.fn(),
    },
    flag: { enabled: true },
}));

vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/useSchedulesInScheduledSlideEnabled', () => ({
    useSchedulesInScheduledSlideEnabled: () => flag.enabled,
}));

vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        schedules: mockSchedulesClient,
        notes: { getGitStatus: vi.fn().mockResolvedValue({ initialized: false }) },
    }),
}));

vi.mock('../../../../src/server/spa/client/react/utils/format', () => ({
    formatRelativeTime: (d: string) => `rel:${d}`,
}));

const MY_PROMPT = {
    id: 'sched-my-prompt',
    name: 'Daily standup',
    target: 'summarize the day',
    targetType: 'prompt' as const,
    cron: '0 9 * * 1-5',
    cronDescription: 'Weekdays at 09:00',
    params: {},
    onFailure: 'notify',
    status: 'active',
    isRunning: false,
    nextRun: '2026-07-08T09:00:00.000Z',
    createdAt: '2026-07-01T00:00:00.000Z',
    mode: 'ask' as const,
    source: 'user' as const,
};

const REPO_SCRIPT = {
    id: 'sched-repo-script',
    name: 'Nightly build',
    target: 'scripts/build.sh',
    targetType: 'script' as const,
    cron: '0 2 * * *',
    cronDescription: 'Every day at 02:00',
    params: {},
    onFailure: 'notify',
    status: 'paused',
    isRunning: false,
    nextRun: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    source: 'repo' as const,
};

function Wrap({ children }: { children: ReactNode }) {
    return <AppProvider>{children}</AppProvider>;
}

async function renderSlide(schedules: any[] | Promise<any[]>) {
    mockSchedulesClient.list.mockReturnValue(
        schedules instanceof Promise ? schedules : Promise.resolve(schedules),
    );
    const { ScheduledSlideSchedules } = await import(
        '../../../../src/server/spa/client/react/features/schedules/ScheduledSlideSchedules'
    );
    return render(
        <Wrap>
            <ScheduledSlideSchedules workspaceId="ws-1" />
        </Wrap>,
    );
}

describe('ScheduledSlideSchedules — feature flag gating', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        flag.enabled = true;
        location.hash = '';
    });

    it('renders nothing and never fetches when the flag is OFF', async () => {
        flag.enabled = false;
        await renderSlide([MY_PROMPT]);
        expect(screen.queryByTestId('scheduled-slide-schedules')).toBeNull();
        // Give any stray effect a tick to (not) run.
        await new Promise(r => setTimeout(r, 20));
        expect(mockSchedulesClient.list).not.toHaveBeenCalled();
    });

    it('renders the definitions section when the flag is ON', async () => {
        await renderSlide([MY_PROMPT]);
        await waitFor(() => expect(screen.getByTestId('scheduled-slide-schedules')).toBeTruthy());
        expect(mockSchedulesClient.list).toHaveBeenCalledWith('ws-1');
    });
});

describe('ScheduledSlideSchedules — list rendering', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        flag.enabled = true;
        location.hash = '';
    });

    it('shows a "+ New schedule" button and a definition count', async () => {
        await renderSlide([MY_PROMPT, REPO_SCRIPT]);
        await waitFor(() => expect(screen.getByTestId('scheduled-slide-schedules-list')).toBeTruthy());
        expect(screen.getByTestId('scheduled-slide-new-schedule-btn').textContent).toContain('New schedule');
        expect(screen.getByTestId('scheduled-slide-schedules-count').textContent).toBe('2');
    });

    it('renders one row per schedule with name, source, type and next-run', async () => {
        await renderSlide([MY_PROMPT, REPO_SCRIPT]);
        await waitFor(() => expect(screen.getAllByTestId('scheduled-slide-schedule-row').length).toBe(2));

        expect(screen.getByText('Daily standup')).toBeTruthy();
        expect(screen.getByText('Nightly build')).toBeTruthy();
        // Source pills: My for user, Repo for repo.
        expect(screen.getByTestId('scheduled-slide-source-my')).toBeTruthy();
        expect(screen.getByTestId('scheduled-slide-source-repo')).toBeTruthy();
        // Script type pill on the repo script.
        expect(screen.getByTestId('scheduled-slide-type-script')).toBeTruthy();
        // Mode pill for the prompt schedule (mode: ask).
        expect(screen.getByTestId('scheduled-slide-mode').textContent).toBe('Ask');
        // Next-run label goes through formatRelativeTime for the active schedule.
        expect(screen.getByText('rel:2026-07-08T09:00:00.000Z')).toBeTruthy();
        // Paused schedule shows "paused" instead of a next-run.
        expect(screen.getByText('paused')).toBeTruthy();
    });

    it('sorts My schedules above Repo schedules', async () => {
        await renderSlide([REPO_SCRIPT, MY_PROMPT]);
        await waitFor(() => expect(screen.getAllByTestId('scheduled-slide-schedule-row').length).toBe(2));
        const rows = screen.getAllByTestId('scheduled-slide-schedule-row');
        expect(rows[0].getAttribute('data-schedule-id')).toBe('sched-my-prompt');
        expect(rows[1].getAttribute('data-schedule-id')).toBe('sched-repo-script');
    });

    it('shows an empty state when there are no schedules', async () => {
        await renderSlide([]);
        await waitFor(() => expect(screen.getByTestId('scheduled-slide-schedules-empty')).toBeTruthy());
        // "+ New schedule" is still offered in the empty state.
        expect(screen.getByTestId('scheduled-slide-new-schedule-btn')).toBeTruthy();
    });
});

describe('ScheduledSlideSchedules — error handling', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        flag.enabled = true;
        location.hash = '';
    });

    it('shows an error state with retry when the list fails, then recovers', async () => {
        mockSchedulesClient.list
            .mockRejectedValueOnce(new Error('boom'))
            .mockResolvedValueOnce([MY_PROMPT]);
        const { ScheduledSlideSchedules } = await import(
            '../../../../src/server/spa/client/react/features/schedules/ScheduledSlideSchedules'
        );
        render(
            <Wrap>
                <ScheduledSlideSchedules workspaceId="ws-1" />
            </Wrap>,
        );
        await waitFor(() => expect(screen.getByTestId('scheduled-slide-schedules-error')).toBeTruthy());

        fireEvent.click(screen.getByTestId('scheduled-slide-schedules-retry'));
        await waitFor(() => expect(screen.getByTestId('scheduled-slide-schedules-list')).toBeTruthy());
        expect(mockSchedulesClient.list).toHaveBeenCalledTimes(2);
    });
});

describe('ScheduledSlideSchedules — navigation and live refresh', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        flag.enabled = true;
        location.hash = '';
    });

    it('"+ New schedule" navigates to the schedules/new hash', async () => {
        await renderSlide([MY_PROMPT]);
        await waitFor(() => expect(screen.getByTestId('scheduled-slide-new-schedule-btn')).toBeTruthy());
        fireEvent.click(screen.getByTestId('scheduled-slide-new-schedule-btn'));
        expect(location.hash).toBe('#repos/ws-1/schedules/new');
    });

    it('clicking a row navigates to that schedule detail hash', async () => {
        await renderSlide([MY_PROMPT]);
        await waitFor(() => expect(screen.getByTestId('scheduled-slide-schedule-row')).toBeTruthy());
        fireEvent.click(screen.getByTestId('scheduled-slide-schedule-row'));
        expect(location.hash).toBe('#repos/ws-1/schedules/sched-my-prompt');
    });

    it('refreshes the list on a schedule-changed event', async () => {
        await renderSlide([MY_PROMPT]);
        await waitFor(() => expect(mockSchedulesClient.list).toHaveBeenCalledTimes(1));
        mockSchedulesClient.list.mockResolvedValue([MY_PROMPT, REPO_SCRIPT]);
        act(() => {
            window.dispatchEvent(new Event('schedule-changed'));
        });
        await waitFor(() => expect(mockSchedulesClient.list).toHaveBeenCalledTimes(2));
        await waitFor(() => expect(screen.getAllByTestId('scheduled-slide-schedule-row').length).toBe(2));
    });
});
