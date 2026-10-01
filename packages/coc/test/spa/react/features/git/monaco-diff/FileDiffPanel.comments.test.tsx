import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { DiffComment, DiffCommentContext, DiffCommentSelection } from '../../../../../../src/server/spa/client/comments/diff-comment-types';
import type { UpdateDiffCommentRequest } from '../../../../../../src/server/spa/client/react/features/git/hooks/useDiffComments';
import type { DiffSource } from '../../../../../../src/server/spa/client/react/features/git/diff/diffSource';
import type { DiffEditorFactory } from '../../../../../../src/server/spa/client/react/features/git/diff/monacoDiffEditorAdapter';
import { createFakeDiffEditor, type FakeDiffEditor } from './fakeDiffEditorAdapter';

const transport = vi.hoisted(() => ({
    client: {} as Record<string, unknown>,
    patch: vi.fn(),
    delete: vi.fn(),
    queueDispatch: vi.fn(),
    copyToClipboard: vi.fn(async () => {}),
}));

vi.mock('../../../../../../src/server/spa/client/react/repos/cloneRegistry', () => ({
    getCocClientForWorkspace: () => transport.client,
}));
vi.mock('../../../../../../src/server/spa/client/react/repos/cloneRouting', () => ({
    useCocClient: () => transport.client,
}));
vi.mock('../../../../../../src/server/spa/client/react/utils/diffCommentApi', () => ({
    computeStorageKey: vi.fn(async () => 'storage-key'),
    patchDiffComment: transport.patch,
    deleteDiffCommentById: transport.delete,
}));
vi.mock('../../../../../../src/server/spa/client/react/contexts/QueueContext', () => ({
    useQueue: () => ({ dispatch: transport.queueDispatch }),
}));
vi.mock('../../../../../../src/server/spa/client/react/utils/format', async importOriginal => ({
    ...await importOriginal<object>(),
    copyToClipboard: transport.copyToClipboard,
}));
vi.mock('../../../../../../src/server/spa/client/react/layout/ThemeProvider', () => ({
    useTheme: () => ({ theme: 'light' }),
}));
vi.mock('../../../../../../src/server/spa/client/react/features/git/hooks/useCommitChatPresentation', () => ({
    useCommitChatPresentation: () => ({ chatOpen: false }),
}));
vi.mock('../../../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        preferences: {
            getGlobal: () => new Promise(() => {}),
            patchGlobal: vi.fn(async () => ({})),
        },
    }),
}));
vi.mock('../../../../../../src/server/spa/client/react/features/git/hooks/useFileDiff', () => ({
    useFileDiff: () => ({
        diff: PATCH, loading: false, error: null, truncated: false,
        totalLines: 10, requestFullDiff: vi.fn(), retry: vi.fn(),
    }),
}));
vi.mock('../../../../../../src/server/spa/client/react/shared/ResolveContextDialog', () => ({
    shouldSkipResolveDialog: () => true,
}));

import { FileDiffPanel } from '../../../../../../src/server/spa/client/react/features/git/diff/FileDiffPanel';
import { computeDiffLines } from '../../../../../../src/server/spa/client/react/features/git/diff/UnifiedDiffViewer';
import { createCommitDiffSource, createBranchRangeDiffSource, createPrDiffSource } from '../../../../../../src/server/spa/client/react/features/git/diff/diffSource';
import { DIFF_ENGINE_STORAGE_KEY, __resetDiffEngineForTesting } from '../../../../../../src/server/spa/client/react/features/git/hooks/useDiffEngine';
import { useFileDiffEngineState } from '../../../../../../src/server/spa/client/react/features/git/hooks/useFileDiffEngineState';

