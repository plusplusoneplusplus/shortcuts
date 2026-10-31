/** @vitest-environment jsdom */
import React, { forwardRef, useImperativeHandle } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
    const content = vi.fn(), patch = vi.fn(), changes = vi.fn();
    return { content, patch, changes, client: { git: { getWorkingTreeChanges: changes, getWorkingTreeFileContent: content, getWorkingTreeFileDiff: patch } },
        classic: vi.fn(), monaco: vi.fn(), scroll: vi.fn(), hunk: vi.fn(), getGlobal: vi.fn(), patchGlobal: vi.fn() };
});
vi.mock('../../../../src/server/spa/client/react/features/git/hooks/useDiffComments', () => ({
    useDiffComments: () => ({
        comments: [], loading: false, addComment: vi.fn(), updateComment: vi.fn(), deleteComment: vi.fn(),
        resolveComment: vi.fn(), unresolveComment: vi.fn(), askAI: vi.fn(), runRelocation: vi.fn(),
        aiLoadingIds: new Set(), aiErrors: new Map(), clearAiError: vi.fn(),
        resolvingIds: new Set(), deletingIds: new Set(), copyAllCommentsAsPrompt: vi.fn(),
    }),
}));
vi.mock('../../../../src/server/spa/client/react/contexts/QueueContext', () => ({
    useQueue: () => ({ state: {}, dispatch: vi.fn() }),
}));
vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({ preferences: { getGlobal: h.getGlobal, patchGlobal: h.patchGlobal } }),
}));
vi.mock('../../../../src/server/spa/client/react/repos/cloneRouting', () => ({
    useCocClient: () => h.client, useCloneBaseUrl: () => undefined,
}));
vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/useDiffContentSearchEnabled', () => ({
    useDiffContentSearchEnabled: () => true,
}));
vi.mock('../../../../src/server/spa/client/react/features/git/diff/UnifiedDiffViewer', async importOriginal => {
    const actual = await importOriginal<object>();
    const { forwardRef, useImperativeHandle } = await import('react');
    return {
        ...actual,
        UnifiedDiffViewer: forwardRef((props: any, ref) => {
            h.classic(props);
            useImperativeHandle(ref, () => ({ scrollLineIntoView: h.scroll, scrollToHunk: h.hunk, getHunkCount: () => 1 }));
            return <div data-testid="classic">{props.diff}</div>;
        }),
    };
});
vi.mock('../../../../src/server/spa/client/react/features/git/diff/SideBySideDiffViewer', () => ({
    SideBySideDiffViewer: forwardRef((props: any, ref) => {
        h.classic(props);
        useImperativeHandle(ref, () => ({ scrollLineIntoView: h.scroll, scrollToHunk: h.hunk, getHunkCount: () => 1 }));
        return <div data-testid="split-classic">{props.diff}</div>;
    }),
}));
vi.mock('../../../../src/server/spa/client/react/features/git/diff/MonacoFileDiffViewer', () => ({
    MonacoFileDiffViewer: forwardRef((props: any, ref) => {
        h.monaco(props);
        useImperativeHandle(ref, () => ({ capturePosition: () => null }));
        return <div data-testid="editor">{props.original} / {props.modified}
            <button onClick={() => props.onModifiedChange('unsaved buffer')}>Edit buffer</button>
        </div>;
    }),
}));

import { WorkingTreeFileDiff } from '../../../../src/server/spa/client/react/features/git/working-tree/WorkingTreeFileDiff';
import { WorkingTreeAllFilesDiff } from '../../../../src/server/spa/client/react/features/git/working-tree/WorkingTreeAllFilesDiff';
import { DIFF_ENGINE_STORAGE_KEY, __resetDiffEngineForTesting } from '../../../../src/server/spa/client/react/features/git/hooks/useDiffEngine';

