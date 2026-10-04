/**
 * Wiring tests for comments on the working-tree surface with the Editor
 * engine (AC-05): the existing CommentCard is portalled into the editor's
 * view zones with the surface's real callbacks; selections open the existing
 * InlineCommentPopup and ask-AI / copy-as-context flows; the sidebar reveals
 * threads; relocation still runs; engine toggling disposes cleanly. Monaco is
 * not loaded; the editor is the owned test adapter.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { DiffComment } from '../../../../../../src/server/spa/client/comments/diff-comment-types';
import { createFakeDiffEditor, type FakeDiffEditor } from './fakeDiffEditorAdapter';

const hooks = vi.hoisted(() => ({
    comments: [] as unknown[],
    addComment: vi.fn(), updateComment: vi.fn(), deleteComment: vi.fn(),
    resolveComment: vi.fn(), unresolveComment: vi.fn(), askAI: vi.fn(),
    runRelocation: vi.fn(), queueDispatch: vi.fn(), copyToClipboard: vi.fn(async () => {}),
}));

// The unstaged editor opens a language document (AC-06); keep the transport inert.
vi.mock('../../../../../../src/server/spa/client/react/features/language-servers/languageServerClient',
    async () => await import('../../../language-servers/inertTransportMock'));
vi.mock('../../../../../../src/server/spa/client/react/features/git/hooks/useDiffComments', () => ({
    useDiffComments: () => ({
        comments: hooks.comments, loading: false, error: null, isEphemeral: false,
        addComment: hooks.addComment, updateComment: hooks.updateComment, deleteComment: hooks.deleteComment,
        resolveComment: hooks.resolveComment, unresolveComment: hooks.unresolveComment, askAI: hooks.askAI,
        aiLoadingIds: new Set(), aiErrors: new Map(), clearAiError: vi.fn(),
        resolvingIds: new Set(), deletingIds: new Set(),
        refresh: vi.fn(), runRelocation: hooks.runRelocation, copyAllCommentsAsPrompt: vi.fn(),
    }),
}));

vi.mock('../../../../../../src/server/spa/client/react/contexts/QueueContext', () => ({
    useQueue: () => ({ state: {}, dispatch: hooks.queueDispatch }),
}));

vi.mock('../../../../../../src/server/spa/client/react/utils/format', async (importOriginal) => ({
    ...(await importOriginal<object>()),
    copyToClipboard: hooks.copyToClipboard,
}));

vi.mock('../../../../../../src/server/spa/client/react/layout/ThemeProvider', () => ({
    useTheme: () => ({ theme: 'light', setTheme: () => {} }),
}));

vi.mock('../../../../../../src/server/spa/client/react/features/git/diff/UnifiedDiffViewer', () => ({
    UnifiedDiffViewer: (props: { diff: string }) => <div data-testid="classic-viewer">{props.diff}</div>,
    HunkNavButtons: () => null,
}));

vi.mock('../../../../../../src/server/spa/client/react/features/repo-detail/explorer', () => ({
    PreviewPane: () => <div data-testid="preview-pane" />,
}));

vi.mock('../../../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({ preferences: { getGlobal: () => new Promise(() => {}), patchGlobal: vi.fn(async () => ({})) } }),
}));

const ORIGINAL = 'a\nb\nc\n';
const MODIFIED = 'a\nB\nc\nd\n';
const CHANGES = [
    { originalStartLineNumber: 2, originalEndLineNumber: 2, modifiedStartLineNumber: 2, modifiedEndLineNumber: 2 },
    { originalStartLineNumber: 3, originalEndLineNumber: 0, modifiedStartLineNumber: 4, modifiedEndLineNumber: 4 },
];

function makeClient() {
    return {
        git: {
            getWorkingTreeFileDiff: vi.fn(async () => ({ diff: '@@ -1,3 +1,4 @@\n a\n-b\n+B\n c\n+d', truncated: false, totalLines: 6 })),
            getWorkingTreeFileContent: vi.fn(async () => ({
                path: '/repo/src/a.ts', fileName: 'a.ts', language: 'typescript', binary: false, tooLarge: false,
                base: { content: ORIGINAL, ref: 'INDEX', exists: true },
                head: { content: MODIFIED, ref: 'WORKTREE', exists: true },
            })),
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

function comment(id: string, extra: Partial<DiffComment> = {}): DiffComment {
    return {
        id,
        context: { repositoryId: 'ws-a', filePath: '/repo/src/a.ts', oldRef: 'INDEX', newRef: 'working-tree' },
        selection: { diffLineStart: 5, diffLineEnd: 5, side: 'added', oldLineStart: NaN, oldLineEnd: NaN, newLineStart: 4, newLineEnd: 4, startColumn: 0, endColumn: 1 },
        selectedText: 'd',
        comment: `note ${id}`,
        status: 'open',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        ...extra,
    };
}

let fakes: FakeDiffEditor[];
const createDiffEditor: DiffEditorFactory = async (_host, options) => {
    const fake = createFakeDiffEditor(options);
    fakes.push(fake);
    return fake.adapter;
};
const fake = () => fakes[fakes.length - 1];

async function renderEditor() {
    let view!: ReturnType<typeof render>;
    await act(async () => {
        view = render(
            <WorkingTreeFileDiff workspaceId="ws-a" filePath="/repo/src/a.ts" repoRoot="/repo" stage="unstaged" createDiffEditor={createDiffEditor} />,
        );
    });
    await act(async () => {});
    await act(async () => { fake().finishDiff(CHANGES); });
    return view;
}

const zoneOf = (id: string) => [...fake().zones.values()].find(z => z.domNode.querySelector(`[data-comment-id="${id}"]`));

beforeEach(() => {
    fakes = [];
    for (const fn of Object.values(hooks)) if (typeof fn === 'function' && 'mockClear' in fn) fn.mockClear();
    hooks.comments = [comment('c1')];
    localStorage.clear();
    localStorage.setItem(DIFF_ENGINE_STORAGE_KEY, 'monaco');
    __resetDiffEngineForTesting();
    clients['ws-a'] = makeClient();
});

describe('WorkingTreeFileDiff — comments in the editor', () => {
    it('portals the existing CommentCard into the thread zone with the surface callbacks', async () => {
        const view = await renderEditor();
        const zone = zoneOf('c1')!;
        expect(zone).toMatchObject({ side: 'modified', afterLineNumber: 4 });
        const card = within(zone.domNode).getByTestId('comment-card-c1');
        expect(card.textContent).toContain('note c1');
        fireEvent.click(within(card).getByTitle('Resolve'));
        expect(hooks.resolveComment).toHaveBeenCalledWith('c1');
        view.unmount();
    });

    it('rehydrates stored comments on reload: the same persisted selection lands on the same line', async () => {
        const first = await renderEditor();
        const before = { side: zoneOf('c1')!.side, line: zoneOf('c1')!.afterLineNumber };
        first.unmount();
        const second = await renderEditor();
        expect({ side: zoneOf('c1')!.side, line: zoneOf('c1')!.afterLineNumber }).toEqual(before);
        expect(hooks.comments).toEqual([comment('c1')]); // placement never rewrites the stored shape
        second.unmount();
    });

    it('runs anchor relocation against the synthesized classic rows', async () => {
        const view = await renderEditor();
        expect(hooks.runRelocation).toHaveBeenCalled();
        const lines = hooks.runRelocation.mock.calls.at(-1)![0] as { type: string; newLine?: number }[];
        expect(lines.find(l => l.newLine === 4)).toMatchObject({ type: 'added' });
        view.unmount();
    });

    it('a selection opens the existing InlineCommentPopup and saves a DiffCommentSelection', async () => {
        const view = await renderEditor();
        act(() => fake().select({ side: 'original', range: { startLineNumber: 2, startColumn: 1, endLineNumber: 2, endColumn: 2 } }));
        fireEvent.click(within(fake().glyph!.domNode).getByTestId('monaco-diff-add-comment'));
        fireEvent.change(screen.getByTestId('comment-textarea'), { target: { value: 'why removed?' } });
        await act(async () => { fireEvent.click(screen.getByText('Submit')); });
        expect(hooks.addComment).toHaveBeenCalledWith(
            expect.objectContaining({ side: 'removed', oldLineStart: 2, oldLineEnd: 2, diffLineStart: 2, startColumn: 0, endColumn: 1 }),
            'b', 'why removed?', 'general',
        );
        view.unmount();
    });

    it('ask-AI and copy-as-context use the same diff context as the classic viewer', async () => {
        const view = await renderEditor();
        const sel = { side: 'modified' as const, range: { startLineNumber: 4, startColumn: 1, endLineNumber: 4, endColumn: 2 } };
        act(() => fake().runAction('coc.diff.comment.askAI', sel));
        expect(hooks.queueDispatch).toHaveBeenCalledWith(expect.objectContaining({
            type: 'OPEN_DIALOG', workspaceId: 'ws-a', mode: 'ask', initialPrompt: expect.stringContaining('/repo/src/a.ts'),
        }));
        act(() => fake().runAction('coc.diff.comment.copyContext', sel));
        expect(hooks.copyToClipboard).toHaveBeenCalledWith(expect.stringContaining('d'));
        view.unmount();
    });

    it('copies a resolve prompt for only the clicked card with working-tree context', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
        hooks.comments = [
            comment('c1'),
            comment('c2', { selection: { diffLineStart: 2, diffLineEnd: 2, side: 'removed', oldLineStart: 2, oldLineEnd: 2, newLineStart: NaN, newLineEnd: NaN, startColumn: 0, endColumn: 1 }, selectedText: 'b' }),
        ];
        const view = await renderEditor();
        const card = within(zoneOf('c2')!.domNode).getByTestId('comment-card-c2');
        await act(async () => { fireEvent.click(within(card).getByRole('button', { name: 'Copy resolve prompt' })); });
        const prompt: string = writeText.mock.calls[0][0];
        expect(prompt).toContain('file: /repo/src/a.ts\nDiff range: working tree changes');
        expect(prompt).toContain('id: c2, status: open');
        expect(prompt).toContain('(removed)');
        expect(prompt).not.toContain('c1');
        expect(within(card).getByRole('status').textContent).toBe('Prompt copied');
        vi.unstubAllGlobals();
        view.unmount();
    });

    it('the sidebar reveals the thread in the editor', async () => {
        hooks.comments = [comment('c1', { status: 'resolved' })];
        const view = await renderEditor();
        fireEvent.click(screen.getByTestId('toggle-comments-btn'));
        const sidebar = screen.getByTestId('comment-sidebar');
        fireEvent.click(within(sidebar).getByTestId('status-filter-all'));
        act(() => { fireEvent.click(within(sidebar).getByTestId('comment-card-c1')); });
        expect(fake().revealedLines).toEqual([{ side: 'modified', line: 4 }]);
        expect(within(zoneOf('c1')!.domNode).getByTestId('comment-card-c1')).toBeTruthy();
        view.unmount();
    });

    it('switching to Classic removes every zone; switching back re-adds each thread once', async () => {
        const view = await renderEditor();
        const firstEditor = fake();
        await act(async () => { fireEvent.click(screen.getByTestId('diff-engine-toggle')); });
        expect(firstEditor.zones.size).toBe(0);
        expect(firstEditor.disposals).toBe(1);
        await act(async () => { fireEvent.click(screen.getByTestId('diff-engine-toggle')); });
        await act(async () => {});
        await act(async () => { fake().finishDiff(CHANGES); });
        expect(fake()).not.toBe(firstEditor);
        expect(fake().zones.size).toBe(1);
        expect(fake().zoneLog.filter(e => e.op === 'add')).toHaveLength(1);
        view.unmount();
    });
});
