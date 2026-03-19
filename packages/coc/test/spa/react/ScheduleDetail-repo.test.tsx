/**
 * Tests for ScheduleDetail read-only behavior for repo schedules.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { AppProvider } from '../../../src/server/spa/client/react/context/AppContext';
import { QueueProvider } from '../../../src/server/spa/client/react/context/QueueContext';
import { ToastProvider } from '../../../src/server/spa/client/react/context/ToastContext';
import { ScheduleDetail } from '../../../src/server/spa/client/react/repos/ScheduleDetail';
import type { Schedule } from '../../../src/server/spa/client/react/repos/scheduleTypes';

vi.mock('../../../src/server/spa/client/react/utils/format', () => ({
    formatRelativeTime: (d: string) => d,
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

    it('hides Edit button for repo schedule', () => {
        renderDetail(REPO_SCHEDULE);
        expect(screen.queryByTestId('edit-btn')).toBeNull();
    });

    it('hides Duplicate button for repo schedule', () => {
        renderDetail(REPO_SCHEDULE);
        expect(screen.queryByTestId('duplicate-btn')).toBeNull();
    });

    it('hides Delete button for repo schedule', () => {
        renderDetail(REPO_SCHEDULE);
        expect(screen.queryByLabelText('Delete schedule')).toBeNull();
    });

    it('shows Run Now and Pause buttons for repo schedule', () => {
        renderDetail(REPO_SCHEDULE);
        expect(screen.getByLabelText('Run schedule now')).toBeTruthy();
        expect(screen.getByLabelText('Pause schedule')).toBeTruthy();
    });

    it('shows "defined in repo" badge for repo schedule', () => {
        renderDetail(REPO_SCHEDULE);
        expect(screen.getByTestId('repo-source-badge')).toBeTruthy();
        expect(screen.getByTestId('repo-source-badge').textContent).toContain('.github/schedule/');
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
});
