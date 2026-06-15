/**
 * Tests for Repos React components: utility functions and component rendering.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useEffect, type ReactNode } from 'react';
import { AppProvider, useApp } from '../../../src/server/spa/client/react/contexts/AppContext';
import { QueueProvider, useQueue } from '../../../src/server/spa/client/react/contexts/QueueContext';
import { ToastProvider } from '../../../src/server/spa/client/react/contexts/ToastContext';
import { NotificationProvider } from '../../../src/server/spa/client/react/contexts/NotificationContext';
import {
    normalizeRemoteUrl,
    remoteUrlLabel,
    groupReposByRemote,
    hashString,
    countTasks,
    truncatePath,
} from '../../../src/server/spa/client/react/repos/repoGrouping';
import type { RepoData } from '../../../src/server/spa/client/react/repos/repoGrouping';
import { RepoCard } from '../../../src/server/spa/client/react/repos/RepoCard';
import { ReposView } from '../../../src/server/spa/client/react/repos/ReposView';
import { RepoInfoTab } from '../../../src/server/spa/client/react/features/repo-detail/RepoInfoTab';
import { TemplatesTab } from '../../../src/server/spa/client/react/features/templates/TemplatesTab';
import { TasksPanel } from '../../../src/server/spa/client/react/tasks/TasksPanel';
import { AddRepoDialog } from '../../../src/server/spa/client/react/repos/AddRepoDialog';
import { ReposGrid } from '../../../src/server/spa/client/react/repos/ReposGrid';
import { RepoDetail } from '../../../src/server/spa/client/react/features/repo-detail/RepoDetail';

const repositoryServiceMocks = vi.hoisted(() => ({
    browseWorkspaceFolders: vi.fn(),
    cloneRepository: vi.fn(),
    getGlobalPreferences: vi.fn(),
    getRepositoryApiErrorMessage: vi.fn((error: unknown, fallback: string, networkFallback?: string) => {
        if (error instanceof Error && error.message) return error.message;
        return networkFallback ?? fallback;
    }),
    registerWorkspace: vi.fn(),
    updateGlobalPreferences: vi.fn(),
    updateWorkspace: vi.fn(),
}));

vi.mock('../../../src/server/spa/client/react/repos/repositoryService', () => ({
    ...repositoryServiceMocks,
}));

// Mock ReposContext so ReposView renders without making real API calls
vi.mock('../../../src/server/spa/client/react/contexts/ReposContext', () => ({
    useRepos: () => ({ repos: [], loading: false, fetchRepos: vi.fn(), unseenCounts: {} }),
    ReposProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// Mock heavy tab components that have side effects (API calls, context deps) when always-mounted via display:none
vi.mock('../../../src/server/spa/client/react/features/git/RepoGitTab', () => ({
    RepoGitTab: () => null,
}));
vi.mock('../../../src/server/spa/client/react/features/chat/RepoChatTab', () => ({
    RepoChatTab: () => null,
}));

let mockUiLayoutModeValue = 'classic';
vi.mock('../../../src/server/spa/client/react/hooks/preferences/useUiLayoutMode', () => ({
    useUiLayoutMode: () => [mockUiLayoutModeValue, vi.fn()],
}));

vi.mock('../../../src/server/spa/client/react/hooks/feature-flags/useWorkflowsEnabled', () => ({
    useWorkflowsEnabled: () => true,
}));

function Wrap({ children }: { children: ReactNode }) {
    return (
        <AppProvider>
            <QueueProvider>
                <NotificationProvider>
                    <ToastProvider value={{ addToast: vi.fn(), removeToast: vi.fn(), toasts: [] }}>
                        {children}
                    </ToastProvider>
                </NotificationProvider>
            </QueueProvider>
        </AppProvider>
    );
}

function CollapseReposSidebarOnMount() {
    const { dispatch } = useApp();
    useEffect(() => {
        dispatch({ type: 'TOGGLE_REPOS_SIDEBAR' });
    }, [dispatch]);
    return null;
}

function makeRepo(overrides: Partial<RepoData> & { workspace: any }): RepoData {
    return {
        gitInfo: { branch: 'main', dirty: false, isGitRepo: true },
        workflows: [],
        stats: { success: 0, failed: 0, running: 0 },
        taskCount: 0,
        ...overrides,
    };
}

// jsdom doesn't implement scrollIntoView
if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn();
}

beforeEach(() => {
    vi.clearAllMocks();
    repositoryServiceMocks.getGlobalPreferences.mockResolvedValue({});
    repositoryServiceMocks.updateGlobalPreferences.mockResolvedValue({});
    repositoryServiceMocks.registerWorkspace.mockResolvedValue({});
    repositoryServiceMocks.updateWorkspace.mockResolvedValue({ workspace: {} });
    repositoryServiceMocks.browseWorkspaceFolders.mockResolvedValue({ path: '', parent: null, entries: [] });
    repositoryServiceMocks.cloneRepository.mockResolvedValue({ clonedPath: '/repo' });
    repositoryServiceMocks.getRepositoryApiErrorMessage.mockImplementation((error: unknown, fallback: string, networkFallback?: string) => {
        if (error instanceof Error && error.message) return error.message;
        return networkFallback ?? fallback;
    });
});

// ============================================================================
// repoGrouping.ts utility tests
// ============================================================================

describe('normalizeRemoteUrl', () => {
    it('handles SSH format (git@host:user/repo.git)', () => {
        expect(normalizeRemoteUrl('git@github.com:user/repo.git')).toBe('github.com/user/repo');
    });

    it('handles HTTPS format', () => {
        expect(normalizeRemoteUrl('https://github.com/user/repo.git')).toBe('github.com/user/repo');
    });

    it('handles plain format without protocol', () => {
        expect(normalizeRemoteUrl('github.com/user/repo')).toBe('github.com/user/repo');
    });

    it('strips trailing slashes', () => {
        expect(normalizeRemoteUrl('https://github.com/user/repo/')).toBe('github.com/user/repo');
    });

    it('strips .git suffix', () => {
        expect(normalizeRemoteUrl('https://github.com/user/repo.git')).toBe('github.com/user/repo');
    });

    it('handles SSH with custom user', () => {
        expect(normalizeRemoteUrl('deploy@gitlab.com:org/project.git')).toBe('gitlab.com/org/project');
    });

    it('handles git:// protocol', () => {
        expect(normalizeRemoteUrl('git://github.com/user/repo.git')).toBe('github.com/user/repo');
    });

    it('handles ssh:// protocol', () => {
        expect(normalizeRemoteUrl('ssh://git@github.com/user/repo.git')).toBe('github.com/user/repo');
    });

    it('trims whitespace', () => {
        expect(normalizeRemoteUrl('  https://github.com/user/repo.git  ')).toBe('github.com/user/repo');
    });
});

describe('remoteUrlLabel', () => {
    it('extracts user/repo from github.com/user/repo', () => {
        expect(remoteUrlLabel('github.com/user/repo')).toBe('user/repo');
    });

    it('returns full string for short paths', () => {
        expect(remoteUrlLabel('repo')).toBe('repo');
    });

    it('handles nested org paths', () => {
        expect(remoteUrlLabel('gitlab.com/org/sub/repo')).toBe('org/sub/repo');
    });
});

describe('groupReposByRemote', () => {
    it('groups repos sharing the same normalized remote URL', () => {
        const repos: RepoData[] = [
            makeRepo({ workspace: { id: 'a', name: 'A', remoteUrl: 'git@github.com:user/repo.git' } }),
            makeRepo({ workspace: { id: 'b', name: 'B', remoteUrl: 'https://github.com/user/repo.git' } }),
        ];
        const groups = groupReposByRemote(repos, {});
        expect(groups.length).toBe(1);
        expect(groups[0].repos.length).toBe(2);
        expect(groups[0].label).toBe('user/repo');
    });

    it('places multi-clone groups first', () => {
        const repos: RepoData[] = [
            makeRepo({ workspace: { id: 'a', name: 'A', remoteUrl: 'https://github.com/solo/one.git' } }),
            makeRepo({ workspace: { id: 'b', name: 'B', remoteUrl: 'https://github.com/team/shared.git' } }),
            makeRepo({ workspace: { id: 'c', name: 'C', remoteUrl: 'https://github.com/team/shared.git' } }),
        ];
        const groups = groupReposByRemote(repos, {});
        // First group should be the multi-clone group
        expect(groups[0].repos.length).toBe(2);
        expect(groups[0].label).toBe('team/shared');
    });

    it('ungrouped repos (no remote) are appended flat', () => {
        const repos: RepoData[] = [
            makeRepo({ workspace: { id: 'a', name: 'NoRemote' } }),
        ];
        const groups = groupReposByRemote(repos, {});
        expect(groups.length).toBe(1);
        expect(groups[0].normalizedUrl).toBeNull();
        expect(groups[0].label).toBe('NoRemote');
    });

    it('respects expandedState', () => {
        const repos: RepoData[] = [
            makeRepo({ workspace: { id: 'a', name: 'A', remoteUrl: 'https://github.com/user/repo.git' } }),
        ];
        const groups = groupReposByRemote(repos, { 'github.com/user/repo': false });
        expect(groups[0].expanded).toBe(false);
    });

    it('defaults expanded state to true', () => {
        const repos: RepoData[] = [
            makeRepo({ workspace: { id: 'a', name: 'A', remoteUrl: 'https://github.com/user/repo.git' } }),
        ];
        const groups = groupReposByRemote(repos, {});
        expect(groups[0].expanded).toBe(true);
    });
});

describe('hashString', () => {
    it('produces deterministic output', () => {
        expect(hashString('/path/to/repo')).toBe(hashString('/path/to/repo'));
    });

    it('produces different output for different inputs', () => {
        expect(hashString('/path/a')).not.toBe(hashString('/path/b'));
    });

    it('returns a base36 string', () => {
        const result = hashString('/test');
        expect(result).toMatch(/^[0-9a-z]+$/);
    });
});

describe('countTasks', () => {
    it('returns 0 for null', () => {
        expect(countTasks(null)).toBe(0);
    });

    it('counts singleDocuments', () => {
        expect(countTasks({ singleDocuments: [1, 2, 3] })).toBe(3);
    });

    it('counts documentGroups', () => {
        expect(countTasks({ documentGroups: [1, 2] })).toBe(2);
    });

    it('counts recursively', () => {
        expect(countTasks({
            singleDocuments: [1],
            children: [{ singleDocuments: [2, 3], documentGroups: [4] }],
        })).toBe(4);
    });

    it('excludes archive folders recursively', () => {
        expect(countTasks({
            singleDocuments: [1],
            children: [
                { name: 'archive', singleDocuments: [2, 3], documentGroups: [4] },
                { relativePath: 'archive/sub', singleDocuments: [5] },
                { name: 'work-items', singleDocuments: [6], children: [{ relativePath: 'archive', singleDocuments: [7] }] },
            ],
        })).toBe(2);
    });
});

describe('truncatePath', () => {
    it('returns short paths unchanged', () => {
        expect(truncatePath('/short', 30)).toBe('/short');
    });

    it('truncates long paths with ellipsis prefix', () => {
        const long = '/very/long/path/to/some/deeply/nested/directory';
        const result = truncatePath(long, 20);
        expect(result.length).toBe(20);
        expect(result.startsWith('...')).toBe(true);
    });
});

// ============================================================================
// Component tests
// ============================================================================

describe('RepoCard', () => {
    const repo = makeRepo({
        workspace: { id: 'ws-1', name: 'My Repo', rootPath: '/path/to/repo', color: '#0078d4' },
        gitInfo: { branch: 'main', dirty: false, isGitRepo: true },
        workflows: [{ name: 'test', path: 'test.yaml' }],
        stats: { success: 5, failed: 1, running: 2 },
        taskCount: 3,
    });

    it('renders repo name', () => {
        render(<Wrap><RepoCard repo={repo} isSelected={false} onClick={() => {}} /></Wrap>);
        expect(screen.getByText('My Repo')).toBeDefined();
    });

    it('shows pipeline count', () => {
        render(<Wrap><RepoCard repo={repo} isSelected={false} onClick={() => {}} /></Wrap>);
        expect(screen.getByText('Workflows: 1')).toBeDefined();
    });

    it('shows task count in stats', () => {
        render(<Wrap><RepoCard repo={repo} isSelected={false} onClick={() => {}} /></Wrap>);
        expect(screen.getByText(/· 3/)).toBeDefined();
    });

    it('calls onClick when clicked', () => {
        const onClick = vi.fn();
        render(<Wrap><RepoCard repo={repo} isSelected={false} onClick={onClick} /></Wrap>);
        fireEvent.click(screen.getByText('My Repo'));
        expect(onClick).toHaveBeenCalledOnce();
    });

    it('shows branch badge when inGroup', () => {
        render(<Wrap><RepoCard repo={repo} isSelected={false} inGroup onClick={() => {}} /></Wrap>);
        expect(screen.getByText('main')).toBeDefined();
    });

    it('does not show queue status when queue is empty', () => {
        render(<Wrap><RepoCard repo={repo} isSelected={false} onClick={() => {}} /></Wrap>);
        expect(document.querySelector('[data-testid="repo-card-queue-status"]')).toBeNull();
    });

    it('shows queue running badge when running > 0', () => {
        function SeedQueue({ children }: { children: ReactNode }) {
            const { dispatch } = useQueue();
            useEffect(() => {
                dispatch({
                    type: 'REPO_QUEUE_UPDATED',
                    repoId: 'ws-1',
                    queue: {
                        queued: [],
                        running: [{ id: 'r1' }],
                        stats: { queued: 0, running: 1, total: 1, isPaused: false, isDraining: false },
                    },
                });
            }, [dispatch]);
            return <>{children}</>;
        }
        render(
            <Wrap>
                <SeedQueue>
                    <RepoCard repo={repo} isSelected={false} onClick={() => {}} />
                </SeedQueue>
            </Wrap>
        );
        expect(document.querySelector('[data-testid="repo-card-queue-running"]')?.textContent).toBe('⏳1');
        expect(document.querySelector('[data-testid="repo-card-queue-queued"]')).toBeNull();
    });

    it('shows queue queued badge when queued > 0', () => {
        function SeedQueue({ children }: { children: ReactNode }) {
            const { dispatch } = useQueue();
            useEffect(() => {
                dispatch({
                    type: 'REPO_QUEUE_UPDATED',
                    repoId: 'ws-1',
                    queue: {
                        queued: [{ id: 'q1' }, { id: 'q2' }],
                        running: [],
                        stats: { queued: 2, running: 0, total: 2, isPaused: false, isDraining: false },
                    },
                });
            }, [dispatch]);
            return <>{children}</>;
        }
        render(
            <Wrap>
                <SeedQueue>
                    <RepoCard repo={repo} isSelected={false} onClick={() => {}} />
                </SeedQueue>
            </Wrap>
        );
        expect(document.querySelector('[data-testid="repo-card-queue-queued"]')?.textContent).toBe('⏸2');
        expect(document.querySelector('[data-testid="repo-card-queue-running"]')).toBeNull();
    });

    it('shows both running and queued badges when both > 0', () => {
        function SeedQueue({ children }: { children: ReactNode }) {
            const { dispatch } = useQueue();
            useEffect(() => {
                dispatch({
                    type: 'REPO_QUEUE_UPDATED',
                    repoId: 'ws-1',
                    queue: {
                        queued: [{ id: 'q1' }, { id: 'q2' }, { id: 'q3' }],
                        running: [{ id: 'r1' }, { id: 'r2' }],
                        stats: { queued: 3, running: 2, total: 5, isPaused: false, isDraining: false },
                    },
                });
            }, [dispatch]);
            return <>{children}</>;
        }
        render(
            <Wrap>
                <SeedQueue>
                    <RepoCard repo={repo} isSelected={false} onClick={() => {}} />
                </SeedQueue>
            </Wrap>
        );
        expect(document.querySelector('[data-testid="repo-card-queue-running"]')?.textContent).toBe('⏳2');
        expect(document.querySelector('[data-testid="repo-card-queue-queued"]')?.textContent).toBe('⏸3');
    });

    it('shows loading skeleton when gitInfoLoading is true', () => {
        const loadingRepo = makeRepo({
            workspace: { id: 'ws-loading', name: 'Loading Repo', rootPath: '/path' },
            gitInfoLoading: true,
            gitInfo: undefined,
        });
        render(<Wrap><RepoCard repo={loadingRepo} isSelected={false} onClick={() => {}} /></Wrap>);
        expect(document.querySelector('[data-testid="git-info-loading"]')).not.toBeNull();
        // Branch badge should NOT be visible while loading
        expect(screen.queryByText('main')).toBeNull();
    });

    it('hides loading skeleton and shows branch badge when gitInfoLoading is false', () => {
        const loadedRepo = makeRepo({
            workspace: { id: 'ws-loaded', name: 'Loaded Repo', rootPath: '/path' },
            gitInfoLoading: false,
            gitInfo: { branch: 'feature', dirty: false, isGitRepo: true },
        });
        render(<Wrap><RepoCard repo={loadedRepo} isSelected={false} onClick={() => {}} /></Wrap>);
        expect(document.querySelector('[data-testid="git-info-loading"]')).toBeNull();
        expect(screen.getByText('feature')).toBeDefined();
    });

    it('hides loading skeleton when gitInfoLoading is undefined (default)', () => {
        render(<Wrap><RepoCard repo={repo} isSelected={false} onClick={() => {}} /></Wrap>);
        expect(document.querySelector('[data-testid="git-info-loading"]')).toBeNull();
        expect(screen.getByText('main')).toBeDefined();
    });
});

describe('ReposGrid', () => {
    it('shows empty state when no repos', () => {
        render(<Wrap><ReposGrid repos={[]} onRefresh={() => {}} /></Wrap>);
        // With SHOW_WELCOME_TUTORIAL=true, the FirstStepsCard replaces the plain empty text
        expect(screen.getByTestId('first-steps-card')).toBeDefined();
    });

    it('renders add button', () => {
        render(<Wrap><ReposGrid repos={[]} onRefresh={() => {}} /></Wrap>);
        expect(screen.getByTestId('add-repo-btn')).toBeDefined();
    });

    it('opens clone dialog from the repositories add menu', async () => {
        render(<Wrap><ReposGrid repos={[]} onRefresh={() => {}} /></Wrap>);
        fireEvent.click(screen.getByTestId('add-repo-btn'));
        fireEvent.click(screen.getByTestId('clone-repository-item'));
        expect(await screen.findByText('Clone Repository')).toBeDefined();
    });

    it('renders repo cards', () => {
        const repos = [makeRepo({ workspace: { id: 'ws-1', name: 'Test Repo', rootPath: '/test' } })];
        render(<Wrap><ReposGrid repos={repos} onRefresh={() => {}} /></Wrap>);
        expect(screen.getByText('Test Repo')).toBeDefined();
    });

    it('renders group header for grouped repos', () => {
        const repos = [
            makeRepo({ workspace: { id: 'ws-1', name: 'Clone A', remoteUrl: 'https://github.com/org/repo.git' } }),
            makeRepo({ workspace: { id: 'ws-2', name: 'Clone B', remoteUrl: 'https://github.com/org/repo.git' } }),
        ];
        render(<Wrap><ReposGrid repos={repos} onRefresh={() => {}} /></Wrap>);
        expect(screen.getByText('org/repo')).toBeDefined();
        expect(screen.getByText('2')).toBeDefined(); // badge count
    });

    it('renders footer stats', () => {
        const repos = [makeRepo({ workspace: { id: 'ws-1', name: 'Repo', rootPath: '/r' }, stats: { success: 3, failed: 0, running: 1 } })];
        render(<Wrap><ReposGrid repos={repos} onRefresh={() => {}} /></Wrap>);
        expect(screen.getByText(/1 repo/)).toBeDefined();
    });

    it('collapses group on click and expands it back on second click', () => {
        const repos = [
            makeRepo({ workspace: { id: 'ws-1', name: 'Clone A', remoteUrl: 'https://github.com/org/repo.git' } }),
            makeRepo({ workspace: { id: 'ws-2', name: 'Clone B', remoteUrl: 'https://github.com/org/repo.git' } }),
        ];
        render(<Wrap><ReposGrid repos={repos} onRefresh={() => {}} /></Wrap>);

        // Initially expanded — both repo cards visible
        expect(screen.getByText('Clone A')).toBeDefined();
        expect(screen.getByText('Clone B')).toBeDefined();

        // Click group header to collapse
        fireEvent.click(screen.getByText('org/repo'));
        expect(screen.queryByText('Clone A')).toBeNull();
        expect(screen.queryByText('Clone B')).toBeNull();

        // Click again to expand — this is the bug regression test
        fireEvent.click(screen.getByText('org/repo'));
        expect(screen.getByText('Clone A')).toBeDefined();
        expect(screen.getByText('Clone B')).toBeDefined();
    });

    it('toggles group indicator between expanded and collapsed', () => {
        const repos = [
            makeRepo({ workspace: { id: 'ws-1', name: 'Clone A', remoteUrl: 'https://github.com/org/repo.git' } }),
            makeRepo({ workspace: { id: 'ws-2', name: 'Clone B', remoteUrl: 'https://github.com/org/repo.git' } }),
        ];
        render(<Wrap><ReposGrid repos={repos} onRefresh={() => {}} /></Wrap>);

        // Initially shows expanded indicator
        expect(screen.getByText('▾')).toBeDefined();

        // Collapse
        fireEvent.click(screen.getByText('org/repo'));
        expect(screen.getByText('▸')).toBeDefined();

        // Expand again
        fireEvent.click(screen.getByText('org/repo'));
        expect(screen.getByText('▾')).toBeDefined();
    });
});

describe('AddRepoDialog', () => {
    beforeEach(() => {
        repositoryServiceMocks.registerWorkspace.mockResolvedValue({});
        repositoryServiceMocks.updateWorkspace.mockResolvedValue({ workspace: {} });
        repositoryServiceMocks.browseWorkspaceFolders.mockResolvedValue({
            path: '',
            parent: null,
            entries: [],
        });
    });

    it('renders add mode title', () => {
        render(<Wrap><AddRepoDialog open onClose={() => {}} repos={[]} onSuccess={() => {}} /></Wrap>);
        expect(screen.getByText('Add Repository')).toBeDefined();
    });

    it('renders edit mode title', () => {
        const repos = [makeRepo({ workspace: { id: 'ws-1', name: 'R', rootPath: '/r', color: '#0078d4' } })];
        render(<Wrap><AddRepoDialog open onClose={() => {}} editId="ws-1" repos={repos} onSuccess={() => {}} /></Wrap>);
        expect(screen.getByText('Edit Repository')).toBeDefined();
    });

    it('shows validation on empty path submit', async () => {
        render(<Wrap><AddRepoDialog open onClose={() => {}} repos={[]} onSuccess={() => {}} /></Wrap>);
        fireEvent.click(screen.getByText('Add Repo'));
        expect(screen.getByText('Path is required')).toBeDefined();
    });

    it('renders color swatches', () => {
        render(<Wrap><AddRepoDialog open onClose={() => {}} repos={[]} onSuccess={() => {}} /></Wrap>);
        // 7 color swatches
        const buttons = document.querySelectorAll('button[title]');
        const colorButtons = Array.from(buttons).filter(b => b.getAttribute('title') && b.getAttribute('title') !== '');
        expect(colorButtons.length).toBeGreaterThanOrEqual(7);
    });

    it('renders browse button in add mode', () => {
        render(<Wrap><AddRepoDialog open onClose={() => {}} repos={[]} onSuccess={() => {}} /></Wrap>);
        expect(screen.getByText('Browse')).toBeDefined();
    });

    it('does not render browse button in edit mode', () => {
        const repos = [makeRepo({ workspace: { id: 'ws-1', name: 'R', rootPath: '/r', color: '#0078d4' } })];
        render(<Wrap><AddRepoDialog open onClose={() => {}} editId="ws-1" repos={repos} onSuccess={() => {}} /></Wrap>);
        expect(screen.queryByText('Browse')).toBeNull();
    });

    it('auto-detects name from Windows-style path when alias is empty', async () => {
        render(<Wrap><AddRepoDialog open onClose={() => {}} repos={[]} onSuccess={() => {}} /></Wrap>);
        fireEvent.change(screen.getByTestId('repo-path'), { target: { value: 'D:\\projects\\my-repo' } });
        fireEvent.click(screen.getByText('Add Repo'));

        await waitFor(() => expect(repositoryServiceMocks.registerWorkspace).toHaveBeenCalledTimes(1));
        const requestBody = repositoryServiceMocks.registerWorkspace.mock.calls[0][0];
        expect(requestBody.name).toBe('my-repo');
    });

    it('joins Windows paths correctly when navigating browser entries', async () => {
        repositoryServiceMocks.browseWorkspaceFolders
            .mockResolvedValueOnce({
                path: 'D:\\projects',
                parent: 'D:\\',
                entries: [{ name: 'my-repo', isGitRepo: true }],
                drives: ['C:\\', 'D:\\'],
            })
            .mockResolvedValueOnce({
                path: 'D:\\projects\\my-repo',
                parent: 'D:\\projects',
                entries: [],
                drives: ['C:\\', 'D:\\'],
            });

        render(<Wrap><AddRepoDialog open onClose={() => {}} repos={[]} onSuccess={() => {}} /></Wrap>);
        fireEvent.change(screen.getByTestId('repo-path'), { target: { value: 'D:\\projects' } });
        fireEvent.click(screen.getByTestId('browse-btn'));

        await screen.findByRole('button', { name: 'D:\\' });
        const entry = await screen.findByTestId('path-browser-entry');
        fireEvent.click(entry);

        await waitFor(() => expect(repositoryServiceMocks.browseWorkspaceFolders).toHaveBeenCalledTimes(2));
        expect(repositoryServiceMocks.browseWorkspaceFolders).toHaveBeenNthCalledWith(2, 'D:\\projects\\my-repo');
    });

    it('renders browse roots and navigates to WSL home from the browser', async () => {
        const wslHome = String.raw`\\wsl$\Ubuntu-24.04\home\georgeqiao`;
        repositoryServiceMocks.browseWorkspaceFolders
            .mockResolvedValueOnce({
                path: 'C:\\Users\\georgeqiao',
                parent: 'C:\\Users',
                entries: [],
                drives: ['C:\\', 'Q:\\'],
                browseRoots: [
                    { label: 'WSL Home (Ubuntu-24.04)', path: wslHome },
                    { label: 'C:\\', path: 'C:\\' },
                    { label: 'Q:\\', path: 'Q:\\' },
                ],
            })
            .mockResolvedValueOnce({
                path: wslHome,
                parent: String.raw`\\wsl$\Ubuntu-24.04\home`,
                entries: [{ name: 'Storage-BOSS', isGitRepo: true }],
                drives: ['C:\\', 'Q:\\'],
                browseRoots: [
                    { label: 'WSL Home (Ubuntu-24.04)', path: wslHome },
                    { label: 'C:\\', path: 'C:\\' },
                    { label: 'Q:\\', path: 'Q:\\' },
                ],
            });

        render(<Wrap><AddRepoDialog open onClose={() => {}} repos={[]} onSuccess={() => {}} /></Wrap>);
        fireEvent.click(screen.getByTestId('browse-btn'));

        const wslButton = await screen.findByRole('button', { name: 'WSL Home (Ubuntu-24.04)' });
        fireEvent.click(wslButton);

        await waitFor(() => expect(repositoryServiceMocks.browseWorkspaceFolders).toHaveBeenCalledTimes(2));
        expect(repositoryServiceMocks.browseWorkspaceFolders).toHaveBeenNthCalledWith(2, wslHome);
    });
});

describe('RepoInfoTab', () => {
    beforeEach(() => {
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ processes: [] }),
        });
    });

    it('renders metadata labels', () => {
        const repo = makeRepo({
            workspace: { id: 'ws-1', name: 'Test', rootPath: '/test/path' },
            gitInfo: { branch: 'develop', dirty: true, isGitRepo: true, ahead: 2, behind: 1 },
        });
        render(<Wrap><RepoInfoTab repo={repo} /></Wrap>);
        expect(screen.getByText('Path')).toBeDefined();
        expect(screen.getByText('Branch')).toBeDefined();
        expect(screen.getByText('Sync')).toBeDefined();
    });

    it('shows dirty indicator', () => {
        const repo = makeRepo({
            workspace: { id: 'ws-1', name: 'Test', rootPath: '/test' },
            gitInfo: { branch: 'main', dirty: true, isGitRepo: true },
        });
        render(<Wrap><RepoInfoTab repo={repo} /></Wrap>);
        expect(screen.getByText('main (dirty)')).toBeDefined();
    });

    it('shows synced when ahead and behind are 0', () => {
        const repo = makeRepo({
            workspace: { id: 'ws-1', name: 'Test', rootPath: '/test' },
            gitInfo: { branch: 'main', dirty: false, isGitRepo: true, ahead: 0, behind: 0 },
        });
        render(<Wrap><RepoInfoTab repo={repo} /></Wrap>);
        expect(screen.getByText('synced')).toBeDefined();
    });

    it('shows Recent Processes heading', () => {
        const repo = makeRepo({ workspace: { id: 'ws-1', name: 'Test', rootPath: '/test' } });
        render(<Wrap><RepoInfoTab repo={repo} /></Wrap>);
        expect(screen.getByText('Recent Processes')).toBeDefined();
    });
});

describe('TemplatesTab', () => {
    it('shows empty state when no pipelines', () => {
        const repo = makeRepo({ workspace: { id: 'ws-1', name: 'Test', rootPath: '/test' }, workflows: [] });
        render(<Wrap><TemplatesTab repo={repo} /></Wrap>);
        expect(screen.getByText('No workflows found')).toBeDefined();
    });

    it('lists pipelines', () => {
        const repo = makeRepo({
            workspace: { id: 'ws-1', name: 'Test', rootPath: '/test' },
            workflows: [{ name: 'build', path: 'build.yaml' }, { name: 'deploy', path: 'deploy.yaml' }],
        });
        render(<Wrap><TemplatesTab repo={repo} /></Wrap>);
        expect(screen.getByText(/build/)).toBeDefined();
        expect(screen.getByText(/deploy/)).toBeDefined();
    });
});

describe('TasksPanel', () => {
    beforeEach(() => {
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({
                name: 'root',
                relativePath: '',
                children: [],
                documentGroups: [],
                singleDocuments: [],
            }),
        });
    });

    it('renders loading state initially', () => {
        render(<Wrap><TasksPanel wsId="ws-1" /></Wrap>);
        expect(screen.getByText('Loading tasks…')).toBeDefined();
    });
});

describe('RepoDetail', () => {
    beforeEach(() => {
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ processes: [] }),
        });
    });

    it('renders header with repo name', () => {
        const repo = makeRepo({
            workspace: { id: 'ws-1', name: 'My Project', rootPath: '/project', color: '#107c10' },
        });
        render(<Wrap><RepoDetail repo={repo} repos={[repo]} onRefresh={() => {}} /></Wrap>);
        expect(screen.getByText('My Project')).toBeDefined();
    });

    it('renders sub-tab bar with all tabs', () => {
        const repo = makeRepo({
            workspace: { id: 'ws-1', name: 'Test', rootPath: '/test' },
        });
        render(<Wrap><RepoDetail repo={repo} repos={[repo]} onRefresh={() => {}} /></Wrap>);
        const buttons = document.querySelectorAll('button');
        const tabLabels = Array.from(buttons).map(b => b.textContent?.trim());
        expect(tabLabels).toContain('Settings');
        expect(tabLabels).toContain('Workflows');
        expect(tabLabels).toContain('Activity');
    });

    it('does not render Edit and Remove buttons (removed from header)', () => {
        const repo = makeRepo({
            workspace: { id: 'ws-1', name: 'Test', rootPath: '/test' },
        });
        render(<Wrap><RepoDetail repo={repo} repos={[repo]} onRefresh={() => {}} /></Wrap>);
        expect(screen.queryByText('Edit')).toBeNull();
        expect(screen.queryByText('Remove')).toBeNull();
    });

    it('shows task count badge when tasks exist', () => {
        // Tasks tab is only visible in dev-workflow layout mode
        mockUiLayoutModeValue = 'dev-workflow';
        const repo = makeRepo({
            workspace: { id: 'ws-1', name: 'Test', rootPath: '/test' },
            taskCount: 5,
        });
        try {
            render(<Wrap><RepoDetail repo={repo} repos={[repo]} onRefresh={() => {}} /></Wrap>);
            // The badge with task count is the bg-[#0078d4] rounded-full span
            const badges = document.querySelectorAll('span.rounded-full');
            const taskBadge = Array.from(badges).find(b => b.textContent === '5');
            expect(taskBadge).not.toBeUndefined();
        } finally {
            mockUiLayoutModeValue = 'classic';
        }
    });

    it('shows no activity badge when queue is empty', () => {
        const repo = makeRepo({
            workspace: { id: 'ws-1', name: 'Test', rootPath: '/test' },
        });
        render(<Wrap><RepoDetail repo={repo} repos={[repo]} onRefresh={() => {}} /></Wrap>);
        const activityBtn = document.querySelector('button[data-subtab="activity"]');
        const badges = activityBtn?.querySelectorAll('span.rounded-full') || [];
        expect(badges.length).toBe(0);
    });

    it('shows separate running and queued badges on activity tab', async () => {
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({
                running: [{ id: 'r1' }],
                queued: [{ id: 'q1' }, { id: 'q2' }],
                stats: {},
            }),
        });
        const repo = makeRepo({
            workspace: { id: 'ws-q', name: 'QueueTest', rootPath: '/qtest' },
        });
        render(<Wrap><RepoDetail repo={repo} repos={[repo]} onRefresh={() => {}} /></Wrap>);
        await vi.waitFor(() => {
            const activityBtn = document.querySelector('button[data-subtab="activity"]');
            const badges = activityBtn?.querySelectorAll('span.rounded-full') || [];
            expect(badges.length).toBe(2);
            const runningBadge = activityBtn?.querySelector('[data-testid="activity-running-badge"]');
            const queuedBadge = activityBtn?.querySelector('[data-testid="activity-queued-badge"]');
            expect(runningBadge?.textContent).toBe('1');
            expect(queuedBadge?.textContent).toBe('2');
        });
    });

    it('shows only running badge when no queued items', async () => {
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({
                running: [{ id: 'r1' }],
                queued: [],
                stats: {},
            }),
        });
        const repo = makeRepo({
            workspace: { id: 'ws-r', name: 'RunOnly', rootPath: '/ronly' },
        });
        render(<Wrap><RepoDetail repo={repo} repos={[repo]} onRefresh={() => {}} /></Wrap>);
        await vi.waitFor(() => {
            const activityBtn = document.querySelector('button[data-subtab="activity"]');
            const runningBadge = activityBtn?.querySelector('[data-testid="activity-running-badge"]');
            const queuedBadge = activityBtn?.querySelector('[data-testid="activity-queued-badge"]');
            expect(runningBadge?.textContent).toBe('1');
            expect(queuedBadge).toBeNull();
        });
    });

    it('shows only queued badge when nothing running', async () => {
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({
                running: [],
                queued: [{ id: 'q1' }, { id: 'q2' }, { id: 'q3' }, { id: 'q4' }],
                stats: {},
            }),
        });
        const repo = makeRepo({
            workspace: { id: 'ws-qo', name: 'QueuedOnly', rootPath: '/qonly' },
        });
        render(<Wrap><RepoDetail repo={repo} repos={[repo]} onRefresh={() => {}} /></Wrap>);
        await vi.waitFor(() => {
            const activityBtn = document.querySelector('button[data-subtab="activity"]');
            const runningBadge = activityBtn?.querySelector('[data-testid="activity-running-badge"]');
            const queuedBadge = activityBtn?.querySelector('[data-testid="activity-queued-badge"]');
            expect(runningBadge).toBeNull();
            expect(queuedBadge?.textContent).toBe('4');
        });
    });
});

describe('ReposView', () => {
    beforeEach(() => {
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ workspaces: [] }),
        });
    });

    it('renders the view container', () => {
        render(<Wrap><ReposView /></Wrap>);
        const view = document.getElementById('view-repos');
        expect(view).not.toBeNull();
    });

    it('shows empty detail pane prompt on desktop (no sidebar)', async () => {
        render(<Wrap><ReposView /></Wrap>);
        await vi.waitFor(() => {
            expect(screen.getByText(/Select a repository/)).toBeDefined();
        });
        // No sidebar in new layout
        expect(screen.queryByTestId('repos-sidebar')).toBeNull();
        expect(screen.queryByTestId('mini-repos-sidebar')).toBeNull();
    });

    it('shows empty detail pane prompt when collapsed state is set (sidebar is still gone)', async () => {
        render(
            <Wrap>
                <CollapseReposSidebarOnMount />
                <ReposView />
            </Wrap>
        );
        await vi.waitFor(() => {
            expect(screen.getByText(/Select a repository/)).toBeDefined();
        });
        // Still no sidebar after toggle
        expect(screen.queryByTestId('repos-sidebar')).toBeNull();
    });
});

// ============================================================================
// ReposContext source-level tests: throttled process events & stable fetchRepos
// ============================================================================

describe('ReposContext — process event throttling', () => {
    let source: string;

    beforeEach(() => {
        const fs = require('fs');
        const path = require('path');
        source = fs.readFileSync(
            path.join(__dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'contexts', 'ReposContext.tsx'),
            'utf-8',
        );
    });

    it('uses a ref to throttle process events instead of calling fetchRepos directly', () => {
        expect(source).toContain('processThrottleRef');
        // Should NOT call fetchRepos() directly in the process-event handler
        const onMessageBlock = source.substring(
            source.indexOf('onMessage: useCallback'),
            source.indexOf('], [refreshPipelinesForWorkspace, refreshGitInfoForWorkspace, fetchRepos])'),
        );
        // The old pattern was a bare fetchRepos() call; now it should be inside setTimeout
        const processBlock = onMessageBlock.substring(onMessageBlock.indexOf('process-added'));
        expect(processBlock).toContain('setTimeout');
        expect(processBlock).toContain('processThrottleRef');
    });

    it('throttles to 10 seconds between fetchRepos calls', () => {
        expect(source).toContain('10_000');
    });

    it('clears the throttle timer on unmount', () => {
        expect(source).toContain('clearTimeout(processThrottleRef.current)');
    });

    it('uses a ref for selectedRepoId to avoid recreating fetchRepos', () => {
        expect(source).toContain('selectedRepoIdRef');
        expect(source).toContain('selectedRepoIdRef.current = appState.selectedRepoId');
        // Inside fetchRepos body, selectedRepoIdRef.current should be used instead of state.selectedRepoId
        const fetchReposStart = source.indexOf('const fetchRepos = useCallback');
        const fetchReposEnd = source.indexOf('}, [dispatch, refreshUnseenCounts, seedRepoQueueStats]);', fetchReposStart);
        const fetchReposBody = source.substring(fetchReposStart, fetchReposEnd + 15);
        expect(fetchReposBody).toContain('selectedRepoIdRef.current');
        // fetchRepos dependency array should NOT include state.selectedRepoId
        expect(fetchReposBody).not.toContain(', state.selectedRepoId');
    });

    it('fetchRepos useCallback does not depend on selectedRepoId', () => {
        // Verify no selectedRepoId in the dependency
        const depsMatch = source.match(/const fetchRepos = useCallback\(async[\s\S]*?\}, \[([^\]]*)\]\)/);
        expect(depsMatch).not.toBeNull();
        expect(depsMatch![1]).toContain('dispatch');
        expect(depsMatch![1]).not.toContain('selectedRepoId');
    });
});

// ============================================================================
// ReposContext source-level tests: async git-info two-phase fetch
// ============================================================================

describe('ReposContext — async git-info', () => {
    let source: string;

    beforeEach(() => {
        const fs = require('fs');
        const path = require('path');
        source = fs.readFileSync(
            path.join(__dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'contexts', 'ReposContext.tsx'),
            'utf-8',
        );
    });

    it('calls setLoading(false) and setRepos before git-info fetches (phase 1 renders first)', () => {
        const fetchReposStart = source.indexOf('const fetchRepos = useCallback');
        const fetchReposEnd = source.indexOf('}, [dispatch, refreshUnseenCounts, seedRepoQueueStats]);', fetchReposStart);
        const fetchReposBody = source.substring(fetchReposStart, fetchReposEnd);
        // setRepos and setLoading(false) should appear before the phase-2 git-info loop.
        // `combined` = local enriched repos plus any merged remote-server repos.
        const setReposIdx = fetchReposBody.indexOf('setRepos(combined)');
        const setLoadingIdx = fetchReposBody.indexOf('setLoading(false)');
        const phase2Idx = fetchReposBody.indexOf('Phase 2');
        expect(setReposIdx).toBeGreaterThan(-1);
        expect(setLoadingIdx).toBeGreaterThan(-1);
        expect(phase2Idx).toBeGreaterThan(-1);
        expect(setReposIdx).toBeLessThan(phase2Idx);
        expect(setLoadingIdx).toBeLessThan(phase2Idx);
    });

    it('sets gitInfoLoading: true on each repo in phase 1', () => {
        expect(source).toContain('gitInfoLoading: true');
    });

    it('updates each repo with gitInfoLoading: false after git-info arrives', () => {
        expect(source).toContain('gitInfoLoading: false');
        // The per-repo update should use setRepos with a mapping function
        expect(source).toContain('setRepos(prev => prev.map(r =>');
    });

    it('does not include git-info in the initial parallel fetch (phase 1)', () => {
        const fetchReposStart = source.indexOf('const fetchRepos = useCallback');
        const phase2Idx = source.indexOf('Phase 2', fetchReposStart);
        const phase1Body = source.substring(fetchReposStart, phase2Idx);
        // git-info endpoint should NOT appear in phase 1
        expect(phase1Body).not.toContain('/git-info');
    });

    it('fetches git-info via batch endpoint in phase 2', () => {
        const phase2Idx = source.indexOf('Phase 2');
        expect(phase2Idx).toBeGreaterThan(-1);
        // Window widened to 2500 so container-mode branching (added in
        // a0bc2fb40) doesn't push the non-container batch call out of range.
        const phase2Body = source.substring(phase2Idx, phase2Idx + 2500);
        expect(phase2Body).toContain('getWorkspaceGitInfoBatch');
    });

    it('uses AbortController for batch git-info requests', () => {
        expect(source).toContain('gitInfoAbortRef');
        expect(source).toContain('new AbortController()');
        expect(source).toContain('getWorkspaceGitInfoBatch(wsIds, abortController.signal)');
    });

    it('handles git-changed WebSocket events', () => {
        expect(source).toContain("msg.type === 'git-changed'");
        expect(source).toContain('refreshGitInfoForWorkspace');
    });

    it('has a targeted refreshGitInfoForWorkspace callback', () => {
        expect(source).toContain('refreshGitInfoForWorkspace');
        // Should use the per-workspace git-info endpoint for targeted refresh
        expect(source).toContain('getWorkspaceGitInfo(wsId)');
    });
});

// ============================================================================
// RepoDetail source-level tests: ExplorerPanel keep-mounted
// ============================================================================

describe('RepoDetail — ExplorerPanel keep-mounted', () => {
    let source: string;

    beforeEach(() => {
        const fs = require('fs');
        const path = require('path');
        source = fs.readFileSync(
            path.join(__dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'features', 'repo-detail', 'RepoDetail.tsx'),
            'utf-8',
        );
    });

    it('wraps ExplorerPanel in display:none div instead of conditional &&', () => {
        // Must NOT use short-circuit conditional rendering
        expect(source).not.toContain("activeSubTab === 'explorer' && <ExplorerPanel");
        // Must use CSS display:none pattern
        expect(source).toContain("activeSubTab === 'explorer' ? undefined : 'none'");
    });

    it('retains key={ws.id} on ExplorerPanel so repo switches still force remount', () => {
        const explorerIdx = source.indexOf('<ExplorerPanel');
        expect(explorerIdx).toBeGreaterThan(-1);
        const explorerBlock = source.substring(explorerIdx, explorerIdx + 120);
        expect(explorerBlock).toContain('key={ws.id}');
    });
});
