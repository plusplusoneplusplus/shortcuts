/**
 * Wiring tests for the diff-engine preference in WorkingTreeFileDiff (AC-04):
 * the Classic/Editor toolbar control, engine selection from the cached
 * preference, both sides loaded from the selected workspace's client, and the
 * classic viewer when the editor cannot show the file. Monaco is not loaded;
 * the editor is the owned test adapter.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { createFakeDiffEditor, type FakeDiffEditor } from './fakeDiffEditorAdapter';


vi.mock('../../../../../../src/server/spa/client/react/features/git/hooks/useDiffComments', () => ({
    useDiffComments: () => ({
        comments: [], loading: false, error: null, isEphemeral: false,
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
    UnifiedDiffViewer: ({ diff }: { diff: string }) => <div data-testid="classic-viewer">{diff}</div>,
    HunkNavButtons: ({ onNext }: { onNext: () => void }) => <button data-testid="hunk-next" onClick={onNext}>next</button>,
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
const createDiffEditor: DiffEditorFactory = async (_host, options) => {
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
    localStorage.clear();
    __resetDiffEngineForTesting();
    getGlobal.mockReset().mockReturnValue(new Promise(() => {}));
    patchGlobal.mockReset().mockResolvedValue({});
    clients['ws-a'] = makeClient();
    clients['ws-b'] = makeClient();
});

describe('WorkingTreeFileDiff — diff engine', () => {
    it('renders the classic viewer by default and does not load full sides', async () => {
        await renderDiff();
        expect(screen.getByTestId('classic-viewer')).toBeTruthy();
        expect(screen.queryByTestId('working-tree-file-diff-editor')).toBeNull();
        expect(clients['ws-a'].git.getWorkingTreeFileContent).not.toHaveBeenCalled();
        expect(screen.getByTestId('diff-engine-toggle-legacy').getAttribute('aria-pressed')).toBe('true');
    });

    it('uses the cached Editor engine on first paint and feeds both server sides to Monaco', async () => {
        localStorage.setItem(DIFF_ENGINE_STORAGE_KEY, 'monaco');
        await renderDiff();
        expect(screen.getByTestId('diff-engine-toggle-monaco').getAttribute('aria-pressed')).toBe('true');
        expect(clients['ws-a'].git.getWorkingTreeFileContent).toHaveBeenCalledWith('ws-a', '/repo/src/a.ts', 'unstaged');
        expect(screen.getByTestId('working-tree-file-diff-editor')).toBeTruthy();
        expect(screen.queryByTestId('classic-viewer')).toBeNull();
        expect(fakes).toHaveLength(1);
        const models = fakes[0].models[0];
        expect(models.original.text).toBe('a\n');
        expect(models.modified.text).toBe('b\n');
        // Unstaged working copy uses the real repo-relative document URI.
        expect(models.modified.uri).toContain('src/a.ts');
        expect(models.original.uri).toMatch(/^coc-diff-ref:/);
    });

    it('routes the content request to the selected workspace client', async () => {
        localStorage.setItem(DIFF_ENGINE_STORAGE_KEY, 'monaco');
        await renderDiff({ workspaceId: 'ws-b', stage: 'staged' });
        expect(clients['ws-b'].git.getWorkingTreeFileContent).toHaveBeenCalledWith('ws-b', '/repo/src/a.ts', 'staged');
        expect(clients['ws-a'].git.getWorkingTreeFileContent).not.toHaveBeenCalled();
        const models = fakes[0].models[0];
        expect(models.original.uri).toMatch(/^coc-diff-ref:/);
        expect(models.modified.uri).toMatch(/^coc-diff-ref:/);
    });

    it('switches engine in place from the toolbar and persists the choice', async () => {
        await renderDiff();
        await act(async () => { fireEvent.click(screen.getByTestId('diff-engine-toggle-monaco')); });
        await act(async () => {});
        expect(patchGlobal).toHaveBeenCalledWith({ diffEngine: 'monaco' });
        expect(localStorage.getItem(DIFF_ENGINE_STORAGE_KEY)).toBe('monaco');
        expect(screen.getByTestId('working-tree-file-diff-editor')).toBeTruthy();

        await act(async () => { fireEvent.click(screen.getByTestId('diff-engine-toggle-legacy')); });
        expect(screen.getByTestId('classic-viewer')).toBeTruthy();
        expect(screen.queryByTestId('working-tree-file-diff-editor')).toBeNull();
        expect(fakes[0].disposals).toBe(1);
    });

    it('keeps the classic viewer for binary or oversized content and failed loads', async () => {
        localStorage.setItem(DIFF_ENGINE_STORAGE_KEY, 'monaco');
        clients['ws-a'].git.getWorkingTreeFileContent.mockResolvedValueOnce(content('', '', { binary: true }));
        const first = await renderDiff();
        expect(screen.getByTestId('classic-viewer')).toBeTruthy();
        first.unmount();

        clients['ws-a'].git.getWorkingTreeFileContent.mockResolvedValueOnce(content('', '', { tooLarge: true }));
        const second = await renderDiff();
        expect(screen.getByTestId('classic-viewer')).toBeTruthy();
        second.unmount();

        clients['ws-a'].git.getWorkingTreeFileContent.mockRejectedValueOnce(new Error('boom'));
        await renderDiff();
        expect(screen.getByTestId('classic-viewer')).toBeTruthy();
        expect(fakes).toHaveLength(0);
    });

    it('does not offer the engine control for untracked files', async () => {
        localStorage.setItem(DIFF_ENGINE_STORAGE_KEY, 'monaco');
        await renderDiff({ stage: 'untracked' });
        expect(screen.getByTestId('preview-pane')).toBeTruthy();
        expect(screen.queryByTestId('diff-engine-toggle')).toBeNull();
        expect(clients['ws-a'].git.getWorkingTreeFileContent).not.toHaveBeenCalled();
    });

    it('drives hunk navigation through the Monaco viewer when the editor is active', async () => {
        localStorage.setItem(DIFF_ENGINE_STORAGE_KEY, 'monaco');
        await renderDiff();
        await act(async () => {
            fakes[0].finishDiff([{ originalStartLineNumber: 1, originalEndLineNumber: 1, modifiedStartLineNumber: 1, modifiedEndLineNumber: 1 }]);
        });
        fireEvent.click(screen.getByTestId('hunk-next'));
        expect(fakes[0].adapter.revealModifiedLine).toHaveBeenCalled();
    });
});
