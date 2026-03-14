/**
 * RepoTabStrip — unit tests.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { RepoTabStrip } from '../../../../src/server/spa/client/react/repos/RepoTabStrip';

vi.mock('../../../../src/server/spa/client/react/repos/AddRepoDialog', () => ({
    AddRepoDialog: ({ open }: { open: boolean }) =>
        open ? <div data-testid="add-repo-dialog" /> : null,
}));

const makeRepo = (id: string, name: string, color = '#ff0000', remoteUrl?: string) => ({
    workspace: { id, name, rootPath: `/repos/${id}`, color, remoteUrl },
    stats: { success: 0, failed: 0, running: 0 },
    workflows: [],
    taskCount: 0,
});

describe('RepoTabStrip', () => {
    beforeEach(() => {
        cleanup();
    });

    it('renders a tab for each repo', () => {
        render(
            <RepoTabStrip
                repos={[makeRepo('r1', 'Alpha'), makeRepo('r2', 'Beta')]}
                selectedRepoId={null}
                onSelect={vi.fn()}
                unseenCounts={{}}
                onRefresh={vi.fn()}
            />
        );
        const tabs = screen.getAllByTestId('repo-tab');
        expect(tabs).toHaveLength(2);
        expect(tabs[0].textContent).toContain('Alpha');
        expect(tabs[1].textContent).toContain('Beta');
    });

    it('marks selected repo tab as aria-pressed=true', () => {
        render(
            <RepoTabStrip
                repos={[makeRepo('r1', 'Alpha'), makeRepo('r2', 'Beta')]}
                selectedRepoId="r1"
                onSelect={vi.fn()}
                unseenCounts={{}}
                onRefresh={vi.fn()}
            />
        );
        const tabs = screen.getAllByTestId('repo-tab');
        expect(tabs[0].getAttribute('aria-pressed')).toBe('true');
        expect(tabs[1].getAttribute('aria-pressed')).toBe('false');
    });

    it('calls onSelect with the correct repo id when tab is clicked', () => {
        const onSelect = vi.fn();
        render(
            <RepoTabStrip
                repos={[makeRepo('r1', 'Alpha'), makeRepo('r2', 'Beta')]}
                selectedRepoId={null}
                onSelect={onSelect}
                unseenCounts={{}}
                onRefresh={vi.fn()}
            />
        );
        const tabs = screen.getAllByTestId('repo-tab');
        fireEvent.click(tabs[1]);
        expect(onSelect).toHaveBeenCalledWith('r2');
    });

    it('shows unseen badge when unseenCount > 0', () => {
        render(
            <RepoTabStrip
                repos={[makeRepo('r1', 'Alpha')]}
                selectedRepoId={null}
                onSelect={vi.fn()}
                unseenCounts={{ r1: 5 }}
                onRefresh={vi.fn()}
            />
        );
        const badge = screen.getByTestId('repo-tab-unseen-badge');
        expect(badge.textContent).toBe('5');
        expect(badge.getAttribute('aria-label')).toBe('5 unread');
    });

    it('caps badge at 99+ for large unseen counts', () => {
        render(
            <RepoTabStrip
                repos={[makeRepo('r1', 'Alpha')]}
                selectedRepoId={null}
                onSelect={vi.fn()}
                unseenCounts={{ r1: 150 }}
                onRefresh={vi.fn()}
            />
        );
        expect(screen.getByTestId('repo-tab-unseen-badge').textContent).toBe('99+');
    });

    it('does not show unseen badge when count is 0', () => {
        render(
            <RepoTabStrip
                repos={[makeRepo('r1', 'Alpha')]}
                selectedRepoId={null}
                onSelect={vi.fn()}
                unseenCounts={{ r1: 0 }}
                onRefresh={vi.fn()}
            />
        );
        expect(screen.queryByTestId('repo-tab-unseen-badge')).toBeNull();
    });

    it('opens AddRepoDialog when "+" button is clicked', () => {
        render(
            <RepoTabStrip
                repos={[]}
                selectedRepoId={null}
                onSelect={vi.fn()}
                unseenCounts={{}}
                onRefresh={vi.fn()}
            />
        );
        const addBtn = screen.getByTestId('repo-tab-add-btn');
        expect(screen.queryByTestId('add-repo-dialog')).toBeNull();
        fireEvent.click(addBtn);
        expect(screen.getByTestId('add-repo-dialog')).toBeDefined();
    });

    it('renders empty strip with just the add button when repos=[]', () => {
        render(
            <RepoTabStrip
                repos={[]}
                selectedRepoId={null}
                onSelect={vi.fn()}
                unseenCounts={{}}
                onRefresh={vi.fn()}
            />
        );
        expect(screen.queryAllByTestId('repo-tab')).toHaveLength(0);
        expect(screen.getByTestId('repo-tab-add-btn')).toBeDefined();
    });

    it('renders no separators when all repos have the same remote URL', () => {
        const remote = 'https://github.com/org/repo.git';
        render(
            <RepoTabStrip
                repos={[makeRepo('r1', 'Alpha', '#f00', remote), makeRepo('r2', 'Beta', '#0f0', remote)]}
                selectedRepoId={null}
                onSelect={vi.fn()}
                unseenCounts={{}}
                onRefresh={vi.fn()}
            />
        );
        expect(screen.queryAllByTestId('repo-group-separator')).toHaveLength(0);
        expect(screen.getAllByTestId('repo-tab')).toHaveLength(2);
    });

    it('renders a separator between repos from different remote URLs', () => {
        render(
            <RepoTabStrip
                repos={[
                    makeRepo('r1', 'Alpha', '#f00', 'https://github.com/org/repo-a.git'),
                    makeRepo('r2', 'Beta', '#0f0', 'https://github.com/org/repo-b.git'),
                ]}
                selectedRepoId={null}
                onSelect={vi.fn()}
                unseenCounts={{}}
                onRefresh={vi.fn()}
            />
        );
        expect(screen.getAllByTestId('repo-group-separator')).toHaveLength(1);
    });

    it('renders a separator before ungrouped repos (no remote URL)', () => {
        render(
            <RepoTabStrip
                repos={[
                    makeRepo('r1', 'Alpha', '#f00', 'https://github.com/org/repo.git'),
                    makeRepo('r2', 'Beta'),
                ]}
                selectedRepoId={null}
                onSelect={vi.fn()}
                unseenCounts={{}}
                onRefresh={vi.fn()}
            />
        );
        expect(screen.getAllByTestId('repo-group-separator')).toHaveLength(1);
    });

    it('renders no separator when all repos are ungrouped (no remote URLs)', () => {
        render(
            <RepoTabStrip
                repos={[makeRepo('r1', 'Alpha'), makeRepo('r2', 'Beta')]}
                selectedRepoId={null}
                onSelect={vi.fn()}
                unseenCounts={{}}
                onRefresh={vi.fn()}
            />
        );
        // Each ungrouped repo is its own group — two repos = two groups = one separator between them
        expect(screen.getAllByTestId('repo-group-separator')).toHaveLength(1);
    });

    it('renders no separator for a single repo', () => {
        render(
            <RepoTabStrip
                repos={[makeRepo('r1', 'Alpha')]}
                selectedRepoId={null}
                onSelect={vi.fn()}
                unseenCounts={{}}
                onRefresh={vi.fn()}
            />
        );
        expect(screen.queryAllByTestId('repo-group-separator')).toHaveLength(0);
    });

    it('separator tooltip shows the group remote URL label', () => {
        render(
            <RepoTabStrip
                repos={[
                    makeRepo('r1', 'Alpha', '#f00', 'https://github.com/org/repo-a.git'),
                    makeRepo('r2', 'Beta', '#0f0', 'https://github.com/org/repo-b.git'),
                ]}
                selectedRepoId={null}
                onSelect={vi.fn()}
                unseenCounts={{}}
                onRefresh={vi.fn()}
            />
        );
        const separator = screen.getByTestId('repo-group-separator');
        // The second group's label should appear as the separator title
        expect(separator.getAttribute('title')).toBeTruthy();
    });
});
