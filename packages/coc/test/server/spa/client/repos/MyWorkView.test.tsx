/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockDispatch = vi.fn();
let mockActiveRepoSubTab = 'notes';
let mockSelectedNotePath: string | null = null;
let mockSchedulesInScheduledSlideEnabled = false;

vi.mock('../../../../../src/server/spa/client/react/contexts/AppContext', () => ({
    useApp: () => ({
        state: {
            activeRepoSubTab: mockActiveRepoSubTab,
            selectedNotePath: mockSelectedNotePath,
        },
        dispatch: mockDispatch,
    }),
}));

const repositoryServiceMocks = vi.hoisted(() => ({
    syncMyWork: vi.fn(),
    generateMyWorkSummary: vi.fn(),
}));

vi.mock('../../../../../src/server/spa/client/react/repos/repositoryService', () => ({
    ...repositoryServiceMocks,
}));

vi.mock('../../../../../src/server/spa/client/react/ui', () => ({
    cn: (...args: any[]) => args.filter(Boolean).join(' '),
}));

// Stub NotesView — render a marker div that captures props
vi.mock('../../../../../src/server/spa/client/react/features/notes/NotesView', () => ({
    NotesView: (props: any) => (
        <div
            data-testid="notes-view"
            data-workspace-id={props.workspaceId}
            data-default-scope={props.defaultScope ?? ''}
            data-chat-panel-open={String(!!props.chatPanelOpen)}
            data-has-toggle={String(typeof props.onToggleChatPanel === 'function')}
        />
    ),
}));

// Stub RepoChatTab — just render a marker div
vi.mock('../../../../../src/server/spa/client/react/features/chat/RepoChatTab', () => ({
    RepoChatTab: (props: any) => (
        <div data-testid="repo-activity-tab" data-workspace-id={props.workspaceId} />
    ),
}));

// Stub NotesGitTab — just render a marker div
vi.mock('../../../../../src/server/spa/client/react/features/notes/NotesGitTab', () => ({
    NotesGitTab: (props: any) => (
        <div data-testid="notes-git-tab" data-workspace-id={props.workspaceId} />
    ),
}));

// Stub RepoSchedulesTab — just render a marker div
vi.mock('../../../../../src/server/spa/client/react/features/schedules/RepoSchedulesTab', () => ({
    RepoSchedulesTab: (props: any) => (
        <div data-testid="repo-schedules-tab" data-workspace-id={props.workspaceId} />
    ),
}));

// Stub RepoSettingsTab— just render a marker div
vi.mock('../../../../../src/server/spa/client/react/features/repo-settings/RepoSettingsTab', () => ({
    RepoSettingsTab: (props: any) => (
        <div data-testid="repo-settings-tab" data-workspace-id={props.workspaceId} data-repo-id={props.repo?.workspace?.id} />
    ),
}));

// Stub repoGrouping — provide the RepoData type import
vi.mock('../../../../../src/server/spa/client/react/repos/repoGrouping', () => ({}));

// Stub the docked status footer — assert placement, not its internals.
vi.mock('../../../../../src/server/spa/client/react/layout/DockedStatusFooter', () => ({
    DockedStatusFooter: () => <div data-testid="docked-status-footer" />,
}));

// Feature flag: schedules-in-scheduled-slide (default off)
vi.mock('../../../../../src/server/spa/client/react/hooks/feature-flags/useSchedulesInScheduledSlideEnabled', () => ({
    useSchedulesInScheduledSlideEnabled: () => mockSchedulesInScheduledSlideEnabled,
}));

import { MyWorkView, MY_WORK_WORKSPACE_ID } from '../../../../../src/server/spa/client/react/repos/MyWorkView';

// ── Helpers ────────────────────────────────────────────────────────────────

