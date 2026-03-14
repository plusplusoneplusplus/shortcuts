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

const makeRepo = (id: string, name: string, color = '#ff0000') => ({
    workspace: { id, name, rootPath: `/repos/${id}`, color },
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
});
