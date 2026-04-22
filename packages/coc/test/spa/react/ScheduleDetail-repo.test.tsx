/**
 * Tests for ScheduleDetail behavior for repo schedules.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { AppProvider } from '../../../src/server/spa/client/react/contexts/AppContext';
import { QueueProvider } from '../../../src/server/spa/client/react/contexts/QueueContext';
import { ToastProvider } from '../../../src/server/spa/client/react/contexts/ToastContext';
import { ScheduleDetail } from '../../../src/server/spa/client/react/features/schedules/ScheduleDetail';
import type { Schedule } from '../../../src/server/spa/client/react/features/schedules/scheduleTypes';

vi.mock('../../../src/server/spa/client/react/utils/format', () => ({
    formatRelativeTime: (d: string) => d,
}));

vi.mock('../../../src/server/spa/client/react/features/schedules/CreateScheduleForm', () => ({
    CreateScheduleForm: ({ onCreated, onCancel }: { onCreated: () => void; onCancel: () => void }) => (
        <div data-testid="mock-form">
            <button data-testid="mock-save" onClick={() => onCreated()}>Save</button>
            <button data-testid="mock-cancel" onClick={() => onCancel()}>Cancel</button>
        </div>
    ),
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

const BASE_SCHEDULE: Schedule = {
    id: 'sched-1',
    name: 'Test Schedule',
    target: 'pipelines/test/pipeline.yaml',
    targetType: 'prompt',
    cron: '0 9 * * *',
    cronDescription: 'Every day at 09:00',
    params: {},
    onFailure: 'notify',
    status: 'active',
    isRunning: false,
    nextRun: null,
    createdAt: new Date().toISOString(),
};

const REPO_SCHEDULE: Schedule = {
    ...BASE_SCHEDULE,
    id: 'repo:daily',
    name: 'Daily Cleanup',
    source: 'repo',
};

function renderDetail(schedule: Schedule) {
    return render(
        <Wrap>
            <ScheduleDetail
                schedule={schedule}
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
        </Wrap>
    );
}

describe('ScheduleDetail — repo schedule read-only', () => {
    beforeEach(() => vi.clearAllMocks());

    it('shows Edit button for repo schedule', () => {
        renderDetail(REPO_SCHEDULE);
        expect(screen.getByTestId('edit-btn')).toBeTruthy();
    });

    it('shows Duplicate button for repo schedule', () => {
        renderDetail(REPO_SCHEDULE);
        expect(screen.getByTestId('duplicate-btn')).toBeTruthy();
    });

    it('shows Delete button for repo schedule', () => {
        renderDetail(REPO_SCHEDULE);
        expect(screen.getByLabelText('Delete schedule')).toBeTruthy();
    });

    it('shows Run Now and Pause buttons for repo schedule', () => {
        renderDetail(REPO_SCHEDULE);
        expect(screen.getByLabelText('Run schedule now')).toBeTruthy();
        expect(screen.getByLabelText('Pause schedule')).toBeTruthy();
    });

    it('shows "defined in repo" badge for repo schedule', () => {
        renderDetail(REPO_SCHEDULE);
        expect(screen.getByTestId('repo-source-badge')).toBeTruthy();
        expect(screen.getByTestId('repo-source-badge').textContent).toContain('.github/schedules/');
    });

    it('does NOT show "defined in repo" badge for user schedule', () => {
        renderDetail(BASE_SCHEDULE);
        expect(screen.queryByTestId('repo-source-badge')).toBeNull();
    });

    it('shows Edit/Duplicate/Delete for user schedule', () => {
        renderDetail(BASE_SCHEDULE);
        expect(screen.getByTestId('edit-btn')).toBeTruthy();
        expect(screen.getByTestId('duplicate-btn')).toBeTruthy();
        expect(screen.getByLabelText('Delete schedule')).toBeTruthy();
    });

    it('schedule name is shown correctly for repo schedule', () => {
        renderDetail(REPO_SCHEDULE);
        expect(screen.getByTestId('schedule-name').textContent).toContain('Daily Cleanup');
    });

    it('does not show commit reminder initially', () => {
        renderDetail(REPO_SCHEDULE);
        expect(screen.queryByTestId('commit-reminder')).toBeNull();
    });

    it('shows commit reminder after saving a repo schedule edit', () => {
        const onSaved = vi.fn();
        const { rerender } = render(
            <Wrap>
                <ScheduleDetail
                    schedule={REPO_SCHEDULE}
                    workspaceId="ws-1"
                    history={[]}
                    editingId={REPO_SCHEDULE.id}
                    onRunNow={vi.fn()}
                    onPauseResume={vi.fn()}
                    onEdit={vi.fn()}
                    onDuplicate={vi.fn()}
                    onDelete={vi.fn()}
                    onCancelEdit={vi.fn()}
                    onSaved={onSaved}
                />
            </Wrap>
        );

        // Form is shown; click mock save button
        act(() => {
            fireEvent.click(screen.getByTestId('mock-save'));
        });
        expect(onSaved).toHaveBeenCalled();

        // Re-render with editingId=null (parent would do this after onSaved)
        rerender(
            <Wrap>
                <ScheduleDetail
                    schedule={REPO_SCHEDULE}
                    workspaceId="ws-1"
                    history={[]}
                    editingId={null}
                    onRunNow={vi.fn()}
                    onPauseResume={vi.fn()}
                    onEdit={vi.fn()}
                    onDuplicate={vi.fn()}
                    onDelete={vi.fn()}
                    onCancelEdit={vi.fn()}
                    onSaved={onSaved}
                />
            </Wrap>
        );

        // Commit reminder should be visible
        expect(screen.getByTestId('commit-reminder')).toBeTruthy();
        expect(screen.getByTestId('commit-reminder').textContent).toContain('.github/schedules/');
    });

    it('commit reminder can be dismissed', () => {
        const onSaved = vi.fn();
        const { rerender } = render(
            <Wrap>
                <ScheduleDetail
                    schedule={REPO_SCHEDULE}
                    workspaceId="ws-1"
                    history={[]}
                    editingId={REPO_SCHEDULE.id}
                    onRunNow={vi.fn()}
                    onPauseResume={vi.fn()}
                    onEdit={vi.fn()}
                    onDuplicate={vi.fn()}
                    onDelete={vi.fn()}
                    onCancelEdit={vi.fn()}
                    onSaved={onSaved}
                />
            </Wrap>
        );

        act(() => { fireEvent.click(screen.getByTestId('mock-save')); });

        rerender(
            <Wrap>
                <ScheduleDetail
                    schedule={REPO_SCHEDULE}
                    workspaceId="ws-1"
                    history={[]}
                    editingId={null}
                    onRunNow={vi.fn()}
                    onPauseResume={vi.fn()}
                    onEdit={vi.fn()}
                    onDuplicate={vi.fn()}
                    onDelete={vi.fn()}
                    onCancelEdit={vi.fn()}
                    onSaved={onSaved}
                />
            </Wrap>
        );

        expect(screen.getByTestId('commit-reminder')).toBeTruthy();

        // Dismiss
        act(() => {
            fireEvent.click(screen.getByLabelText('Dismiss reminder'));
        });
        expect(screen.queryByTestId('commit-reminder')).toBeNull();
    });

    it('does NOT show commit reminder after saving a user schedule', () => {
        const onSaved = vi.fn();
        const { rerender } = render(
            <Wrap>
                <ScheduleDetail
                    schedule={BASE_SCHEDULE}
                    workspaceId="ws-1"
                    history={[]}
                    editingId={BASE_SCHEDULE.id}
                    onRunNow={vi.fn()}
                    onPauseResume={vi.fn()}
                    onEdit={vi.fn()}
                    onDuplicate={vi.fn()}
                    onDelete={vi.fn()}
                    onCancelEdit={vi.fn()}
                    onSaved={onSaved}
                />
            </Wrap>
        );

        act(() => { fireEvent.click(screen.getByTestId('mock-save')); });

        rerender(
            <Wrap>
                <ScheduleDetail
                    schedule={BASE_SCHEDULE}
                    workspaceId="ws-1"
                    history={[]}
                    editingId={null}
                    onRunNow={vi.fn()}
                    onPauseResume={vi.fn()}
                    onEdit={vi.fn()}
                    onDuplicate={vi.fn()}
                    onDelete={vi.fn()}
                    onCancelEdit={vi.fn()}
                    onSaved={onSaved}
                />
            </Wrap>
        );

        expect(screen.queryByTestId('commit-reminder')).toBeNull();
    });
});
