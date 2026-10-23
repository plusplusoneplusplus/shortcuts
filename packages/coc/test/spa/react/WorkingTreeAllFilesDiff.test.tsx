/**
 * @vitest-environment jsdom
 *
 * The all-working-changes view: staged, unstaged and untracked files grouped
 * by section, collapsed rows that lazy-load their diff, and the Working
 * Changes header button that opens it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import React from 'react';

const h = vi.hoisted(() => {
    const client = {
        git: {
            getWorkingTreeChanges: vi.fn(),
            getWorkingTreeFileDiff: vi.fn(),
            getWorkingTreeFileContent: vi.fn(),
            listDiffComments: vi.fn(),
        },
    };
    return { client };
});

vi.mock('../../../src/server/spa/client/react/repos/cloneRouting', () => ({
    useCocClient: () => h.client,
}));

vi.mock('../../../src/server/spa/client/react/features/git/hooks/useFilesViewMode', () => ({
    useFilesViewMode: () => ({ mode: 'flat', setMode: vi.fn() }),
}));

import {
    WorkingTreeAllFilesDiff,
    untrackedContentAsDiff,
} from '../../../src/server/spa/client/react/features/git/working-tree/WorkingTreeAllFilesDiff';
import { WorkingTree } from '../../../src/server/spa/client/react/features/git/working-tree/WorkingTree';

const ROOT = '/repo';
function change(rel: string, stage: 'staged' | 'unstaged' | 'untracked', status = 'M') {
    return { filePath: `${ROOT}/${rel}`, status, stage, repositoryRoot: ROOT, repositoryName: 'repo', additions: 1, deletions: 0 };
}

// a.ts is partially staged, so it shows in two sections.
const CHANGES = [
    change('a.ts', 'staged'),
    change('a.ts', 'unstaged'),
    change('new.txt', 'untracked', '?'),
];

beforeEach(() => {
    vi.clearAllMocks();
    h.client.git.getWorkingTreeChanges.mockResolvedValue({ changes: CHANGES });
    h.client.git.listDiffComments.mockResolvedValue({ comments: [] });
    h.client.git.getWorkingTreeFileDiff.mockImplementation((_ws: string, _path: string, q: { stage: string }) =>
        Promise.resolve({ diff: `@@ -1 +1 @@\n-old\n+${q.stage}-line` }));
    h.client.git.getWorkingTreeFileContent.mockResolvedValue({
        head: { content: 'hello\nworld\n' }, base: { content: '' }, binary: false, tooLarge: false,
    });
});

describe('untrackedContentAsDiff', () => {
    it('adds every line of the file', () => {
        expect(untrackedContentAsDiff('hello\nworld\n')).toBe('@@ -0,0 +1,2 @@\n+hello\n+world');
    });

    it('returns an empty diff for an empty file', () => {
        expect(untrackedContentAsDiff('')).toBe('');
    });
});

describe('WorkingTreeAllFilesDiff', () => {
    it('groups files by section with rows collapsed and no diff fetched', async () => {
        render(<WorkingTreeAllFilesDiff workspaceId="ws-1" onFileSelect={vi.fn()} />);

        const staged = await screen.findByTestId('working-tree-all-section-staged');
        expect(within(staged).getByText('Staged (1)')).toBeTruthy();
        expect(within(screen.getByTestId('working-tree-all-section-unstaged')).getByText('Changes (1)')).toBeTruthy();
        expect(within(screen.getByTestId('working-tree-all-section-untracked')).getByText('Untracked (1)')).toBeTruthy();
        expect(screen.queryByTestId('working-tree-all-file-diff-staged-a.ts')).toBeNull();
        expect(h.client.git.getWorkingTreeFileDiff).not.toHaveBeenCalled();
    });

    it('loads the diff for the expanded section only, keeping a partially staged file apart', async () => {
        render(<WorkingTreeAllFilesDiff workspaceId="ws-1" onFileSelect={vi.fn()} />);

        fireEvent.click(await screen.findByTestId('working-tree-all-file-toggle-unstaged-a.ts'));

        const diff = await screen.findByTestId('working-tree-all-file-diff-unstaged-a.ts');
        await waitFor(() => expect(diff.textContent).toContain('unstaged-line'));
        expect(h.client.git.getWorkingTreeFileDiff).toHaveBeenCalledWith('ws-1', `${ROOT}/a.ts`, { stage: 'unstaged' });
        expect(screen.queryByTestId('working-tree-all-file-diff-staged-a.ts')).toBeNull();
    });

    it('shows an untracked file as added content', async () => {
        render(<WorkingTreeAllFilesDiff workspaceId="ws-1" onFileSelect={vi.fn()} />);

        fireEvent.click(await screen.findByTestId('working-tree-all-file-toggle-untracked-new.txt'));

        const diff = await screen.findByTestId('working-tree-all-file-diff-untracked-new.txt');
        await waitFor(() => expect(diff.textContent).toContain('world'));
        expect(h.client.git.getWorkingTreeFileContent).toHaveBeenCalledWith('ws-1', `${ROOT}/new.txt`, 'untracked');
        expect(h.client.git.getWorkingTreeFileDiff).not.toHaveBeenCalled();
    });

    it('opens the single-file view with the row stage', async () => {
        const onFileSelect = vi.fn();
        render(<WorkingTreeAllFilesDiff workspaceId="ws-1" onFileSelect={onFileSelect} />);

        fireEvent.click(await screen.findByTestId('working-tree-all-file-open-staged-a.ts'));

        expect(onFileSelect).toHaveBeenCalledWith(`${ROOT}/a.ts`, 'staged');
    });

    it('collapses a row again without refetching', async () => {
        render(<WorkingTreeAllFilesDiff workspaceId="ws-1" onFileSelect={vi.fn()} />);
        const toggle = await screen.findByTestId('working-tree-all-file-toggle-staged-a.ts');

        fireEvent.click(toggle);
        await screen.findByText('staged-line', { exact: false });
        fireEvent.click(toggle);
        expect(screen.queryByTestId('working-tree-all-file-diff-staged-a.ts')).toBeNull();
        fireEvent.click(toggle);

        await screen.findByTestId('working-tree-all-file-diff-staged-a.ts');
        expect(h.client.git.getWorkingTreeFileDiff).toHaveBeenCalledTimes(1);
    });

    it('re-reads the list and drops cached diffs on refresh', async () => {
        const { rerender } = render(<WorkingTreeAllFilesDiff workspaceId="ws-1" onFileSelect={vi.fn()} refreshKey={0} />);
        fireEvent.click(await screen.findByTestId('working-tree-all-file-toggle-staged-a.ts'));
        await screen.findByText('staged-line', { exact: false });

        rerender(<WorkingTreeAllFilesDiff workspaceId="ws-1" onFileSelect={vi.fn()} refreshKey={1} />);

        await waitFor(() => expect(h.client.git.getWorkingTreeChanges).toHaveBeenCalledTimes(2));
        await waitFor(() => expect(screen.queryByTestId('working-tree-all-file-diff-staged-a.ts')).toBeNull());
    });

    it('shows an empty state when the tree is clean', async () => {
        h.client.git.getWorkingTreeChanges.mockResolvedValue({ changes: [] });
        render(<WorkingTreeAllFilesDiff workspaceId="ws-1" onFileSelect={vi.fn()} />);
        expect(await screen.findByTestId('working-tree-all-files-empty')).toBeTruthy();
    });

    it('shows the list error', async () => {
        h.client.git.getWorkingTreeChanges.mockRejectedValue(new Error('boom'));
        render(<WorkingTreeAllFilesDiff workspaceId="ws-1" onFileSelect={vi.fn()} />);
        expect((await screen.findByTestId('working-tree-all-files-error')).textContent).toContain('boom');
    });
});

describe('WorkingTree all-changes button', () => {
    it('opens the all-changes view without toggling the section', async () => {
        const onAllChangesClick = vi.fn();
        render(<WorkingTree workspaceId="ws-1" onAllChangesClick={onAllChangesClick} />);

        const button = await screen.findByTestId('working-tree-all-changes-btn');
        const expandedBefore = screen.getByTestId('working-changes-header').getAttribute('aria-expanded');
        fireEvent.click(button);

        expect(onAllChangesClick).toHaveBeenCalledTimes(1);
        expect(screen.getByTestId('working-changes-header').getAttribute('aria-expanded')).toBe(expandedBefore);
    });

    it('is hidden without a handler', async () => {
        render(<WorkingTree workspaceId="ws-1" />);
        await screen.findByTestId('working-changes-header');
        expect(screen.queryByTestId('working-tree-all-changes-btn')).toBeNull();
    });
});