const ORIGINAL = 'a\nb\nc\n';
const MODIFIED = 'a\nB\nc\nd\n';
const PATCH = 'diff --git a/src/a.ts b/src/a.ts\nindex 0000000..1111111 100644\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,3 +1,4 @@\n a\n-b\n+B\n c\n+d';
const CHANGES = [
    { originalStartLineNumber: 2, originalEndLineNumber: 2, modifiedStartLineNumber: 2, modifiedEndLineNumber: 2 },
    { originalStartLineNumber: 3, originalEndLineNumber: 0, modifiedStartLineNumber: 4, modifiedEndLineNumber: 4 },
];
const PATH = 'src/a.ts';
type SourceKind = 'commit' | 'branch-range' | 'pull-request';
const REFS: Record<SourceKind, [string, string]> = {
    commit: ['abc123^', 'abc123'],
    'branch-range': ['branch-base', 'branch-head'],
    'pull-request': ['pr-42-base', 'pr-42-head'],
};

function makeSource(kind: SourceKind): DiffSource {
    const files = [PATH, 'src/b.ts'];
    if (kind === 'commit') return createCommitDiffSource('ws-a', 'abc123', { files });
    if (kind === 'branch-range') return createBranchRangeDiffSource('ws-a', { files, baseMode: 'upstream' });
    return createPrDiffSource('ws-a', 'repo-a', '42', { originId: 'origin-a', headSha: 'head-sha', files });
}

function comment(source: DiffSource, id: string, extra: Partial<DiffComment> = {}): DiffComment {
    return {
        id, context: source.commentContext(PATH),
        selection: {
            diffLineStart: 9, diffLineEnd: 9, side: 'added',
            newLineStart: 4, newLineEnd: 4, startColumn: 0, endColumn: 1,
        },
        selectedText: 'd', comment: `note ${id}`, status: 'open',
        createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
        ...extra,
    };
}

let stored: DiffComment[];
let fakes: FakeDiffEditor[];
const fake = () => fakes[fakes.length - 1];
const zoneOf = (id: string) => [...fake().zones.values()].find(z => z.domNode.querySelector(`[data-comment-id="${id}"]`))!;
const cardOf = (id: string) => within(zoneOf(id).domNode).getByTestId(`comment-card-${id}`);
const createEditor: DiffEditorFactory = async (_host, options) => {
    const editor = createFakeDiffEditor(options);
    fakes.push(editor);
    return editor.adapter;
};
const anchorFor = (selectedText: string) => ({
    selectedText, contextBefore: '', contextAfter: '', originalLine: 1, textHash: 'fingerprint',
});

interface CreateRequest {
    context: DiffCommentContext;
    selection: DiffCommentSelection;
    selectedText: string;
    comment: string;
    category?: DiffComment['category'];
}
const createComment = vi.fn(async (_workspace: string, request: CreateRequest) => {
    const created: DiffComment = {
        id: `created-${stored.length}`, ...request, status: 'open',
        anchor: anchorFor(request.selectedText),
        createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    };
    stored.push(created);
    return { comment: created };
});
const askAI = vi.fn(async () => ({ aiResponse: 'AI answer' }));
const fixWithAI = vi.fn(async () => ({ totalCount: 1 }));

function panel(source: DiffSource, filePath = PATH) {
    return <FileDiffPanel workspaceId="ws-a" filePath={filePath} source={source} createDiffEditor={createEditor} />;
}
async function mount(source: DiffSource) {
    let view!: ReturnType<typeof render>;
    await act(async () => { view = render(panel(source)); });
    await act(async () => { fake().finishDiff(CHANGES); });
    return view;
}
async function submit(text: string) {
    fireEvent.change(screen.getByTestId('comment-textarea'), { target: { value: text } });
    await act(async () => { fireEvent.click(screen.getByText('Submit')); });
}
async function toggleEngine(engine: 'legacy' | 'monaco') {
    await act(async () => { fireEvent.click(screen.getByTestId(`diff-engine-toggle-${engine}`)); });
    if (engine === 'monaco') await act(async () => { fake().finishDiff(CHANGES); });
}

