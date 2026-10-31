// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PrReviewContent } from '../../../../src/server/spa/client/react/layout/popoutGitReview/PrReviewContent';
import { applyRuntimeConfigPatch } from '../../../../src/server/spa/client/react/utils/config';
import { registerCloneBaseUrls } from '../../../../src/server/spa/client/react/repos/cloneRegistry';
import { ReviewContentSearchController } from '../../../../src/server/spa/client/react/features/git/diff/reviewContentSearchController';
import type { FileDiffPanelProps } from '../../../../src/server/spa/client/react/features/git/diff/FileDiffPanel';

const mocks = vi.hoisted(() => ({
    detail: vi.fn(), diff: vi.fn(), content: vi.fn(), client: vi.fn(), contentOwner: vi.fn(), panel: vi.fn(), visited: vi.fn(),
}));
vi.mock('../../../../src/server/spa/client/react/api/cocClient', async importOriginal => {
    const actual = await importOriginal<typeof import('../../../../src/server/spa/client/react/api/cocClient')>();
    const client = (url?: string) => {
        mocks.client(url);
        return { pullRequests: {
            getForOrigin: mocks.detail, getDiffForOrigin: mocks.diff,
            getFileDiffContentForOrigin: (...args: unknown[]) => { mocks.contentOwner(url); return mocks.content(...args); },
        } };
    };
    return { ...actual, getCocClientFor: client, getSpaCocClient: () => client() };
});
vi.mock('../../../../src/server/spa/client/react/features/git/diff/FileDiffPanel', () => ({
    FileDiffPanel: (props: FileDiffPanelProps) => {
        mocks.panel(props);
        return <div data-testid="focused-diff">{props.filePath}
            <button onClick={() => props.onNavigateToFile?.('one.ts', 'last')}>Editor navigation</button>
            <button onClick={props.onBack}>Back to files</button>
        </div>;
    },
}));
vi.mock('../../../../src/server/spa/client/react/layout/popoutGitReview/PopOutClassificationToolbar', () => ({
    PopOutClassificationToolbar: () => null,
}));
vi.mock('../../../../src/server/spa/client/react/features/git/hooks/useReviewChatPresentation', () => ({
    useReviewChatPresentation: () => ({ chatOpen: false, presentation: 'side-panel' }),
}));
vi.mock('../../../../src/server/spa/client/react/features/git/commits/PrChatPanel', () => ({ PrChatPanel: () => null }));
vi.mock('../../../../src/server/spa/client/react/shared/ModalJobAiControls', () => ({
    useModalJobAiSelection: () => ({ resolved: { provider: 'copilot' } }),
}));
vi.mock('../../../../src/server/spa/client/react/features/git/diff/useClassification', () => ({
    useClassification: () => ({ state: { status: 'idle', activeFilters: new Set() } }),
}));
vi.mock('../../../../src/server/spa/client/react/features/git/diff/usePrReviewProgress', () => ({
    usePrReviewProgress: () => ({
        state: { reviewedFiles: new Set(), visitedFiles: new Set() },
        markVisited: mocks.visited, setLastSelectedFile: vi.fn(), toggleReviewed: vi.fn(), isReviewed: () => false,
    }),
}));
const patch = ['one.ts', 'two.ts'].map(path => `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-old\n+new`).join('\n');
const props = { workspaceId: 'ws', repoId: 'provider-repo', prId: '7', originId: 'origin-1' };
function latest(): FileDiffPanelProps { return mocks.panel.mock.calls.at(-1)![0]; }
function search() {
    fireEvent.click(screen.getByRole('button', { name: 'Search review contents' }));
    fireEvent.change(screen.getByTestId('review-content-search-input'), { target: { value: 'target' } });
}
async function settle() { await act(async () => { for (let n = 0; n < 30; n++) await Promise.resolve(); }); }
beforeEach(() => {
    vi.clearAllMocks();
    mocks.detail.mockResolvedValue({ title: 'Review', headSha: 'head', baseSha: 'base' });
    mocks.diff.mockResolvedValue(patch);
    mocks.content.mockImplementation(async (_origin: string, _pr: string, path: string) => ({
        path, fileName: path, language: 'typescript', binary: false, tooLarge: false,
        base: { content: 'old target', exists: true, ref: 'base' },
        head: { content: 'new target', exists: true, ref: 'head' },
    }));
    localStorage.clear();
});
afterEach(() => { cleanup(); act(() => applyRuntimeConfigPatch({ diffContentSearchEnabled: false })); registerCloneBaseUrls([]); vi.restoreAllMocks(); });

