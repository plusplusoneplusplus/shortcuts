/**
 * Tests for Repos React components: utility functions and component rendering.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useEffect, type ReactNode } from 'react';
import { AppProvider, useApp } from '../../../src/server/spa/client/react/context/AppContext';
import { QueueProvider } from '../../../src/server/spa/client/react/context/QueueContext';
import { ToastProvider } from '../../../src/server/spa/client/react/context/ToastContext';
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
import { RepoInfoTab } from '../../../src/server/spa/client/react/repos/RepoInfoTab';
import { PipelinesTab } from '../../../src/server/spa/client/react/repos/PipelinesTab';
import { TasksPanel } from '../../../src/server/spa/client/react/tasks/TasksPanel';
import { AddRepoDialog } from '../../../src/server/spa/client/react/repos/AddRepoDialog';
import { ReposGrid } from '../../../src/server/spa/client/react/repos/ReposGrid';
import { RepoDetail } from '../../../src/server/spa/client/react/repos/RepoDetail';

function Wrap({ children }: { children: ReactNode }) {
    return (
        <AppProvider>
            <QueueProvider>
                <ToastProvider value={{ addToast: vi.fn(), removeToast: vi.fn(), toasts: [] }}>
                    {children}
                </ToastProvider>
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
        pipelines: [],
        stats: { success: 0, failed: 0, running: 0 },
        taskCount: 0,
        ...overrides,
    };
}

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
        pipelines: [{ name: 'test', path: 'test.yaml' }],
        stats: { success: 5, failed: 1, running: 2 },
        taskCount: 3,
    });

    it('renders repo name', () => {
        render(<Wrap><RepoCard repo={repo} isSelected={false} onClick={() => {}} /></Wrap>);
        expect(screen.getByText('My Repo')).toBeDefined();
    });

    it('shows pipeline count', () => {
        render(<Wrap><RepoCard repo={repo} isSelected={false} onClick={() => {}} /></Wrap>);
        expect(screen.getByText('Pipelines: 1')).toBeDefined();
    });

    it('shows task count in stats', () => {
        render(<Wrap><RepoCard repo={repo} isSelected={false} onClick={() => {}} /></Wrap>);
        expect(screen.getByText(/3 tasks/)).toBeDefined();
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
});

describe('ReposGrid', () => {
    it('shows empty state when no repos', () => {
        render(<Wrap><ReposGrid repos={[]} onRefresh={() => {}} /></Wrap>);
        expect(screen.getByText(/No repositories registered/)).toBeDefined();
    });

    it('renders add button', () => {
        render(<Wrap><ReposGrid repos={[]} onRefresh={() => {}} /></Wrap>);
        expect(screen.getByText('+ Add')).toBeDefined();
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
});

describe('AddRepoDialog', () => {
    beforeEach(() => {
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({}),
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

describe('PipelinesTab', () => {
    it('shows empty state when no pipelines', () => {
        const repo = makeRepo({ workspace: { id: 'ws-1', name: 'Test', rootPath: '/test' }, pipelines: [] });
        render(<Wrap><PipelinesTab repo={repo} /></Wrap>);
        expect(screen.getByText('No pipelines found')).toBeDefined();
    });

    it('lists pipelines', () => {
        const repo = makeRepo({
            workspace: { id: 'ws-1', name: 'Test', rootPath: '/test' },
            pipelines: [{ name: 'build', path: 'build.yaml' }, { name: 'deploy', path: 'deploy.yaml' }],
        });
        render(<Wrap><PipelinesTab repo={repo} /></Wrap>);
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
        // Sub-tab buttons are present
        const buttons = document.querySelectorAll('button');
        const tabLabels = Array.from(buttons).map(b => b.textContent?.trim());
        expect(tabLabels).toContain('Info');
        expect(tabLabels).toContain('Pipelines');
        expect(tabLabels).toContain('Queue');
    });

    it('renders Edit and Remove buttons', () => {
        const repo = makeRepo({
            workspace: { id: 'ws-1', name: 'Test', rootPath: '/test' },
        });
        render(<Wrap><RepoDetail repo={repo} repos={[repo]} onRefresh={() => {}} /></Wrap>);
        expect(screen.getByText('Edit')).toBeDefined();
        expect(screen.getByText('Remove')).toBeDefined();
    });

    it('shows task count badge when tasks exist', () => {
        const repo = makeRepo({
            workspace: { id: 'ws-1', name: 'Test', rootPath: '/test' },
            taskCount: 5,
        });
        render(<Wrap><RepoDetail repo={repo} repos={[repo]} onRefresh={() => {}} /></Wrap>);
        // The badge with task count is the bg-[#0078d4] rounded-full span
        const badges = document.querySelectorAll('span.rounded-full');
        const taskBadge = Array.from(badges).find(b => b.textContent === '5');
        expect(taskBadge).not.toBeUndefined();
    });
});

describe('ReposView', () => {
    beforeEach(() => {
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ workspaces: [] }),
        });
    });

    it('renders the two-pane layout', () => {
        render(<Wrap><ReposView /></Wrap>);
        const view = document.getElementById('view-repos');
        expect(view).not.toBeNull();
    });

    it('keeps sidebar width classes when expanded', async () => {
        render(<Wrap><ReposView /></Wrap>);
        await vi.waitFor(() => {
            expect(screen.getByText(/Select a repository/)).toBeDefined();
        });
        const sidebar = screen.getByTestId('repos-sidebar');
        expect(sidebar.className).toContain('w-[280px]');
        expect(sidebar.className).toContain('min-w-[240px]');
        expect(sidebar.className).not.toContain('w-0');
    });

    it('collapses sidebar width when app state is collapsed', async () => {
        render(
            <Wrap>
                <CollapseReposSidebarOnMount />
                <ReposView />
            </Wrap>
        );
        await vi.waitFor(() => {
            expect(screen.getByText(/Select a repository/)).toBeDefined();
        });
        const sidebar = screen.getByTestId('repos-sidebar');
        expect(sidebar.className).toContain('w-0');
        expect(sidebar.className).toContain('min-w-0');
        expect(sidebar.className).toContain('border-r-0');
    });

    it('shows empty detail pane prompt', async () => {
        render(<Wrap><ReposView /></Wrap>);
        // Wait for loading to finish
        await vi.waitFor(() => {
            expect(screen.getByText(/Select a repository/)).toBeDefined();
        });
    });
});
