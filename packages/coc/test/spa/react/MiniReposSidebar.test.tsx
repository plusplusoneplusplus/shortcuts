/**
 * Tests for MiniReposSidebar — the collapsed sidebar rail.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { useEffect, type ReactNode } from 'react';
import { AppProvider, useApp } from '../../../src/server/spa/client/react/context/AppContext';
import { QueueProvider } from '../../../src/server/spa/client/react/context/QueueContext';
import { ToastProvider } from '../../../src/server/spa/client/react/context/ToastContext';
import { MiniReposSidebar, disambiguateLabels } from '../../../src/server/spa/client/react/repos/MiniReposSidebar';
import { ReposView } from '../../../src/server/spa/client/react/repos/ReposView';
import type { RepoData } from '../../../src/server/spa/client/react/repos/repoGrouping';

// Mock ReposContext so ReposView renders without making real API calls
vi.mock('../../../src/server/spa/client/react/context/ReposContext', () => ({
    useRepos: () => ({ repos: [], loading: false, fetchRepos: vi.fn(), unseenCounts: {} }),
    ReposProvider: ({ children }: { children: React.ReactNode }) => children,
}));

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

function CollapseOnMount() {
    const { dispatch } = useApp();
    useEffect(() => {
        dispatch({ type: 'TOGGLE_REPOS_SIDEBAR' });
    }, [dispatch]);
    return null;
}

function SelectRepoOnMount({ id }: { id: string }) {
    const { dispatch } = useApp();
    useEffect(() => {
        dispatch({ type: 'SET_SELECTED_REPO', id });
    }, [dispatch, id]);
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
// disambiguateLabels — pure function tests
// ============================================================================

describe('disambiguateLabels', () => {
    it('returns single first letter when no collisions', () => {
        const repos = [
            makeRepo({ workspace: { id: 'a', name: 'Alpha' } }),
            makeRepo({ workspace: { id: 'b', name: 'Beta' } }),
        ];
        const labels = disambiguateLabels(repos);
        expect(labels.get('a')).toBe('A');
        expect(labels.get('b')).toBe('B');
    });

    it('returns two characters when first letters collide', () => {
        const repos = [
            makeRepo({ workspace: { id: 'a', name: 'Shortcuts' } }),
            makeRepo({ workspace: { id: 'b', name: 'SnakeGame' } }),
        ];
        const labels = disambiguateLabels(repos);
        expect(labels.get('a')).toBe('SH');
        expect(labels.get('b')).toBe('SN');
    });

    it('handles empty name gracefully', () => {
        const repos = [
            makeRepo({ workspace: { id: 'a', name: '' } }),
        ];
        const labels = disambiguateLabels(repos);
        expect(labels.get('a')).toBe('?');
    });

    it('handles single-character name', () => {
        const repos = [
            makeRepo({ workspace: { id: 'a', name: 'A' } }),
        ];
        const labels = disambiguateLabels(repos);
        expect(labels.get('a')).toBe('A');
    });

    it('single-char names that collide stay as single char', () => {
        const repos = [
            makeRepo({ workspace: { id: 'a', name: 'S' } }),
            makeRepo({ workspace: { id: 'b', name: 'S' } }),
        ];
        const labels = disambiguateLabels(repos);
        // Can't disambiguate single-char names, stays as S
        expect(labels.get('a')).toBe('S');
        expect(labels.get('b')).toBe('S');
    });
});

// ============================================================================
// MiniReposSidebar component tests
// ============================================================================

describe('MiniReposSidebar', () => {
    beforeEach(() => {
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({}),
        });
    });

    it('renders navigation landmark', () => {
        render(<Wrap><MiniReposSidebar repos={[]} onRefresh={() => {}} /></Wrap>);
        const nav = screen.getByTestId('mini-repos-sidebar');
        expect(nav).toBeDefined();
        expect(nav.getAttribute('role')).toBe('navigation');
        expect(nav.getAttribute('aria-label')).toBe('Repository quick-switch');
    });

    it('shows add button', () => {
        render(<Wrap><MiniReposSidebar repos={[]} onRefresh={() => {}} /></Wrap>);
        expect(screen.getByTestId('mini-add-btn')).toBeDefined();
        expect(screen.getByLabelText('Add repository')).toBeDefined();
    });

    it('shows empty state when no repos', () => {
        render(<Wrap><MiniReposSidebar repos={[]} onRefresh={() => {}} /></Wrap>);
        expect(screen.getByTestId('mini-empty')).toBeDefined();
        expect(screen.getByText('No repos')).toBeDefined();
    });

    it('shows repo count in footer', () => {
        const repos = [
            makeRepo({ workspace: { id: 'a', name: 'Alpha', color: '#0078d4' } }),
            makeRepo({ workspace: { id: 'b', name: 'Beta', color: '#107c10' } }),
        ];
        render(<Wrap><MiniReposSidebar repos={repos} onRefresh={() => {}} /></Wrap>);
        expect(screen.getByText('2 repos')).toBeDefined();
    });

    it('shows singular footer for one repo', () => {
        const repos = [makeRepo({ workspace: { id: 'a', name: 'Alpha' } })];
        render(<Wrap><MiniReposSidebar repos={repos} onRefresh={() => {}} /></Wrap>);
        expect(screen.getByText('1 repo')).toBeDefined();
    });

    it('renders mini items with color dot and full name', () => {
        const repos = [
            makeRepo({ workspace: { id: 'a', name: 'Alpha', color: '#0078d4' } }),
        ];
        render(<Wrap><MiniReposSidebar repos={repos} onRefresh={() => {}} /></Wrap>);
        const items = screen.getAllByTestId('mini-repo-item');
        expect(items).toHaveLength(1);
        expect(items[0].getAttribute('aria-label')).toBe('Alpha (main)');
        expect(items[0].textContent).toContain('Alpha');
    });

    it('shows full name and branch in tooltip', () => {
        const repos = [
            makeRepo({
                workspace: { id: 'a', name: 'My Project' },
                gitInfo: { branch: 'develop', dirty: false, isGitRepo: true },
            }),
        ];
        render(<Wrap><MiniReposSidebar repos={repos} onRefresh={() => {}} /></Wrap>);
        const item = screen.getByTestId('mini-repo-item');
        expect(item.getAttribute('title')).toBe('My Project (develop)');
    });

    it('selects repo on click without expanding sidebar', () => {
        const repos = [
            makeRepo({ workspace: { id: 'ws-1', name: 'Alpha' } }),
        ];
        render(
            <Wrap>
                <MiniReposSidebar repos={repos} onRefresh={() => {}} />
            </Wrap>
        );
        fireEvent.click(screen.getByTestId('mini-repo-item'));
        // We can't directly check dispatch, but the hash should update
        expect(location.hash).toContain('repos/ws-1');
    });

    it('highlights selected repo with accent border', () => {
        const repos = [
            makeRepo({ workspace: { id: 'ws-1', name: 'Alpha' } }),
            makeRepo({ workspace: { id: 'ws-2', name: 'Beta' } }),
        ];
        render(
            <Wrap>
                <SelectRepoOnMount id="ws-1" />
                <MiniReposSidebar repos={repos} onRefresh={() => {}} />
            </Wrap>
        );
        const items = screen.getAllByTestId('mini-repo-item');
        expect(items[0].className).toContain('border-l-[#0078d4]');
        expect(items[1].className).not.toContain('border-l-[#0078d4]');
    });

    it('opens AddRepoDialog when + button is clicked', () => {
        render(<Wrap><MiniReposSidebar repos={[]} onRefresh={() => {}} /></Wrap>);
        fireEvent.click(screen.getByTestId('mini-add-btn'));
        expect(screen.getByText('Add Repository')).toBeDefined();
    });

    it('renders dividers between groups', () => {
        const repos = [
            makeRepo({ workspace: { id: 'a', name: 'A', remoteUrl: 'https://github.com/org/repo1.git' } }),
            makeRepo({ workspace: { id: 'b', name: 'B', remoteUrl: 'https://github.com/org/repo1.git' } }),
            makeRepo({ workspace: { id: 'c', name: 'C', remoteUrl: 'https://github.com/org/repo2.git' } }),
        ];
        render(<Wrap><MiniReposSidebar repos={repos} onRefresh={() => {}} /></Wrap>);
        const items = screen.getAllByTestId('mini-repo-item');
        expect(items).toHaveLength(3);
    });

    it('shows full repo names (not abbreviations)', () => {
        const repos = [
            makeRepo({ workspace: { id: 'a', name: 'Shortcuts' } }),
            makeRepo({ workspace: { id: 'b', name: 'SnakeGame' } }),
        ];
        render(<Wrap><MiniReposSidebar repos={repos} onRefresh={() => {}} /></Wrap>);
        const items = screen.getAllByTestId('mini-repo-item');
        expect(items[0].textContent).toContain('Shortcuts');
        expect(items[1].textContent).toContain('SnakeGame');
    });

    it('many repos are scrollable (overflow-y-auto)', () => {
        render(<Wrap><MiniReposSidebar repos={[]} onRefresh={() => {}} /></Wrap>);
        const nav = screen.getByTestId('mini-repos-sidebar');
        const scrollArea = nav.querySelector('.overflow-y-auto');
        expect(scrollArea).not.toBeNull();
    });
});

// ============================================================================
// ReposView integration — layout after sidebar removal
// ============================================================================

describe('ReposView — full-width layout (sidebar removed)', () => {
    beforeEach(() => {
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ workspaces: [] }),
        });
    });

    it('renders repo-detail-empty when no repo is selected on desktop', async () => {
        render(
            <Wrap>
                <ReposView />
            </Wrap>
        );
        await waitFor(() => {
            expect(screen.getByText(/Select a repository/)).toBeDefined();
        });
        // No sidebar in desktop layout
        expect(screen.queryByTestId('repos-sidebar')).toBeNull();
        expect(screen.queryByTestId('mini-repos-sidebar')).toBeNull();
    });

    it('does not render mini sidebar regardless of reposSidebarCollapsed', async () => {
        render(
            <Wrap>
                <CollapseOnMount />
                <ReposView />
            </Wrap>
        );
        await waitFor(() => {
            expect(screen.getByText(/Select a repository/)).toBeDefined();
        });
        expect(screen.queryByTestId('repos-sidebar')).toBeNull();
        expect(screen.queryByTestId('mini-repos-sidebar')).toBeNull();
    });
});

// ============================================================================
// Long hover expand — MiniReposSidebar hover callbacks (component-level)
// ============================================================================

describe('Long hover expand — MiniReposSidebar hover callbacks', () => {
    it('MiniReposSidebar calls onItemHoverStart/onItemHoverEnd on mouse enter/leave', () => {
        const onStart = vi.fn();
        const onEnd = vi.fn();
        const repos = [makeRepo({ workspace: { id: 'a', name: 'Alpha', color: '#0078d4' } })];
        render(
            <Wrap>
                <MiniReposSidebar repos={repos} onRefresh={() => {}} onItemHoverStart={onStart} onItemHoverEnd={onEnd} />
            </Wrap>
        );
        const item = screen.getByTestId('mini-repo-item');
        fireEvent.mouseEnter(item);
        expect(onStart).toHaveBeenCalledTimes(1);
        fireEvent.mouseLeave(item);
        expect(onEnd).toHaveBeenCalledTimes(1);
    });

    it('MiniReposSidebar works without hover props (backward compat)', () => {
        const repos = [makeRepo({ workspace: { id: 'a', name: 'Alpha' } })];
        render(
            <Wrap>
                <MiniReposSidebar repos={repos} onRefresh={() => {}} />
            </Wrap>
        );
        const item = screen.getByTestId('mini-repo-item');
        fireEvent.mouseEnter(item);
        fireEvent.mouseLeave(item);
        expect(item).toBeDefined();
    });
});

// ============================================================================
// Unseen badges
// ============================================================================

describe('MiniReposSidebar — unseen badges', () => {
    it('shows unseen badge when unseenCounts > 0', () => {
        const repos = [makeRepo({ workspace: { id: 'ws-1', name: 'Alpha' } })];
        render(
            <Wrap>
                <MiniReposSidebar repos={repos} onRefresh={() => {}} unseenCounts={{ 'ws-1': 3 }} />
            </Wrap>
        );
        const badge = screen.getByTestId('mini-repo-unseen-badge');
        expect(badge).toBeDefined();
        expect(badge.textContent).toBe('3');
    });

    it('does not show badge when unseenCounts is 0', () => {
        const repos = [makeRepo({ workspace: { id: 'ws-1', name: 'Alpha' } })];
        render(
            <Wrap>
                <MiniReposSidebar repos={repos} onRefresh={() => {}} unseenCounts={{ 'ws-1': 0 }} />
            </Wrap>
        );
        expect(screen.queryByTestId('mini-repo-unseen-badge')).toBeNull();
    });

    it('does not show badge when unseenCounts not provided', () => {
        const repos = [makeRepo({ workspace: { id: 'ws-1', name: 'Alpha' } })];
        render(
            <Wrap>
                <MiniReposSidebar repos={repos} onRefresh={() => {}} />
            </Wrap>
        );
        expect(screen.queryByTestId('mini-repo-unseen-badge')).toBeNull();
    });

    it('caps badge display at 99+', () => {
        const repos = [makeRepo({ workspace: { id: 'ws-1', name: 'Alpha' } })];
        render(
            <Wrap>
                <MiniReposSidebar repos={repos} onRefresh={() => {}} unseenCounts={{ 'ws-1': 150 }} />
            </Wrap>
        );
        const badge = screen.getByTestId('mini-repo-unseen-badge');
        expect(badge.textContent).toBe('99+');
    });

    it('shows individual badges per repo', () => {
        const repos = [
            makeRepo({ workspace: { id: 'ws-1', name: 'Alpha' } }),
            makeRepo({ workspace: { id: 'ws-2', name: 'Beta' } }),
        ];
        render(
            <Wrap>
                <MiniReposSidebar repos={repos} onRefresh={() => {}} unseenCounts={{ 'ws-1': 2, 'ws-2': 0 }} />
            </Wrap>
        );
        const badges = screen.queryAllByTestId('mini-repo-unseen-badge');
        expect(badges).toHaveLength(1);
        expect(badges[0].textContent).toBe('2');
    });

    it('badge has accessible aria-label', () => {
        const repos = [makeRepo({ workspace: { id: 'ws-1', name: 'Alpha' } })];
        render(
            <Wrap>
                <MiniReposSidebar repos={repos} onRefresh={() => {}} unseenCounts={{ 'ws-1': 5 }} />
            </Wrap>
        );
        const badge = screen.getByTestId('mini-repo-unseen-badge');
        expect(badge.getAttribute('aria-label')).toBe('5 unread');
    });
});
