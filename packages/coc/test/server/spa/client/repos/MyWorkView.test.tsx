/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockDispatch = vi.fn();
let mockActiveRepoSubTab = 'notes';
let mockSelectedNotePath: string | null = null;

vi.mock('../../../../../src/server/spa/client/react/context/AppContext', () => ({
    useApp: () => ({
        state: {
            activeRepoSubTab: mockActiveRepoSubTab,
            selectedNotePath: mockSelectedNotePath,
        },
        dispatch: mockDispatch,
    }),
}));

vi.mock('../../../../../src/server/spa/client/react/hooks/useApi', () => ({
    fetchApi: vi.fn(),
}));

vi.mock('../../../../../src/server/spa/client/react/shared', () => ({
    cn: (...args: any[]) => args.filter(Boolean).join(' '),
}));

// Stub NotesView — render a marker div that captures props
vi.mock('../../../../../src/server/spa/client/react/repos/NotesView', () => ({
    NotesView: (props: any) => (
        <div
            data-testid="notes-view"
            data-workspace-id={props.workspaceId}
            data-chat-panel-open={String(!!props.chatPanelOpen)}
            data-has-toggle={String(typeof props.onToggleChatPanel === 'function')}
        />
    ),
}));

// Stub RepoChatTab — just render a marker div
vi.mock('../../../../../src/server/spa/client/react/repos/RepoChatTab', () => ({
    RepoChatTab: (props: any) => (
        <div data-testid="repo-activity-tab" data-workspace-id={props.workspaceId} />
    ),
}));

// Stub NotesGitTab — just render a marker div
vi.mock('../../../../../src/server/spa/client/react/repos/NotesGitTab', () => ({
    NotesGitTab: (props: any) => (
        <div data-testid="notes-git-tab" data-workspace-id={props.workspaceId} />
    ),
}));

// Stub RepoSettingsTab— just render a marker div
vi.mock('../../../../../src/server/spa/client/react/repos/RepoSettingsTab', () => ({
    RepoSettingsTab: (props: any) => (
        <div data-testid="repo-settings-tab" data-workspace-id={props.workspaceId} data-repo-id={props.repo?.workspace?.id} />
    ),
}));

// Stub repoGrouping — provide the RepoData type import
vi.mock('../../../../../src/server/spa/client/react/repos/repoGrouping', () => ({}));

import { MyWorkView, MY_WORK_WORKSPACE_ID } from '../../../../../src/server/spa/client/react/repos/MyWorkView';

// ── Helpers ────────────────────────────────────────────────────────────────

function renderView() {
    return render(<MyWorkView />);
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('MyWorkView', () => {
    beforeEach(() => {
        mockActiveRepoSubTab = 'notes';
        mockSelectedNotePath = null;
        mockDispatch.mockClear();
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

    describe('chat toggle button', () => {
        it('renders the 🤖 Chat toggle button in the header', () => {
            renderView();
            expect(screen.getByTestId('my-work-chat-toggle')).toBeTruthy();
        });

        it('clicking the toggle toggles chatPanelOpen', () => {
            renderView();
            const toggle = screen.getByTestId('my-work-chat-toggle');
            const notesView = screen.getByTestId('notes-view');

            // Initially false
            expect(notesView.getAttribute('data-chat-panel-open')).toBe('false');

            // Click to open
            fireEvent.click(toggle);
            expect(screen.getByTestId('notes-view').getAttribute('data-chat-panel-open')).toBe('true');

            // Click to close
            fireEvent.click(toggle);
            expect(screen.getByTestId('notes-view').getAttribute('data-chat-panel-open')).toBe('false');
        });

        it('passes onToggleChatPanel callback to NotesView', () => {
            renderView();
            const notesView = screen.getByTestId('notes-view');
            expect(notesView.getAttribute('data-has-toggle')).toBe('true');
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