beforeEach(() => {
    vi.clearAllMocks();
    stored = [];
    fakes = [];
    localStorage.clear();
    localStorage.setItem(DIFF_ENGINE_STORAGE_KEY, 'monaco');
    __resetDiffEngineForTesting();
    vi.stubGlobal('WebSocket', class {
        addEventListener() {}
        send() {}
        close() {}
    });
    transport.patch.mockImplementation(async (_ws: string, _key: string, id: string, request: UpdateDiffCommentRequest) => {
        const current = stored.find(c => c.id === id)!;
        const updated: DiffComment = {
            ...current, ...request, category: current.category,
            selection: { ...current.selection, ...request.selection },
        };
        stored = stored.map(c => c.id === id ? updated : c);
        return updated;
    });
    transport.delete.mockImplementation(async (_ws: string, _key: string, id: string) => {
        stored = stored.filter(c => c.id !== id);
    });
    const content = vi.fn(async () => ({
        path: PATH, fileName: 'a.ts', language: 'typescript', binary: false, tooLarge: false,
        base: { content: ORIGINAL, ref: 'base', exists: true },
        head: { content: MODIFIED, ref: 'head', exists: true },
    }));
    transport.client = {
        git: {
            commitFileDiffPath: () => '/commit-patch',
            branchRangeFileDiffPath: () => '/branch-patch',
            getCommitFileDiffContent: content,
            getBranchRangeFileDiffContent: content,
            listDiffComments: vi.fn(async () => ({ comments: [...stored] })),
            createDiffComment: createComment,
            askDiffCommentAI: askAI,
            resolveDiffCommentsWithAI: fixWithAI,
        },
        pullRequests: {
            prFileDiffPathForOrigin: () => '/pr-patch',
            getFileDiffContentForOrigin: content,
        },
    };
});
afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe.each<SourceKind>(['commit', 'branch-range', 'pull-request'])('%s Monaco comments', kind => {
    it('portals stored comments and replies without changing their persisted shape', async () => {
        const source = makeSource(kind);
        const initial = comment(source, 'c1', {
            replies: [{ id: 'reply-1', author: 'Reviewer', text: 'Reply body', createdAt: '2026-01-01T00:00:00Z' }],
        });
        stored = [initial];
        const view = await mount(source);
        expect(zoneOf('c1')).toMatchObject({ side: 'modified', afterLineNumber: 4 });
        expect(cardOf('c1').textContent).toContain('note c1');
        expect(within(cardOf('c1')).getByTestId('comment-reply-reply-1').textContent).toContain('Reply body');
        expect(fake().decorations).toContainEqual(expect.objectContaining({ side: 'modified', kind: 'open' }));
        expect(stored).toEqual([initial]);
        view.unmount();
        await mount(source);
        expect(zoneOf('c1')).toMatchObject({ side: 'modified', afterLineNumber: 4 });
        expect(stored).toEqual([initial]);
    });

    it('creates through the existing popup with the source refs and reveals the result after reload', async () => {
        const source = makeSource(kind);
        const view = await mount(source);
        act(() => fake().select({
            side: 'original', range: { startLineNumber: 2, startColumn: 1, endLineNumber: 2, endColumn: 2 },
        }));
        fireEvent.click(within(fake().glyph!.domNode).getByTestId('monaco-diff-add-comment'));
        await submit('why removed?');
        expect(createComment).toHaveBeenCalledWith('ws-a', expect.objectContaining({
            context: { repositoryId: 'ws-a', filePath: PATH, oldRef: REFS[kind][0], newRef: REFS[kind][1] },
            selection: expect.objectContaining({
                side: 'removed', oldLineStart: 2, oldLineEnd: 2, startColumn: 0, endColumn: 1,
            }),
            selectedText: 'b', comment: 'why removed?', category: 'general',
        }));
        expect(cardOf('created-0').textContent).toContain('why removed?');
        view.unmount();
        await mount(source);
        expect(zoneOf('created-0')).toMatchObject({ side: 'modified', afterLineNumber: 2 });
    });

    it('routes edit, resolve, reopen, and delete from the portalled card to existing CRUD', async () => {
        const source = makeSource(kind);
        stored = [comment(source, 'c1')];
        await mount(source);
        fireEvent.click(within(cardOf('c1')).getByTitle('Edit'));
        fireEvent.change(within(cardOf('c1')).getByTestId('comment-edit-textarea'), { target: { value: 'edited note' } });
        await act(async () => { fireEvent.click(within(cardOf('c1')).getByText('Save')); });
        expect(transport.patch).toHaveBeenLastCalledWith('ws-a', 'storage-key', 'c1', { comment: 'edited note' });
        await act(async () => { fireEvent.click(within(cardOf('c1')).getByTitle('Resolve')); });
        expect(stored[0].status).toBe('resolved');
        expect(fake().decorations[0].kind).toBe('resolved');
        fireEvent.click(within(zoneOf('c1').domNode).getByTestId('monaco-comment-thread-toggle'));
        await act(async () => { fireEvent.click(within(cardOf('c1')).getByTitle('Reopen')); });
        expect(stored[0].status).toBe('open');
        fireEvent.click(within(cardOf('c1')).getByTitle('Delete'));
        await act(async () => { fireEvent.click(within(cardOf('c1')).getByText('Confirm')); });
        expect(transport.delete).toHaveBeenCalledWith('ws-a', 'storage-key', 'c1');
        expect(stored).toEqual([]);
        expect(fake().zones.size).toBe(0);
    });

    it('uses the existing ask-AI response and error handling inside the thread', async () => {
        const source = makeSource(kind);
        stored = [comment(source, 'c1')];
        await mount(source);
        fireEvent.click(within(cardOf('c1')).getByTestId('ai-menu-trigger'));
        await act(async () => { fireEvent.click(screen.getByTestId('ai-cmd-clarify')); });
        expect(askAI).toHaveBeenCalledWith('ws-a', 'storage-key', 'c1', { commandId: 'clarify', customQuestion: undefined });
        expect(within(cardOf('c1')).getByTestId('ai-response').textContent).toContain('AI answer');
        askAI.mockRejectedValueOnce(new Error('AI unavailable'));
        fireEvent.click(within(cardOf('c1')).getByTestId('ai-menu-trigger'));
        await act(async () => { fireEvent.click(screen.getByTestId('ai-cmd-clarify')); });
        expect(within(cardOf('c1')).getByTestId('ai-error-banner').textContent).toContain('AI unavailable');
        fireEvent.click(within(cardOf('c1')).getByLabelText('Dismiss error'));
        expect(within(cardOf('c1')).queryByTestId('ai-error-banner')).toBeNull();
    });

    it('asks AI and copies selections with the same file context as Classic', async () => {
        await mount(makeSource(kind));
        const selection = { side: 'modified' as const, range: { startLineNumber: 4, startColumn: 1, endLineNumber: 4, endColumn: 2 } };
        act(() => fake().runAction('coc.diff.comment.askAI', selection));
        expect(transport.queueDispatch).toHaveBeenCalledWith(expect.objectContaining({
            type: 'OPEN_DIALOG', workspaceId: 'ws-a', mode: 'ask', initialPrompt: expect.stringContaining(PATH),
            ...(kind === 'commit' ? {} : { launchMode: 'floating-chat' }),
        }));
        act(() => fake().runAction('coc.diff.comment.copyContext', selection));
        expect(transport.copyToClipboard).toHaveBeenCalledWith(expect.stringContaining('d'));
    });

    it('keeps the existing fix-with-AI action and source ref context', async () => {
        const source = makeSource(kind);
        stored = [comment(source, 'c1')];
        await mount(source);
        await act(async () => { fireEvent.click(within(cardOf('c1')).getByTestId('fix-with-ai')); });
        expect(fixWithAI).toHaveBeenCalledWith('ws-a', {
            oldRef: REFS[kind][0], newRef: REFS[kind][1], filePath: PATH, commentId: 'c1',
        });
    });

    it('sidebar navigation expands a resolved thread and reveals its source line', async () => {
        const source = makeSource(kind);
        stored = [comment(source, 'c1', { status: 'resolved' })];
        await mount(source);
        expect(within(zoneOf('c1').domNode).queryByTestId('comment-card-c1')).toBeNull();
        fireEvent.click(screen.getByTestId('toggle-comments-btn'));
        const sidebar = screen.getByTestId('comment-sidebar');
        fireEvent.click(within(sidebar).getByTestId('status-filter-all'));
        fireEvent.click(within(sidebar).getByTestId('comment-card-c1'));
        expect(fake().revealedLines).toEqual([{ side: 'modified', line: 4 }]);
        expect(cardOf('c1')).toBeTruthy();
    });

    it('keeps lost anchors accessible and recovers legacy selections through diffCoords', async () => {
        const source = makeSource(kind);
        stored = [
            comment(source, 'legacy', {
                selection: { diffLineStart: 7, diffLineEnd: 7, side: 'added', startColumn: 0, endColumn: 1 },
                selectedText: 'B', anchor: anchorFor('B'),
            }),
            comment(source, 'lost', {
                selection: { diffLineStart: 1, diffLineEnd: 1, side: 'added', startColumn: 0, endColumn: 1 },
                selectedText: 'gone', anchor: anchorFor('gone'),
            }),
        ];
        await mount(source);
        expect(zoneOf('legacy')).toMatchObject({ side: 'modified', afterLineNumber: 2 });
        expect(within(zoneOf('legacy').domNode).getByTestId('monaco-comment-thread-recovered')).toBeTruthy();
        expect(fake().zones.size).toBe(1);
        fireEvent.click(screen.getByTestId('toggle-comments-btn'));
        const sidebar = screen.getByTestId('comment-sidebar');
        fireEvent.click(within(sidebar).getByTestId('status-filter-all'));
        fireEvent.click(within(sidebar).getByTestId('comment-card-lost'));
        expect(screen.getByTestId('monaco-comment-orphan').textContent).toContain('note lost');
        expect(fake().revealedLines).toEqual([]);
    });

    it.each([
        ['original', 'unified'], ['modified', 'unified'],
        ['original', 'split'], ['modified', 'split'],
    ] as const)('round-trips a Monaco %s comment through real Classic %s rows', async (side, viewMode) => {
        localStorage.setItem('coc-diff-view-mode', viewMode);
        const source = makeSource(kind);
        await mount(source);
        act(() => fake().runAction('coc.diff.comment.add', {
            side, range: { startLineNumber: 2, startColumn: 1, endLineNumber: 2, endColumn: 2 },
        }));
        await submit('round-trip');
        const before = { ...stored[0].selection };
        const firstEditor = fake();
        await toggleEngine('legacy');
        expect(firstEditor.zones.size).toBe(0);
        expect(firstEditor.actions).toEqual([]);
        expect(firstEditor.disposals).toBe(1);
        const row = screen.getByTestId('file-diff-content').querySelector<HTMLElement>(
            `[data-diff-line-index="${stored[0].selection.diffLineStart}"]`,
        )!;
        if (viewMode === 'unified') expect(row.dataset.lineType).toBe(side === 'original' ? 'removed' : 'added');
        expect(row.textContent).toContain(side === 'original' ? 'b' : 'B');
        expect(within(row).getByTestId('comment-badge')).toBeTruthy();
        await toggleEngine('monaco');
        expect(zoneOf('created-0')).toMatchObject({
            side: viewMode === 'split' ? side : 'modified', afterLineNumber: 2,
        });
        expect(fake().zones.size).toBe(1);
        expect(stored[0].selection).toEqual(before);
        expect(Object.keys(stored[0]).sort()).toEqual([
            'anchor', 'category', 'comment', 'context', 'createdAt', 'id', 'selectedText', 'selection', 'status', 'updatedAt',
        ]);
    });

    it('places a Classic-created comment on the same line when switching to Monaco', async () => {
        localStorage.setItem(DIFF_ENGINE_STORAGE_KEY, 'legacy');
        __resetDiffEngineForTesting();
        const source = makeSource(kind);
        await act(async () => { render(panel(source)); });
        const viewer = screen.getByTestId('file-diff-content');
        const line = viewer.querySelector<HTMLElement>('[data-line-type="added"]')!;
        const range = document.createRange();
        range.selectNodeContents(line);
        const selection = window.getSelection()!;
        selection.removeAllRanges();
        selection.addRange(range);
        vi.spyOn(selection, 'toString').mockReturnValue('B');
        fireEvent.mouseUp(viewer);
        fireEvent.contextMenu(viewer, { clientX: 20, clientY: 20 });
        fireEvent.click(screen.getByTestId('context-menu-item-0'));
        await submit('from Classic');
        expect(stored[0].selection).toMatchObject({ side: 'added', newLineStart: 2, newLineEnd: 2 });
        await toggleEngine('monaco');
        expect(zoneOf('created-0')).toMatchObject({ side: 'modified', afterLineNumber: 2 });
        expect(cardOf('created-0').textContent).toContain('from Classic');
        selection.removeAllRanges();
    });

    it('removes old file threads and selections when switching files', async () => {
        const source = makeSource(kind);
        stored = [comment(source, 'a'), comment(source, 'b', {
            context: source.commentContext('src/b.ts'),
        })];
        const view = await mount(source);
        const firstEditor = fake();
        act(() => firstEditor.select({
            side: 'modified', range: { startLineNumber: 4, startColumn: 1, endLineNumber: 4, endColumn: 2 },
        }));
        await act(async () => { view.rerender(panel(source, 'src/b.ts')); });
        await act(async () => { fake().finishDiff(CHANGES); });
        expect(firstEditor.zones.size).toBe(0);
        expect(firstEditor.disposals).toBe(1);
        expect(fake().glyph).toBeNull();
        expect(fake().zones.size).toBe(1);
        expect(cardOf('b')).toBeTruthy();
        expect([...fake().zones.values()].some(z => z.domNode.querySelector('[data-comment-id="a"]'))).toBe(false);
    });
});

