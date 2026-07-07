/**
 * @vitest-environment jsdom
 *
 * AC-04 routing — schedules-in-Scheduled-slide flag changes how
 * `#repos/{id}/schedules/...` deep-links route.
 *
 * Flag OFF (default): schedule routes select the standalone `schedules`
 * sub-tab, exactly as today. Flag ON: schedule routes keep the chat surface
 * mounted (SET_REPO_SUB_TAB → chats/activity) so RepoChatTab can host the
 * schedule detail/editor in its main pane; the selected schedule id is still
 * dispatched. The `/schedules/new` create route carries no selected id.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { Router } from '../../../../src/server/spa/client/react/layout/Router';
import type { DashboardTab } from '../../../../src/server/spa/client/react/types/dashboard';

const { flag } = vi.hoisted(() => ({ flag: { enabled: false } }));

vi.mock('../../../../src/server/spa/client/react/utils/config', async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    return { ...actual, isSchedulesInScheduledSlideEnabled: () => flag.enabled };
});

const mockDispatch = vi.fn();
const mockQueueDispatch = vi.fn();
let mockActiveTab: DashboardTab = 'repos';
let mockSelectedRepoId: string | null = null;
let mockQueueState: any = {};

vi.mock('../../../../src/server/spa/client/react/contexts/AppContext', () => ({
    useApp: () => ({
        state: {
            activeTab: mockActiveTab,
            selectedRepoId: mockSelectedRepoId,
            reposSidebarCollapsed: false,
            wsStatus: 'open',
        },
        dispatch: mockDispatch,
    }),
}));

vi.mock('../../../../src/server/spa/client/react/contexts/QueueContext', () => ({
    useQueue: () => ({ state: mockQueueState, dispatch: mockQueueDispatch }),
}));

vi.mock('../../../../src/server/spa/client/react/contexts/ReposContext', () => ({
    useRepos: () => ({ repos: [], unseenCounts: {}, fetchRepos: vi.fn(), loading: false }),
    ReposProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('../../../../src/server/spa/client/react/repos/MiniReposSidebar', () => ({
    MiniReposSidebar: () => <div data-testid="mini-repos-sidebar" />,
}));

vi.mock('../../../../src/server/spa/client/react/processes/ProcessesView', () => ({
    ProcessesView: () => <div id="view-processes" />,
}));

vi.mock('../../../../src/server/spa/client/react/repos', () => ({
    ReposView: () => <div id="view-repos" />,
}));

vi.mock('../../../../src/server/spa/client/react/wiki/WikiView', () => ({
    WikiView: () => <div id="view-wiki" />,
}));

vi.mock('../../../../src/server/spa/client/react/features/memory/MemoryView', () => ({
    MemoryView: () => <div id="view-memory" />,
}));

vi.mock('../../../../src/server/spa/client/react/features/skills/SkillsView', () => ({
    SkillsView: () => <div id="view-skills" />,
}));

vi.mock('../../../../src/server/spa/client/react/admin/AdminPanel', () => ({
    AdminPanel: () => <div id="view-admin" />,
}));

vi.mock('../../../../src/server/spa/client/react/features/logs/LogsView', () => ({
    LogsView: () => <div id="view-logs" />,
}));

beforeEach(() => {
    mockActiveTab = 'repos';
    mockSelectedRepoId = null;
    mockQueueState = {
        repoQueueMap: {},
        repoHistoryMap: {},
        selectedTaskId: null,
        selectedTaskIdByRepo: {},
        queued: [],
        running: [],
        history: [],
    };
    mockDispatch.mockReset();
    mockQueueDispatch.mockReset();
    flag.enabled = false;
    window.location.hash = '';
});

afterEach(() => {
    cleanup();
    window.location.hash = '';
});

function dispatched() {
    return mockDispatch.mock.calls.map(([action]) => action);
}

describe('Router — schedules deep-links, flag OFF (default)', () => {
    it('selects the standalone schedules sub-tab and the schedule id', () => {
        window.location.hash = '#repos/feature-repo/schedules/sched-1';
        render(<Router />);
        const actions = dispatched();
        expect(actions).toContainEqual({ type: 'SET_REPO_SUB_TAB', tab: 'schedules' });
        expect(actions).toContainEqual({ type: 'SET_SELECTED_SCHEDULE', id: 'sched-1' });
    });
});

describe('Router — schedules deep-links, flag ON', () => {
    beforeEach(() => { flag.enabled = true; });

    it('keeps the chat surface mounted (no schedules sub-tab) and still selects the schedule', () => {
        window.location.hash = '#repos/feature-repo/schedules/sched-1';
        render(<Router />);
        const actions = dispatched();
        expect(actions).not.toContainEqual({ type: 'SET_REPO_SUB_TAB', tab: 'schedules' });
        expect(actions).toContainEqual({ type: 'SET_SELECTED_SCHEDULE', id: 'sched-1' });
        // A chat sub-tab (activity in classic, chats in dev-workflow) is selected instead.
        const subTabs = actions.filter(a => a.type === 'SET_REPO_SUB_TAB').map(a => a.tab);
        expect(subTabs.some(t => t === 'activity' || t === 'chats')).toBe(true);
    });

    it('routes the /schedules/new create route with no selected id', () => {
        window.location.hash = '#repos/feature-repo/schedules/new';
        render(<Router />);
        const actions = dispatched();
        expect(actions).not.toContainEqual({ type: 'SET_REPO_SUB_TAB', tab: 'schedules' });
        expect(actions).toContainEqual({ type: 'SET_SELECTED_SCHEDULE', id: null });
        expect(actions).not.toContainEqual({ type: 'SET_SELECTED_SCHEDULE', id: 'new' });
    });
});
