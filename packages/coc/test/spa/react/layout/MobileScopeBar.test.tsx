/**
 * MobileScopeBar — the 40px scope row that stands in for BottomNav on the
 * mobile Repos tab.
 *
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { mockViewport } from '../../helpers/viewport-mock';

vi.stubGlobal('ResizeObserver', vi.fn().mockImplementation(function () { return ({
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
}); }));

const mockDispatch = vi.fn();
let mockActiveTab = 'repos';
let mockSelectedRepoId: string | null = null;
let mockLastWorkspaceRepoId: string | null = null;
let mockRepos: any[] = [];
let mockWorkspaces: any[] = [];
let mockServersEnabled = false;

vi.mock('../../../../src/server/spa/client/react/utils/config', async () => {
    const actual = await vi.importActual<any>('../../../../src/server/spa/client/react/utils/config');
    return { ...actual, isServersEnabled: () => mockServersEnabled };
});
vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        preferences: {
            getGlobal: vi.fn().mockResolvedValue({ recentRemotes: [] }),
            patchGlobal: vi.fn().mockResolvedValue({}),
        },
    }),
}));
vi.mock('../../../../src/server/spa/client/react/contexts/AppContext', () => ({
    useApp: () => ({
        state: {
            activeTab: mockActiveTab,
            selectedRepoId: mockSelectedRepoId,
            lastWorkspaceRepoId: mockLastWorkspaceRepoId,
            workspaces: mockWorkspaces,
            lastCloneByRemote: {},
        },
        dispatch: mockDispatch,
    }),
}));
vi.mock('../../../../src/server/spa/client/react/contexts/QueueContext', () => ({
    useQueue: () => ({ state: { repoQueueMap: {} }, dispatch: vi.fn() }),
}));
vi.mock('../../../../src/server/spa/client/react/contexts/ReposContext', () => ({
    useRepos: () => ({
        repos: mockRepos,
        unseenCounts: {},
        fetchRepos: vi.fn().mockResolvedValue(undefined),
        remoteGroupWorkspaces: [],
    }),
}));
vi.mock('../../../../src/server/spa/client/react/features/remote-shell/useShellNavigation', () => ({
    useShellNavigation: () => ({ selectClone: vi.fn(), switchSubTab: vi.fn() }),
}));
vi.mock('../../../../src/server/spa/client/react/hooks/useScopeNavigation', () => ({
    useScopeNavigation: () => ({ goToMyWork: vi.fn(), goToMyLife: vi.fn() }),
}));
vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/useMyWorkEnabled', () => ({
    useMyWorkEnabled: () => true,
}));
vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/useMyLifeEnabled', () => ({
    useMyLifeEnabled: () => true,
}));
vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/usePinnedScopesEnabled', () => ({
    usePinnedScopesEnabled: () => false,
}));
vi.mock('../../../../src/server/spa/client/react/repos/AddFolderDialog', () => ({ AddFolderDialog: () => null }));
vi.mock('../../../../src/server/spa/client/react/repos/AddRepoDialog', () => ({ AddRepoDialog: () => null }));
vi.mock('../../../../src/server/spa/client/react/repos/CloneRepoDialog', () => ({ CloneRepoDialog: () => null }));
vi.mock('../../../../src/server/spa/client/react/repos/RepoGroupDialog', () => ({ RepoGroupDialog: () => null }));
vi.mock('../../../../src/server/spa/client/react/repos/repoGroupService', () => ({
    deleteRepoGroup: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../../../src/server/spa/client/react/repos/repositoryService', () => ({
    removeWorkspace: vi.fn().mockResolvedValue(undefined),
}));

import { MobileScopeBar } from '../../../../src/server/spa/client/react/layout/MobileScopeBar';

const SHORTCUTS = 'https://github.com/acme/shortcuts.git';
const repo = (id: string, name: string) => ({
    workspace: { id, name, color: '#0078d4', remoteUrl: SHORTCUTS, rootPath: `/r/${id}` },
    gitInfo: { isGitRepo: true, branch: 'main', dirty: false, remoteUrl: SHORTCUTS },
});

let viewportCleanup: (() => void) | undefined;

beforeEach(() => {
    cleanup();
    viewportCleanup?.();
    viewportCleanup = mockViewport(390);
    mockDispatch.mockReset();
    mockActiveTab = 'repos';
    mockSelectedRepoId = null;
    mockLastWorkspaceRepoId = null;
    mockRepos = [];
    mockWorkspaces = [];
    mockServersEnabled = false;
});

describe('MobileScopeBar', () => {
    it('renders on the mobile repos tab', () => {
        render(<MobileScopeBar />);
        expect(screen.getByTestId('mobile-scope-bar')).toBeTruthy();
    });

    it('stands down off the repos tab, where BottomNav takes the row', () => {
        mockActiveTab = 'skills';
        const { container } = render(<MobileScopeBar />);
        expect(container.innerHTML).toBe('');
    });

    it('stands down on desktop', () => {
        viewportCleanup?.();
        viewportCleanup = mockViewport(1280);
        const { container } = render(<MobileScopeBar />);
        expect(container.innerHTML).toBe('');
    });

    it('stands down once a workspace is selected — its own tab bar owns the row', () => {
        mockSelectedRepoId = 'a';
        const { container } = render(<MobileScopeBar />);
        expect(container.innerHTML).toBe('');
    });

    it('names the workspace the user was last in', () => {
        mockRepos = [repo('a', 'shortcuts')];
        mockLastWorkspaceRepoId = 'a';
        render(<MobileScopeBar />);
        expect(screen.getByTestId('mobile-scope-chip').textContent).toContain('shortcuts');
    });

    it('names a repo group with its group glyph', () => {
        mockWorkspaces = [{ id: 'group-frontend', name: 'Frontend' }];
        mockLastWorkspaceRepoId = 'group-frontend';
        render(<MobileScopeBar />);
        const chip = screen.getByTestId('mobile-scope-chip');
        expect(chip.textContent).toContain('Frontend');
        expect(chip.querySelector('[data-testid="repo-group-icon"]')).toBeTruthy();
    });

    it('falls back to a prompt when there is no scope yet', () => {
        render(<MobileScopeBar />);
        expect(screen.getByTestId('mobile-scope-chip').textContent).toContain('Select workspace');
    });

    it('opens the scope picker sheet from the chip', () => {
        mockRepos = [repo('a', 'shortcuts')];
        render(<MobileScopeBar />);
        fireEvent.click(screen.getByTestId('mobile-scope-chip'));
        expect(screen.getByTestId('scope-picker-sheet')).toBeTruthy();
    });

    it('folds the BottomNav destinations into the more sheet', () => {
        render(<MobileScopeBar />);
        fireEvent.click(screen.getByTestId('mobile-scope-more-btn'));
        const sheet = screen.getByTestId('mobile-scope-more-sheet');
        expect([...sheet.querySelectorAll('button[data-tab]')].map(b => b.getAttribute('data-tab')))
            .toEqual(['skills', 'memory', 'stats', 'logs']);

        fireEvent.click(sheet.querySelector('button[data-tab="memory"]')!);
        expect(mockDispatch).toHaveBeenCalledWith({ type: 'SET_ACTIVE_TAB', tab: 'memory' });
        expect(location.hash).toBe('#memory');
    });
});