const props = { workspaceId: 'workspace', filePath: '/repo/a.ts', repoRoot: '/repo', stage: 'unstaged' as const };
const target = (side: 'old' | 'new', line: number) => ({
    filePath: props.filePath, side, line, startColumn: 3, endColumn: 9, text: '😀needle',
});
const response = {
    path: props.filePath, fileName: 'a.ts', binary: false, tooLarge: false,
    base: { content: 'unchanged needle\nold\n', ref: 'INDEX', exists: true },
    head: { content: 'unchanged needle\nnew\n', ref: 'WORKTREE', exists: true },
};
beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    localStorage.setItem(DIFF_ENGINE_STORAGE_KEY, 'legacy');
    localStorage.setItem('coc-diff-view-mode', 'unified');
    __resetDiffEngineForTesting();
    h.patch.mockReset().mockResolvedValue({ diff: '@@ -8,2 +12,2 @@\n same\n-old\n+new' });
    h.content.mockReset().mockResolvedValue(response);
    h.changes.mockReset().mockResolvedValue({ changes: [
        { filePath: props.filePath, stage: 'staged', status: 'M', repositoryRoot: '/repo', repositoryName: 'repo' },
        { filePath: props.filePath, stage: 'unstaged', status: 'M', repositoryRoot: '/repo', repositoryName: 'repo' },
    ] });
    h.getGlobal.mockReturnValue(new Promise(() => {}));
    h.patchGlobal.mockResolvedValue({});
});