it('keeps source file-line coordinates independent of the Classic patch preamble', () => {
    const rows = computeDiffLines(PATCH.split('\n'));
    expect(rows.find(r => r.type === 'removed')).toMatchObject({ index: 6, oldLine: 2 });
    expect(rows.find(r => r.type === 'added')).toMatchObject({ index: 7, newLine: 2 });
});

const classifyHunk = vi.fn(() => ({ category: 'logic' as const, intensity: 'high' as const }));
function ClassifiedPanel({ source }: { source: DiffSource }) {
    const state = useFileDiffEngineState(`${source.cacheKey}:${PATH}`);
    return <>
        {state.classificationEnabled && <button data-testid="classify-control">Classify</button>}
        <FileDiffPanel workspaceId="ws-a" filePath={PATH} source={source} createDiffEditor={createEditor}
            onDiffEngineChange={state.onDiffEngineChange} getHunkClassification={classifyHunk} hunkActiveFilters={new Set()} />
    </>;
}

it.each<SourceKind>(['commit', 'branch-range', 'pull-request'])(
    '%s ignores classification in Monaco and restores it in Classic', async kind => {
        classifyHunk.mockClear();
        await act(async () => { render(<ClassifiedPanel source={makeSource(kind)} />); });
        await act(async () => { fake().finishDiff(CHANGES); });
        expect(screen.queryByTestId('classify-control')).toBeNull();
        expect(classifyHunk).not.toHaveBeenCalled();
        expect(fake().models[0].modified.text).toBe(MODIFIED);
        await toggleEngine('legacy');
        expect(screen.getByTestId('classify-control')).toBeTruthy();
        expect(classifyHunk).toHaveBeenCalled();
        await toggleEngine('monaco');
        expect(screen.queryByTestId('classify-control')).toBeNull();
    },
);

it('restores classification on automatic fallback and clears fallback state for a new revision', async () => {
    const source = makeSource('commit');
    const binarySource = { ...source, fetchFileContent: async () => ({
        path: PATH, fileName: 'a.ts', language: 'typescript', binary: true, tooLarge: false,
        base: { content: '', ref: 'base', exists: true }, head: { content: '', ref: 'head', exists: true },
    }) };
    let view!: ReturnType<typeof render>;
    await act(async () => { view = render(<ClassifiedPanel source={binarySource} />); });
    expect(screen.getByTestId('classify-control')).toBeTruthy();
    await act(async () => { view.rerender(<ClassifiedPanel source={{ ...source, cacheKey: 'commit:new' }} />); });
    await act(async () => { fake().finishDiff(CHANGES); });
    expect(screen.queryByTestId('classify-control')).toBeNull();
});
