/**
 * Wiring tests for the classic fallback in WorkingTreeFileDiff (AC-07): the
 * visible reason banner, retry issuing a fresh content request, sticky editor
 * failures, and the classic viewer receiving the same comments and patch.
 * Monaco is not loaded; the editor is the owned test adapter.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createFakeDiffEditor, type FakeDiffEditor } from './fakeDiffEditorAdapter';


const COMMENTS = [{ id: 'c1', comment: 'look here', selection: { diffLineStart: 1, diffLineEnd: 1, side: 'added' } }];
const classicProps = vi.fn();

vi.mock('../../../../../../src/server/spa/client/react/features/git/hooks/useDiffComments', () => ({
    useDiffComments: () => ({
        comments: COMMENTS, loading: false, error: null, isEphemeral: false,
        addComment: vi.fn(), updateComment: vi.fn(), deleteComment: vi.fn(),
        resolveComment: vi.fn(), unresolveComment: vi.fn(), askAI: vi.fn(),
        aiLoadingIds: new Set(), aiErrors: new Map(), clearAiError: vi.fn(),
        resolvingIds: new Set(), deletingIds: new Set(),
        refresh: vi.fn(), runRelocation: vi.fn(), copyAllCommentsAsPrompt: vi.fn(),
    }),
}));

vi.mock('../../../../../../src/server/spa/client/react/contexts/QueueContext', () => ({
    useQueue: () => ({ state: {}, dispatch: vi.fn() }),
}));

vi.mock('../../../../../../src/server/spa/client/react/layout/ThemeProvider', () => ({
    useTheme: () => ({ theme: 'light', setTheme: () => {} }),
}));

vi.mock('../../../../../../src/server/spa/client/react/features/git/diff/UnifiedDiffViewer', () => ({
    UnifiedDiffViewer: (props: { diff: string }) => {
        classicProps(props);
        return <div data-testid="classic-viewer">{props.diff}</div>;
    },
    HunkNavButtons: ({ onNext }: { onNext: () => void }) => <button data-testid="hunk-next" onClick={onNext}>next</button>,
}));

vi.mock('../../../../../../src/server/spa/client/react/features/git/diff/SideBySideDiffViewer', () => ({
    SideBySideDiffViewer: (props: { diff: string }) => {
        classicProps(props);
        return <div data-testid="classic-split-viewer">{props.diff}</div>;
    },
}));

vi.mock('../../../../../../src/server/spa/client/react/features/repo-detail/explorer', () => ({
    PreviewPane: () => <div data-testid="preview-pane" />,
}));

const getGlobal = vi.fn();
const patchGlobal = vi.fn();
vi.mock('../../../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({ preferences: { getGlobal, patchGlobal } }),
}));

type Content = {
    path: string; fileName: string; language: string; binary: boolean; tooLarge: boolean;
    base: { content: string; ref: string; exists: boolean };
    head: { content: string; ref: string; exists: boolean };
};
function content(original: string, modified: string, extra: Partial<Content> = {}): Content {
    return {
        path: '/repo/src/a.ts', fileName: 'a.ts', language: 'typescript', binary: false, tooLarge: false,
        base: { content: original, ref: 'INDEX', exists: true },
        head: { content: modified, ref: 'WORKTREE', exists: true },
        ...extra,
    };
}
function makeClient() {
    return {
        git: {
            getWorkingTreeFileDiff: vi.fn(async () => ({ diff: '@@ -1 +1 @@\n-a\n+b', truncated: false, totalLines: 2 })),
            getWorkingTreeFileContent: vi.fn(async () => content('a\n', 'b\n')),
        },
    };
}
const clients: Record<string, ReturnType<typeof makeClient>> = {};
vi.mock('../../../../../../src/server/spa/client/react/repos/cloneRouting', () => ({
    useCocClient: (workspaceId: string) => clients[workspaceId],
}));

import { WorkingTreeFileDiff } from '../../../../../../src/server/spa/client/react/features/git/working-tree/WorkingTreeFileDiff';
import {
    DIFF_ENGINE_STORAGE_KEY,
    __resetDiffEngineForTesting,
} from '../../../../../../src/server/spa/client/react/features/git/hooks/useDiffEngine';
import type { DiffEditorFactory } from '../../../../../../src/server/spa/client/react/features/git/diff/monacoDiffEditorAdapter';

let fakes: FakeDiffEditor[];
let failEditor = false;
const createDiffEditor: DiffEditorFactory = async (_host, options) => {
    if (failEditor) throw new Error('editor boom');
    const fake = createFakeDiffEditor(options);
    fakes.push(fake);
    return fake.adapter;
};

async function renderDiff(props: Partial<React.ComponentProps<typeof WorkingTreeFileDiff>> = {}) {
    let view!: ReturnType<typeof render>;
    await act(async () => {
        view = render(
            <WorkingTreeFileDiff
                workspaceId="ws-a"
                filePath="/repo/src/a.ts"
                repoRoot="/repo"
                stage="unstaged"
                createDiffEditor={createDiffEditor}
                {...props}
            />,
        );
    });
    await act(async () => {});
    return view;
}

beforeEach(() => {
    fakes = [];
    failEditor = false;
    classicProps.mockClear();
    localStorage.clear();
    __resetDiffEngineForTesting();
    getGlobal.mockReset().mockReturnValue(new Promise(() => {}));
    patchGlobal.mockReset().mockResolvedValue({});
    clients['ws-a'] = makeClient();
    clients['ws-b'] = makeClient();
});

const banner = () => screen.queryByTestId('diff-engine-fallback-banner');

describe('WorkingTreeFileDiff — classic fallback', () => {
    it('shows no banner when the user chose Classic', async () => {
        await renderDiff();
        expect(screen.getByTestId('classic-viewer')).toBeTruthy();
        expect(banner()).toBeNull();
    });

    it('shows no banner while the editor renders', async () => {
        localStorage.setItem(DIFF_ENGINE_STORAGE_KEY, 'monaco');
        await renderDiff();
        expect(screen.getByTestId('working-tree-file-diff-editor')).toBeTruthy();
        expect(banner()).toBeNull();
    });

    it('states the specific reason for binary and oversized files, without retry', async () => {
        localStorage.setItem(DIFF_ENGINE_STORAGE_KEY, 'monaco');
        clients['ws-a'].git.getWorkingTreeFileContent.mockResolvedValueOnce(content('', '', { binary: true }));
        const first = await renderDiff();
        expect(banner()?.getAttribute('data-reason')).toBe('binary');
        expect(banner()?.textContent).toMatch(/Binary file/);
        expect(screen.queryByTestId('diff-engine-fallback-retry')).toBeNull();
        first.unmount();

        clients['ws-a'].git.getWorkingTreeFileContent.mockResolvedValueOnce(
            content('', '', { binary: true, tooLarge: true }),
        );
        const second = await renderDiff();
        expect(banner()?.getAttribute('data-reason')).toBe('binary');
        second.unmount();

        clients['ws-a'].git.getWorkingTreeFileContent.mockResolvedValueOnce(content('', '', { tooLarge: true }));
        await renderDiff();
        expect(banner()?.getAttribute('data-reason')).toBe('tooLarge');
        expect(banner()?.textContent).toMatch(/too large/);
        expect(screen.getByTestId('classic-viewer')).toBeTruthy();
        expect(fakes).toHaveLength(0);
    });

    it('shows the generic reason on a failed load and retry issues a fresh content request', async () => {
        localStorage.setItem(DIFF_ENGINE_STORAGE_KEY, 'monaco');
        const getContent = clients['ws-a'].git.getWorkingTreeFileContent;
        getContent.mockRejectedValueOnce(new Error('boom'));
        await renderDiff();
        expect(banner()?.getAttribute('data-reason')).toBe('loadFailed');
        expect(screen.getByTestId('classic-viewer')).toBeTruthy();
        expect(getContent).toHaveBeenCalledTimes(1);

        await act(async () => { fireEvent.click(screen.getByTestId('diff-engine-fallback-retry')); });
        await act(async () => {});
        expect(getContent).toHaveBeenCalledTimes(2);
        expect(getContent).toHaveBeenLastCalledWith('ws-a', '/repo/src/a.ts', 'unstaged');
        expect(banner()).toBeNull();
        expect(screen.getByTestId('working-tree-file-diff-editor')).toBeTruthy();
    });

    it('falls back when the editor fails, stays there across re-renders, and retry re-mounts it', async () => {
        localStorage.setItem(DIFF_ENGINE_STORAGE_KEY, 'monaco');
        failEditor = true;
        const view = await renderDiff();
        await act(async () => {});
        expect(banner()?.getAttribute('data-reason')).toBe('editorFailed');
        expect(screen.getByTestId('classic-viewer')).toBeTruthy();
        expect(screen.getByTestId('diff-engine-fallback-retry')).toBeTruthy();

        // No flapping: re-rendering and switching view mode keep the classic viewer.
        const getContent = clients['ws-a'].git.getWorkingTreeFileContent;
        const calls = getContent.mock.calls.length;
        view.rerender(
            <WorkingTreeFileDiff workspaceId="ws-a" filePath="/repo/src/a.ts" repoRoot="/repo" stage="unstaged" createDiffEditor={createDiffEditor} />,
        );
        await act(async () => { fireEvent.click(screen.getByTestId('diff-view-toggle-split')); });
        await act(async () => {});
        expect(banner()?.getAttribute('data-reason')).toBe('editorFailed');
        expect(screen.queryByTestId('working-tree-file-diff-editor')).toBeNull();
        expect(getContent.mock.calls.length).toBe(calls);

        failEditor = false;
        await act(async () => { fireEvent.click(screen.getByTestId('diff-engine-fallback-retry')); });
        await act(async () => {});
        expect(getContent.mock.calls.length).toBe(calls + 1);
        expect(banner()).toBeNull();
        expect(screen.getByTestId('working-tree-file-diff-editor')).toBeTruthy();
        expect(fakes).toHaveLength(1);
    });

    it('clears a fallback when moving to another file', async () => {
        localStorage.setItem(DIFF_ENGINE_STORAGE_KEY, 'monaco');
        clients['ws-a'].git.getWorkingTreeFileContent.mockResolvedValueOnce(content('', '', { binary: true }));
        const view = await renderDiff();
        expect(banner()?.getAttribute('data-reason')).toBe('binary');
        await act(async () => {
            view.rerender(
                <WorkingTreeFileDiff workspaceId="ws-a" filePath="/repo/src/b.ts" repoRoot="/repo" stage="unstaged" createDiffEditor={createDiffEditor} />,
            );
        });
        await act(async () => {});
        expect(banner()).toBeNull();
        expect(screen.getByTestId('working-tree-file-diff-editor')).toBeTruthy();
    });

    it('passes the same comments and patch to the classic viewer on fallback', async () => {
        await renderDiff();
        const classicDefault = classicProps.mock.calls.at(-1)![0];
        classicProps.mockClear();
        localStorage.setItem(DIFF_ENGINE_STORAGE_KEY, 'monaco');
        __resetDiffEngineForTesting();
        clients['ws-a'].git.getWorkingTreeFileContent.mockResolvedValueOnce(content('', '', { tooLarge: true }));
        cleanup();
        await renderDiff();
        const fallback = classicProps.mock.calls.at(-1)![0];
        expect(banner()).toBeTruthy();
        expect(fallback.diff).toBe(classicDefault.diff);
        expect(fallback.comments).toBe(COMMENTS);
        expect(fallback.comments).toBe(classicDefault.comments);
        expect(fallback.enableComments).toBe(true);
        expect(typeof fallback.onAddComment).toBe('function');
        // The patch comes from the existing diff route on the selected workspace client.
        expect(clients['ws-a'].git.getWorkingTreeFileDiff).toHaveBeenCalledWith('ws-a', '/repo/src/a.ts', { stage: 'unstaged', full: false });
    });

    it('keeps the untracked branch untouched: preview, no banner, no content request', async () => {
        localStorage.setItem(DIFF_ENGINE_STORAGE_KEY, 'monaco');
        await renderDiff({ stage: 'untracked' });
        expect(screen.getByTestId('preview-pane')).toBeTruthy();
        expect(banner()).toBeNull();
        expect(clients['ws-a'].git.getWorkingTreeFileContent).not.toHaveBeenCalled();
    });
});