describe('pop-out PR full-content search', () => {
    it('keeps loading lazy and opens exact old/new targets without toggling off repeated selections', async () => {
        render(<PrReviewContent {...props} />);
        await waitFor(() => expect(screen.getByTestId('popout-file-panel')).toBeDefined());
        expect(mocks.content).not.toHaveBeenCalled();
        expect(screen.queryByRole('button', { name: 'Search review contents' })).toBeNull();
        act(() => applyRuntimeConfigPatch({ diffContentSearchEnabled: true }));
        search(); await settle();
        expect(mocks.content).toHaveBeenCalledTimes(2);
        fireEvent.keyDown(screen.getByTestId('review-content-search-input'), { key: 'F3' });
        expect(latest().contentSearchTarget?.side).toBe('old');
        expect(mocks.content).toHaveBeenCalledWith('origin-1', '7', 'two.ts', { workspaceId: 'ws', repoId: 'provider-repo' });
        const result = screen.getByRole('button', { name: 'two.ts, OLD line 1, column 5' });
        fireEvent.click(result);
        expect(latest()).toMatchObject({ filePath: 'two.ts', contentSearchTarget: {
            filePath: 'two.ts', side: 'old', line: 1, startColumn: 5, endColumn: 11,
        } });
        const previous = latest().contentSearchTarget;
        fireEvent.click(result);
        expect(latest().contentSearchTarget).not.toBe(previous);
        fireEvent.click(screen.getByRole('button', { name: 'two.ts, NEW line 1, column 5' }));
        expect(latest().contentSearchTarget?.side).toBe('new');
        expect(mocks.visited).toHaveBeenCalledWith('two.ts');
        fireEvent.click(screen.getByRole('button', { name: 'Files' }));
        fireEvent.click(screen.getByRole('button', { name: 'Search' }));
        expect((screen.getByTestId('review-content-search-input') as HTMLInputElement).value).toBe('target');
        expect(mocks.content).toHaveBeenCalledTimes(2);
        fireEvent.click(screen.getByRole('button', { name: 'Editor navigation' }));
        expect(latest().filePath).toBe('one.ts');
        expect(latest().contentSearchTarget).toBeUndefined();
        fireEvent.keyDown(screen.getByTestId('focused-diff'), { key: 'f', ctrlKey: true, shiftKey: true });
        expect(document.activeElement).toBe(screen.getByTestId('review-content-search-input'));
        fireEvent.keyDown(screen.getByTestId('review-content-search-input'), { key: 'Enter' });
        expect(latest().contentSearchTarget).toBeDefined();
        fireEvent.click(screen.getByRole('button', { name: 'Back to files' }));
        expect(screen.queryByTestId('focused-diff')).toBeNull();
    });

    it('replaces controllers on endpoint and PR changes and never loads a colliding clone', async () => {
        act(() => applyRuntimeConfigPatch({ diffContentSearchEnabled: true }));
        const owner = 'remote:one:ws';
        registerCloneBaseUrls([
            { workspaceId: 'ws', cloneKey: owner, baseUrl: 'https://one.example' },
            { workspaceId: 'ws', cloneKey: 'remote:two:ws', baseUrl: 'https://two.example' },
        ]);
        const dispose = vi.spyOn(ReviewContentSearchController.prototype, 'dispose');
        const view = render(<PrReviewContent {...props} attachmentDestinationId={owner} />);
        await waitFor(() => expect(screen.getByTestId('popout-file-panel')).toBeDefined());
        search(); await settle();
        expect(mocks.contentOwner.mock.calls.every(([url]) => url === 'https://one.example')).toBe(true);
        const before = dispose.mock.calls.length;
        act(() => registerCloneBaseUrls([{ workspaceId: 'ws', cloneKey: owner, baseUrl: 'https://replacement.example' }]));
        await waitFor(() => expect(screen.getByTestId('popout-file-panel')).toBeDefined());
        search(); await settle();
        expect(dispose.mock.calls.length).toBeGreaterThan(before);
        expect(mocks.contentOwner).toHaveBeenLastCalledWith('https://replacement.example');
        expect(mocks.content).toHaveBeenCalledTimes(4);
        view.rerender(<PrReviewContent {...props} prId="8" attachmentDestinationId={owner} />);
        await waitFor(() => expect(mocks.detail).toHaveBeenCalledWith('origin-1', '8', { workspaceId: 'ws', repoId: 'provider-repo' }));
        await waitFor(() => expect(screen.getByTestId('popout-file-panel')).toBeDefined());
        search(); await settle();
        expect(mocks.content).toHaveBeenLastCalledWith('origin-1', '8', 'two.ts', { workspaceId: 'ws', repoId: 'provider-repo' });
    });
});