describe('mounted all-working-changes search with the real file pane', () => {
    const hostProps = { workspaceId: 'workspace', repoRoot: '/repo', onFileSelect: vi.fn() };
    it('activates a stage-specific unchanged old-side hit and reveals it through explicit Editor fallback', async () => {
        render(<WorkingTreeAllFilesDiff {...hostProps} />);
        await screen.findByTestId('classic');
        fireEvent.click(screen.getByRole('button', { name: 'Search review contents' }));
        fireEvent.change(screen.getByTestId('review-content-search-input'), { target: { value: 'needle' } });
        await screen.findByText('Searched 2 of 2 files');
        fireEvent.click(screen.getAllByRole('button', { name: 'a.ts, OLD line 1, column 11' })[1]);
        expect(screen.getByTestId('working-tree-file-diff-header').textContent).toContain('Unstaged diff');
        expect((await screen.findByTestId('search-outside-patch')).textContent).toContain('OLD line 1');
        fireEvent.click(screen.getByRole('button', { name: 'Open in Editor view' }));
        await screen.findByTestId('editor');
        await waitFor(() => expect(h.monaco.mock.calls.at(-1)![0].revealTarget).toEqual({ side: 'original', line: 1, column: 11 }));
        expect(h.monaco.mock.calls.at(-1)![0].original).toBe(response.base.content);
        expect(h.monaco.mock.calls.at(-1)![0].modified).toBe(response.head.content);
    });
    it('preserves a real dirty buffer across refresh and canceled result navigation', async () => {
        localStorage.setItem(DIFF_ENGINE_STORAGE_KEY, 'monaco');
        __resetDiffEngineForTesting();
        const dirty = vi.fn();
        const view = render(<WorkingTreeAllFilesDiff {...hostProps} onDirtyChange={dirty} refreshKey={0} />);
        await screen.findByTestId('editor');
        fireEvent.click(screen.getByText('Edit buffer'));
        await screen.findByTestId('working-tree-file-diff-dirty');
        fireEvent.click(screen.getByRole('button', { name: 'Search review contents' }));
        fireEvent.change(screen.getByTestId('review-content-search-input'), { target: { value: 'needle' } });
        await screen.findByText('Searched 2 of 2 files');
        expect(h.monaco.mock.calls.at(-1)![0].editedText).toBe('unsaved buffer');
        expect(screen.getByTestId('working-tree-file-diff-dirty')).toBeTruthy();
        expect(dirty).toHaveBeenLastCalledWith(true);
        fireEvent.click(screen.getAllByRole('button', { name: 'a.ts, NEW line 1, column 11' })[1]);
        expect(screen.getByTestId('explorer-close-tabs-prompt')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(h.monaco.mock.calls.at(-1)![0].editedText).toBe('unsaved buffer');
        h.content.mockResolvedValue({ ...response, head: { ...response.head, content: 'changed needle\n' } });
        view.rerender(<WorkingTreeAllFilesDiff {...hostProps} onDirtyChange={dirty} refreshKey={1} />);
        await screen.findByTestId('working-tree-file-diff-disk-changed');
        expect(h.monaco.mock.calls.at(-1)![0].editedText).toBe('unsaved buffer');
        expect(h.monaco.mock.calls.at(-1)![0].revealTarget).toBeNull();
    });
});

describe('working-tree content search Classic coordinates', () => {
    it.each([
        ['old', 8, 1], ['new', 12, 1], ['old', 9, 2], ['new', 13, 3],
    ] as const)('maps %s source line %s to patch index %s with UTF-16 highlights', async (side, line, index) => {
        render(<WorkingTreeFileDiff {...props} contentSearchTarget={target(side, line)} initialHunkTarget="last" />);
        await screen.findByTestId('classic');
        expect(h.scroll).toHaveBeenLastCalledWith(index);
        expect(h.classic.mock.calls.at(-1)![0].matchRangesByLine.get(index)).toEqual([{ start: 2, end: 8, active: true }]);
        expect(h.hunk).not.toHaveBeenCalled();
        expect(h.content).not.toHaveBeenCalled();
    });
    it('repeats fresh targets and re-applies the same coordinates when changing to split layout', async () => {
        const match = target('old', 9);
        const view = render(<WorkingTreeFileDiff {...props} contentSearchTarget={match} />);
        await screen.findByTestId('classic');
        const count = h.scroll.mock.calls.length;
        view.rerender(<WorkingTreeFileDiff {...props} contentSearchTarget={match} />);
        expect(h.scroll).toHaveBeenCalledTimes(count);
        view.rerender(<WorkingTreeFileDiff {...props} contentSearchTarget={{ ...match }} />);
        expect(h.scroll).toHaveBeenCalledTimes(count + 1);
        fireEvent.click(screen.getByRole('button', { name: 'Unified view — switch to Split' }));
        await screen.findByTestId('split-classic');
        expect(h.scroll).toHaveBeenCalledTimes(count + 2);
        expect(h.scroll).toHaveBeenLastCalledWith(2);
    });
    it('offers outside-hunk Editor navigation without reading until explicitly selected', async () => {
        render(<WorkingTreeFileDiff {...props} contentSearchTarget={target('old', 1)} />);
        expect((await screen.findByTestId('search-outside-patch')).textContent).toContain('OLD line 1');
        expect(h.content).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Open in Editor view' }));
        await screen.findByTestId('editor');
        await waitFor(() => expect(h.monaco.mock.calls.at(-1)![0].revealTarget).toEqual({ side: 'original', line: 1, column: 3 }));
        expect(h.content).toHaveBeenCalledWith('workspace', '/repo/a.ts', 'unstaged');
        expect(h.monaco.mock.calls.at(-1)![0].viewMode).toBe('split');
    });
    it('waits for the current patch and never resolves against a previous file patch', async () => {
        const view = render(<WorkingTreeFileDiff {...props} contentSearchTarget={target('new', 13)} />);
        await screen.findByTestId('classic');
        h.scroll.mockClear();
        let finish!: (value: any) => void;
        h.patch.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
        view.rerender(<WorkingTreeFileDiff {...props} filePath="/repo/b.ts"
            contentSearchTarget={{ ...target('new', 13), filePath: '/repo/b.ts' }} />);
        expect(h.scroll).not.toHaveBeenCalled();
        await act(async () => { finish({ diff: '@@ -1 +13 @@\n-old\n+new' }); });
        expect(h.scroll).toHaveBeenLastCalledWith(2);
    });
    it('clears highlights and outside-hunk notices on ordinary navigation', async () => {
        const view = render(<WorkingTreeFileDiff {...props} contentSearchTarget={target('old', 1)} />);
        await screen.findByTestId('search-outside-patch');
        view.rerender(<WorkingTreeFileDiff {...props} />);
        expect(screen.queryByTestId('search-outside-patch')).toBeNull();
        expect(h.classic.mock.calls.at(-1)![0].matchRangesByLine).toBeUndefined();
    });
    it('supports an equal-text / empty patch search target in Editor view', async () => {
        h.patch.mockResolvedValue({ diff: '' });
        h.content.mockResolvedValue({ ...response, head: { ...response.head, content: response.base.content } });
        render(<WorkingTreeFileDiff {...props} contentSearchTarget={target('new', 1)} />);
        await screen.findByTestId('search-outside-patch');
        fireEvent.click(screen.getByRole('button', { name: 'Open in Editor view' }));
        await screen.findByTestId('editor');
        expect(h.monaco.mock.calls.at(-1)![0].revealTarget).toEqual({ side: 'modified', line: 1, column: 3 });
    });
});
