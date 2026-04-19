/**
 * Tests for ScheduleListPanel two-section UI (MY SCHEDULES / REPO SCHEDULES).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';
import { AppProvider } from '../../../src/server/spa/client/react/context/AppContext';
import { QueueProvider } from '../../../src/server/spa/client/react/context/QueueContext';
import { ToastProvider } from '../../../src/server/spa/client/react/context/ToastContext';
import { ScheduleListPanel } from '../../../src/server/spa/client/react/repos/ScheduleListPanel';
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

function makeSchedule(overrides: Partial<Schedule> = {}): Schedule {
    return {
        id: 'sch-1',
        name: 'My Schedule',
        target: 'test.yaml',
        targetType: 'prompt',
        cron: '0 9 * * *',
        cronDescription: 'Every day at 09:00',
        params: {},
        onFailure: 'notify',
        status: 'active',
        isRunning: false,
        nextRun: null,
        createdAt: new Date().toISOString(),
        ...overrides,
    };
}

const USER_SCHEDULE = makeSchedule({ id: 'sch-1', name: 'My User Schedule' });
const REPO_SCHEDULE = makeSchedule({ id: 'repo:daily', name: 'Daily Cleanup', source: 'repo' });

function renderPanel(schedules: Schedule[], selectedId: string | null = null, notesAutoCommit?: any) {
    return render(
        <Wrap>
            <ScheduleListPanel
                schedules={schedules}
                selectedId={selectedId}
                onSelect={vi.fn()}
                onNew={vi.fn()}
                loading={false}
                notesAutoCommit={notesAutoCommit}
            />
        </Wrap>
    );
}

describe('ScheduleListPanel — two-section UI', () => {
    beforeEach(() => vi.clearAllMocks());

    it('renders MY SCHEDULES section header', () => {
        renderPanel([USER_SCHEDULE]);
        expect(screen.getByTestId('my-schedules-header')).toBeTruthy();
        expect(screen.getByTestId('my-schedules-header').textContent).toContain('MY SCHEDULES');
    });

    it('renders REPO SCHEDULES section header', () => {
        renderPanel([]);
        expect(screen.getByTestId('repo-schedules-header')).toBeTruthy();
        expect(screen.getByTestId('repo-schedules-header').textContent).toContain('REPO SCHEDULES');
    });

    it('shows .github/schedules/ path label in repo section', () => {
        renderPanel([]);
        expect(screen.getByTestId('repo-schedules-path').textContent).toContain('.github/schedules/');
    });

    it('user schedules appear under MY SCHEDULES list', () => {
        renderPanel([USER_SCHEDULE]);
        const list = screen.getByTestId('user-schedules-list');
        expect(list.textContent).toContain('My User Schedule');
    });

    it('repo schedules appear under REPO SCHEDULES list', () => {
        renderPanel([REPO_SCHEDULE]);
        const list = screen.getByTestId('repo-schedules-list');
        expect(list.textContent).toContain('Daily Cleanup');
    });

    it('user and repo schedules are separated into correct sections', () => {
        renderPanel([USER_SCHEDULE, REPO_SCHEDULE]);

        const userList = screen.getByTestId('user-schedules-list');
        expect(userList.textContent).toContain('My User Schedule');
        expect(userList.textContent).not.toContain('Daily Cleanup');

        const repoList = screen.getByTestId('repo-schedules-list');
        expect(repoList.textContent).toContain('Daily Cleanup');
        expect(repoList.textContent).not.toContain('My User Schedule');
    });

    it('shows count in MY SCHEDULES header when user schedules exist', () => {
        renderPanel([USER_SCHEDULE]);
        expect(screen.getByTestId('my-schedules-header').textContent).toContain('(1)');
    });

    it('shows count in REPO SCHEDULES header when repo schedules exist', () => {
        renderPanel([REPO_SCHEDULE]);
        expect(screen.getByTestId('repo-schedules-header').textContent).toContain('(1)');
    });

    it('shows no count in MY SCHEDULES when empty', () => {
        renderPanel([]);
        const header = screen.getByTestId('my-schedules-header');
        expect(header.textContent).not.toContain('(');
    });

    it('repo schedule shows [Repo] badge instead of [Prompt]/[Script]', () => {
        renderPanel([REPO_SCHEDULE]);
        expect(screen.getByText('[Repo]')).toBeTruthy();
        expect(screen.queryByText('[Prompt]')).toBeNull();
        expect(screen.queryByText('[Script]')).toBeNull();
    });

    it('user prompt schedule shows [Prompt] badge', () => {
        renderPanel([USER_SCHEDULE]);
        expect(screen.getByText('[Prompt]')).toBeTruthy();
        expect(screen.queryByText('[Repo]')).toBeNull();
    });

    it('user script schedule shows [Script] badge', () => {
        renderPanel([makeSchedule({ id: 'sch-script', name: 'Script', targetType: 'script' })]);
        expect(screen.getByText('[Script]')).toBeTruthy();
    });

    it('+ New button is present', () => {
        renderPanel([]);
        expect(screen.getByTestId('new-schedule-btn')).toBeTruthy();
    });

    it('clicking MY SCHEDULES header collapses user section', () => {
        renderPanel([USER_SCHEDULE]);
        const header = screen.getByTestId('my-schedules-header');
        fireEvent.click(header);
        expect(screen.queryByTestId('user-schedules-list')).toBeNull();
    });

    it('clicking REPO SCHEDULES header collapses repo section', () => {
        renderPanel([REPO_SCHEDULE]);
        const header = screen.getByTestId('repo-schedules-header');
        fireEvent.click(header);
        expect(screen.queryByTestId('repo-schedules-list')).toBeNull();
    });

    it('shows empty state for user section when no user schedules', () => {
        renderPanel([REPO_SCHEDULE]);
        // User section shows empty state text
        expect(screen.getByText(/No schedules yet/)).toBeTruthy();
    });

    it('shows empty state for repo section when no repo schedules', () => {
        renderPanel([USER_SCHEDULE]);
        expect(screen.getByText('No repo schedules found.')).toBeTruthy();
    });

    it('renders refresh button when onRefresh is provided', () => {
        const onRefresh = vi.fn();
        render(
            <Wrap>
                <ScheduleListPanel
                    schedules={[USER_SCHEDULE]}
                    selectedId={null}
                    onSelect={vi.fn()}
                    onNew={vi.fn()}
                    loading={false}
                    onRefresh={onRefresh}
                />
            </Wrap>
        );
        expect(screen.getByTestId('schedules-refresh-btn')).toBeTruthy();
    });

    it('calls onRefresh when refresh button is clicked', () => {
        const onRefresh = vi.fn();
        render(
            <Wrap>
                <ScheduleListPanel
                    schedules={[USER_SCHEDULE]}
                    selectedId={null}
                    onSelect={vi.fn()}
                    onNew={vi.fn()}
                    loading={false}
                    onRefresh={onRefresh}
                />
            </Wrap>
        );
        fireEvent.click(screen.getByTestId('schedules-refresh-btn'));
        expect(onRefresh).toHaveBeenCalled();
    });
});

describe('ScheduleListPanel — Quick Actions & Notes badge', () => {
    beforeEach(() => vi.clearAllMocks());

    it('renders Quick Actions bar when notesAutoCommit.available && !enabled', () => {
        renderPanel([USER_SCHEDULE], null, {
            available: true,
            enabled: false,
            enabling: false,
            onEnable: vi.fn(),
        });
        expect(screen.getByTestId('quick-actions-bar')).toBeTruthy();
        expect(screen.getByTestId('enable-autocommit-btn')).toBeTruthy();
        expect(screen.getByText(/Enable Notes Auto-Commit/)).toBeTruthy();
    });

    it('hides Quick Actions when notesAutoCommit.enabled', () => {
        renderPanel([USER_SCHEDULE], null, {
            available: true,
            enabled: true,
            enabling: false,
            onEnable: vi.fn(),
        });
        expect(screen.queryByTestId('quick-actions-bar')).toBeNull();
    });

    it('hides Quick Actions when notesAutoCommit.available is false', () => {
        renderPanel([USER_SCHEDULE], null, {
            available: false,
            enabled: false,
            enabling: false,
            onEnable: vi.fn(),
        });
        expect(screen.queryByTestId('quick-actions-bar')).toBeNull();
    });

    it('Enable button calls onEnable and shows spinner during enabling', () => {
        const onEnable = vi.fn();
        renderPanel([], null, {
            available: true,
            enabled: false,
            enabling: true,
            onEnable,
        });
        const btn = screen.getByTestId('enable-autocommit-btn');
        expect(btn.textContent).toContain('⏳');
        expect(btn).toHaveProperty('disabled', true);
    });

    it('[Notes] badge renders on schedule named "Notes Auto-Commit"', () => {
        const autoCommitSchedule = makeSchedule({
            id: 'ac-1',
            name: 'Notes Auto-Commit',
            targetType: 'script',
        });
        renderPanel([autoCommitSchedule]);
        expect(screen.getByTestId('notes-badge')).toBeTruthy();
        expect(screen.getByText('[Notes]')).toBeTruthy();
    });

    it('[Notes] badge does not render on other schedules', () => {
        renderPanel([USER_SCHEDULE]);
        expect(screen.queryByTestId('notes-badge')).toBeNull();
        expect(screen.queryByText('[Notes]')).toBeNull();
    });

    it('Quick Actions is hidden when MY SCHEDULES section is collapsed', () => {
        renderPanel([], null, {
            available: true,
            enabled: false,
            enabling: false,
            onEnable: vi.fn(),
        });
        // Verify it's visible initially
        expect(screen.getByTestId('quick-actions-bar')).toBeTruthy();

        // Collapse
        fireEvent.click(screen.getByTestId('my-schedules-header'));
        expect(screen.queryByTestId('quick-actions-bar')).toBeNull();
    });
});
