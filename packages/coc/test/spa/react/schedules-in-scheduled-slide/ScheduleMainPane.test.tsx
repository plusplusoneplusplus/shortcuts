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
 *  - an unknown id after load shows the "not found" state;
 *  - Edit is disabled with a hint for non-prompt (script / workflow) schedules
 *    in this prompt-only host, while the classic Schedules tab (no
 *    `disableNonPromptEdit`) keeps Edit enabled for them.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { AppProvider } from '../../../../src/server/spa/client/react/contexts/AppContext';
import {
    ScheduleMainPane,
    parseScheduleMainPaneRoute,
    isSchedulesRoute,
    type ScheduleMainPaneRoute,
} from '../../../../src/server/spa/client/react/features/schedules/ScheduleMainPane';
import {
    ScheduleDetail,
    isPromptEditableSchedule,
    NON_PROMPT_EDIT_HINT,
} from '../../../../src/server/spa/client/react/features/schedules/ScheduleDetail';

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
        move: vi.fn(),
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

// A script schedule — not editable with the Prompt form.
const MY_SCRIPT = {
    ...MY_PROMPT,
    id: 'sched-script',
    name: 'Nightly backup',
    targetType: 'script' as const,
    target: 'scripts/backup.sh',
    params: {},
};

// A workflow schedule (targetType 'prompt' but carries a `pipeline` param) —
// also not editable with the Prompt form.
const MY_WORKFLOW = {
    ...MY_PROMPT,
    id: 'sched-workflow',
    name: 'Weekly report',
    targetType: 'prompt' as const,
    params: { pipeline: 'pipelines/report/pipeline.yaml' },
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

describe('isSchedulesRoute', () => {
    it('is true for the bare schedules landing hash (where parse returns null)', () => {
        expect(isSchedulesRoute('#repos/ws-1/schedules', 'ws-1')).toBe(true);
        expect(parseScheduleMainPaneRoute('#repos/ws-1/schedules', 'ws-1')).toBeNull();
    });
    it('is true for the create and detail deep links', () => {
        expect(isSchedulesRoute('#repos/ws-1/schedules/new', 'ws-1')).toBe(true);
        expect(isSchedulesRoute('#repos/ws-1/schedules/sch-1', 'ws-1')).toBe(true);
        expect(isSchedulesRoute('#repos/ws-1/schedules/repo%3Aslug?x=1', 'ws-1')).toBe(true);
    });
    it('is false when the workspace does not match', () => {
        expect(isSchedulesRoute('#repos/ws-2/schedules/sch-1', 'ws-1')).toBe(false);
        expect(isSchedulesRoute('#repos/ws-2/schedules', 'ws-1')).toBe(false);
    });
    it('is false for non-schedules routes and empty hashes', () => {
        expect(isSchedulesRoute('#repos/ws-1/chats/abc', 'ws-1')).toBe(false);
        expect(isSchedulesRoute('#repos/ws-1', 'ws-1')).toBe(false);
        expect(isSchedulesRoute('', 'ws-1')).toBe(false);
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

describe('ScheduleMainPane — create store picker + commit reminder', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        location.hash = '';
        mockSchedulesClient.list.mockResolvedValue([]);
        mockSchedulesClient.history.mockResolvedValue([]);
    });

    it('exposes the My/Repo store picker in the create form', async () => {
        await renderPane({ kind: 'new' });
        await waitFor(() => expect(screen.getByTestId('prompt-schedule-form')).toBeTruthy());
        expect(screen.getByTestId('prompt-store-picker')).toBeTruthy();
        expect(screen.getByTestId('prompt-store-my')).toBeTruthy();
        expect(screen.getByTestId('prompt-store-repo')).toBeTruthy();
    });

    it('creates into repo (create + move) and shows the commit-to-share reminder on the new detail', async () => {
        mockSchedulesClient.create.mockResolvedValue({ schedule: { id: 'sched-new' } });
        mockSchedulesClient.move.mockResolvedValue({ schedule: { id: 'repo:sched-new', source: 'repo' } });

        const { rerender } = render(
            <Wrap>
                <ScheduleMainPane workspaceId="ws-1" route={{ kind: 'new' }} />
            </Wrap>,
        );
        await waitFor(() => expect(screen.getByTestId('prompt-schedule-form')).toBeTruthy());

        fireEvent.click(screen.getByTestId('prompt-store-repo'));
        fireEvent.change(screen.getByTestId('prompt-name-input'), { target: { value: 'Team routine' } });
        fireEvent.change(screen.getByTestId('prompt-instructions-input'), { target: { value: 'shared work' } });
        fireEvent.click(screen.getByTestId('prompt-submit-btn'));

        await waitFor(() => expect(mockSchedulesClient.move).toHaveBeenCalledWith('ws-1', 'sched-new', 'repo'));
        await waitFor(() => expect(location.hash).toBe('#repos/ws-1/schedules/repo%3Asched-new'));

        // The parent navigates: re-render the SAME pane instance with the moved
        // schedule's detail route. Pane state (commit-reminder id) persists.
        mockSchedulesClient.list.mockResolvedValue([{ ...MY_PROMPT, id: 'repo:sched-new', source: 'repo' }]);
        rerender(
            <Wrap>
                <ScheduleMainPane workspaceId="ws-1" route={{ kind: 'detail', scheduleId: 'repo:sched-new' }} />
            </Wrap>,
        );

        await waitFor(() => expect(screen.getByTestId('schedule-main-pane-commit-reminder')).toBeTruthy());

        // Dismissable.
        fireEvent.click(screen.getByTestId('schedule-main-pane-commit-reminder-dismiss'));
        await waitFor(() => expect(screen.queryByTestId('schedule-main-pane-commit-reminder')).toBeNull());
    });

    it('creating into the My store shows no commit reminder', async () => {
        mockSchedulesClient.create.mockResolvedValue({ schedule: { id: 'sched-my' } });

        const { rerender } = render(
            <Wrap>
                <ScheduleMainPane workspaceId="ws-1" route={{ kind: 'new' }} />
            </Wrap>,
        );
        await waitFor(() => expect(screen.getByTestId('prompt-schedule-form')).toBeTruthy());

        fireEvent.change(screen.getByTestId('prompt-name-input'), { target: { value: 'My routine' } });
        fireEvent.change(screen.getByTestId('prompt-instructions-input'), { target: { value: 'private work' } });
        fireEvent.click(screen.getByTestId('prompt-submit-btn'));

        await waitFor(() => expect(mockSchedulesClient.create).toHaveBeenCalledTimes(1));
        expect(mockSchedulesClient.move).not.toHaveBeenCalled();
        await waitFor(() => expect(location.hash).toBe('#repos/ws-1/schedules/sched-my'));

        mockSchedulesClient.list.mockResolvedValue([{ ...MY_PROMPT, id: 'sched-my' }]);
        rerender(
            <Wrap>
                <ScheduleMainPane workspaceId="ws-1" route={{ kind: 'detail', scheduleId: 'sched-my' }} />
            </Wrap>,
        );

        await waitFor(() => expect(screen.getByTestId('schedule-main-pane')).toBeTruthy());
        expect(screen.queryByTestId('schedule-main-pane-commit-reminder')).toBeNull();
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

describe('isPromptEditableSchedule', () => {
    it('is true for a prompt schedule with no pipeline param', () => {
        expect(isPromptEditableSchedule(MY_PROMPT)).toBe(true);
    });
    it('is true when targetType is undefined (legacy prompt schedule)', () => {
        expect(isPromptEditableSchedule({ ...MY_PROMPT, targetType: undefined })).toBe(true);
    });
    it('is false for a script schedule', () => {
        expect(isPromptEditableSchedule(MY_SCRIPT)).toBe(false);
    });
    it('is false for a workflow schedule (pipeline param) even when targetType is prompt', () => {
        expect(isPromptEditableSchedule(MY_WORKFLOW)).toBe(false);
    });
});

describe('ScheduleMainPane — Edit disabled for non-prompt schedules', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        location.hash = '';
    });

    it('leaves Edit enabled (no hint) for a prompt schedule', async () => {
        await renderPane({ kind: 'detail', scheduleId: 'sched-my-prompt' });
        await waitFor(() => expect(screen.getByTestId('schedule-detail')).toBeTruthy());
        const editBtn = screen.getByTestId('edit-btn') as HTMLButtonElement;
        expect(editBtn.disabled).toBe(false);
        expect(editBtn.getAttribute('title')).toBeNull();
    });

    it('disables Edit with a hint for a script schedule', async () => {
        await renderPane({ kind: 'detail', scheduleId: 'sched-script' }, [MY_SCRIPT]);
        await waitFor(() => expect(screen.getByTestId('schedule-detail')).toBeTruthy());
        const editBtn = screen.getByTestId('edit-btn') as HTMLButtonElement;
        expect(editBtn.disabled).toBe(true);
        expect(editBtn.getAttribute('title')).toBe(NON_PROMPT_EDIT_HINT);
    });

    it('disables Edit with a hint for a workflow (pipeline param) schedule', async () => {
        await renderPane({ kind: 'detail', scheduleId: 'sched-workflow' }, [MY_WORKFLOW]);
        await waitFor(() => expect(screen.getByTestId('schedule-detail')).toBeTruthy());
        const editBtn = screen.getByTestId('edit-btn') as HTMLButtonElement;
        expect(editBtn.disabled).toBe(true);
        expect(editBtn.getAttribute('title')).toBe(NON_PROMPT_EDIT_HINT);
    });

    it('clicking the disabled Edit does not switch into an edit form', async () => {
        await renderPane({ kind: 'detail', scheduleId: 'sched-script' }, [MY_SCRIPT]);
        await waitFor(() => expect(screen.getByTestId('schedule-detail')).toBeTruthy());
        fireEvent.click(screen.getByTestId('edit-btn'));
        // Stays on the read view — neither the prompt nor the advanced form mounts.
        expect(screen.queryByTestId('prompt-schedule-form')).toBeNull();
        expect(screen.getByTestId('schedule-detail')).toBeTruthy();
    });
});

// Regression guard for the classic Repo ▸ Schedules tab path (flag OFF): it
// renders ScheduleDetail WITHOUT `disableNonPromptEdit`, so Edit must stay
// enabled for non-prompt schedules (advanced editing continues via that tab).
describe('ScheduleDetail — Edit enabled by default (classic Schedules tab)', () => {

    beforeEach(() => {
        vi.clearAllMocks();
        location.hash = '';
    });

    it('keeps Edit enabled for a script schedule when disableNonPromptEdit is unset', async () => {
        render(
            <Wrap>
                <ScheduleDetail
                    schedule={MY_SCRIPT}
                    workspaceId="ws-1"
                    history={[]}
                    editingId={null}
                    onRunNow={vi.fn()}
                    onPauseResume={vi.fn()}
                    onEdit={vi.fn()}
                    onDuplicate={vi.fn()}
                    onDelete={vi.fn()}
                    onCancelEdit={vi.fn()}
                    onSaved={vi.fn()}
                />
            </Wrap>,
        );
        await waitFor(() => expect(screen.getByTestId('schedule-detail')).toBeTruthy());
        const editBtn = screen.getByTestId('edit-btn') as HTMLButtonElement;
        expect(editBtn.disabled).toBe(false);
        expect(editBtn.getAttribute('title')).toBeNull();
    });
});

// AC-02 / AC-03 dirty guard: navigating away from a create/edit form with
// unsaved edits prompts "Discard changes?"; a clean form leaves silently.
describe('ScheduleMainPane — dirty guard on navigate-away', () => {
    const DISCARD = 'Discard changes? Your unsaved edits will be lost.';

    beforeEach(() => {
        vi.clearAllMocks();
        location.hash = '';
    });

    it('closing a clean create form does not prompt and returns to the slide', async () => {
        const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
        await renderPane({ kind: 'new' }, []);
        await waitFor(() => expect(screen.getByTestId('prompt-schedule-form')).toBeTruthy());

        fireEvent.click(screen.getByTestId('schedule-main-pane-close'));

        expect(confirmSpy).not.toHaveBeenCalled();
        expect(location.hash).toBe('#repos/ws-1/schedules');
        confirmSpy.mockRestore();
    });

    it('closing a dirty create form prompts; declining keeps the form and does not navigate', async () => {
        const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
        await renderPane({ kind: 'new' }, []);
        await waitFor(() => expect(screen.getByTestId('prompt-schedule-form')).toBeTruthy());

        fireEvent.change(screen.getByTestId('prompt-name-input'), { target: { value: 'wip' } });
        fireEvent.click(screen.getByTestId('schedule-main-pane-close'));

        expect(confirmSpy).toHaveBeenCalledWith(DISCARD);
        expect(location.hash).toBe('');
        expect(screen.getByTestId('prompt-schedule-form')).toBeTruthy();
        confirmSpy.mockRestore();
    });

    it('closing a dirty create form and confirming navigates back to the slide', async () => {
        const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
        await renderPane({ kind: 'new' }, []);
        await waitFor(() => expect(screen.getByTestId('prompt-schedule-form')).toBeTruthy());

        fireEvent.change(screen.getByTestId('prompt-name-input'), { target: { value: 'wip' } });
        fireEvent.click(screen.getByTestId('schedule-main-pane-close'));

        expect(confirmSpy).toHaveBeenCalledWith(DISCARD);
        expect(location.hash).toBe('#repos/ws-1/schedules');
        confirmSpy.mockRestore();
    });

    it('pressing Escape on a dirty create form prompts before leaving', async () => {
        const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
        await renderPane({ kind: 'new' }, []);
        await waitFor(() => expect(screen.getByTestId('prompt-schedule-form')).toBeTruthy());

        fireEvent.change(screen.getByTestId('prompt-name-input'), { target: { value: 'wip' } });
        fireEvent.keyDown(document.body, { key: 'Escape' });

        expect(confirmSpy).toHaveBeenCalledWith(DISCARD);
        expect(location.hash).toBe('#repos/ws-1/schedules');
        confirmSpy.mockRestore();
    });

    it('cancelling a dirty inline edit prompts; confirming returns to the read view', async () => {
        const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
        await renderPane({ kind: 'detail', scheduleId: 'sched-my-prompt' });
        await waitFor(() => expect(screen.getByTestId('schedule-detail')).toBeTruthy());

        fireEvent.click(screen.getByTestId('edit-btn'));
        await waitFor(() => expect(screen.getByTestId('prompt-schedule-form')).toBeTruthy());
        fireEvent.change(screen.getByTestId('prompt-name-input'), { target: { value: 'changed name' } });
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

        expect(confirmSpy).toHaveBeenCalledWith(DISCARD);
        await waitFor(() => expect(screen.queryByTestId('prompt-schedule-form')).toBeNull());
        expect(screen.getByTestId('schedule-detail')).toBeTruthy();
        confirmSpy.mockRestore();
    });

    it('declining the discard prompt keeps the dirty inline editor open', async () => {
        const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
        await renderPane({ kind: 'detail', scheduleId: 'sched-my-prompt' });
        await waitFor(() => expect(screen.getByTestId('schedule-detail')).toBeTruthy());

        fireEvent.click(screen.getByTestId('edit-btn'));
        await waitFor(() => expect(screen.getByTestId('prompt-schedule-form')).toBeTruthy());
        fireEvent.change(screen.getByTestId('prompt-name-input'), { target: { value: 'changed name' } });
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

        expect(confirmSpy).toHaveBeenCalledWith(DISCARD);
        expect(screen.getByTestId('prompt-schedule-form')).toBeTruthy();
        confirmSpy.mockRestore();
    });

    it('cancelling a clean inline edit returns to the read view without prompting', async () => {
        const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
        await renderPane({ kind: 'detail', scheduleId: 'sched-my-prompt' });
        await waitFor(() => expect(screen.getByTestId('schedule-detail')).toBeTruthy());

        fireEvent.click(screen.getByTestId('edit-btn'));
        await waitFor(() => expect(screen.getByTestId('prompt-schedule-form')).toBeTruthy());
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

        expect(confirmSpy).not.toHaveBeenCalled();
        await waitFor(() => expect(screen.queryByTestId('prompt-schedule-form')).toBeNull());
        expect(screen.getByTestId('schedule-detail')).toBeTruthy();
        confirmSpy.mockRestore();
    });
});

describe('ScheduleMainPane — live refresh on schedule-changed (AC-03)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        location.hash = '';
    });

    it('refreshes the open detail run history when a schedule-changed event fires', async () => {
        // Detail opens with no runs yet.
        await renderPane({ kind: 'detail', scheduleId: 'sched-my-prompt' });
        await waitFor(() => expect(screen.getByTestId('schedule-detail')).toBeTruthy());
        await waitFor(() => expect(screen.getByTestId('no-runs-empty')).toBeTruthy());

        // A run starts/finishes elsewhere → the WS broadcast should live-refresh
        // the history without any user action in this pane.
        mockSchedulesClient.history.mockResolvedValue([
            { id: 'run-1', status: 'success', startedAt: '2026-07-07T10:00:00.000Z' },
        ]);
        await act(async () => {
            window.dispatchEvent(new CustomEvent('schedule-changed', { detail: {} }));
        });

        await waitFor(() => expect(screen.getByTestId('run-row-run-1')).toBeTruthy());
    });

    it('does not clobber an open dirty editor when a schedule-changed event fires', async () => {
        await renderPane({ kind: 'detail', scheduleId: 'sched-my-prompt' });
        await waitFor(() => expect(screen.getByTestId('schedule-detail')).toBeTruthy());

        // Enter edit mode and dirty the name field.
        fireEvent.click(screen.getByTestId('edit-btn'));
        await waitFor(() => expect(screen.getByTestId('prompt-schedule-form')).toBeTruthy());
        fireEvent.change(screen.getByTestId('prompt-name-input'), { target: { value: 'wip edit' } });

        // A concurrent WS refresh re-lists the (unchanged) schedule; the in-progress
        // edit must survive.
        await act(async () => {
            window.dispatchEvent(new CustomEvent('schedule-changed', { detail: {} }));
        });

        expect(screen.getByTestId('prompt-schedule-form')).toBeTruthy();
        expect((screen.getByTestId('prompt-name-input') as HTMLInputElement).value).toBe('wip edit');
    });
});