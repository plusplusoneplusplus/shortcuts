/**
 * ScopeSlideSwitcher — sliding scope segmented control tests.
 *
 * jsdom has no layout, so the thumb is asserted via data-active-scope /
 * aria-selected rather than pixel positions.
 *
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const mockSelectClone = vi.fn();
const mockSwitchSubTab = vi.fn();
const mockDispatch = vi.fn();
let mockAppState: any = { selectedRepoId: 'a', activeTab: 'repos', activeRepoSubTab: 'chats', notePathState: {} };
let mockQueueState: any = { repoQueueMap: {} };
let mockRepos: any[] = [];
let mockMyWorkEnabled = true;
let mockMyLifeEnabled = true;

vi.mock('../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        preferences: {
            getGlobal: vi.fn().mockResolvedValue({ recentRemotes: [] }),
            patchGlobal: vi.fn().mockResolvedValue({}),
        },
    }),
}));
vi.mock('../../../src/server/spa/client/react/contexts/AppContext', () => ({
    useApp: () => ({ state: mockAppState, dispatch: mockDispatch }),
}));
vi.mock('../../../src/server/spa/client/react/contexts/QueueContext', () => ({
    useQueue: () => ({ state: mockQueueState, dispatch: vi.fn() }),
}));
vi.mock('../../../src/server/spa/client/react/contexts/ReposContext', () => ({
    useRepos: () => ({ repos: mockRepos, unseenCounts: {}, fetchRepos: vi.fn() }),
}));
vi.mock('../../../src/server/spa/client/react/hooks/feature-flags/useMyWorkEnabled', () => ({
    useMyWorkEnabled: () => mockMyWorkEnabled,
}));
vi.mock('../../../src/server/spa/client/react/hooks/feature-flags/useMyLifeEnabled', () => ({
    useMyLifeEnabled: () => mockMyLifeEnabled,
}));
vi.mock('../../../src/server/spa/client/react/features/remote-shell/useShellNavigation', () => ({
    useShellNavigation: () => ({ selectClone: mockSelectClone, switchSubTab: mockSwitchSubTab }),
}));
vi.mock('../../../src/server/spa/client/react/repos/AddFolderDialog', () => ({
    AddFolderDialog: ({ open }: { open: boolean }) => (open ? <div data-testid="add-folder-dialog" /> : null),
}));
vi.mock('../../../src/server/spa/client/react/repos/AddRepoDialog', () => ({
    AddRepoDialog: ({ open }: { open: boolean }) => (open ? <div data-testid="add-repo-dialog" /> : null),
}));
vi.mock('../../../src/server/spa/client/react/repos/CloneRepoDialog', () => ({
    CloneRepoDialog: ({ open }: { open: boolean }) => (open ? <div data-testid="clone-repo-dialog" /> : null),
}));

import { ScopeSlideSwitcher } from '../../../src/server/spa/client/react/features/remote-shell/ScopeSlideSwitcher';
import { MY_WORK_WORKSPACE_ID } from '../../../src/server/spa/client/react/repos/MyWorkView';
import { MY_LIFE_WORKSPACE_ID } from '../../../src/server/spa/client/react/repos/MyLifeView';

const repo = (id: string, name: string, remoteUrl: string) => ({
    workspace: { id, name, color: '#0078d4', remoteUrl, rootPath: `/r/${id}` },
    gitInfo: { isGitRepo: true, branch: 'main', dirty: false, remoteUrl },
});

const SHORTCUTS = 'https://github.com/acme/shortcuts.git';
const FORGE = 'https://github.com/acme/forge.git';

beforeEach(() => {
    cleanup();
    mockSelectClone.mockReset();
    mockSwitchSubTab.mockReset();
    mockDispatch.mockReset();
    mockAppState = { selectedRepoId: 'a', activeTab: 'repos', activeRepoSubTab: 'chats', notePathState: {} };
    mockQueueState = { repoQueueMap: {} };
    mockRepos = [repo('a', 'shortcuts', SHORTCUTS), repo('b', 'shortcuts-2', SHORTCUTS), repo('c', 'forge', FORGE)];
    mockMyWorkEnabled = true;
    mockMyLifeEnabled = true;
    location.hash = '';
});

const segments = () => screen.getAllByTestId('scope-segment');
const segment = (scope: string) => segments().find(el => el.getAttribute('data-scope') === scope);

describe('ScopeSlideSwitcher — segments and active scope', () => {
    it('renders work, life, and workspace segments with the workspace identity chip', () => {
        render(<ScopeSlideSwitcher repo={mockRepos[0]} repos={mockRepos} />);

        expect(segments().map(el => el.getAttribute('data-scope'))).toEqual(['work', 'life', 'workspace']);
        expect(screen.getByTestId('remote-chip').textContent).toContain('shortcuts');
    });

    it('marks the workspace segment active for a real repo selection', () => {
        render(<ScopeSlideSwitcher repo={mockRepos[0]} repos={mockRepos} />);

        expect(screen.getByTestId('scope-switcher').getAttribute('data-active-scope')).toBe('workspace');
        expect(segment('workspace')!.getAttribute('aria-selected')).toBe('true');
        expect(segment('work')!.getAttribute('aria-selected')).toBe('false');
    });

    it('marks the work segment active when My Work is the selected scope', () => {
        mockAppState = { ...mockAppState, selectedRepoId: MY_WORK_WORKSPACE_ID };
        render(<ScopeSlideSwitcher repos={mockRepos} />);

        expect(screen.getByTestId('scope-switcher').getAttribute('data-active-scope')).toBe('work');
        expect(segment('work')!.getAttribute('aria-selected')).toBe('true');
    });

    it('marks the life segment active when My Life is the selected scope', () => {
        mockAppState = { ...mockAppState, selectedRepoId: MY_LIFE_WORKSPACE_ID };
        render(<ScopeSlideSwitcher repos={mockRepos} />);

        expect(screen.getByTestId('scope-switcher').getAttribute('data-active-scope')).toBe('life');
    });

    it('falls back to the workspace scope off the repos tab even with a virtual id selected', () => {
        mockAppState = { ...mockAppState, selectedRepoId: MY_WORK_WORKSPACE_ID, activeTab: 'admin' };
        render(<ScopeSlideSwitcher repos={mockRepos} />);

        expect(screen.getByTestId('scope-switcher').getAttribute('data-active-scope')).toBe('workspace');
    });

    it('gates the work and life segments on their feature flags', () => {
        mockMyWorkEnabled = false;
        mockMyLifeEnabled = false;
        render(<ScopeSlideSwitcher repo={mockRepos[0]} repos={mockRepos} />);

        expect(segments().map(el => el.getAttribute('data-scope'))).toEqual(['workspace']);
    });
});

describe('ScopeSlideSwitcher — interactions', () => {
    it('clicking the work segment selects the My Work virtual workspace', () => {
        render(<ScopeSlideSwitcher repo={mockRepos[0]} repos={mockRepos} />);

        fireEvent.click(segment('work')!);

        expect(mockDispatch).toHaveBeenCalledWith({ type: 'SET_ACTIVE_TAB', tab: 'repos' });
        expect(mockDispatch).toHaveBeenCalledWith({ type: 'SET_SELECTED_REPO', id: MY_WORK_WORKSPACE_ID });
        expect(location.hash).toBe('#repos/' + MY_WORK_WORKSPACE_ID + '/notes');
    });

    it('clicking the life segment selects the My Life virtual workspace', () => {
        render(<ScopeSlideSwitcher repo={mockRepos[0]} repos={mockRepos} />);

        fireEvent.click(segment('life')!);

        expect(mockDispatch).toHaveBeenCalledWith({ type: 'SET_SELECTED_REPO', id: MY_LIFE_WORKSPACE_ID });
    });

    it('restores the saved note path when returning to My Work', () => {
        mockAppState = { ...mockAppState, notePathState: { [MY_WORK_WORKSPACE_ID]: 'Plans/today.md' } };
        render(<ScopeSlideSwitcher repo={mockRepos[0]} repos={mockRepos} />);

        fireEvent.click(segment('work')!);

        expect(location.hash).toContain('#repos/' + MY_WORK_WORKSPACE_ID + '/notes/');
        expect(decodeURIComponent(location.hash)).toContain('Plans/today.md');
    });

    it('chevron click opens the remote picker without switching scope', () => {
        render(<ScopeSlideSwitcher repo={mockRepos[0]} repos={mockRepos} />);

        fireEvent.click(screen.getByTestId('remote-chip'));

        expect(screen.getByTestId('remote-dropdown')).toBeTruthy();
        expect(mockDispatch).not.toHaveBeenCalled();
        expect(mockSelectClone).not.toHaveBeenCalled();
    });

    it('selecting a different remote from the picker keeps segment 3 as the active workspace', () => {
        render(<ScopeSlideSwitcher repo={mockRepos[0]} repos={mockRepos} />);

        fireEvent.click(screen.getByTestId('remote-chip'));
        const forge = screen.getAllByTestId('remote-dropdown-item').find(el => el.textContent?.includes('forge'))!;
        fireEvent.click(forge);

        expect(mockSelectClone).toHaveBeenCalledWith('c');
        // Still exactly one workspace segment — no per-workspace segment explosion.
        expect(segments().filter(el => el.getAttribute('data-scope') === 'workspace')).toHaveLength(1);
    });

    it('shows "Select repository" in the chip when no repo is active (virtual scope)', () => {
        mockAppState = { ...mockAppState, selectedRepoId: MY_WORK_WORKSPACE_ID };
        render(<ScopeSlideSwitcher repos={mockRepos} />);

        expect(screen.getByTestId('remote-chip').textContent).toContain('Select repository');
    });
});
