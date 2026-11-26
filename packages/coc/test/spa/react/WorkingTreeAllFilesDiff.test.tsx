/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import React, { useEffect } from 'react';

const h = vi.hoisted(() => ({
    client: { git: { getWorkingTreeChanges: vi.fn(), getWorkingTreeFileContent: vi.fn(), listDiffComments: vi.fn() } },
    endpoint: undefined as string | undefined,
    unresolved: false,
    searchEnabled: false,
    panel: vi.fn(), mount: vi.fn(), unmount: vi.fn(), save: vi.fn(), openTab: vi.fn(),
    createComment: vi.fn(), reviewClientFor: vi.fn(), readBlob: vi.fn(),
}));
vi.mock('../../../src/server/spa/client/react/features/repo-detail/explorer/explorerApi', async importOriginal => {
    const actual = await importOriginal<typeof import('../../../src/server/spa/client/react/features/repo-detail/explorer/explorerApi')>();
    return { explorerApi: { ...actual.explorerApi, readBlob: h.readBlob } };
});
vi.mock('../../../src/server/spa/client/react/hooks/feature-flags/useDiffContentSearchEnabled', () => ({
    useDiffContentSearchEnabled: () => h.searchEnabled,
}));
vi.mock('../../../src/server/spa/client/react/features/git/diff/diffSource', () => ({
    getGitReviewClient: (...args: unknown[]) => { h.reviewClientFor(...args); return { git: { createDiffComment: h.createComment } }; },
}));
vi.mock('../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelOpen', () => ({
    openUnifiedPanelTab: h.openTab,
}));
vi.mock('../../../src/server/spa/client/react/repos/cloneRouting', () => ({
    useCocClient: () => h.client, useCloneBaseUrl: () => h.endpoint,
}));
vi.mock('../../../src/server/spa/client/react/repos/cloneRegistry', () => ({
    resolveCloneRoute: () => ({ kind: h.unresolved ? 'unresolved-remote' : 'local' }),
}));
vi.mock('../../../src/server/spa/client/react/features/git/hooks/useFilesViewMode', () => ({
    useFilesViewMode: () => ({ mode: 'flat', setMode: vi.fn() }),
}));
// Keep the real shared shell and dirty guard; the file pane has separate engine/edit tests.
vi.mock('../../../src/server/spa/client/react/features/git/working-tree/WorkingTreeFileDiff', () => ({
    WorkingTreeFileDiff: (props: any) => {
        h.panel(props);
        useEffect(() => { h.mount(); return () => { h.unmount(); props.onDirtyChange(false); }; }, []);
        return <div data-testid="full-working-diff">{props.filePath} {props.stage}
            <button onClick={() => { props.onDirtyChange(true); props.onRegisterSave(h.save); }}>Edit buffer</button>
            <button onClick={() => props.onNavigateToFile(props.workingTreeFiles.at(-1), 'last')}>Last hunk</button>
        </div>;
    },
}));
import { WorkingTreeAllFilesDiff } from '../../../src/server/spa/client/react/features/git/working-tree/WorkingTreeAllFilesDiff';
import { WorkingTree } from '../../../src/server/spa/client/react/features/git/working-tree/WorkingTree';
import { UnifiedPanelHostProvider } from '../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelHost';

const ROOT = '/repo';
const writeText = vi.fn();
function change(rel: string, stage: 'staged' | 'unstaged' | 'untracked', status = 'M') {
    return { filePath: `${ROOT}/${rel}`, status, stage, repositoryRoot: ROOT, repositoryName: 'repo', additions: 1, deletions: 0 };
}
const CHANGES = [change('a.ts', 'staged'), change('a.ts', 'unstaged'), change('new.txt', 'untracked', '?')];
const nav = () => screen.getByRole('complementary', { name: 'Changed files' });
const row = (stage: string) => within(nav()).getByRole('button', { name: new RegExp(`, ${stage},`) });
const current = () => h.panel.mock.calls.at(-1)![0];
const props = { workspaceId: 'ws-1', attachmentDestinationId: 'ws-1', repoRoot: ROOT, onNavigateToFile: vi.fn() };
beforeEach(() => {
    writeText.mockReset().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', Object.create(navigator, { clipboard: { value: { writeText }, configurable: true } }));
    vi.clearAllMocks(); h.endpoint = undefined; h.unresolved = false; h.searchEnabled = false;
    h.client.git.getWorkingTreeChanges.mockResolvedValue({ changes: CHANGES });
    h.client.git.listDiffComments.mockResolvedValue({ comments: [] });
    h.save.mockResolvedValue(true);
    h.client.git.getWorkingTreeFileContent.mockReset().mockImplementation(async (_workspace, path, stage) => ({
        path, fileName: path.split('/').pop(), binary: false, tooLarge: false,
        base: { content: stage === 'staged' ? 'HEAD needle\n' : 'INDEX needle\n', ref: stage === 'staged' ? 'HEAD' : 'INDEX', exists: stage !== 'untracked' },
        head: { content: stage === 'staged' ? 'INDEX needle\n' : 'DISK needle\n', ref: stage === 'staged' ? 'INDEX' : 'WORKTREE', exists: true },
    }));
});
afterEach(() => vi.unstubAllGlobals());

