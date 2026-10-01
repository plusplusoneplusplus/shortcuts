/**
 * Compact Git panel layout: anchored branch dropdown, compact working-tree
 * counts, and the commit id leading each commit row.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import * as fs from 'fs';
import * as path from 'path';

const listBranches = vi.fn();
vi.mock('../../../../src/server/spa/client/react/repos/cloneRegistry', () => ({
    getCocClientForWorkspace: () => ({ git: { listBranches, switchBranch: vi.fn() } }),
}));

import { BranchPickerModal } from '../../../../src/server/spa/client/react/features/git/branches/BranchPickerModal';
import { CompactWorkingTreeSummary } from '../../../../src/server/spa/client/react/features/git/working-tree/WorkingTree';

describe('BranchPickerModal anchored dropdown', () => {
    beforeEach(() => {
        // jsdom has no scrollIntoView; the picker scrolls the focused row into view.
        Element.prototype.scrollIntoView = vi.fn();
        listBranches.mockReset();
        listBranches.mockResolvedValue({
            local: {
                branches: [
                    { name: 'main', isCurrent: true, isRemote: false, lastCommitSubject: 'Merge #1' },
                    { name: 'feat/x', isCurrent: false, isRemote: false, lastCommitSubject: 'Add x', lastCommitDate: '2d' },
                ],
                hasMore: false,
            },
        });
    });

    it('renders under the anchor without a backdrop and shows last-commit subjects', async () => {
        render(
            <BranchPickerModal workspaceId="ws" currentBranch="main" isOpen onClose={vi.fn()} anchorRect={{ left: 40, bottom: 30 }} />,
        );
        const overlay = screen.getByTestId('branch-picker-overlay');
        expect(overlay.getAttribute('data-anchored')).toBe('true');
        expect(overlay.querySelector('.bg-black\\/40')).toBeNull();
        const dialog = screen.getByTestId('branch-picker-modal');
        expect(dialog.style.top).toBe('34px');
        expect(dialog.style.left).toBe('40px');
        await waitFor(() => expect(screen.getByTestId('branch-item-subject-feat/x').textContent).toBe('Add x'));
    });

    it('clamps the dropdown inside the viewport', () => {
        render(
            <BranchPickerModal workspaceId="ws" currentBranch="main" isOpen onClose={vi.fn()} anchorRect={{ left: window.innerWidth - 10, bottom: 30 }} />,
        );
        const left = parseFloat(screen.getByTestId('branch-picker-modal').style.left);
        expect(left + 320).toBeLessThanOrEqual(window.innerWidth);
    });

    it('stays a centered modal with a backdrop when no anchor is given', async () => {
        render(<BranchPickerModal workspaceId="ws" currentBranch="main" isOpen onClose={vi.fn()} />);
        const overlay = screen.getByTestId('branch-picker-overlay');
        expect(overlay.getAttribute('data-anchored')).toBeNull();
        expect(overlay.querySelector('.bg-black\\/40')).toBeTruthy();
        await waitFor(() => expect(screen.getByTestId('branch-item-feat/x')).toBeTruthy());
        expect(screen.queryByTestId('branch-item-subject-feat/x')).toBeNull();
    });
});

describe('CompactWorkingTreeSummary', () => {
    it('shows "clean" when nothing changed', () => {
        render(<CompactWorkingTreeSummary staged={0} modified={0} untracked={0} />);
        expect(screen.getByTestId('working-tree-clean').textContent).toContain('clean');
    });

    it('shows +staged ~modified ?untracked', () => {
        render(<CompactWorkingTreeSummary staged={2} modified={3} untracked={1} />);
        expect(screen.getByTestId('working-tree-count-staged').textContent).toBe('+2');
        expect(screen.getByTestId('working-tree-count-modified').textContent).toBe('~3');
        expect(screen.getByTestId('working-tree-count-untracked').textContent).toBe('?1');
    });

    it('omits zero counts', () => {
        render(<CompactWorkingTreeSummary staged={0} modified={4} untracked={0} />);
        expect(screen.queryByTestId('working-tree-count-staged')).toBeNull();
        expect(screen.queryByTestId('working-tree-count-untracked')).toBeNull();
        expect(screen.getByTestId('working-tree-count-modified').textContent).toBe('~4');
        expect(screen.queryByTestId('working-tree-clean')).toBeNull();
    });
});

describe('WorkingTree compact header', () => {
    const source = fs.readFileSync(
        path.join(__dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'features', 'git', 'working-tree', 'WorkingTree.tsx'),
        'utf-8',
    );

    it('uses the compact summary and hides the total file count in compact mode', () => {
        expect(source).toContain('<CompactWorkingTreeSummary staged={staged.length}');
        expect(source).not.toContain('`${staged.length}s · ${unstaged.length}m · ${untracked.length}u`');
        expect(source).toMatch(/\{!compact && \(\s*<span[\s\S]*?data-testid="working-tree-file-count"/);
    });
});

describe('CommitRow', () => {
    const source = fs.readFileSync(
        path.join(__dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'features', 'git', 'commits', 'CommitRow.tsx'),
        'utf-8',
    );

    it('renders the commit id before the subject', () => {
        const hashAt = source.indexOf('data-testid={`commit-hash-${commit.shortHash}`}');
        const subjectAt = source.indexOf('{isFixup ? fixupEntry!.displaySubject : commit.subject}');
        expect(hashAt).toBeGreaterThan(-1);
        expect(subjectAt).toBeGreaterThan(hashAt);
        expect(source.match(/\{commit\.shortHash\}<\/span>/g)?.length).toBe(1);
    });
});
