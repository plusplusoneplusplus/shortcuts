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

// Stub NotesView — just render a marker div
vi.mock('../../../../../src/server/spa/client/react/repos/NotesView', () => ({
    NotesView: (props: any) => (
        <div data-testid="notes-view" data-workspace-id={props.workspaceId} />
    ),
}));

// Stub RepoActivityTab — just render a marker div
vi.mock('../../../../../src/server/spa/client/react/repos/RepoActivityTab', () => ({
    RepoActivityTab: (props: any) => (
        <div data-testid="repo-activity-tab" data-workspace-id={props.workspaceId} />
    ),
}));

import { MyLifeView, MY_LIFE_WORKSPACE_ID } from '../../../../../src/server/spa/client/react/repos/MyLifeView';

// ── Helpers ────────────────────────────────────────────────────────────────

function renderView() {
    return render(<MyLifeView />);
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('MyLifeView', () => {
    beforeEach(() => {
        mockActiveRepoSubTab = 'notes';
        mockSelectedNotePath = null;
        mockDispatch.mockClear();
        location.hash = '';
    });

    it('renders the single-row header with tabs and action buttons', () => {
        renderView();
        expect(screen.getByTestId('my-life-header')).toBeTruthy();
        expect(screen.getByTestId('my-life-sync-btn')).toBeTruthy();
        expect(screen.getByTestId('my-life-generate-btn')).toBeTruthy();
        expect(screen.getByTestId('my-life-tab-activity')).toBeTruthy();
        expect(screen.getByTestId('my-life-tab-notes')).toBeTruthy();
    });

    it('renders a vertical splitter between tabs and action buttons', () => {
        renderView();
        expect(screen.getByTestId('my-life-header-splitter')).toBeTruthy();
    });

    it('defaults to Notes tab when activeRepoSubTab is not activity/notes', () => {
        mockActiveRepoSubTab = 'settings';
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

    it('passes my_life workspace ID to RepoActivityTab', () => {
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
});