describe('WorkingTreeAllFilesDiff shared review', () => {
    it('copies a local worktree path against its own root without a workspace root', async () => {
        h.client.git.getWorkingTreeChanges.mockResolvedValue({ changes: [
            { ...change('new.txt', 'untracked', '?'), filePath: '/worktrees/feature/docs/新 file.txt',
                repositoryRoot: '/worktrees/feature', repositoryName: 'feature' },
        ] });
        render(<WorkingTreeAllFilesDiff {...props} repoRoot={undefined} />);
        await screen.findByTestId('full-working-diff');
        fireEvent.contextMenu(row('Untracked'));
        await act(async () => fireEvent.click(screen.getByRole('menuitem', { name: /Copy path/ })));
        expect(writeText).toHaveBeenCalledExactlyOnceWith('docs/新 file.txt');
    });

    it.each(['Groups', 'Tree', 'Flat'])('copies each repository-relative path in %s, without repository labels or stage IDs', async mode => {
        h.client.git.getWorkingTreeChanges.mockResolvedValue({ changes: [
            ...CHANGES, change('gone.ts', 'unstaged', 'D'),
            { ...change('old.ts', 'staged', 'R100'), filePath: 'C:\\worktrees\\other\\src\\new name.ts',
                oldPath: 'C:\\worktrees\\other\\old.ts', repositoryRoot: 'C:\\worktrees\\other', repositoryName: 'other' },
        ] });
        render(<UnifiedPanelHostProvider host={{ workspaceId: 'group', chatId: null }}>
            <WorkingTreeAllFilesDiff {...props} attachmentDestinationId="remote:b:ws-1" />
        </UnifiedPanelHostProvider>);
        await screen.findByTestId('full-working-diff');
        fireEvent.click(screen.getByRole('button', { name: mode, exact: true }));
        const selected = current().filePath;
        for (const [label, expected] of [
            [/new name\.ts/, 'src/new name.ts'], [/gone\.ts/, 'gone.ts'], [/Untracked/, 'new.txt'],
            [/repo\/a\.ts, Staged,/, 'a.ts'], [/repo\/a\.ts, Unstaged,/, 'a.ts'],
        ] as const) {
            // Use each row's full accessible name, rather than a truncated visual label.
            const target = within(nav()).getByRole('button', { name: label });
            fireEvent.contextMenu(target);
            await act(async () => fireEvent.click(screen.getByRole('menuitem', { name: /Copy path/ })));
            expect(writeText).toHaveBeenLastCalledWith(expected);
        }
        expect(current().filePath).toBe(selected);
        expect(h.openTab).not.toHaveBeenCalled();
        expect(screen.getByRole('status')).toHaveTextContent('Path copied.');
    });

    it('uses one full pane, stage labels and shared responsive controls without review-only actions', async () => {
        render(<WorkingTreeAllFilesDiff {...props} />);
        await screen.findByTestId('full-working-diff');
        expect(screen.getAllByTestId('full-working-diff')).toHaveLength(1);
        expect(current()).toMatchObject({ filePath: '/repo/a.ts', stage: 'staged', repoRoot: ROOT });
        for (const mode of ['Groups', 'Tree', 'Flat']) expect(screen.getByRole('button', { name: mode, exact: true })).toBeTruthy();
        expect(screen.getByRole('separator', { name: 'Resize changed files list' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Files · 3' })).toBeTruthy();
        expect(row('Staged')).toBeTruthy(); expect(row('Unstaged')).toBeTruthy(); expect(row('Untracked')).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Mark viewed' })).toBeNull();
        expect(screen.queryByLabelText('Hide viewed')).toBeNull();
    });
    it('places real matching counts and layout controls in the compact header and combines filters', async () => {
        h.client.git.getWorkingTreeChanges.mockResolvedValue({ changes: [
            change('src/a.ts', 'staged'), change('src/a.ts', 'unstaged'),
            change('tests/a.test.ts', 'untracked', '?'), change('docs/guide.md', 'unstaged', 'D'),
        ] });
        render(<WorkingTreeAllFilesDiff {...props} />);
        await screen.findByTestId('full-working-diff');
        expect(nav()).toHaveClass('git-review-nav-compact');
        const header = nav().querySelector('.git-review-filter-title')!;
        expect(within(header as HTMLElement).getByRole('group', { name: 'File list view' })).toBeTruthy();
        const badge = () => nav().querySelector('.git-review-file-count');
        expect(badge()).toHaveTextContent('4');
        const kinds = within(nav()).getByRole('group', { name: 'File kind filter' });
        expect(kinds.parentElement).toBe(screen.getByLabelText('Change status filter').parentElement);
        for (const label of ['All 4', 'Source 2', 'Tests 1', 'Docs 1']) {
            expect(within(kinds).getByRole('button', { name: label })).toBeTruthy();
        }
        fireEvent.click(within(kinds).getByRole('button', { name: 'Source 2' }));
        expect(badge()).toHaveTextContent('2');
        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'src/' } });
        fireEvent.change(screen.getByLabelText('Change status filter'), { target: { value: 'D' } });
        expect(badge()).toHaveTextContent('0');
        expect(within(kinds).getByRole('button', { name: 'All 4' })).toBeTruthy();
        fireEvent.click(within(nav()).getByRole('button', { name: 'Clear filters' }));
        expect(badge()).toHaveTextContent('4');
        fireEvent.click(within(kinds).getByRole('button', { name: 'Tests 1' }));
        expect(current()).toMatchObject({ stage: 'untracked', filePath: '/repo/tests/a.test.ts' });
        expect(badge()).toHaveAttribute('aria-label', '1 matching file');
    });
    it('keeps icon layout controls named, titled and keyboard accessible without clearing filters', async () => {
        render(<WorkingTreeAllFilesDiff {...props} />);
        await screen.findByTestId('full-working-diff');
        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'a.ts' } });
        const layouts = within(nav()).getByRole('group', { name: 'File list view' });
        for (const label of ['Tree', 'Flat', 'Groups']) {
            const button = within(layouts).getByRole('button', { name: label, exact: true });
            expect(button).toHaveAttribute('title', label);
            expect(button.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
            button.focus();
            expect(document.activeElement).toBe(button);
            fireEvent.click(button);
            expect(button).toHaveAttribute('aria-pressed', 'true');
            expect(within(layouts).getAllByRole('button').filter(control => control.getAttribute('aria-pressed') === 'true')).toHaveLength(1);
            expect(screen.getByRole('textbox')).toHaveValue('a.ts');
            expect(nav().querySelectorAll('[data-file-path]')).toHaveLength(2);
        }
    });
    it('keeps compact drawer search focus, keyboard navigation and focus return', async () => {
        render(<WorkingTreeAllFilesDiff {...props} />);
        await screen.findByTestId('full-working-diff');
        const trigger = screen.getByRole('button', { name: 'Files · 3' });
        fireEvent.click(trigger);
        expect(document.activeElement).toBe(screen.getByRole('textbox'));
        const groups = within(nav()).getByRole('button', { name: 'Groups', exact: true });
        groups.focus();
        fireEvent.keyDown(groups, { key: 'Tab', shiftKey: true });
        expect(document.activeElement).toBe(row('Untracked'));
        fireEvent.keyDown(row('Untracked'), { key: 'Tab' });
        expect(document.activeElement).toBe(groups);
        fireEvent.keyDown(nav(), { key: 'Escape' });
        expect(document.activeElement).toBe(trigger);
        expect(trigger).toHaveAttribute('aria-expanded', 'false');
    });
    it('keeps the same path separate in groups, tree and flat, including keyboard and hunk navigation', async () => {
        render(<WorkingTreeAllFilesDiff {...props} />);
        await screen.findByTestId('full-working-diff');
        for (const mode of ['Tree', 'Flat', 'Groups']) {
            fireEvent.click(screen.getByRole('button', { name: mode, exact: true }));
            expect(nav().querySelectorAll('[data-file-path]')).toHaveLength(3);
            fireEvent.click(row('Unstaged'));
            expect(current()).toMatchObject({ filePath: '/repo/a.ts', stage: 'unstaged', workingTreeFiles: ['/repo/a.ts'] });
            fireEvent.keyDown(row('Unstaged'), { key: 'Home' });
            expect(current().stage).toBe('staged');
        }
        fireEvent.click(screen.getByRole('button', { name: 'Last hunk', exact: true }));
        expect(current()).toMatchObject({ stage: 'staged', initialHunkTarget: 'last' });
        fireEvent.click(row('Untracked'));
        expect(current()).toMatchObject({ stage: 'untracked', filePath: '/repo/new.txt' });
    });
    it('opens the right-clicked change as a raw repo-relative source tab for its owner, and disables deletions', async () => {
        h.client.git.getWorkingTreeChanges.mockResolvedValue({ changes: [...CHANGES, change('gone.ts', 'unstaged', 'D')] });
        render(<UnifiedPanelHostProvider host={{ workspaceId: 'ws-1', chatId: null }}>
            <WorkingTreeAllFilesDiff {...props} attachmentDestinationId="remote:b:ws-1" /></UnifiedPanelHostProvider>);
        await screen.findByTestId('full-working-diff');
        fireEvent.contextMenu(row('Untracked'), { clientX: 5, clientY: 5 });
        fireEvent.click(within(screen.getByTestId('context-menu')).getByRole('menuitem', { name: /Open file/ }));
        expect(h.openTab).toHaveBeenCalledWith('ws-1', expect.objectContaining({
            kind: 'file', ownerWorkspaceId: 'ws-1', ownerRoutingRef: 'remote:b:ws-1', resourceId: 'new.txt', rawSource: true,
        }));
        expect(current().stage).toBe('staged');
        fireEvent.contextMenu(within(nav()).getByRole('button', { name: /gone\.ts/ }), { clientX: 5, clientY: 5 });
        expect(within(screen.getByTestId('context-menu')).getByRole('menuitem', { name: /Open file/ })).toBeDisabled();
    });
    it('saves a file-level comment on the right-clicked change for its stage and owner, and disables untracked files', async () => {
        h.createComment.mockResolvedValue({ comment: { id: 'c1' } });
        render(<WorkingTreeAllFilesDiff {...props} attachmentDestinationId="remote:b:ws-1" />);
        await screen.findByTestId('full-working-diff');
        expect(current().stage).toBe('staged');
        const menuItem = (name: RegExp) => within(screen.getByTestId('context-menu')).getByRole('menuitem', { name });
        fireEvent.contextMenu(row('Untracked'), { clientX: 5, clientY: 5 });
        expect(menuItem(/Comment/)).toBeDisabled();
        fireEvent.keyDown(document, { key: 'Escape' });
        fireEvent.contextMenu(row('Unstaged'), { clientX: 5, clientY: 5 });
        fireEvent.click(menuItem(/Comment/));
        const dialog = screen.getByRole('dialog', { name: 'Comment on file a.ts' });
        fireEvent.change(within(dialog).getByTestId('comment-textarea'), { target: { value: 'Whole file note' } });
        fireEvent.click(within(dialog).getByRole('button', { name: /Submit/ }));
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
        expect(h.reviewClientFor).toHaveBeenCalledWith('ws-1', 'remote:b:ws-1');
        expect(h.createComment).toHaveBeenCalledWith('ws-1', {
            context: { repositoryId: 'ws-1', filePath: '/repo/a.ts', oldRef: 'INDEX', newRef: 'working-tree' },
            scope: 'file', selectedText: '', comment: 'Whole file note', category: 'general',
        });
        expect(current().stage).toBe('staged');
    });
    it('opens on the requested file and stage instead of the first change', async () => {
        render(<WorkingTreeAllFilesDiff {...props} filePath="/repo/a.ts" stage="unstaged" />);
        await waitFor(() => expect(current()).toMatchObject({ filePath: '/repo/a.ts', stage: 'unstaged' }));
        expect(row('Unstaged').getAttribute('aria-current')).toBe('true');
        expect(h.panel.mock.calls.every(([p]) => p.stage === 'unstaged')).toBe(true);
    });
    it('moves to a newly requested file and hunk without remounting the review', async () => {
        const { rerender } = render(<WorkingTreeAllFilesDiff {...props} filePath="/repo/a.ts" stage="unstaged" />);
        await waitFor(() => expect(current().stage).toBe('unstaged'));
        rerender(<WorkingTreeAllFilesDiff {...props} filePath="/repo/new.txt" stage="untracked" initialHunkTarget="last" />);
        await waitFor(() => expect(current()).toMatchObject({ filePath: '/repo/new.txt', stage: 'untracked', initialHunkTarget: 'last' }));
        expect(h.client.git.getWorkingTreeChanges).toHaveBeenCalledTimes(1);
    });
    it('keeps repeated display paths from different repository roots selectable in the tree', async () => {
        h.client.git.getWorkingTreeChanges.mockResolvedValue({ changes: [
            change('a.ts', 'staged'),
            { ...change('a.ts', 'staged'), filePath: '/other/a.ts', repositoryRoot: '/other' },
        ] });
        render(<WorkingTreeAllFilesDiff {...props} />); await screen.findByTestId('full-working-diff');
        fireEvent.click(screen.getByRole('button', { name: 'Tree', exact: true }));
        const repeated = within(nav()).getAllByRole('button', { name: /repo\/a.ts, Staged,/ });
        expect(repeated).toHaveLength(2);
        fireEvent.click(repeated[1]);
        expect(current().filePath).toBe('/other/a.ts');
    });
    it('searches and filters real paths while reporting stage-specific file selection', async () => {
        render(<WorkingTreeAllFilesDiff {...props} />);
        await screen.findByTestId('full-working-diff');
        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'a.ts' } });
        expect(nav().querySelectorAll('[data-file-path]')).toHaveLength(2);
        fireEvent.click(row('Unstaged'));
        expect(props.onNavigateToFile).toHaveBeenLastCalledWith('/repo/a.ts', 'unstaged', 'first');
        expect(screen.queryByRole('button', { name: 'Open full diff', exact: true })).toBeNull();
        fireEvent.change(screen.getByLabelText('Change status filter'), { target: { value: 'A' } });
        expect(nav().querySelectorAll('[data-file-path]')).toHaveLength(0);
    });
    it('refreshes the list and selected pane without disposing dirty text, even if the path disappears', async () => {
        const onDirtyChange = vi.fn(), onRegisterSave = vi.fn();
        const { rerender } = render(<WorkingTreeAllFilesDiff {...props} refreshKey={0} onDirtyChange={onDirtyChange} onRegisterSave={onRegisterSave} />);
        await screen.findByTestId('full-working-diff');
        fireEvent.click(screen.getByText('Edit buffer'));
        expect(onDirtyChange).toHaveBeenCalledWith(true); expect(onRegisterSave).toHaveBeenCalledWith(h.save);
        const mounts = h.mount.mock.calls.length;
        h.client.git.getWorkingTreeChanges.mockResolvedValue({ changes: [] });
        rerender(<WorkingTreeAllFilesDiff {...props} refreshKey={1} onDirtyChange={onDirtyChange} onRegisterSave={onRegisterSave} />);
        await waitFor(() => expect(h.client.git.getWorkingTreeChanges).toHaveBeenCalledTimes(2));
        expect(current().refreshKey).toBe(1); expect(current().stage).toBe('staged');
        expect(h.mount).toHaveBeenCalledTimes(mounts); expect(h.unmount).not.toHaveBeenCalled();
        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'other' } });
        expect(screen.getByTestId('full-working-diff')).toBeTruthy();
    });
    it('guards selection and overview, retains failed saves and supports cancel/discard', async () => {
        render(<WorkingTreeAllFilesDiff {...props} />); await screen.findByTestId('full-working-diff');
        fireEvent.click(screen.getByText('Edit buffer'));
        fireEvent.click(row('Unstaged'));
        expect(current().stage).toBe('staged');
        fireEvent.click(screen.getByRole('button', { name: 'Cancel', exact: true }));
        fireEvent.click(screen.getByRole('button', { name: 'Overview', exact: true }));
        h.save.mockResolvedValue(false);
        fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }));
        await screen.findByText('Could not save the file. Your changes are still in the editor.');
        expect(screen.getByTestId('full-working-diff')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: "Don't Save", exact: true }));
        expect(screen.queryByTestId('full-working-diff')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Read diff', exact: true }));
        expect(current().stage).toBe('staged');
    });
    it('does not accept delayed list results after refresh or owner changes', async () => {
        let resolveOld!: (value: any) => void;
        h.client.git.getWorkingTreeChanges.mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve; }));
        const { rerender } = render(<WorkingTreeAllFilesDiff {...props} refreshKey={0} />);
        rerender(<WorkingTreeAllFilesDiff {...props} refreshKey={1} />);
        await screen.findByTestId('full-working-diff');
        await act(async () => resolveOld({ changes: [change('stale.ts', 'staged')] }));
        expect(screen.queryByText('stale.ts')).toBeNull();
        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'new.txt' } });
        h.endpoint = 'https://other.test';
        rerender(<WorkingTreeAllFilesDiff {...props} attachmentDestinationId="remote:other:ws-1" refreshKey={1} />);
        await screen.findByTestId('full-working-diff');
        expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('');
        expect(current().attachmentDestinationId).toBe('remote:other:ws-1');
        expect(h.client.git.getWorkingTreeChanges).toHaveBeenLastCalledWith('ws-1');
    });
    it('does not issue a local request for an unresolved remote owner', () => {
        h.unresolved = true;
        render(<WorkingTreeAllFilesDiff {...props} attachmentDestinationId="remote:offline:ws-1" />);
        expect(screen.getByRole('alert').textContent).toContain('owner is unavailable');
        expect(h.client.git.getWorkingTreeChanges).not.toHaveBeenCalled();
    });
    it('shows clean, error and retry states', async () => {
        h.client.git.getWorkingTreeChanges.mockRejectedValueOnce(new Error('boom')).mockResolvedValue({ changes: [] });
        render(<WorkingTreeAllFilesDiff {...props} />);
        expect((await screen.findByRole('alert')).textContent).toContain('boom');
        expect(h.client.git.getWorkingTreeChanges).toHaveBeenLastCalledWith('ws-1');
        fireEvent.click(screen.getByRole('button', { name: 'Retry', exact: true }));
        expect(await screen.findByTestId('working-tree-all-files-empty')).toBeTruthy();
        expect(h.client.git.getWorkingTreeChanges).toHaveBeenLastCalledWith('ws-1', { refresh: true });
    });
    it('reads strictly on refresh, adds and drops files, and keeps the last list beside a failed refresh', async () => {
        const view = render(<WorkingTreeAllFilesDiff {...props} refreshKey={2} />);
        await screen.findByTestId('full-working-diff');
        expect(h.client.git.getWorkingTreeChanges).toHaveBeenLastCalledWith('ws-1');
        h.client.git.getWorkingTreeChanges.mockResolvedValue({ changes: [change('a.ts', 'staged'), change('added.ts', 'untracked', '?')] });
        view.rerender(<WorkingTreeAllFilesDiff {...props} refreshKey={3} />);
        await waitFor(() => expect(within(nav()).getByRole('button', { name: /added\.ts/ })).toBeTruthy());
        expect(h.client.git.getWorkingTreeChanges).toHaveBeenLastCalledWith('ws-1', { refresh: true });
        expect(within(nav()).queryByRole('button', { name: /new\.txt/ })).toBeNull();
        expect(current()).toMatchObject({ filePath: '/repo/a.ts', stage: 'staged', refreshKey: 3 });

        h.client.git.getWorkingTreeChanges.mockRejectedValueOnce(new Error('status failed'));
        view.rerender(<WorkingTreeAllFilesDiff {...props} refreshKey={4} />);
        expect((await screen.findByRole('alert')).textContent).toContain('status failed');
        expect(within(nav()).getByRole('button', { name: /added\.ts/ })).toBeTruthy();
        expect(screen.queryByTestId('working-tree-all-files-empty')).toBeNull();
    });
});

