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
    syncMyLife: vi.fn(),
    generateMyLifeSummary: vi.fn(),
}));

vi.mock('../../../../../src/server/spa/client/react/repos/repositoryService', () => ({
    ...repositoryServiceMocks,
}));

vi.mock('../../../../../src/server/spa/client/react/ui', () => ({
    cn: (...args: any[]) => args.filter(Boolean).join(' '),
}));

// Stub NotesView — just render a marker div
vi.mock('../../../../../src/server/spa/client/react/features/notes/NotesView', () => ({
    NotesView: (props: any) => (
        <div data-testid="notes-view" data-workspace-id={props.workspaceId} />
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

// Feature flag: schedules-in-scheduled-slide (default off)
vi.mock('../../../../../src/server/spa/client/react/hooks/feature-flags/useSchedulesInScheduledSlideEnabled', () => ({
    useSchedulesInScheduledSlideEnabled: () => mockSchedulesInScheduledSlideEnabled,
}));

import { MyLifeView, MY_LIFE_WORKSPACE_ID } from '../../../../../src/server/spa/client/react/repos/MyLifeView';

// ── Helpers ────────────────────────────────────────────────────────────────

function renderView() {
    return render(<MyLifeView />);
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('MyLifeView', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockActiveRepoSubTab = 'notes';
        mockSelectedNotePath = null;
        mockSchedulesInScheduledSlideEnabled = false;
        mockDispatch.mockClear();
        repositoryServiceMocks.syncMyLife.mockResolvedValue({ goalCount: 0, entryCount: 0 });
        repositoryServiceMocks.generateMyLifeSummary.mockResolvedValue({ path: 'Weekly/summary.md' });
        location.hash = '';
    });

    it('renders the single-row header with tabs and action buttons', () => {
        renderView();
        expect(screen.getByTestId('my-life-header')).toBeTruthy();
        expect(screen.getByTestId('my-life-sync-btn')).toBeTruthy();
        expect(screen.getByTestId('my-life-generate-btn')).toBeTruthy();
        expect(screen.getByTestId('my-life-tab-activity')).toBeTruthy();
        expect(screen.getByTestId('my-life-tab-notes')).toBeTruthy();
        expect(screen.getByTestId('my-life-tab-git')).toBeTruthy();
        expect(screen.getByTestId('my-life-tab-schedules')).toBeTruthy();
        expect(screen.getByTestId('my-life-tab-settings')).toBeTruthy();
    });

    it('renders a vertical splitter between tabs and action buttons', () => {
        renderView();
        expect(screen.getByTestId('my-life-header-splitter')).toBeTruthy();
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

    it('passes my_life workspace ID to RepoChatTab', () => {
        mockActiveRepoSubTab = 'activity';
        renderView();

        const activityTab = screen.getByTestId('repo-activity-tab');
        expect(activityTab.getAttribute('data-workspace-id')).toBe(MY_LIFE_WORKSPACE_ID);
    });

    it('passes my_life workspace ID to NotesView', () => {
        mockActiveRepoSubTab = 'notes';
        renderView();

        const notesView = screen.getByTestId('notes-view');
        expect(notesView.getAttribute('data-workspace-id')).toBe(MY_LIFE_WORKSPACE_ID);
    });

    it('clicking Activity tab dispatches SET_REPO_SUB_TAB and updates hash', () => {
        mockActiveRepoSubTab = 'notes';
        renderView();

        fireEvent.click(screen.getByTestId('my-life-tab-activity'));

        expect(mockDispatch).toHaveBeenCalledWith({ type: 'SET_REPO_SUB_TAB', tab: 'activity' });
        expect(location.hash).toBe('#repos/my_life/activity');
    });

    it('clicking Notes tab dispatches SET_REPO_SUB_TAB and updates hash', () => {
        mockActiveRepoSubTab = 'activity';
        renderView();

        fireEvent.click(screen.getByTestId('my-life-tab-notes'));

        expect(mockDispatch).toHaveBeenCalledWith({ type: 'SET_REPO_SUB_TAB', tab: 'notes' });
        expect(location.hash).toBe('#repos/my_life/notes');
    });

    it('active tab has active styling indicator', () => {
        mockActiveRepoSubTab = 'activity';
        renderView();

        const activityBtn = screen.getByTestId('my-life-tab-activity');
        // Active tab should contain the indicator span
        expect(activityBtn.querySelector('span')).toBeTruthy();

        const notesBtn = screen.getByTestId('my-life-tab-notes');
        expect(notesBtn.querySelector('span')).toBeNull();
    });

    it('header stays visible regardless of active tab', () => {
        // Notes tab
        mockActiveRepoSubTab = 'notes';
        const { unmount } = renderView();
        expect(screen.getByTestId('my-life-header')).toBeTruthy();
        unmount();

        // Activity tab
        mockActiveRepoSubTab = 'activity';
        renderView();
        expect(screen.getByTestId('my-life-header')).toBeTruthy();
    });

    it('exports MY_LIFE_WORKSPACE_ID constant', () => {
        expect(MY_LIFE_WORKSPACE_ID).toBe('my_life');
    });

    describe('actions', () => {
        it('syncs My Life through the typed repository service', async () => {
            repositoryServiceMocks.syncMyLife.mockResolvedValueOnce({ goalCount: 2, entryCount: 1 });
            renderView();

            fireEvent.click(screen.getByTestId('my-life-sync-btn'));

            expect(repositoryServiceMocks.syncMyLife).toHaveBeenCalledTimes(1);
            expect(await screen.findByText('Synced 3 items')).toBeTruthy();
        });

        it('generates a summary through the typed repository service', async () => {
            repositoryServiceMocks.generateMyLifeSummary.mockResolvedValueOnce({ path: 'Weekly/2026-W18.md' });
            renderView();

            fireEvent.click(screen.getByTestId('my-life-generate-btn'));

            expect(repositoryServiceMocks.generateMyLifeSummary).toHaveBeenCalledTimes(1);
            expect(await screen.findByText('Summary saved to Weekly/2026-W18.md')).toBeTruthy();
            expect(location.hash).toBe('#repos/my_life/notes/Weekly%2F2026-W18.md');
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

        it('passes my_life workspace ID to NotesGitTab', () => {
            mockActiveRepoSubTab = 'git';
            renderView();

            const gitTab = screen.getByTestId('notes-git-tab');
            expect(gitTab.getAttribute('data-workspace-id')).toBe(MY_LIFE_WORKSPACE_ID);
        });

        it('clicking Git tab dispatches SET_REPO_SUB_TAB and updates hash', () => {
            mockActiveRepoSubTab = 'notes';
            renderView();

            fireEvent.click(screen.getByTestId('my-life-tab-git'));

            expect(mockDispatch).toHaveBeenCalledWith({ type: 'SET_REPO_SUB_TAB', tab: 'git' });
            expect(location.hash).toBe('#repos/my_life/git');
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

        it('passes my_life workspace ID to RepoSchedulesTab', () => {
            mockActiveRepoSubTab = 'schedules';
            renderView();

            const schedulesTab = screen.getByTestId('repo-schedules-tab');
            expect(schedulesTab.getAttribute('data-workspace-id')).toBe(MY_LIFE_WORKSPACE_ID);
        });

        it('clicking Schedules tab dispatches SET_REPO_SUB_TAB and updates hash', () => {
            mockActiveRepoSubTab = 'notes';
            renderView();

            fireEvent.click(screen.getByTestId('my-life-tab-schedules'));

            expect(mockDispatch).toHaveBeenCalledWith({ type: 'SET_REPO_SUB_TAB', tab: 'schedules' });
            expect(location.hash).toBe('#repos/my_life/schedules');
        });

        describe('when schedules-in-scheduled-slide flag is enabled', () => {
            beforeEach(() => {
                mockSchedulesInScheduledSlideEnabled = true;
            });

            it('hides the Schedules tab button', () => {
                renderView();
                expect(screen.queryByTestId('my-life-tab-schedules')).toBeNull();
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

        it('passes my_life workspace ID and virtual repo to RepoSettingsTab', () => {
            mockActiveRepoSubTab = 'settings';
            renderView();

            const settingsTab = screen.getByTestId('repo-settings-tab');
            expect(settingsTab.getAttribute('data-workspace-id')).toBe(MY_LIFE_WORKSPACE_ID);
            expect(settingsTab.getAttribute('data-repo-id')).toBe(MY_LIFE_WORKSPACE_ID);
        });

        it('clicking Settings tab dispatches SET_REPO_SUB_TAB and updates hash', () => {
            mockActiveRepoSubTab = 'notes';
            renderView();

            fireEvent.click(screen.getByTestId('my-life-tab-settings'));

            expect(mockDispatch).toHaveBeenCalledWith({ type: 'SET_REPO_SUB_TAB', tab: 'settings' });
            expect(location.hash).toBe('#repos/my_life/settings');
        });
    });
});
