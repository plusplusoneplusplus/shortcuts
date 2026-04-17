/**
 * RepoManagementPopover — unit tests.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { RepoManagementPopover } from '../../../../src/server/spa/client/react/repos/RepoManagementPopover';

vi.mock('../../../../src/server/spa/client/react/repos/ReposGrid', () => ({
    ReposGrid: ({ repos }: { repos: any[] }) => (
        <div data-testid="repos-grid" data-repo-count={repos.length} />
    ),
}));

describe('RepoManagementPopover', () => {
    beforeEach(() => {
        cleanup();
    });

    it('renders nothing when open=false', () => {
        render(
            <RepoManagementPopover open={false} onClose={vi.fn()} repos={[]} onRefresh={vi.fn()} />
        );
        expect(screen.queryByTestId('repo-management-popover')).toBeNull();
    });

    it('renders popover with ReposGrid when open=true', () => {
        render(
            <RepoManagementPopover open={true} onClose={vi.fn()} repos={[]} onRefresh={vi.fn()} />
        );
        expect(screen.getByTestId('repo-management-popover')).toBeDefined();
        expect(screen.getByTestId('repos-grid')).toBeDefined();
    });

    it('passes repos to ReposGrid', () => {
        const repos = [
            { workspace: { id: 'r1', name: 'Alpha', rootPath: '/r1', color: '#f00' }, stats: {}, workflows: [], taskCount: 0 },
        ];
        render(
            <RepoManagementPopover open={true} onClose={vi.fn()} repos={repos} onRefresh={vi.fn()} />
        );
        expect(screen.getByTestId('repos-grid').getAttribute('data-repo-count')).toBe('1');
    });

    it('calls onClose when Escape key is pressed', () => {
        const onClose = vi.fn();
        render(
            <RepoManagementPopover open={true} onClose={onClose} repos={[]} onRefresh={vi.fn()} />
        );
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('calls onClose when clicking outside the popover', () => {
        const onClose = vi.fn();
        render(
            <div>
                <RepoManagementPopover open={true} onClose={onClose} repos={[]} onRefresh={vi.fn()} />
                <div data-testid="outside" />
            </div>
        );
        fireEvent.mouseDown(screen.getByTestId('outside'));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('does not call onClose when clicking inside the popover', () => {
        const onClose = vi.fn();
        render(
            <RepoManagementPopover open={true} onClose={onClose} repos={[]} onRefresh={vi.fn()} />
        );
        fireEvent.mouseDown(screen.getByTestId('repo-management-popover'));
        expect(onClose).not.toHaveBeenCalled();
    });

    it('does not register event listeners when open=false', () => {
        const addSpy = vi.spyOn(document, 'addEventListener');
        render(
            <RepoManagementPopover open={false} onClose={vi.fn()} repos={[]} onRefresh={vi.fn()} />
        );
        expect(addSpy).not.toHaveBeenCalled();
        addSpy.mockRestore();
    });

    it('has role=dialog and aria-modal=true for accessibility', () => {
        render(
            <RepoManagementPopover open={true} onClose={vi.fn()} repos={[]} onRefresh={vi.fn()} />
        );
        const popover = screen.getByTestId('repo-management-popover');
        expect(popover.getAttribute('role')).toBe('dialog');
        expect(popover.getAttribute('aria-modal')).toBe('true');
    });
});
