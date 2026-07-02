/**
 * Tests for Router — persistent MiniReposSidebar removed.
 *
 * Verifies that:
 * - mini-sidebar-layout and persistent-mini-sidebar are never rendered on any tab
 * - Each tab still renders its view content directly
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { Router } from '../../../../src/server/spa/client/react/layout/Router';
import { MarkdownView } from '../../../../src/server/spa/client/react/shared/MarkdownView';
import type { DashboardTab } from '../../../../src/server/spa/client/react/types/dashboard';

// ── Minimal mocks ──────────────────────────────────────────────────────────

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

// ── Tests ──────────────────────────────────────────────────────────────────

const NON_REPOS_TABS: DashboardTab[] = ['wiki', 'memory', 'skills', 'admin', 'logs'];

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
    window.location.hash = '';
});

afterEach(() => {
    cleanup();
    window.location.hash = '';
});

describe('Router — no persistent mini sidebar on any tab', () => {
    it('does NOT render mini-sidebar-layout on repos tab', () => {
        mockActiveTab = 'repos';
        const { container } = render(<Router />);
        expect(container.querySelector('[data-testid="mini-sidebar-layout"]')).toBeNull();
        expect(container.querySelector('[data-testid="persistent-mini-sidebar"]')).toBeNull();
    });

    it.each(NON_REPOS_TABS)('does NOT render mini-sidebar-layout on %s tab', (tab) => {
        mockActiveTab = tab;
        const { container } = render(<Router />);
        expect(container.querySelector('[data-testid="mini-sidebar-layout"]')).toBeNull();
        expect(container.querySelector('[data-testid="persistent-mini-sidebar"]')).toBeNull();
        expect(container.querySelector('[data-testid="mini-repos-sidebar"]')).toBeNull();
    });

    it('renders ReposView directly on repos tab', () => {
        mockActiveTab = 'repos';
        const { container } = render(<Router />);
        expect(container.querySelector('#view-repos')).not.toBeNull();
    });
});

describe('Router activity deep-link handling', () => {
    /**
     * Virtual workspaces ('my_work', 'my_life') have always preserved the
     * `activity` sub-tab. Regression coverage that this is unchanged.
     */
    it.each(['my_work', 'my_life'])('preserves the activity tab for virtual workspace %s', (workspaceId) => {
        window.location.hash = `#repos/${workspaceId}/activity`;

        render(<Router />);

        const dispatchedActions = mockDispatch.mock.calls.map(([action]) => action);
        expect(dispatchedActions).toContainEqual({ type: 'SET_SELECTED_REPO', id: workspaceId });
        expect(dispatchedActions).toContainEqual({ type: 'SET_REPO_SUB_TAB', tab: 'activity' });
        expect(dispatchedActions).not.toContainEqual({ type: 'SET_REPO_SUB_TAB', tab: 'chats' });
    });

    /**
     * Regression for the mobile blank-screen bug:
     *
     * Previously the Router unconditionally redirected `/activity` →
     * `/chats` for non-virtual repos. In classic UI mode, `RepoDetail` then
     * gated the chat surface on `activeSubTab === 'activity'` only, so the
     * redirected `'chats'` value collapsed the wrapper to `display:none` and
     * the mobile activity page rendered blank when a user tapped a finished
     * chat.
     *
     * The fix removes the redirect: `/activity` deep-links keep dispatching
     * `SET_REPO_SUB_TAB tab: 'activity'` for every repo (virtual or not),
     * and `RepoDetail` accepts both `'activity'` and `'chats'` keys
     * interchangeably so cross-mode URLs render in either layout mode.
     */
    it('preserves activity sub-tab for normal repos (no redirect to chats)', () => {
        window.location.hash = '#repos/feature-repo/activity';

        render(<Router />);

        const dispatchedActions = mockDispatch.mock.calls.map(([action]) => action);
        expect(dispatchedActions).toContainEqual({ type: 'SET_SELECTED_REPO', id: 'feature-repo' });
        expect(dispatchedActions).toContainEqual({ type: 'SET_REPO_SUB_TAB', tab: 'activity' });
        expect(dispatchedActions).not.toContainEqual({ type: 'SET_REPO_SUB_TAB', tab: 'chats' });
    });

    /**
     * Both `/activity/<id>` and `/chats/<id>` are valid deep-link aliases
     * for the chat surface. Each should preserve its sub-tab key as-is and
     * select the queue task — no implicit redirects either way.
     */
    it('preserves chats sub-tab for normal repos when /chats deep-link is used', () => {
        window.location.hash = '#repos/feature-repo/chats';

        render(<Router />);

        const dispatchedActions = mockDispatch.mock.calls.map(([action]) => action);
        expect(dispatchedActions).toContainEqual({ type: 'SET_SELECTED_REPO', id: 'feature-repo' });
        expect(dispatchedActions).toContainEqual({ type: 'SET_REPO_SUB_TAB', tab: 'chats' });
        expect(dispatchedActions).not.toContainEqual({ type: 'SET_REPO_SUB_TAB', tab: 'activity' });
    });

    it('selects queue task when /activity/<taskId> deep-link is used', () => {
        window.location.hash = '#repos/feature-repo/activity/task-42';

        render(<Router />);

        const queueActions = mockQueueDispatch.mock.calls.map(([action]) => action);
        expect(queueActions).toContainEqual({ type: 'SELECT_QUEUE_TASK', id: 'task-42', repoId: 'feature-repo' });
    });

    it('selects queue task when /chats/<taskId> deep-link is used', () => {
        window.location.hash = '#repos/feature-repo/chats/task-77';

        render(<Router />);

        const queueActions = mockQueueDispatch.mock.calls.map(([action]) => action);
        expect(queueActions).toContainEqual({ type: 'SELECT_QUEUE_TASK', id: 'task-77', repoId: 'feature-repo' });
    });

    it.each([
        ['#/process/queue_42', 'Process chat'],
        ['#/session/queue_42', 'Session chat'],
        ['#/processes/queue_42', 'Processes chat'],
    ])('routes a MarkdownView %s click into the current repo queue selection', async (href, label) => {
        mockSelectedRepoId = 'feature-repo';

        const { getByText } = render(
            <>
                <Router />
                <MarkdownView html={`<p><a href="${href}">${label}</a></p>`} />
            </>,
        );

        fireEvent.click(getByText(label));

        await waitFor(() => {
            expect(mockQueueDispatch).toHaveBeenCalledWith({
                type: 'SELECT_QUEUE_TASK',
                id: 'queue_42',
                repoId: 'feature-repo',
            });
        });
        expect(mockDispatch).toHaveBeenCalledWith({ type: 'SET_ACTIVE_TAB', tab: 'repos' });
        expect(mockDispatch).toHaveBeenCalledWith({ type: 'SET_SELECTED_REPO', id: 'feature-repo' });
        expect(mockDispatch).toHaveBeenCalledWith({ type: 'SET_REPO_SUB_TAB', tab: 'activity' });
        expect(window.location.hash).toBe('#repos/feature-repo/activity/queue_42');
    });

    it('uses cached queue ownership instead of the current repo for shorthand process hashes', () => {
        mockSelectedRepoId = 'current-repo';
        mockQueueState = {
            ...mockQueueState,
            repoHistoryMap: {
                'target-repo': {
                    items: [{ id: 'queue_99' }],
                    hasMore: false,
                    updatedAt: 1,
                },
            },
        };
        window.location.hash = '#/process/queue_99';

        render(<Router />);

        const dispatchedActions = mockDispatch.mock.calls.map(([action]) => action);
        const queueActions = mockQueueDispatch.mock.calls.map(([action]) => action);
        expect(dispatchedActions).toContainEqual({ type: 'SET_SELECTED_REPO', id: 'target-repo' });
        expect(dispatchedActions).toContainEqual({ type: 'SET_REPO_SUB_TAB', tab: 'activity' });
        expect(queueActions).toContainEqual({ type: 'SELECT_QUEUE_TASK', id: 'queue_99', repoId: 'target-repo' });
        expect(window.location.hash).toBe('#repos/target-repo/activity/queue_99');
    });
});
