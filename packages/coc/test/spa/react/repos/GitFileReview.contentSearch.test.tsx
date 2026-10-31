// @vitest-environment jsdom
import { StrictMode, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { GitFileDiffContentResponse } from '@plusplusoneplusplus/coc-client';
import { GitFileReview } from '../../../../src/server/spa/client/react/features/git/diff/GitFileReview';
import { createBranchRangeDiffSource, createCommitDiffSource } from '../../../../src/server/spa/client/react/features/git/diff/diffSource';
import type { FileDiffPanelProps } from '../../../../src/server/spa/client/react/features/git/diff/FileDiffPanel';
import { ReviewContentSearchController } from '../../../../src/server/spa/client/react/features/git/diff/reviewContentSearchController';
import { registerCloneBaseUrls } from '../../../../src/server/spa/client/react/repos/cloneRegistry';
import { applyRuntimeConfigPatch } from '../../../../src/server/spa/client/react/utils/config';

const mocks = vi.hoisted(() => ({
    panel: vi.fn(),
    commit: vi.fn(),
    range: vi.fn(),
    client: vi.fn(),
}));
vi.mock('../../../../src/server/spa/client/react/api/cocClient', async importOriginal => {
    const actual = await importOriginal<typeof import('../../../../src/server/spa/client/react/api/cocClient')>();
    const client = (baseUrl?: string) => {
        mocks.client(baseUrl);
        return { git: { getCommitFileDiffContent: mocks.commit, getBranchRangeFileDiffContent: mocks.range } };
    };
    return { ...actual, getCocClientFor: client, getSpaCocClient: () => client() };
});
vi.mock('../../../../src/server/spa/client/react/features/git/diff/FileDiffPanel', () => ({
    FileDiffPanel: (props: FileDiffPanelProps) => {
        mocks.panel(props);
        return <div data-testid="focused-diff">{props.filePath}
            <button onClick={() => props.onNavigateToFile?.('src/a.ts', 'last')}>Navigate from editor</button>
        </div>;
    },
}));

const files = [
    { path: 'src/a.ts', status: 'M', additions: 1, deletions: 1 },
    { path: 'src/renamed.ts', oldPath: 'old/name.ts', status: 'R100', additions: 0, deletions: 0 },
    { path: 'docs/deleted.md', status: 'D', additions: 0, deletions: 1 },
];
function paired(path = 'src/a.ts'): GitFileDiffContentResponse {
    return {
        path, fileName: path, language: 'typescript', binary: false, tooLarge: false,
        base: { content: 'unchanged\nold target', exists: true, ref: 'base' },
        head: { content: 'unchanged\nnew target', exists: path !== 'docs/deleted.md', ref: 'head' },
    };
}
function props(kind: 'commit' | 'range' = 'commit', owner: string | null = null) {
    const source = kind === 'commit' ? createCommitDiffSource('ws', 'abc', { routingTarget: owner })
        : createBranchRangeDiffSource('ws', { routingTarget: owner, baseMode: 'upstream', revision: 'base..head',
            range: { baseRef: 'base', headRef: 'head', mergeBase: 'base-sha', headSha: 'head-sha' } });
    return { workspaceId: 'ws', attachmentDestinationId: owner ?? 'ws', comparisonKey: kind, files, source };
}
function enabled(value = true) { act(() => applyRuntimeConfigPatch({ diffContentSearchEnabled: value })); }
function search(query = 'target') {
    fireEvent.click(screen.getByRole('button', { name: 'Search review contents' }));
    fireEvent.change(screen.getByTestId('review-content-search-input'), { target: { value: query } });
}
async function settle() { await act(async () => { for (let n = 0; n < 30; n++) await Promise.resolve(); }); }
function latest(): FileDiffPanelProps { return mocks.panel.mock.calls.at(-1)![0]; }
beforeEach(() => {
    vi.clearAllMocks();
    mocks.commit.mockImplementation(async (_workspace: string, _hash: string, path: string) => paired(path));
    mocks.range.mockImplementation(async (_workspace: string, path: string) => paired(path));
});
afterEach(() => { cleanup(); enabled(false); registerCloneBaseUrls([]); vi.restoreAllMocks(); });

describe('commit and branch full-content review search', () => {
    it.each(['commit', 'range'] as const)('keeps %s reads lazy and routes every changed file through its existing loader', async kind => {
        render(<GitFileReview {...props(kind)} />);
        expect(screen.queryByRole('button', { name: 'Search review contents' })).toBeNull();
        expect(mocks.commit).not.toHaveBeenCalled();
        expect(mocks.range).not.toHaveBeenCalled();
        enabled(); search('unchanged'); await settle();
        const load = kind === 'commit' ? mocks.commit : mocks.range;
        expect(load).toHaveBeenCalledTimes(3);
        if (kind === 'commit') expect(load).toHaveBeenCalledWith('ws', 'abc', 'src/renamed.ts');
        else expect(load).toHaveBeenCalledWith('ws', 'src/renamed.ts', { base: 'upstream' });
        expect(screen.getByRole('button', { name: 'src/renamed.ts, OLD line 1, column 1' })).toBeDefined();
        expect(screen.queryByRole('button', { name: 'docs/deleted.md, NEW line 1, column 1' })).toBeNull();
        expect(mocks.client.mock.calls.every(([url]) => url === undefined)).toBe(true);
    });

    it('opens exact old/new matches outside all file filters without losing the query or cached contents', async () => {
        enabled();
        const onSelect = vi.fn();
        render(<GitFileReview {...props()} onSelect={onSelect} reviewedFiles={new Set(['src/renamed.ts'])} />);
        fireEvent.change(screen.getByLabelText('Search changed files by name or path'), { target: { value: 'absent' } });
        fireEvent.click(screen.getByRole('button', { name: 'Docs 1' }));
        fireEvent.change(screen.getByLabelText('Change status filter'), { target: { value: 'D' } });
        fireEvent.click(screen.getByLabelText('Hide viewed'));
        search(); await settle();
        const result = screen.getByRole('button', { name: 'src/renamed.ts, OLD line 2, column 5' });
        fireEvent.click(result);
        expect(onSelect).toHaveBeenLastCalledWith('src/renamed.ts', 'first');
        expect(latest()).toMatchObject({ filePath: 'src/renamed.ts',
            contentSearchTarget: { filePath: 'src/renamed.ts', side: 'old', line: 2, startColumn: 5, endColumn: 11 } });
        const target = latest().contentSearchTarget;
        fireEvent.click(result);
        expect(latest().contentSearchTarget).not.toBe(target);
        expect((screen.getByTestId('review-content-search-input') as HTMLInputElement).value).toBe('target');
        fireEvent.click(screen.getByRole('button', { name: 'src/renamed.ts, NEW line 2, column 5' }));
        expect(latest().contentSearchTarget?.side).toBe('new');
        fireEvent.click(screen.getByRole('button', { name: 'Files' }));
        expect((screen.getByLabelText('Search changed files by name or path') as HTMLInputElement).value).toBe('');
        expect(screen.getByLabelText('Hide viewed')).toHaveProperty('checked', false);
        fireEvent.click(screen.getByRole('button', { name: 'Search' }));
        await settle(); expect(mocks.commit).toHaveBeenCalledTimes(3);
    });

    it('preserves a match through its controlled route echo and clears it on editor or external file navigation', async () => {
        enabled();
        const initial = props();
        function Controlled() {
            const [path, setPath] = useState<string | null>(null);
            return <><GitFileReview {...initial} selectedPath={path} onSelect={setPath} />
                <button onClick={() => setPath('docs/deleted.md')}>External route</button></>;
        }
        render(<Controlled />); search(); await settle();
        fireEvent.click(screen.getByRole('button', { name: 'src/renamed.ts, OLD line 2, column 5' }));
        expect(latest().contentSearchTarget?.side).toBe('old');
        fireEvent.click(screen.getByRole('button', { name: 'Navigate from editor' }));
        expect(latest().filePath).toBe('src/a.ts');
        expect(latest().contentSearchTarget).toBeUndefined();
        fireEvent.keyDown(screen.getByTestId('review-content-search-input'), { key: 'Enter' });
        expect(latest().contentSearchTarget).toBeDefined();
        fireEvent.click(screen.getByRole('button', { name: 'External route' }));
        expect(latest().filePath).toBe('docs/deleted.md');
        expect(latest().contentSearchTarget).toBeUndefined();
    });

    it('retains the review cache when equivalent metadata/source objects rerender', async () => {
        enabled(); const initial = props();
        const view = render(<GitFileReview {...initial} />);
        search(); await settle();
        view.rerender(<GitFileReview {...initial} files={files.map(file => ({ ...file }))}
            source={{ ...initial.source }} />);
        expect((screen.getByTestId('review-content-search-input') as HTMLInputElement).value).toBe('target');
        fireEvent.change(screen.getByTestId('review-content-search-input'), { target: { value: 'unchanged' } });
        await settle(); expect(mocks.commit).toHaveBeenCalledTimes(3);
    });

    it.each(['owner', 'workspace', 'comparison', 'refs', 'files'] as const)('disposes the old cache and target when %s changes', async change => {
        enabled(); const initial = props();
        const dispose = vi.spyOn(ReviewContentSearchController.prototype, 'dispose');
        const view = render(<GitFileReview {...initial} />);
        search(); await settle();
        fireEvent.click(screen.getByRole('button', { name: 'src/renamed.ts, OLD line 2, column 5' }));
        view.rerender(<GitFileReview {...initial} {...(
            change === 'owner' ? { attachmentDestinationId: 'another-owner' }
                : change === 'workspace' ? { workspaceId: 'another-workspace' }
                    : change === 'comparison' ? { comparisonKey: 'another-comparison' }
                        : change === 'refs' ? { source: { ...initial.source, fileContextRefs: { baseRef: 'other-base', headRef: 'other-head' } } }
                            : { files: [...files, { ...files[0], path: 'extra.ts' }] }
        )} />);
        expect(dispose).toHaveBeenCalledTimes(1);
        expect(latest().contentSearchTarget).toBeUndefined();
        search(); await settle();
        expect(mocks.commit).toHaveBeenCalledTimes(change === 'files' ? 7 : 6);
    });

    it('isolates colliding owners and drops in-flight replies when the concrete endpoint changes', async () => {
        enabled();
        const owner = 'remote:one:ws';
        registerCloneBaseUrls([
            { workspaceId: 'ws', cloneKey: owner, baseUrl: 'https://one.example' },
            { workspaceId: 'ws', cloneKey: 'remote:two:ws', baseUrl: 'https://two.example' },
        ]);
        let release!: (response: GitFileDiffContentResponse) => void;
        mocks.commit.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
        const dispose = vi.spyOn(ReviewContentSearchController.prototype, 'dispose');
        render(<GitFileReview {...props('commit', owner)} />);
        search(); await settle();
        expect(mocks.client.mock.calls.every(([url]) => url === 'https://one.example')).toBe(true);
        act(() => registerCloneBaseUrls([{ workspaceId: 'ws', cloneKey: owner, baseUrl: 'https://replacement.example' }]));
        expect(dispose).toHaveBeenCalledTimes(1);
        release(paired()); await settle();
        expect((screen.getByTestId('review-content-search-input') as HTMLInputElement).value).toBe('');
        search(); await settle();
        expect(mocks.client).toHaveBeenLastCalledWith('https://replacement.example');
        expect(mocks.commit).toHaveBeenCalledTimes(6);
        act(() => registerCloneBaseUrls([]));
        expect(screen.getByRole('alert').textContent).toContain('owner is unavailable');
        expect(dispose).toHaveBeenCalledTimes(2);
    });

    it('allocates a usable controller under StrictMode and disposes on unmount', async () => {
        enabled();
        const dispose = vi.spyOn(ReviewContentSearchController.prototype, 'dispose');
        const view = render(<StrictMode><GitFileReview {...props()} /></StrictMode>);
        search(); await settle();
        expect(screen.getByRole('button', { name: 'src/a.ts, NEW line 2, column 5' })).toBeDefined();
        expect(mocks.commit).toHaveBeenCalledTimes(3);
        view.unmount();
        expect(dispose).toHaveBeenCalledTimes(2);
    });

    it('leaves patch-only sources without the search capability', () => {
        enabled(); const initial = props();
        render(<GitFileReview {...initial} source={{ ...initial.source, fetchFileContent: undefined }} />);
        expect(screen.queryByRole('button', { name: 'Search review contents' })).toBeNull();
    });
});
