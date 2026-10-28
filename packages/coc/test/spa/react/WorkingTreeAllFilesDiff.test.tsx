/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import React, { useEffect } from 'react';

const h = vi.hoisted(() => ({
    client: { git: { getWorkingTreeChanges: vi.fn(), listDiffComments: vi.fn() } },
    endpoint: undefined as string | undefined,
    unresolved: false,
    panel: vi.fn(), mount: vi.fn(), unmount: vi.fn(), save: vi.fn(),
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

const ROOT = '/repo';
function change(rel: string, stage: 'staged' | 'unstaged' | 'untracked', status = 'M') {
    return { filePath: `${ROOT}/${rel}`, status, stage, repositoryRoot: ROOT, repositoryName: 'repo', additions: 1, deletions: 0 };
}
const CHANGES = [change('a.ts', 'staged'), change('a.ts', 'unstaged'), change('new.txt', 'untracked', '?')];
const nav = () => screen.getByRole('complementary', { name: 'Changed files' });
const row = (stage: string) => within(nav()).getByRole('button', { name: new RegExp(`, ${stage},`) });
const current = () => h.panel.mock.calls.at(-1)![0];
const props = { workspaceId: 'ws-1', attachmentDestinationId: 'ws-1', repoRoot: ROOT, onFileSelect: vi.fn() };
beforeEach(() => {
    vi.clearAllMocks(); h.endpoint = undefined; h.unresolved = false;
    h.client.git.getWorkingTreeChanges.mockResolvedValue({ changes: CHANGES });
    h.client.git.listDiffComments.mockResolvedValue({ comments: [] });
    h.save.mockResolvedValue(true);
});

describe('WorkingTreeAllFilesDiff shared review', () => {
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
    it('searches and filters real paths while keeping stage-specific single-file opening', async () => {
        render(<WorkingTreeAllFilesDiff {...props} />);
        await screen.findByTestId('full-working-diff');
        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'a.ts' } });
        expect(nav().querySelectorAll('[data-file-path]')).toHaveLength(2);
        fireEvent.click(row('Unstaged'));
        fireEvent.click(screen.getByRole('button', { name: 'Open full diff', exact: true }));
        expect(props.onFileSelect).toHaveBeenCalledWith('/repo/a.ts', 'unstaged');
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
        fireEvent.click(screen.getByRole('button', { name: 'Retry', exact: true }));
        expect(await screen.findByTestId('working-tree-all-files-empty')).toBeTruthy();
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
