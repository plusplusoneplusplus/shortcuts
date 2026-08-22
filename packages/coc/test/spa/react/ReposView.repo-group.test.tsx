/**
 * ReposView + AppContext — repo-group virtual workspace routing (AC-02).
 *
 * Selecting a `group-<slug>` workspace id renders the dedicated RepoGroupView
 * (recognized by id prefix — groups never appear in the repos list), skips the
 * deep-link loading guard, and never overwrites the remembered concrete
 * workspace (`lastWorkspaceRepoId`) the scope switcher switches back to.
 *
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { useEffect, type ReactNode } from 'react';

let mockLoading = false;
let mockRepos: any[] = [];

vi.mock('../../../src/server/spa/client/react/contexts/ReposContext', () => ({
    useRepos: () => ({ repos: mockRepos, loading: mockLoading, fetchRepos: vi.fn(), unseenCounts: {} }),
    ReposProvider: ({ children }: { children: ReactNode }) => children,
}));

// Stub only the view component; TopBar and others import the real
// getRepoGroupHeaderConfig from the same module.
vi.mock('../../../src/server/spa/client/react/repos/RepoGroupView', async () => {
    const actual = await vi.importActual<object>('../../../src/server/spa/client/react/repos/RepoGroupView');
    return {
        ...actual,
        RepoGroupView: ({ workspaceId }: { workspaceId: string }) => (
            <div data-testid="stub-repo-group-view" data-workspace={workspaceId} />
        ),
    };
});

// Heavy always-mounted tab bodies pulled in via MyWorkView/MyLifeView.
vi.mock('../../../src/server/spa/client/react/features/chat/RepoChatTab', () => ({
    RepoChatTab: () => null,
}));

import { AppProvider, appReducer, useApp } from '../../../src/server/spa/client/react/contexts/AppContext';
import { QueueProvider } from '../../../src/server/spa/client/react/contexts/QueueContext';
import { ReposView } from '../../../src/server/spa/client/react/repos/ReposView';

const GROUP_ID = 'group-frontend';

// jsdom doesn't implement scrollIntoView (needed by RepoDetail's tab strip)
if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn();
}

function SelectRepoOnMount({ id }: { id: string }) {
    const { dispatch } = useApp();
    useEffect(() => {
        dispatch({ type: 'SET_SELECTED_REPO', id });
    }, [dispatch, id]);
    return null;
}

function renderReposView(selectedId: string) {
    return render(
        <AppProvider>
            <QueueProvider>
                <SelectRepoOnMount id={selectedId} />
                <ReposView />
            </QueueProvider>
        </AppProvider>
    );
}

beforeEach(() => {
    cleanup();
    mockLoading = false;
    mockRepos = [];
    location.hash = '';
});

describe('ReposView — repo-group selection', () => {
    it('renders RepoGroupView for a group-<slug> selection', () => {
        renderReposView(GROUP_ID);
        expect(screen.getByTestId('stub-repo-group-view').getAttribute('data-workspace')).toBe(GROUP_ID);
    });

    it('does not hold a group deep-link on the loading indicator while repos load', () => {
        // The deep-link guard waits for a selected repo to appear in the repos
        // list — groups never appear there, so they must be exempt.
        mockLoading = true;
        mockRepos = [{ workspace: { id: 'r1', name: 'shortcuts', rootPath: '/r/r1' } }];
        renderReposView(GROUP_ID);
        expect(screen.getByTestId('stub-repo-group-view')).toBeTruthy();
        expect(screen.queryByText('Loading repositories...')).toBeNull();
    });

    it('does not render RepoGroupView for a plain repo selection', () => {
        mockRepos = [{ workspace: { id: 'r1', name: 'shortcuts', rootPath: '/r/r1' } }];
        renderReposView('r1');
        expect(screen.queryByTestId('stub-repo-group-view')).toBeNull();
    });
});

describe('appReducer — repo groups never become the remembered concrete workspace', () => {
    const baseState = {
        selectedRepoId: null,
        lastWorkspaceRepoId: null,
        activeRepoSubTab: 'chats',
        repoTabState: {},
        repoRouteState: {},
        notePathState: {},
        selectedNotePath: null,
    } as any;

    it('selecting a group preserves the previously remembered workspace', () => {
        const afterRepo = appReducer(baseState, { type: 'SET_SELECTED_REPO', id: 'r1' });
        expect(afterRepo.lastWorkspaceRepoId).toBe('r1');
        const afterGroup = appReducer(afterRepo, { type: 'SET_SELECTED_REPO', id: GROUP_ID });
        expect(afterGroup.selectedRepoId).toBe(GROUP_ID);
        expect(afterGroup.lastWorkspaceRepoId).toBe('r1');
    });

    it('selecting a group with no prior workspace leaves the slot empty', () => {
        const afterGroup = appReducer(baseState, { type: 'SET_SELECTED_REPO', id: GROUP_ID });
        expect(afterGroup.selectedRepoId).toBe(GROUP_ID);
        expect(afterGroup.lastWorkspaceRepoId).toBeNull();
    });
});
