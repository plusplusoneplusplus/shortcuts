/**
 * @vitest-environment jsdom
 *
 * AC-02 / AC-03 host — the schedule create / view-edit surface rendered in the
 * chat-list main pane when the `schedulesInScheduledSlide` flag is ON.
 *
 * Covers:
 *  - `parseScheduleMainPaneRoute` (pure): new / detail / bare / wrong-workspace;
 *  - route `new`    → renders the PromptScheduleForm; create navigates to the
 *    new schedule's detail hash;
 *  - route `detail` → renders ScheduleDetail for the matched schedule, with the
 *    Duplicate action hidden (out of scope for this surface);
 *  - detail actions (Run now / Pause / Delete) call the schedules client;
 *  - an unknown id after load shows the "not found" state.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { AppProvider } from '../../../../src/server/spa/client/react/contexts/AppContext';
import {
    ScheduleMainPane,
    parseScheduleMainPaneRoute,
    type ScheduleMainPaneRoute,
} from '../../../../src/server/spa/client/react/features/schedules/ScheduleMainPane';

const { mockSchedulesClient } = vi.hoisted(() => ({
    mockSchedulesClient: {
        list: vi.fn(),
        history: vi.fn(),
        run: vi.fn(),
        enable: vi.fn(),
        disable: vi.fn(),
        delete: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        refine: vi.fn(),
    },
}));

vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        schedules: mockSchedulesClient,
        agentProviders: { listModels: vi.fn().mockResolvedValue({ models: [] }) },
        notes: { getGitStatus: vi.fn().mockResolvedValue({ initialized: false }) },
    }),
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

function Wrap({ children }: { children: ReactNode }) {
    return <AppProvider>{children}</AppProvider>;
}

async function renderPane(route: ScheduleMainPaneRoute, schedules: any[] = [MY_PROMPT]) {
    mockSchedulesClient.list.mockResolvedValue(schedules);
    mockSchedulesClient.history.mockResolvedValue([]);
    return render(
        <Wrap>
            <ScheduleMainPane workspaceId="ws-1" route={route} />
        </Wrap>,
    );
}

describe('parseScheduleMainPaneRoute', () => {
    it('parses the create route', () => {
        expect(parseScheduleMainPaneRoute('#repos/ws-1/schedules/new', 'ws-1')).toEqual({ kind: 'new' });
    });
    it('parses a detail route (with decoding)', () => {
        expect(parseScheduleMainPaneRoute('#repos/ws-1/schedules/repo%3Aslug', 'ws-1'))
            .toEqual({ kind: 'detail', scheduleId: 'repo:slug' });
    });
    it('returns null for the bare schedules route (no id)', () => {
        expect(parseScheduleMainPaneRoute('#repos/ws-1/schedules', 'ws-1')).toBeNull();
    });
    it('returns null when the workspace does not match', () => {
        expect(parseScheduleMainPaneRoute('#repos/ws-2/schedules/sch-1', 'ws-1')).toBeNull();
    });
    it('returns null for a non-schedules route', () => {
        expect(parseScheduleMainPaneRoute('#repos/ws-1/chats/abc', 'ws-1')).toBeNull();
        expect(parseScheduleMainPaneRoute('', 'ws-1')).toBeNull();
    });
    it('ignores a trailing query string', () => {
        expect(parseScheduleMainPaneRoute('#repos/ws-1/schedules/sch-1?x=1', 'ws-1'))
            .toEqual({ kind: 'detail', scheduleId: 'sch-1' });
    });
});

describe('ScheduleMainPane — create route', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        location.hash = '';
    });

    it('renders the prompt schedule form for the new route', async () => {
        await renderPane({ kind: 'new' });
        await waitFor(() => expect(screen.getByTestId('schedule-main-pane')).toBeTruthy());
        expect(screen.getByTestId('schedule-main-pane').getAttribute('data-schedule-pane-mode')).toBe('new');
        expect(screen.getByTestId('prompt-schedule-form')).toBeTruthy();
    });

    it('navigates to the new schedule detail hash after a successful create', async () => {
        mockSchedulesClient.create.mockResolvedValue({ schedule: { id: 'sched-new', name: 'x' } });
        await renderPane({ kind: 'new' });
        await waitFor(() => expect(screen.getByTestId('prompt-schedule-form')).toBeTruthy());

        fireEvent.change(screen.getByTestId('prompt-name-input'), { target: { value: 'My routine' } });
        fireEvent.change(screen.getByTestId('prompt-instructions-input'), { target: { value: 'do the thing' } });
        fireEvent.click(screen.getByTestId('prompt-submit-btn'));

        await waitFor(() => expect(mockSchedulesClient.create).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(location.hash).toBe('#repos/ws-1/schedules/sched-new'));
    });

    it('cancelling the form returns to the bare schedules hash', async () => {
        await renderPane({ kind: 'new' });
        await waitFor(() => expect(screen.getByTestId('prompt-schedule-form')).toBeTruthy());
        fireEvent.click(screen.getByTestId('schedule-main-pane-close'));
        expect(location.hash).toBe('#repos/ws-1/schedules');
    });
});

describe('ScheduleMainPane — detail route', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        location.hash = '';
    });

    it('renders ScheduleDetail for a known schedule, without the Duplicate action', async () => {
        await renderPane({ kind: 'detail', scheduleId: 'sched-my-prompt' });
        await waitFor(() => expect(screen.getByTestId('schedule-detail')).toBeTruthy());
        expect(screen.getByTestId('schedule-name').textContent).toContain('Daily standup');
        // Duplicate is intentionally out of scope for the Scheduled-slide main pane.
        expect(screen.queryByTestId('duplicate-btn')).toBeNull();
        // History is fetched for the selected schedule.
        expect(mockSchedulesClient.history).toHaveBeenCalledWith('ws-1', 'sched-my-prompt');
    });

    it('runs the schedule via the client on "Run now"', async () => {
        mockSchedulesClient.run.mockResolvedValue({ run: {} });
        await renderPane({ kind: 'detail', scheduleId: 'sched-my-prompt' });
        await waitFor(() => expect(screen.getByTestId('schedule-detail')).toBeTruthy());
        fireEvent.click(screen.getByLabelText('Run schedule now'));
        await waitFor(() => expect(mockSchedulesClient.run).toHaveBeenCalledWith('ws-1', 'sched-my-prompt'));
    });

    it('pauses an active schedule via the client', async () => {
        mockSchedulesClient.disable.mockResolvedValue({ schedule: {} });
        await renderPane({ kind: 'detail', scheduleId: 'sched-my-prompt' });
        await waitFor(() => expect(screen.getByTestId('schedule-detail')).toBeTruthy());
        fireEvent.click(screen.getByLabelText('Pause schedule'));
        await waitFor(() => expect(mockSchedulesClient.disable).toHaveBeenCalledWith('ws-1', 'sched-my-prompt'));
    });

    it('deletes the schedule (confirmed) and returns to the schedules hash', async () => {
        const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
        mockSchedulesClient.delete.mockResolvedValue({ deleted: true });
        location.hash = '#repos/ws-1/schedules/sched-my-prompt';
        await renderPane({ kind: 'detail', scheduleId: 'sched-my-prompt' });
        await waitFor(() => expect(screen.getByTestId('schedule-detail')).toBeTruthy());
        fireEvent.click(screen.getByLabelText('Delete schedule'));
        await waitFor(() => expect(mockSchedulesClient.delete).toHaveBeenCalledWith('ws-1', 'sched-my-prompt'));
        await waitFor(() => expect(location.hash).toBe('#repos/ws-1/schedules'));
        confirmSpy.mockRestore();
    });

    it('shows a not-found state for an unknown schedule id after load', async () => {
        await renderPane({ kind: 'detail', scheduleId: 'does-not-exist' }, [MY_PROMPT]);
        await waitFor(() => expect(screen.getByTestId('schedule-main-pane-not-found')).toBeTruthy());
    });
});