describe('working changes full-content search', () => {
    const searchInput = () => screen.getByTestId('review-content-search-input');
    async function openSearch() {
        await screen.findByTestId('full-working-diff');
        fireEvent.click(screen.getByRole('button', { name: 'Search review contents' }));
        return searchInput();
    }
    it('is default-off and performs no full-content reads before a nonempty query', async () => {
        const view = render(<WorkingTreeAllFilesDiff {...props} />);
        await screen.findByTestId('full-working-diff');
        expect(screen.queryByRole('button', { name: 'Search review contents' })).toBeNull();
        h.searchEnabled = true;
        view.rerender(<WorkingTreeAllFilesDiff {...props} />);
        await openSearch();
        expect(h.client.git.getWorkingTreeFileContent).not.toHaveBeenCalled();
    });
    it('searches HEAD/index, index/disk and untracked new only, with stage-qualified result activation', async () => {
        h.searchEnabled = true;
        render(<WorkingTreeAllFilesDiff {...props} />);
        fireEvent.change(await openSearch(), { target: { value: 'needle' } });
        await screen.findByText('Searched 3 of 3 files');
        expect(h.client.git.getWorkingTreeFileContent.mock.calls).toEqual([
            ['ws-1', '/repo/a.ts', 'staged'], ['ws-1', '/repo/a.ts', 'unstaged'], ['ws-1', '/repo/new.txt', 'untracked'],
        ]);
        const summaries = screen.getByRole('region', { name: 'Review content search' }).querySelectorAll('details');
        expect(summaries).toHaveLength(3);
        expect(Array.from(summaries, group => group.querySelector('summary')?.textContent)).toEqual([
            'a.ts (2) · Staged', 'a.ts (2) · Unstaged', 'new.txt (1) · Untracked',
        ]);
        expect(summaries[0].textContent).toContain('HEAD needle');
        expect(summaries[0].textContent).toContain('INDEX needle');
        expect(summaries[1].textContent).toContain('INDEX needle');
        expect(summaries[1].textContent).toContain('DISK needle');
        expect(summaries[2].querySelectorAll('button')).toHaveLength(1);
        fireEvent.click(within(summaries[1]).getByRole('button', { name: /OLD line 1, column 7/ }));
        expect(current()).toMatchObject({ stage: 'unstaged', filePath: '/repo/a.ts',
            contentSearchTarget: { filePath: '/repo/a.ts', side: 'old', line: 1, startColumn: 7, endColumn: 13 } });
        const target = current().contentSearchTarget;
        fireEvent.click(within(summaries[1]).getByRole('button', { name: /OLD line 1/ }));
        expect(current().contentSearchTarget).not.toBe(target);
        fireEvent.click(screen.getByRole('button', { name: 'Files' }));
        fireEvent.click(row('Staged'));
        expect(current().contentSearchTarget).toBeUndefined();
    });
    it('steps F3 across staged old/new and unstaged old on the same path with exact-side targets', async () => {
        h.searchEnabled = true;
        render(<WorkingTreeAllFilesDiff {...props} />);
        fireEvent.change(await openSearch(), { target: { value: 'needle' } });
        await screen.findByText('Searched 3 of 3 files');
        const step = (shiftKey = false) => fireEvent.keyDown(screen.getByTestId('full-working-diff'), { key: 'F3', shiftKey });
        step();
        expect(current()).toMatchObject({ stage: 'staged', filePath: '/repo/a.ts',
            contentSearchTarget: { filePath: '/repo/a.ts', side: 'old', line: 1, startColumn: 6, endColumn: 12 } });
        const stagedOld = current().contentSearchTarget;
        step();
        expect(current()).toMatchObject({ stage: 'staged', filePath: '/repo/a.ts',
            contentSearchTarget: { filePath: '/repo/a.ts', side: 'new', line: 1, startColumn: 7, endColumn: 13 } });
        step();
        expect(current()).toMatchObject({ stage: 'unstaged', filePath: '/repo/a.ts',
            contentSearchTarget: { filePath: '/repo/a.ts', side: 'old', line: 1, startColumn: 7, endColumn: 13 } });
        expect(current().contentSearchTarget).not.toBe(stagedOld);
        step(true);
        expect(current()).toMatchObject({ stage: 'staged', contentSearchTarget: { side: 'new', line: 1, startColumn: 7 } });
        step(true);
        expect(current()).toMatchObject({ stage: 'staged', contentSearchTarget: { side: 'old', line: 1, startColumn: 6 } });
        expect(h.client.git.getWorkingTreeFileContent).toHaveBeenCalledTimes(3);
        expect((searchInput() as HTMLInputElement).value).toBe('needle');
    });
    it('bypasses file-list filters, preserves search state and reuses cached reads across controls', async () => {
        h.searchEnabled = true;
        render(<WorkingTreeAllFilesDiff {...props} />);
        await screen.findByTestId('full-working-diff');
        fireEvent.change(screen.getByPlaceholderText('Search files or path…'), { target: { value: 'new.txt' } });
        fireEvent.change(screen.getByLabelText('Change status filter'), { target: { value: 'A' } });
        fireEvent.change(await openSearch(), { target: { value: 'needle' } });
        await screen.findByText('Searched 3 of 3 files');
        fireEvent.click(screen.getAllByRole('button', { name: /a.ts, OLD line/ })[0]);
        expect(current().stage).toBe('staged');
        expect((screen.getByPlaceholderText('Search files or path…') as HTMLInputElement).value).toBe('');
        expect((screen.getByLabelText('Change status filter') as HTMLSelectElement).value).toBe('all');
        expect((searchInput() as HTMLInputElement).value).toBe('needle');
        fireEvent.change(screen.getByLabelText('Search side'), { target: { value: 'new' } });
        fireEvent.change(screen.getByLabelText('Files to include'), { target: { value: '*.ts' } });
        fireEvent.change(searchInput(), { target: { value: 'INDEX' } });
        await screen.findByText('Searched 2 of 2 files');
        expect(h.client.git.getWorkingTreeFileContent).toHaveBeenCalledTimes(3);
    });
    it('guards result navigation without losing the buffer or target on cancel/failed save', async () => {
        h.searchEnabled = true;
        render(<WorkingTreeAllFilesDiff {...props} />);
        fireEvent.change(await openSearch(), { target: { value: 'needle' } });
        await screen.findByText('Searched 3 of 3 files');
        fireEvent.click(screen.getByText('Edit buffer'));
        const result = screen.getByRole('button', { name: /new.txt, NEW line/ });
        fireEvent.click(result);
        expect(current().stage).toBe('staged');
        expect(current().contentSearchTarget).toBeUndefined();
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        h.save.mockResolvedValue(false);
        fireEvent.click(result);
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        await screen.findByText('Could not save the file. Your changes are still in the editor.');
        expect(current().stage).toBe('staged');
        fireEvent.click(screen.getByRole('button', { name: "Don't Save" }));
        expect(current()).toMatchObject({ stage: 'untracked', contentSearchTarget: { side: 'new', filePath: '/repo/new.txt' } });
    });
    it('limits concurrent reads to four and caches across query edits', async () => {
        h.searchEnabled = true;
        h.client.git.getWorkingTreeChanges.mockResolvedValue({ changes: Array.from({ length: 7 }, (_, i) => change(`${i}.ts`, 'unstaged')) });
        const finish: Array<(data: any) => void> = [];
        h.client.git.getWorkingTreeFileContent.mockImplementation(() => new Promise(resolve => finish.push(resolve)));
        render(<WorkingTreeAllFilesDiff {...props} />);
        fireEvent.change(await openSearch(), { target: { value: 'needle' } });
        await waitFor(() => expect(finish).toHaveLength(4));
        fireEvent.change(searchInput(), { target: { value: 'fresh' } });
        expect(finish).toHaveLength(4);
        const response = { binary: false, tooLarge: false, base: { exists: false }, head: { content: 'fresh', exists: true } };
        await act(async () => { finish[0](response); });
        expect(finish).toHaveLength(5);
        await act(async () => { finish.slice(1).forEach(resolve => resolve(response)); });
        await act(async () => { finish.slice(5).forEach(resolve => resolve(response)); });
        await screen.findByText('Searched 7 of 7 files');
        expect(h.client.git.getWorkingTreeFileContent).toHaveBeenCalledTimes(7);
    });
    it('invalidates search caches/targets on refresh without remounting dirty editors', async () => {
        h.searchEnabled = true;
        const view = render(<WorkingTreeAllFilesDiff {...props} refreshKey={0} />);
        fireEvent.change(await openSearch(), { target: { value: 'needle' } });
        await screen.findByText('Searched 3 of 3 files');
        fireEvent.click(screen.getAllByRole('button', { name: /a.ts, OLD line/ })[0]);
        fireEvent.click(screen.getByText('Edit buffer'));
        const mounts = h.mount.mock.calls.length;
        view.rerender(<WorkingTreeAllFilesDiff {...props} refreshKey={1} />);
        await waitFor(() => expect(h.client.git.getWorkingTreeFileContent).toHaveBeenCalledTimes(6));
        expect(current().contentSearchTarget).toBeUndefined();
        expect(current().refreshKey).toBe(1);
        expect(h.mount).toHaveBeenCalledTimes(mounts);
        expect(h.unmount).not.toHaveBeenCalled();
    });
    it('ignores late replies after owner/endpoint replacement and starts fresh controls/cache', async () => {
        h.searchEnabled = true;
        let finish!: (data: any) => void;
        h.client.git.getWorkingTreeFileContent.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
        const view = render(<WorkingTreeAllFilesDiff {...props} />);
        fireEvent.change(await openSearch(), { target: { value: 'needle' } });
        await waitFor(() => expect(h.client.git.getWorkingTreeFileContent).toHaveBeenCalledTimes(3));
        h.endpoint = 'https://other.test';
        view.rerender(<WorkingTreeAllFilesDiff {...props} attachmentDestinationId="remote:other:ws-1" />);
        await openSearch();
        expect((searchInput() as HTMLInputElement).value).toBe('');
        await act(async () => { finish({ base: { exists: false }, head: { content: 'stale needle', exists: true } }); });
        expect(screen.queryByText(/stale needle/)).toBeNull();
        fireEvent.change(searchInput(), { target: { value: 'needle' } });
        await screen.findByText('Searched 3 of 3 files');
        expect(h.client.git.getWorkingTreeFileContent).toHaveBeenCalledTimes(6);
        view.unmount();
    });
    it('distinguishes same-display-path matches from separate repositories', async () => {
        h.searchEnabled = true;
        h.client.git.getWorkingTreeChanges.mockResolvedValue({ changes: [
            change('a.ts', 'staged'), { ...change('a.ts', 'staged'), repositoryRoot: '/other', filePath: '/other/a.ts' },
        ] });
        render(<WorkingTreeAllFilesDiff {...props} />);
        fireEvent.change(await openSearch(), { target: { value: 'needle' } });
        await screen.findByText('Searched 2 of 2 files');
        const repeated = screen.getAllByRole('button', { name: /repo\/a.ts, NEW line/ });
        expect(repeated).toHaveLength(2);
        fireEvent.click(repeated[1]);
        expect(current()).toMatchObject({ filePath: '/other/a.ts', stage: 'staged', contentSearchTarget: { filePath: '/other/a.ts' } });
        expect(h.client.git.getWorkingTreeFileContent.mock.calls.map(call => call[1])).toEqual(['/repo/a.ts', '/other/a.ts']);
    });
    it('shows skips and retryable failures through the actual search panel', async () => {
        h.searchEnabled = true;
        h.client.git.getWorkingTreeFileContent.mockResolvedValueOnce({ binary: true }).mockRejectedValueOnce(new Error('read failed'))
            .mockResolvedValueOnce({ tooLarge: true });
        render(<WorkingTreeAllFilesDiff {...props} />);
        fireEvent.change(await openSearch(), { target: { value: 'needle' } });
        await screen.findByText('Searched 3 of 3 files');
        expect(screen.getByRole('region', { name: 'Skipped' }).textContent).toContain('Binary file');
        expect(screen.getByRole('region', { name: 'Skipped' }).textContent).toContain('Over server size limit');
        expect(screen.getByRole('region', { name: 'Errors' }).textContent).toContain('read failed');
        fireEvent.click(screen.getByRole('button', { name: 'Retry a.ts' }));
        await screen.findByRole('button', { name: /a.ts, NEW line/ });
        expect(h.client.git.getWorkingTreeFileContent).toHaveBeenCalledTimes(4);
        expect(h.client.git.getWorkingTreeFileContent).toHaveBeenLastCalledWith('ws-1', '/repo/a.ts', 'unstaged');
    });
    it('replaces the searchable file inventory after a refresh without retaining missing result rows', async () => {
        h.searchEnabled = true;
        const view = render(<WorkingTreeAllFilesDiff {...props} refreshKey={0} />);
        fireEvent.change(await openSearch(), { target: { value: 'needle' } });
        await screen.findByText('Searched 3 of 3 files');
        h.client.git.getWorkingTreeChanges.mockResolvedValue({ changes: [change('fresh.ts', 'unstaged')] });
        view.rerender(<WorkingTreeAllFilesDiff {...props} refreshKey={1} />);
        await screen.findByText('Searched 1 of 1 files');
        expect(screen.queryByRole('button', { name: /new.txt, NEW line/ })).toBeNull();
        expect(screen.getByRole('button', { name: /fresh.ts, NEW line/ })).toBeTruthy();
        expect(h.client.git.getWorkingTreeFileContent).toHaveBeenLastCalledWith('ws-1', '/repo/fresh.ts', 'unstaged');
    });
    it('does not schedule remaining reads after unmount, including StrictMode effect replay', async () => {
        h.searchEnabled = true;
        h.client.git.getWorkingTreeChanges.mockResolvedValue({ changes: Array.from({ length: 8 }, (_, i) => change(`${i}.ts`, 'unstaged')) });
        const finish: Array<(value: any) => void> = [];
        h.client.git.getWorkingTreeFileContent.mockImplementation(() => new Promise(resolve => finish.push(resolve)));
        const view = render(<React.StrictMode><WorkingTreeAllFilesDiff {...props} /></React.StrictMode>);
        fireEvent.change(await openSearch(), { target: { value: 'needle' } });
        await waitFor(() => expect(finish).toHaveLength(4));
        view.unmount();
        await act(async () => {
            finish.forEach(resolve => resolve({ base: { exists: false }, head: { content: 'late needle', exists: true } }));
        });
        expect(h.client.git.getWorkingTreeFileContent).toHaveBeenCalledTimes(4);
    });
});