function renderView() {
    return render(<MyWorkView />);
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('MyWorkView', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockActiveRepoSubTab = 'notes';
        mockSelectedNotePath = null;
        mockSchedulesInScheduledSlideEnabled = false;
        mockDispatch.mockClear();
        repositoryServiceMocks.syncMyWork.mockResolvedValue({ actionItemCount: 0, followUpCount: 0 });
        repositoryServiceMocks.generateMyWorkSummary.mockResolvedValue({ path: 'Weekly/summary.md' });
        location.hash = '';
    });

    it('renders the single-row header with tabs and action buttons', () => {
        renderView();
        expect(screen.getByTestId('my-work-header')).toBeTruthy();
        expect(screen.getByTestId('my-work-sync-btn')).toBeTruthy();
        expect(screen.getByTestId('my-work-generate-btn')).toBeTruthy();
        expect(screen.getByTestId('my-work-tab-activity')).toBeTruthy();
        expect(screen.getByTestId('my-work-tab-notes')).toBeTruthy();
        expect(screen.getByTestId('my-work-tab-git')).toBeTruthy();
        expect(screen.getByTestId('my-work-tab-schedules')).toBeTruthy();
        expect(screen.getByTestId('my-work-tab-settings')).toBeTruthy();
    });

    it('renders a vertical splitter between tabs and action buttons', () => {
        renderView();
        expect(screen.getByTestId('my-work-header-splitter')).toBeTruthy();
    });

    it('defaults to Notes tab when activeRepoSubTab is not in tabs list', () => {
        mockActiveRepoSubTab = 'templates';
        renderView();

        // Notes view should be visible (not display:none)
        const notesContainer = screen.getByTestId('notes-view').parentElement!;
        expect(notesContainer.style.display).not.toBe('none');

        // Activity tab should be hidden
        const activityContainer = screen.getByTestId('repo-activity-tab').parentElement!;
        expect(activityContainer.style.display).toBe('none');
    });

    it('shows Notes tab content when activeRepoSubTab is notes', () => {
        mockActiveRepoSubTab = 'notes';
        renderView();

        const notesContainer = screen.getByTestId('notes-view').parentElement!;
        expect(notesContainer.style.display).not.toBe('none');

        const activityContainer = screen.getByTestId('repo-activity-tab').parentElement!;
        expect(activityContainer.style.display).toBe('none');
    });

    it('shows Activity tab content when activeRepoSubTab is activity', () => {
        mockActiveRepoSubTab = 'activity';
        renderView();

        const activityContainer = screen.getByTestId('repo-activity-tab').parentElement!;
        expect(activityContainer.style.display).not.toBe('none');

        const notesContainer = screen.getByTestId('notes-view').parentElement!;
        expect(notesContainer.style.display).toBe('none');
    });

    it('passes my_work workspace ID to RepoChatTab', () => {
        mockActiveRepoSubTab = 'activity';
        renderView();

        const activityTab = screen.getByTestId('repo-activity-tab');
        expect(activityTab.getAttribute('data-workspace-id')).toBe(MY_WORK_WORKSPACE_ID);
    });

    it('passes my_work workspace ID to NotesView', () => {
        mockActiveRepoSubTab = 'notes';
        renderView();

        const notesView = screen.getByTestId('notes-view');
        expect(notesView.getAttribute('data-workspace-id')).toBe(MY_WORK_WORKSPACE_ID);
    });

    it('clicking Activity tab dispatches SET_REPO_SUB_TAB and updates hash', () => {
        mockActiveRepoSubTab = 'notes';
        renderView();

        fireEvent.click(screen.getByTestId('my-work-tab-activity'));

        expect(mockDispatch).toHaveBeenCalledWith({ type: 'SET_REPO_SUB_TAB', tab: 'activity' });
        expect(location.hash).toBe('#repos/my_work/activity');
    });

    it('clicking Notes tab dispatches SET_REPO_SUB_TAB and updates hash', () => {
        mockActiveRepoSubTab = 'activity';
        renderView();

        fireEvent.click(screen.getByTestId('my-work-tab-notes'));

        expect(mockDispatch).toHaveBeenCalledWith({ type: 'SET_REPO_SUB_TAB', tab: 'notes' });
        expect(location.hash).toBe('#repos/my_work/notes');
    });

    it('active tab has active styling indicator', () => {
        mockActiveRepoSubTab = 'activity';
        renderView();

        const activityBtn = screen.getByTestId('my-work-tab-activity');
        // Active tab should contain the indicator span
        expect(activityBtn.querySelector('span')).toBeTruthy();

        const notesBtn = screen.getByTestId('my-work-tab-notes');
        expect(notesBtn.querySelector('span')).toBeNull();
    });

    it('header stays visible regardless of active tab', () => {
        // Notes tab
        mockActiveRepoSubTab = 'notes';
        const { unmount } = renderView();
        expect(screen.getByTestId('my-work-header')).toBeTruthy();
        unmount();

        // Activity tab
        mockActiveRepoSubTab = 'activity';
        renderView();
        expect(screen.getByTestId('my-work-header')).toBeTruthy();
    });

    it('exports MY_WORK_WORKSPACE_ID constant', () => {
        expect(MY_WORK_WORKSPACE_ID).toBe('my_work');
    });

    it('docks the status cluster footer as the last child of the view body', () => {
        renderView();
        const view = screen.getByTestId('my-work-view');
        const footer = screen.getByTestId('docked-status-footer');
        // Lives inside the My Work chrome, pinned to the bottom (last child), so
        // the app-wide GlobalStatusDock stands down and no empty strip is drawn.
        expect(view.contains(footer)).toBe(true);
        expect(view.lastElementChild).toBe(footer);
    });

    describe('chat toggle button (removed from header)', () => {
        it('does not render a 🤖 Chat toggle button in the header', () => {
            renderView();
            expect(screen.queryByTestId('my-work-chat-toggle')).toBeNull();
        });
    });

    describe('defaultScope prop', () => {
        it('passes defaultScope="per-workspace" to NotesView', () => {
            mockActiveRepoSubTab = 'notes';
            renderView();
            const notesView = screen.getByTestId('notes-view');
            expect(notesView.getAttribute('data-default-scope')).toBe('per-workspace');
        });

        it('does not pass chatPanelOpen from header to NotesView (no external state)', () => {
            renderView();
            const notesView = screen.getByTestId('notes-view');
            // NotesView manages chat panel state internally (no external chatPanelOpen)
            expect(notesView.getAttribute('data-chat-panel-open')).toBe('false');
        });

        it('does not pass onToggleChatPanel to NotesView (internal management)', () => {
            renderView();
            const notesView = screen.getByTestId('notes-view');
            expect(notesView.getAttribute('data-has-toggle')).toBe('false');
        });
    });

    describe('actions', () => {
        it('syncs My Work through the typed repository service', async () => {
            repositoryServiceMocks.syncMyWork.mockResolvedValueOnce({ actionItemCount: 2, followUpCount: 1 });
            renderView();

            fireEvent.click(screen.getByTestId('my-work-sync-btn'));

            expect(repositoryServiceMocks.syncMyWork).toHaveBeenCalledTimes(1);
            expect(await screen.findByText('Synced 3 items')).toBeTruthy();
        });

        it('generates a summary through the typed repository service', async () => {
            repositoryServiceMocks.generateMyWorkSummary.mockResolvedValueOnce({ path: 'Weekly/2026-W18.md' });
            renderView();

            fireEvent.click(screen.getByTestId('my-work-generate-btn'));

            expect(repositoryServiceMocks.generateMyWorkSummary).toHaveBeenCalledTimes(1);
            expect(await screen.findByText('Summary saved to Weekly/2026-W18.md')).toBeTruthy();
            expect(location.hash).toBe('#repos/my_work/notes/Weekly%2F2026-W18.md');
        });
    });

    describe('git tab', () => {
        it('shows NotesGitTab when git tab is active', () => {
            mockActiveRepoSubTab = 'git';
            renderView();

            const gitContainer = screen.getByTestId('notes-git-tab').parentElement!;
            expect(gitContainer.style.display).not.toBe('none');
        });

        it('hides NotesGitTab when another tab is active', () => {
            mockActiveRepoSubTab = 'notes';
            renderView();

            const gitContainer = screen.getByTestId('notes-git-tab').parentElement!;
            expect(gitContainer.style.display).toBe('none');
        });

        it('passes my_work workspace ID to NotesGitTab', () => {
            mockActiveRepoSubTab = 'git';
            renderView();

            const gitTab = screen.getByTestId('notes-git-tab');
            expect(gitTab.getAttribute('data-workspace-id')).toBe(MY_WORK_WORKSPACE_ID);
        });

        it('clicking Git tab dispatches SET_REPO_SUB_TAB and updates hash', () => {
            mockActiveRepoSubTab = 'notes';
            renderView();

            fireEvent.click(screen.getByTestId('my-work-tab-git'));

            expect(mockDispatch).toHaveBeenCalledWith({ type: 'SET_REPO_SUB_TAB', tab: 'git' });
            expect(location.hash).toBe('#repos/my_work/git');
        });
    });

    describe('schedules tab', () => {
        it('shows RepoSchedulesTab when schedules tab is active', () => {
            mockActiveRepoSubTab = 'schedules';
            renderView();

            const schedulesContainer = screen.getByTestId('repo-schedules-tab').parentElement!;
            expect(schedulesContainer.style.display).not.toBe('none');
        });

        it('hides RepoSchedulesTab when another tab is active', () => {
            mockActiveRepoSubTab = 'notes';
            renderView();

            const schedulesContainer = screen.getByTestId('repo-schedules-tab').parentElement!;
            expect(schedulesContainer.style.display).toBe('none');
        });

        it('passes my_work workspace ID to RepoSchedulesTab', () => {
            mockActiveRepoSubTab = 'schedules';
            renderView();

            const schedulesTab = screen.getByTestId('repo-schedules-tab');
            expect(schedulesTab.getAttribute('data-workspace-id')).toBe(MY_WORK_WORKSPACE_ID);
        });

        it('clicking Schedules tab dispatches SET_REPO_SUB_TAB and updates hash', () => {
            mockActiveRepoSubTab = 'notes';
            renderView();

            fireEvent.click(screen.getByTestId('my-work-tab-schedules'));

            expect(mockDispatch).toHaveBeenCalledWith({ type: 'SET_REPO_SUB_TAB', tab: 'schedules' });
            expect(location.hash).toBe('#repos/my_work/schedules');
        });

        describe('when schedules-in-scheduled-slide flag is enabled', () => {
            beforeEach(() => {
                mockSchedulesInScheduledSlideEnabled = true;
            });

            it('hides the Schedules tab button', () => {
                renderView();
                expect(screen.queryByTestId('my-work-tab-schedules')).toBeNull();
            });

            it('does not mount RepoSchedulesTab', () => {
                renderView();
                expect(screen.queryByTestId('repo-schedules-tab')).toBeNull();
            });

            it('does not mount RepoSchedulesTab even when the stale sub-tab is schedules', () => {
                mockActiveRepoSubTab = 'schedules';
                renderView();
                expect(screen.queryByTestId('repo-schedules-tab')).toBeNull();
                // Falls back to Notes content since schedules is no longer a visible tab
                const notesContainer = screen.getByTestId('notes-view').parentElement!;
                expect(notesContainer.style.display).not.toBe('none');
            });
        });
    });

    describe('settings tab', () => {
        it('renders RepoSettingsTab when settings tab is active', () => {
            mockActiveRepoSubTab = 'settings';
            renderView();

            expect(screen.getByTestId('repo-settings-tab')).toBeTruthy();
        });

        it('does not render RepoSettingsTab when another tab is active', () => {
            mockActiveRepoSubTab = 'notes';
            renderView();

            expect(screen.queryByTestId('repo-settings-tab')).toBeNull();
        });

        it('passes my_work workspace ID and virtual repo to RepoSettingsTab', () => {
            mockActiveRepoSubTab = 'settings';
            renderView();

            const settingsTab = screen.getByTestId('repo-settings-tab');
            expect(settingsTab.getAttribute('data-workspace-id')).toBe(MY_WORK_WORKSPACE_ID);
            expect(settingsTab.getAttribute('data-repo-id')).toBe(MY_WORK_WORKSPACE_ID);
        });

        it('clicking Settings tab dispatches SET_REPO_SUB_TAB and updates hash', () => {
            mockActiveRepoSubTab = 'notes';
            renderView();

            fireEvent.click(screen.getByTestId('my-work-tab-settings'));

            expect(mockDispatch).toHaveBeenCalledWith({ type: 'SET_REPO_SUB_TAB', tab: 'settings' });
            expect(location.hash).toBe('#repos/my_work/settings');
        });
    });
});
