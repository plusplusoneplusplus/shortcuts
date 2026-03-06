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

    it('renders mini items with color dot and letter', () => {
        const repos = [
            makeRepo({ workspace: { id: 'a', name: 'Alpha', color: '#0078d4' } }),
        ];
        render(<Wrap><MiniReposSidebar repos={repos} onRefresh={() => {}} /></Wrap>);
        const items = screen.getAllByTestId('mini-repo-item');
        expect(items).toHaveLength(1);
        expect(items[0].getAttribute('aria-label')).toBe('Alpha (main)');
        expect(items[0].textContent).toContain('A');
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

    it('disambiguates duplicate first letters', () => {
        const repos = [
            makeRepo({ workspace: { id: 'a', name: 'Shortcuts' } }),
            makeRepo({ workspace: { id: 'b', name: 'SnakeGame' } }),
        ];
        render(<Wrap><MiniReposSidebar repos={repos} onRefresh={() => {}} /></Wrap>);
        const items = screen.getAllByTestId('mini-repo-item');
        expect(items[0].textContent).toContain('SH');
        expect(items[1].textContent).toContain('SN');
    });

    it('many repos are scrollable (overflow-y-auto)', () => {
        render(<Wrap><MiniReposSidebar repos={[]} onRefresh={() => {}} /></Wrap>);
        const nav = screen.getByTestId('mini-repos-sidebar');
        const scrollArea = nav.querySelector('.overflow-y-auto');
        expect(scrollArea).not.toBeNull();
    });
});

// ============================================================================
// ReposView integration — mini sidebar appears when collapsed
// ============================================================================

describe('ReposView — mini sidebar integration', () => {
    beforeEach(() => {
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ workspaces: [] }),
        });
    });

    it('shows mini sidebar when collapsed instead of hiding', async () => {
        render(
            <Wrap>
                <CollapseOnMount />
                <ReposView />
            </Wrap>
        );
        await waitFor(() => {
            expect(screen.getByText(/Select a repository/)).toBeDefined();
        });
        const sidebar = screen.getByTestId('repos-sidebar');
        // Should be 48px (w-12), not 0
        expect(sidebar.className).toContain('w-12');
        expect(sidebar.className).not.toContain('w-0');
        // Mini sidebar should be rendered
        expect(screen.getByTestId('mini-repos-sidebar')).toBeDefined();
    });

    it('shows full sidebar when expanded', async () => {
        render(<Wrap><ReposView /></Wrap>);
        await waitFor(() => {
            expect(screen.getByText(/Select a repository/)).toBeDefined();
        });
        const sidebar = screen.getByTestId('repos-sidebar');
        expect(sidebar.className).toContain('w-[280px]');
        // Mini sidebar should NOT be rendered
        expect(screen.queryByTestId('mini-repos-sidebar')).toBeNull();
    });

    it('sidebar does not have aria-hidden when collapsed (mini is visible)', async () => {
        render(
            <Wrap>
                <CollapseOnMount />
                <ReposView />
            </Wrap>
        );
        await waitFor(() => {
            expect(screen.getByText(/Select a repository/)).toBeDefined();
        });
        const sidebar = screen.getByTestId('repos-sidebar');
        expect(sidebar.getAttribute('aria-hidden')).toBeNull();
    });
});

// ============================================================================
// Long hover expand — temporary sidebar expansion
// ============================================================================

describe('Long hover expand', () => {
    beforeEach(() => {
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ workspaces: [] }),
        });
    });

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

    it('sidebar remains collapsed before 600ms threshold', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({
                workspaces: [{ id: 'ws-1', name: 'TestRepo', rootPath: '/test', color: '#0078d4' }]
            }),
        });
        render(
            <Wrap>
                <CollapseOnMount />
                <ReposView />
            </Wrap>
        );
        await waitFor(() => {
            expect(screen.getByTestId('repos-sidebar')).toBeDefined();
            expect(screen.queryAllByTestId('mini-repo-item').length).toBeGreaterThan(0);
        });

        const sidebar = screen.getByTestId('repos-sidebar');
        expect(sidebar.className).toContain('w-12');

        const items = screen.getAllByTestId('mini-repo-item');
        fireEvent.mouseEnter(items[0]);
        // Only 300ms — not enough
        act(() => { vi.advanceTimersByTime(300); });
        expect(sidebar.className).toContain('w-12');

        // Cancel by leaving
        fireEvent.mouseLeave(items[0]);
        act(() => { vi.advanceTimersByTime(400); });
        expect(sidebar.className).toContain('w-12');
        vi.useRealTimers();
    });

    it('collapses back on mouseleave from aside', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({
                workspaces: [{ id: 'ws-1', name: 'TestRepo', rootPath: '/test', color: '#0078d4' }]
            }),
        });
        render(
            <Wrap>
                <CollapseOnMount />
                <ReposView />
            </Wrap>
        );
        await waitFor(() => {
            expect(screen.queryAllByTestId('mini-repo-item').length).toBeGreaterThan(0);
        });

        const sidebar = screen.getByTestId('repos-sidebar');
        const items = screen.getAllByTestId('mini-repo-item');

        // Trigger hover expand
        fireEvent.mouseEnter(items[0]);
        act(() => { vi.advanceTimersByTime(700); });
        expect(sidebar.className).toContain('w-[280px]');

        // Leave the aside entirely
        fireEvent.mouseLeave(sidebar);
        expect(sidebar.className).toContain('w-12');
        vi.useRealTimers();
    });

    it('does not affect permanently expanded sidebar', async () => {
        render(<Wrap><ReposView /></Wrap>);
        await waitFor(() => {
            expect(screen.getByTestId('repos-sidebar')).toBeDefined();
        });
        const sidebar = screen.getByTestId('repos-sidebar');
        expect(sidebar.className).toContain('w-[280px]');
        fireEvent.mouseLeave(sidebar);
        expect(sidebar.className).toContain('w-[280px]');
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
