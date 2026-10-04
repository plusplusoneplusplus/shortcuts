/**
 * Editing the modified (disk) side of a working-tree diff in the Monaco engine
 * (editable-working-tree-diff AC-01, AC-02): which stages open for editing, and that
 * Ctrl/Cmd+S writes the edited text to disk through the explorer blob API,
 * keyed by the diff's own workspace. The editor is the owned test adapter.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { createFakeDiffEditor, type FakeDiffEditor } from './fakeDiffEditorAdapter';


// The unstaged editor opens a language document (AC-06); keep the transport inert.
vi.mock('../../../../../../src/server/spa/client/react/features/language-servers/languageServerClient',
    async () => await import('../../../language-servers/inertTransportMock'));
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

const writeBlob = vi.fn();
vi.mock('../../../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerApi', () => ({
    explorerApi: { writeBlob: (...args: unknown[]) => writeBlob(...args) },
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

import { WorkingTreeFileDiff, stagedDiskMatchesIndex } from '../../../../../../src/server/spa/client/react/features/git/working-tree/WorkingTreeFileDiff';
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
    localStorage.setItem(DIFF_ENGINE_STORAGE_KEY, 'monaco');
    getGlobal.mockReset().mockReturnValue(new Promise(() => {}));
    patchGlobal.mockReset().mockResolvedValue({});
    writeBlob.mockReset().mockResolvedValue({ success: true });
    clients['ws-a'] = makeClient();
    clients['ws-b'] = makeClient();
});

describe('WorkingTreeFileDiff — editable unstaged diff', () => {
    it('opens the modified side for editing and keeps the original read-only', async () => {
        await renderDiff();
        expect(fakes[0].options[0]).toMatchObject({ readOnly: false, originalEditable: false });
        expect(fakes[0].saveCommands.size).toBe(1);
    });

    it('typing then Ctrl/Cmd+S writes the edited text to disk', async () => {
        await renderDiff();
        act(() => fakes[0].type('b\nmore\n'));
        await act(async () => { fakes[0].pressSave(); });
        expect(writeBlob).toHaveBeenCalledTimes(1);
        expect(writeBlob).toHaveBeenCalledWith('ws-a', 'src/a.ts', 'b\nmore\n');
    });

    it('writes to the diff\'s own workspace (multi-repo)', async () => {
        await renderDiff({ workspaceId: 'ws-b' });
        act(() => fakes[0].type('edited\n'));
        await act(async () => { fakes[0].pressSave(); });
        expect(writeBlob).toHaveBeenCalledWith('ws-b', 'src/a.ts', 'edited\n');
    });

    it('Ctrl/Cmd+S with no edits, or after a save, writes nothing more', async () => {
        await renderDiff();
        await act(async () => { fakes[0].pressSave(); });
        expect(writeBlob).not.toHaveBeenCalled();
        act(() => fakes[0].type('x\n'));
        await act(async () => { fakes[0].pressSave(); });
        await act(async () => { fakes[0].pressSave(); });
        expect(writeBlob).toHaveBeenCalledTimes(1);
    });

    it('typing back to the disk text is not an edit to save', async () => {
        await renderDiff();
        act(() => fakes[0].type('changed\n'));
        act(() => fakes[0].type('b\n'));
        await act(async () => { fakes[0].pressSave(); });
        expect(writeBlob).not.toHaveBeenCalled();
    });

    it('a failed write shows the error and a later save retries', async () => {
        writeBlob.mockRejectedValueOnce(new Error('disk full'));
        await renderDiff();
        act(() => fakes[0].type('x\n'));
        await act(async () => { fakes[0].pressSave(); });
        expect(screen.getByTestId('working-tree-file-diff-save-error').textContent).toContain('disk full');
        await act(async () => { fakes[0].pressSave(); });
        expect(writeBlob).toHaveBeenCalledTimes(2);
        expect(screen.queryByTestId('working-tree-file-diff-save-error')).toBeNull();
    });

});

describe('WorkingTreeFileDiff — editable staged diff (disk == index)', () => {
    /** Staged sides HEAD → index; unstaged sides index → disk. */
    function stagedClient(index: string, disk: string, workspaceId = 'ws-a') {
        const client = clients[workspaceId];
        client.git.getWorkingTreeFileContent.mockImplementation(async (_ws: string, _p: string, stage: string) =>
            stage === 'staged'
                ? content('head\n', index, { head: { content: index, ref: 'INDEX', exists: true } })
                : content(index, disk));
        return client;
    }

    it('is editable when the disk file equals the index, and uses the real document URI', async () => {
        stagedClient('b\n', 'b\n');
        await renderDiff({ stage: 'staged' });
        expect(fakes[0].options[0]).toMatchObject({ readOnly: false, originalEditable: false });
        expect(fakes[0].saveCommands.size).toBe(1);
        expect(fakes[0].models[0].modified.uri).not.toMatch(/^coc-diff-ref:/);
        expect(fakes[0].models[0].original.uri).toMatch(/^coc-diff-ref:/);
        expect(screen.queryByTestId('working-tree-file-diff-staged-readonly-note')).toBeNull();
    });

    it('save writes only the disk file of the diff\'s own workspace', async () => {
        const client = stagedClient('b\n', 'b\n', 'ws-b');
        await renderDiff({ stage: 'staged', workspaceId: 'ws-b' });
        act(() => fakes[0].type('b\nedit\n'));
        await act(async () => { fakes[0].pressSave(); });
        expect(writeBlob).toHaveBeenCalledTimes(1);
        expect(writeBlob).toHaveBeenCalledWith('ws-b', 'src/a.ts', 'b\nedit\n');
        // No git calls beyond reading the two content views (never stages).
        expect(Object.keys(client.git).sort()).toEqual(['getWorkingTreeFileContent', 'getWorkingTreeFileDiff']);
    });

    it('stays read-only with a note when the disk file has unstaged changes', async () => {
        stagedClient('b\n', 'c\n');
        await renderDiff({ stage: 'staged' });
        expect(fakes[0].options[0]).toMatchObject({ readOnly: true });
        expect(fakes[0].saveCommands.size).toBe(0);
        expect(fakes[0].models[0].modified.uri).toMatch(/^coc-diff-ref:/);
        expect(screen.getByTestId('working-tree-file-diff-staged-readonly-note').textContent)
            .toContain('File has unstaged changes');
    });

    it('stays read-only when the disk check fails', async () => {
        const client = clients['ws-a'];
        client.git.getWorkingTreeFileContent.mockImplementation(async (_ws: string, _p: string, stage: string) => {
            if (stage === 'staged') return content('a\n', 'b\n');
            throw new Error('boom');
        });
        await renderDiff({ stage: 'staged' });
        expect(fakes[0].options[0]).toMatchObject({ readOnly: true });
    });
});

describe('stagedDiskMatchesIndex', () => {
    const staged = (index: string, exists = true) =>
        content('h\n', index, { head: { content: index, ref: 'INDEX', exists } }) as never;
    it('matches only an existing, identical, loadable disk file', () => {
        expect(stagedDiskMatchesIndex(staged('x'), content('x', 'x') as never)).toBe(true);
        expect(stagedDiskMatchesIndex(staged('x'), content('x', 'y') as never)).toBe(false);
        expect(stagedDiskMatchesIndex(staged('x'), null)).toBe(false);
        expect(stagedDiskMatchesIndex(staged('x'), content('x', 'x', { binary: true }) as never)).toBe(false);
        expect(stagedDiskMatchesIndex(staged('x'), content('x', 'x', { tooLarge: true }) as never)).toBe(false);
        // Staged deletion: no index file, so nothing to edit.
        expect(stagedDiskMatchesIndex(staged('', false), content('', '', { head: { content: '', ref: 'WORKTREE', exists: false } }) as never)).toBe(false);
    });
});
