/**
 * Wiring tests for comment threads in MonacoFileDiffViewer (AC-05): view-zone
 * lifecycle, portals (with React context intact), resize relayout, side
 * placement, selection → add comment / ask AI / copy as context, reveal and
 * disposal. Monaco is not loaded; the editor is the owned test adapter, and
 * line changes are supplied by the test.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createContext, createRef, useContext } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import {
    MonacoFileDiffViewer,
    type MonacoFileDiffViewerHandle,
    type MonacoFileDiffViewerProps,
} from '../../../../../../src/server/spa/client/react/features/git/diff/MonacoFileDiffViewer';
import type { DiffLineChange } from '../../../../../../src/server/spa/client/react/features/git/diff/diffCoords';
import type { DiffComment, DiffCommentSelection } from '../../../../../../src/server/spa/client/comments/diff-comment-types';
import { createFakeDiffEditor, flush, type FakeDiffEditor } from './fakeDiffEditorAdapter';

vi.mock('../../../../../../src/server/spa/client/react/layout/ThemeProvider', () => ({
    useTheme: () => ({ theme: 'light', setTheme: () => {} }),
}));

// original: a b c d e       modified: a B c d NEW e
const ORIGINAL = 'a\nb\nc\nd\ne\n';
const MODIFIED = 'a\nB\nc\nd\nNEW\ne\n';
const CHANGES: DiffLineChange[] = [
    { originalStartLineNumber: 2, originalEndLineNumber: 2, modifiedStartLineNumber: 2, modifiedEndLineNumber: 2 },
    { originalStartLineNumber: 4, originalEndLineNumber: 0, modifiedStartLineNumber: 5, modifiedEndLineNumber: 5 },
];

function comment(id: string, selection: Partial<DiffCommentSelection>, extra: Partial<DiffComment> = {}): DiffComment {
    return {
        id,
        context: { repositoryId: 'ws-1', filePath: '/repo/src/a.ts', oldRef: 'INDEX', newRef: 'working-tree' },
        selection: {
            diffLineStart: -1, diffLineEnd: -1, side: 'context',
            oldLineStart: NaN, oldLineEnd: NaN, newLineStart: NaN, newLineEnd: NaN,
            startColumn: 0, endColumn: 1, ...selection,
        },
        selectedText: 'x',
        comment: `text ${id}`,
        status: 'open',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        ...extra,
    };
}

const ADDED = comment('added', { side: 'added', newLineStart: 5, newLineEnd: 5 });
const REMOVED = comment('removed', { side: 'removed', oldLineStart: 2, oldLineEnd: 2 });
const RESOLVED = comment('resolved', { side: 'context', oldLineStart: 1, oldLineEnd: 1, newLineStart: 1, newLineEnd: 1 }, { status: 'resolved' });
const ORPHAN = comment('orphan', { side: 'context', newLineStart: 3, newLineEnd: 3 }, { status: 'orphaned' });

// Proves the portalled thread still sees the app's React context.
const AppContext = createContext('no-provider');
function Thread({ c }: { c: DiffComment }) {
    const value = useContext(AppContext);
    return <div data-testid={`thread-${c.id}`}>{c.comment} [{value}]</div>;
}

function harness(overrides: Partial<MonacoFileDiffViewerProps> = {}) {
    const fakes: FakeDiffEditor[] = [];
    const ref = createRef<MonacoFileDiffViewerHandle>();
    const props: MonacoFileDiffViewerProps = {
        workspaceId: 'ws-1',
        relativePath: 'src/a.ts',
        stage: 'unstaged',
        original: ORIGINAL,
        modified: MODIFIED,
        viewMode: 'split',
        comments: [ADDED, REMOVED, RESOLVED],
        renderCommentThread: (c) => <Thread c={c} />,
        onAddComment: vi.fn(),
        onAskAI: vi.fn(),
        onCopyAsContext: vi.fn(),
        createEditor: vi.fn(async (_host: HTMLElement, options) => {
            const fake = createFakeDiffEditor(options);
            fakes.push(fake);
            return fake.adapter;
        }),
        ...overrides,
    };
    const tree = (p: MonacoFileDiffViewerProps) => (
        <AppContext.Provider value="app-context"><MonacoFileDiffViewer ref={ref} {...p} /></AppContext.Provider>
    );
    const view = render(tree(props));
    return {
        ...view, ref, props, fake: () => fakes[fakes.length - 1], fakes,
        rerender: (next: Partial<MonacoFileDiffViewerProps>) => view.rerender(tree({ ...props, ...next })),
    };
}

async function ready(h: ReturnType<typeof harness>, changes = CHANGES) {
    await act(flush);
    await act(async () => { h.fake().finishDiff(changes); });
}

const zoneFor = (fake: FakeDiffEditor, id: string) =>
    [...fake.zones.values()].find(z => z.domNode.querySelector(`[data-comment-id="${id}"]`));
const addCount = (fake: FakeDiffEditor) => fake.zoneLog.filter(e => e.op === 'add').length;

let resizeCallbacks: (() => void)[];
beforeEach(() => {
    resizeCallbacks = [];
    vi.stubGlobal('ResizeObserver', class {
        constructor(cb: () => void) { resizeCallbacks.push(cb); }
        observe() {}
        disconnect() {}
    });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('MonacoFileDiffViewer — comment threads', () => {
    it('adds no zones until the diff is computed, then one per placed thread', async () => {
        const h = harness();
        await act(flush);
        expect(h.fake().zones.size).toBe(0);
        await act(async () => { h.fake().finishDiff(CHANGES); });
        expect(h.fake().zones.size).toBe(3);
        expect(addCount(h.fake())).toBe(3);
        expect(zoneFor(h.fake(), 'added')).toMatchObject({ side: 'modified', afterLineNumber: 5 });
        expect(zoneFor(h.fake(), 'removed')).toMatchObject({ side: 'original', afterLineNumber: 2 });
        expect(h.fake().decorations.map(d => [d.side, d.range.startLineNumber, d.kind])).toEqual([
            ['original', 2, 'open'], ['modified', 1, 'resolved'], ['modified', 5, 'open'],
        ]);
        h.unmount();
    });

    it('portals the thread component into its zone with React context intact', async () => {
        const h = harness();
        await ready(h);
        const zone = zoneFor(h.fake(), 'added')!;
        expect(within(zone.domNode).getByTestId('thread-added').textContent).toBe('text added [app-context]');
        h.unmount();
    });

    it('opens unresolved threads and collapses resolved ones; toggle and Escape change it', async () => {
        const h = harness();
        await ready(h);
        const resolvedZone = zoneFor(h.fake(), 'resolved')!.domNode;
        expect(within(resolvedZone).queryByTestId('thread-resolved')).toBeNull();
        fireEvent.click(within(resolvedZone).getByTestId('monaco-comment-thread-toggle'));
        expect(within(resolvedZone).getByTestId('thread-resolved')).toBeTruthy();

        const addedZone = zoneFor(h.fake(), 'added')!.domNode;
        expect(within(addedZone).getByTestId('thread-added')).toBeTruthy();
        fireEvent.keyDown(within(addedZone).getByTestId('monaco-comment-thread'), { key: 'Escape' });
        expect(within(addedZone).queryByTestId('thread-added')).toBeNull();
        h.unmount();
    });

    it('relayouts a zone when its thread resizes', async () => {
        const h = harness({ comments: [ADDED] });
        await ready(h);
        const zone = zoneFor(h.fake(), 'added')!;
        const thread = within(zone.domNode).getByTestId('monaco-comment-thread');
        thread.getBoundingClientRect = () => ({ height: 143.2 } as DOMRect);
        act(() => { for (const cb of resizeCallbacks) cb(); });
        expect(zone.heightInPx).toBe(144);
        expect(h.fake().adapter.layoutViewZone).toHaveBeenLastCalledWith('modified', expect.any(String), 144);
        h.unmount();
    });

    it('moves a removed-line thread to the modified editor in unified view without duplicating it', async () => {
        const h = harness({ comments: [REMOVED] });
        await ready(h);
        const node = zoneFor(h.fake(), 'removed')!.domNode;
        h.rerender({ comments: [REMOVED], viewMode: 'unified' });
        await act(flush);
        expect(h.fake().zones.size).toBe(1);
        expect(zoneFor(h.fake(), 'removed')).toMatchObject({ side: 'modified', afterLineNumber: 2, domNode: node });
        expect(within(node).getByTestId('monaco-comment-thread').getAttribute('data-side')).toBe('original');
        h.unmount();
    });

    it('re-adds zones once after a model swap (file changed on disk)', async () => {
        const h = harness({ comments: [ADDED] });
        await ready(h);
        h.rerender({ comments: [ADDED], modified: MODIFIED + 'tail\n' });
        await act(flush);
        expect(h.fake().zones.size).toBe(0); // swap dropped them; diff not ready yet
        await act(async () => { h.fake().finishDiff(CHANGES); });
        expect(h.fake().zones.size).toBe(1);
        expect(addCount(h.fake())).toBe(2);
        expect(h.fake().zoneLog.filter(e => e.op === 'remove')).toEqual([]);
        h.unmount();
    });

    it('lists orphaned comments above the editor instead of placing them', async () => {
        const h = harness({ comments: [ADDED, ORPHAN] });
        await ready(h);
        expect(h.fake().zones.size).toBe(1);
        fireEvent.click(screen.getByTestId('monaco-comment-orphans-toggle'));
        expect(within(screen.getByTestId('monaco-comment-orphans')).getByTestId('thread-orphan')).toBeTruthy();
        h.unmount();
    });

    it('reveals a thread: scrolls to its line, expands it and focuses it', async () => {
        const h = harness();
        await ready(h);
        let revealed = false;
        act(() => { revealed = h.ref.current!.revealComment('resolved'); });
        expect(revealed).toBe(true);
        expect(h.fake().revealedLines).toEqual([{ side: 'modified', line: 1 }]);
        const zone = zoneFor(h.fake(), 'resolved')!.domNode;
        expect(within(zone).getByTestId('thread-resolved')).toBeTruthy();
        expect(h.ref.current!.revealComment('missing')).toBe(false);
        h.unmount();
    });

    it('removes every zone and the glyph on unmount (engine toggle) and tolerates remounting', async () => {
        for (let i = 0; i < 3; i++) {
            const h = harness();
            await ready(h);
            act(() => h.fake().select({ side: 'modified', range: { startLineNumber: 2, startColumn: 1, endLineNumber: 2, endColumn: 2 } }));
            expect(h.fake().glyph).not.toBeNull();
            const fake = h.fake();
            h.unmount();
            expect(fake.zones.size).toBe(0);
            expect(fake.glyph).toBeNull();
            expect(fake.disposals).toBe(1);
        }
    });
});

describe('MonacoFileDiffViewer — creating comments from a selection', () => {
    const SEL = { side: 'modified' as const, range: { startLineNumber: 5, startColumn: 1, endLineNumber: 5, endColumn: 4 } };

    it('shows the add-comment glyph beside a selection and hides it when the selection collapses', async () => {
        const h = harness();
        await ready(h);
        act(() => h.fake().select(SEL));
        expect(h.fake().glyph).toMatchObject({ side: 'modified', line: 5 });
        expect(within(h.fake().glyph!.domNode).getByTestId('monaco-diff-add-comment')).toBeTruthy();
        act(() => h.fake().select(null));
        expect(h.fake().glyph).toBeNull();
        h.unmount();
    });

    it('the glyph opens the add-comment flow with diffCoords coordinates, text and position', async () => {
        const h = harness();
        await ready(h);
        act(() => h.fake().select(SEL));
        fireEvent.click(within(h.fake().glyph!.domNode).getByTestId('monaco-diff-add-comment'));
        expect(h.props.onAddComment).toHaveBeenCalledTimes(1);
        const [selection, text, position] = (h.props.onAddComment as ReturnType<typeof vi.fn>).mock.calls[0];
        expect(selection).toMatchObject({ side: 'added', newLineStart: 5, newLineEnd: 5, startColumn: 0, endColumn: 3 });
        // Classic patch rows: @@ a -b +B c d +NEW e → "+NEW" is row 6, so the
        // comment also lands on the right row in the classic viewer.
        expect(selection).toMatchObject({ diffLineStart: 6, diffLineEnd: 6 });
        expect(text).toBe('NEW');
        expect(position).toEqual({ top: 100, left: 28 });
        h.unmount();
    });

    it('context-menu actions send the selection to ask-AI and copy-as-context', async () => {
        const h = harness();
        await ready(h);
        const original = { side: 'original' as const, range: { startLineNumber: 2, startColumn: 1, endLineNumber: 2, endColumn: 2 } };
        act(() => h.fake().runAction('coc.diff.comment.askAI', original));
        act(() => h.fake().runAction('coc.diff.comment.copyContext', SEL));
        expect(h.props.onAskAI).toHaveBeenCalledWith(expect.objectContaining({ side: 'removed', oldLineStart: 2 }), 'b');
        expect(h.props.onCopyAsContext).toHaveBeenCalledWith(expect.objectContaining({ side: 'added', newLineStart: 5 }), 'NEW');
        act(() => h.fake().runAction('coc.diff.comment.add', SEL));
        expect(h.props.onAddComment).toHaveBeenCalledTimes(1);
        h.unmount();
    });

    it('keeps selection actions but omits comment zones when no thread renderer is given', async () => {
        const h = harness({ renderCommentThread: undefined });
        await ready(h);
        expect(h.fake().actions.map(action => action.id)).toEqual([
            'coc.diff.comment.add',
            'coc.diff.comment.askAI',
            'coc.diff.comment.copyContext',
        ]);
        expect(h.fake().zones.size).toBe(0);
        h.unmount();
    });
});
