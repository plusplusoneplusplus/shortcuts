/**
 * RemoteTopBar — component tests.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

const mockSelectClone = vi.fn();
let mockAppState: any = { selectedRepoId: null };
let mockQueueState: any = { repoQueueMap: {} };
let mockRepos: any[] = [];
let mockUnseen: Record<string, number> = {};

vi.mock('../../../../src/server/spa/client/react/contexts/AppContext', () => ({
    useApp: () => ({ state: mockAppState, dispatch: vi.fn() }),
}));
vi.mock('../../../../src/server/spa/client/react/contexts/QueueContext', () => ({
    useQueue: () => ({ state: mockQueueState, dispatch: vi.fn() }),
}));
vi.mock('../../../../src/server/spa/client/react/contexts/ReposContext', () => ({
    useRepos: () => ({ repos: mockRepos, unseenCounts: mockUnseen, fetchRepos: vi.fn() }),
}));
vi.mock('../../../../src/server/spa/client/react/features/remote-shell/useShellNavigation', () => ({
    useShellNavigation: () => ({ selectClone: mockSelectClone, switchSubTab: vi.fn() }),
}));
vi.mock('../../../../src/server/spa/client/react/repos/CloneRepoDialog', () => ({
    CloneRepoDialog: ({ open }: { open: boolean }) => (open ? <div data-testid="clone-repo-dialog" /> : null),
}));
vi.mock('../../../../src/server/spa/client/react/repos/AddFolderDialog', () => ({
    AddFolderDialog: ({ open }: { open: boolean }) => (open ? <div data-testid="add-folder-dialog" /> : null),
}));
vi.mock('../../../../src/server/spa/client/react/repos/AddRepoDialog', () => ({
    AddRepoDialog: ({ open }: { open: boolean }) => (open ? <div data-testid="add-repo-dialog" /> : null),
}));

import { RemoteTopBar } from '../../../../src/server/spa/client/react/features/remote-shell/RemoteTopBar';

const repo = (id: string, name: string, remoteUrl: string, color = '#123456') => ({
    workspace: { id, name, color, remoteUrl, rootPath: `/r/${id}` },
    gitInfo: { isGitRepo: true, branch: 'main', dirty: false, remoteUrl },
});

const SHORTCUTS = 'https://github.com/acme/shortcuts.git';
const FORGE = 'https://github.com/acme/forge.git';

beforeEach(() => {
    cleanup();
    mockSelectClone.mockReset();
    mockAppState = { selectedRepoId: null };
    mockQueueState = { repoQueueMap: {} };
    mockUnseen = {};
});

describe('RemoteTopBar', () => {
    it('renders one tab per remote — clones of the same origin collapse', () => {
        mockRepos = [
            repo('a', 'shortcuts', SHORTCUTS),
            repo('b', 'shortcuts-2', SHORTCUTS),
            repo('c', 'forge', FORGE),
        ];
        render(<RemoteTopBar />);
        expect(screen.getAllByTestId('remote-tab')).toHaveLength(2);
    });

    it('shows a clone-count chip only when a remote has more than one clone', () => {
        mockRepos = [
            repo('a', 'shortcuts', SHORTCUTS),
            repo('b', 'shortcuts-2', SHORTCUTS),
            repo('c', 'forge', FORGE),
        ];
        render(<RemoteTopBar />);
        const counts = screen.getAllByTestId('remote-clone-count');
        expect(counts).toHaveLength(1);
        expect(counts[0].textContent).toContain('2');
    });

    it('aggregates unseen counts across clones and shows a running pulse', () => {
        mockRepos = [repo('a', 'shortcuts', SHORTCUTS), repo('b', 'shortcuts-2', SHORTCUTS)];
        mockUnseen = { a: 3, b: 5 };
        mockQueueState = { repoQueueMap: { a: { running: [{}], queued: [] } } };
        render(<RemoteTopBar />);
        expect(screen.getByTestId('remote-unseen-badge').textContent).toBe('8');
        expect(screen.getByTestId('remote-running-pulse')).toBeTruthy();
    });

    it('selects the first clone of a remote on click', () => {
        mockRepos = [repo('a', 'shortcuts', SHORTCUTS), repo('b', 'shortcuts-2', SHORTCUTS)];
        render(<RemoteTopBar />);
        fireEvent.click(screen.getAllByTestId('remote-tab')[0]);
        expect(mockSelectClone).toHaveBeenCalledWith('a');
    });

    it('marks the remote containing the selected clone as active', () => {
        mockRepos = [repo('a', 'shortcuts', SHORTCUTS), repo('c', 'forge', FORGE)];
        mockAppState = { selectedRepoId: 'c' };
        render(<RemoteTopBar />);
        const active = screen.getAllByTestId('remote-tab').find(el => el.getAttribute('data-active') === 'true');
        expect(active).toBeTruthy();
        expect(active!.getAttribute('data-remote-key')).toContain('forge');
    });

    it('exposes a top-level add menu with folder / repo / clone options', () => {
        mockRepos = [repo('a', 'shortcuts', SHORTCUTS)];
        render(<RemoteTopBar />);
        expect(screen.queryByTestId('remote-add-menu')).toBeNull();
        fireEvent.click(screen.getByTestId('remote-add-btn'));
        expect(screen.getByTestId('remote-add-folder-option')).toBeTruthy();
        expect(screen.getByTestId('remote-add-repo-option')).toBeTruthy();
        expect(screen.getByTestId('remote-clone-repo-option')).toBeTruthy();
    });

    it('adds an existing folder from the top-level menu', () => {
        mockRepos = [repo('a', 'shortcuts', SHORTCUTS)];
        render(<RemoteTopBar />);
        fireEvent.click(screen.getByTestId('remote-add-btn'));
        fireEvent.click(screen.getByTestId('remote-add-folder-option'));
        expect(screen.getByTestId('add-folder-dialog')).toBeTruthy();
    });

    it('clones a repository from the top-level menu', () => {
        mockRepos = [repo('a', 'shortcuts', SHORTCUTS)];
        render(<RemoteTopBar />);
        fireEvent.click(screen.getByTestId('remote-add-btn'));
        fireEvent.click(screen.getByTestId('remote-clone-repo-option'));
        expect(screen.getByTestId('clone-repo-dialog')).toBeTruthy();
    });
});