describe('working changes definition routing', () => {
    // Current code, as definition providers see it; `line 1` … `line 6`.
    const CURRENT = Array.from({ length: 6 }, (_, index) => `line ${index + 1}`).join('\n');
    type Sides = { base: string | null; head: string };
    function serve(files: Record<string, Partial<Record<'staged' | 'unstaged' | 'untracked', Sides>>>) {
        h.client.git.getWorkingTreeFileContent.mockReset().mockImplementation(async (_workspace: string, path: string, stage: 'staged') => {
            const sides = files[path]?.[stage];
            if (!sides) throw new Error(`no ${stage} content for ${path}`);
            return { path, fileName: path.split('/').pop(), binary: false, tooLarge: false,
                base: { content: sides.base ?? '', ref: 'BASE', exists: sides.base !== null },
                head: { content: sides.head, ref: 'HEAD', exists: true } };
        });
    }
    const jump = (path: string, side: 'original' | 'modified', line = 4, signal = new AbortController().signal) => {
        let moved!: Promise<boolean>;
        act(() => { moved = current().onNavigateDefinitionFile({ path, side, line, column: 3 }, signal); });
        return moved;
    };
    beforeEach(() => { h.readBlob.mockResolvedValue({ encoding: 'utf-8', content: CURRENT }); });

    it('selects a changed file hidden by the navigator filter and reveals the definition in it, keeping the filter', async () => {
        h.client.git.getWorkingTreeChanges.mockResolvedValue({ changes: [change('caller.ts', 'unstaged'), change('def.ts', 'unstaged')] });
        serve({ '/repo/def.ts': { unstaged: { base: `header\n${CURRENT}`, head: CURRENT } } });
        render(<WorkingTreeAllFilesDiff {...props} />);
        await screen.findByTestId('full-working-diff');
        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'caller' } });
        expect(current()).toMatchObject({ filePath: '/repo/caller.ts', definitionFiles: ['caller.ts', 'def.ts'] });
        await act(async () => { expect(await jump('def.ts', 'original')).toBe(true); });
        // The index side carries one more line above the definition than current code.
        expect(current()).toMatchObject({ filePath: '/repo/def.ts', stage: 'unstaged', definitionTarget: { side: 'original', line: 5, column: 3 } });
        expect(h.readBlob).toHaveBeenCalledWith('ws-1', 'def.ts', expect.objectContaining({ signal: expect.any(AbortSignal) }), null);
        expect(screen.getByRole('textbox')).toHaveValue('caller');
        expect(props.onNavigateToFile).toHaveBeenLastCalledWith('/repo/def.ts', 'unstaged', 'first');
    });

    it('picks the staged or unstaged entry whose snapshot holds the definition, never an arbitrary one', async () => {
        h.client.git.getWorkingTreeChanges.mockResolvedValue({ changes: [change('caller.ts', 'unstaged'), change('a.ts', 'staged'), change('a.ts', 'unstaged')] });
        // HEAD still has the definition (shifted); the index already dropped it.
        serve({ '/repo/a.ts': {
            staged: { base: `old\nold\n${CURRENT}`, head: 'index only' },
            unstaged: { base: 'index only', head: CURRENT },
        } });
        render(<WorkingTreeAllFilesDiff {...props} filePath="/repo/caller.ts" stage="unstaged" />);
        await screen.findByTestId('full-working-diff');
        await act(async () => { expect(await jump('a.ts', 'original')).toBe(true); });
        expect(current()).toMatchObject({ filePath: '/repo/a.ts', stage: 'staged', definitionTarget: { side: 'original', line: 6, column: 3 } });
        // The right side: the disk file equals current code, so the unstaged entry wins over the index.
        serve({ '/repo/a.ts': { staged: { base: '', head: CURRENT }, unstaged: { base: CURRENT, head: CURRENT } } });
        await act(async () => { expect(await jump('a.ts', 'modified', 2)).toBe(true); });
        expect(current()).toMatchObject({ stage: 'unstaged', definitionTarget: { side: 'modified', line: 2, column: 3 } });
    });

    it('declines when no entry locates the definition, and for an untracked file\'s missing left side', async () => {
        h.client.git.getWorkingTreeChanges.mockResolvedValue({ changes: [change('caller.ts', 'unstaged'), change('a.ts', 'staged'), change('new.ts', 'untracked', '?')] });
        serve({ '/repo/a.ts': { staged: { base: 'line 4\nline 4', head: 'gone' } }, '/repo/new.ts': { untracked: { base: null, head: CURRENT } } });
        render(<WorkingTreeAllFilesDiff {...props} filePath="/repo/caller.ts" stage="unstaged" />);
        await screen.findByTestId('full-working-diff');
        await act(async () => { expect(await jump('a.ts', 'original')).toBe(false); });
        await act(async () => { expect(await jump('a.ts', 'modified')).toBe(false); });
        await act(async () => { expect(await jump('new.ts', 'original')).toBe(false); });
        h.readBlob.mockResolvedValue({ encoding: 'base64', content: 'AAAA' });
        await act(async () => { expect(await jump('new.ts', 'modified')).toBe(false); });
        expect(current()).toMatchObject({ filePath: '/repo/caller.ts', definitionTarget: undefined });
        h.readBlob.mockResolvedValue({ encoding: 'utf-8', content: CURRENT });
        await act(async () => { expect(await jump('new.ts', 'modified')).toBe(true); });
        expect(current()).toMatchObject({ filePath: '/repo/new.ts', stage: 'untracked', definitionTarget: { side: 'modified', line: 4 } });
    });

    it('ignores a lookup its diff superseded', async () => {
        h.client.git.getWorkingTreeChanges.mockResolvedValue({ changes: [change('caller.ts', 'unstaged'), change('def.ts', 'unstaged')] });
        serve({ '/repo/def.ts': { unstaged: { base: CURRENT, head: CURRENT } } });
        render(<WorkingTreeAllFilesDiff {...props} />);
        await screen.findByTestId('full-working-diff');
        const abort = new AbortController();
        let moved!: Promise<boolean>;
        await act(async () => { moved = jump('def.ts', 'modified', 4, abort.signal); abort.abort(); await moved; });
        expect(current().filePath).toBe('/repo/caller.ts');
    });

    it('asks before leaving unsaved edits; Cancel keeps the file and sets no reveal, Don\'t Save moves and reveals', async () => {
        h.client.git.getWorkingTreeChanges.mockResolvedValue({ changes: [change('caller.ts', 'unstaged'), change('def.ts', 'unstaged')] });
        serve({ '/repo/def.ts': { unstaged: { base: CURRENT, head: CURRENT } } });
        render(<WorkingTreeAllFilesDiff {...props} />);
        await screen.findByTestId('full-working-diff');
        fireEvent.click(screen.getByText('Edit buffer'));
        await act(async () => { await jump('def.ts', 'modified'); });
        fireEvent.click(screen.getByRole('button', { name: 'Cancel', exact: true }));
        expect(current()).toMatchObject({ filePath: '/repo/caller.ts', definitionTarget: undefined });
        // A manual move to the file later does not replay the cancelled jump.
        fireEvent.click(within(nav()).getByRole('button', { name: /def\.ts/ }));
        fireEvent.click(screen.getByRole('button', { name: "Don't Save", exact: true }));
        expect(current()).toMatchObject({ filePath: '/repo/def.ts', definitionTarget: undefined });
        fireEvent.click(within(nav()).getByRole('button', { name: /caller\.ts/ }));
        fireEvent.click(screen.getByText('Edit buffer'));
        await act(async () => { await jump('def.ts', 'modified'); });
        fireEvent.click(screen.getByRole('button', { name: "Don't Save", exact: true }));
        expect(current()).toMatchObject({ filePath: '/repo/def.ts', definitionTarget: { side: 'modified', line: 4, column: 3 } });
    });

    it('reads current code through the concrete remote owner', async () => {
        h.client.git.getWorkingTreeChanges.mockResolvedValue({ changes: [change('caller.ts', 'unstaged'), change('def.ts', 'unstaged')] });
        serve({ '/repo/def.ts': { unstaged: { base: CURRENT, head: CURRENT } } });
        render(<WorkingTreeAllFilesDiff {...props} attachmentDestinationId="remote:b:ws-1" />);
        await screen.findByTestId('full-working-diff');
        await act(async () => { await jump('def.ts', 'modified'); });
        expect(h.readBlob).toHaveBeenCalledWith('ws-1', 'def.ts', expect.anything(), 'remote:b:ws-1');
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
