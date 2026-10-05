// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MonacoFileDiffViewer } from '../../../../../../src/server/spa/client/react/features/git/diff/MonacoFileDiffViewer';
import { createMonacoDiffSelectionDragPayload } from '../../../../../../src/server/spa/client/react/features/git/diff/diffSelectionContext';
import { createFakeDiffEditor, flush } from './fakeDiffEditorAdapter';
const state = vi.hoisted(() => ({ enabled: true, route: vi.fn() }));
vi.mock('../../../../../../src/server/spa/client/react/layout/ThemeProvider', () => ({ useTheme: () => ({ theme: 'light' }) }));
vi.mock('../../../../../../src/server/spa/client/react/utils/config', () => ({ isSessionContextAttachmentsEnabled: () => state.enabled }));
vi.mock('../../../../../../src/server/spa/client/react/features/chat/activeChatAttach', () => ({ attachSelectionToChat: state.route }));
beforeEach(() => { state.enabled = true; vi.clearAllMocks(); });
afterEach(cleanup);
const source = { workspaceId: 'repo-A', filePath: 'src/a.ts', ref: { type: 'working-tree' as const, stage: 'unstaged' as const } };
async function mount(viewMode: 'split' | 'unified' = 'split', destinationId?: string) {
    const fake = createFakeDiffEditor();
    const sides = Object.fromEntries(['original', 'modified'].map(side => {
        const host = document.createElement('div');
        const events: Record<string, () => void> = {};
        const data = { empty: true, focused: false, snippet: side === 'original' ? 'old' : 'unsaved', top: 40 };
        const listen = (name: string, cb: () => void) => { events[name] = cb; return { dispose: vi.fn() }; };
        const selection = { startLineNumber: 2, startColumn: 1, endLineNumber: 2, endColumn: 4,
            isEmpty: () => data.empty, getEndPosition: () => ({ lineNumber: 2, column: 4 }) };
        const editor = {
            getDomNode: () => host, getSelection: () => selection,
            getModel: () => ({ getValueInRange: () => data.snippet }), hasWidgetFocus: () => data.focused,
            getScrolledVisiblePosition: () => ({ top: data.top, left: 90, height: 20 }),
            getLayoutInfo: () => ({ width: 400, height: 300, contentLeft: 40, contentWidth: 350 }),
            onDidChangeCursorSelection: (cb: () => void) => listen('selection', cb),
            onDidScrollChange: (cb: () => void) => listen('scroll', cb),
            onDidLayoutChange: (cb: () => void) => listen('layout', cb),
            onDidChangeModel: (cb: () => void) => listen('model', cb),
            onDidBlurEditorWidget: (cb: () => void) => listen('blur', cb),
        };
        return [side, { host, events, data, editor }];
    }));
    fake.adapter.getSelectionEditor = side => sides[side].editor as any;
    render(<MonacoFileDiffViewer workspaceId="repo-A" relativePath="src/a.ts" stage="unstaged"
        original={'one\nold'} modified={'one\nnew'} viewMode={viewMode} languageFeatures={false}
        diffSelectionDragSource={{ ...source, destinationId }} createEditor={async host => {
            host.append(sides.original.host, sides.modified.host); return fake.adapter;
        }} />);
    await act(flush);
    act(() => fake.finishDiff([{ originalStartLineNumber: 2, originalEndLineNumber: 2,
        modifiedStartLineNumber: 2, modifiedEndLineNumber: 2 }]));
    return { fake, sides, select: (side: string) => act(() => {
        sides[side].data.empty = false; sides[side].data.focused = true; sides[side].events.selection?.();
    }) };
}
it.each(['original', 'modified'])('attaches %s selection with the existing drag payload', async side => {
    const h = await mount(); expect(screen.queryByText('Attach as context')).toBeNull(); h.select(side);
    const pill = screen.getByRole('button', { name: 'Attach as context' });
    expect(pill.style.top).toBe('62px'); expect(h.sides[side].host.contains(pill)).toBe(true);
    const editorMouseDown = vi.fn(); h.sides[side].host.addEventListener('mousedown', editorMouseDown);
    expect(fireEvent.mouseDown(pill)).toBe(false); expect(editorMouseDown).not.toHaveBeenCalled(); fireEvent.click(pill);
    const coords = side === 'original' ? { oldLineStart: 2, oldLineEnd: 2 } : { newLineStart: 2, newLineEnd: 2 };
    expect(state.route).toHaveBeenCalledWith('repo-A', createMonacoDiffSelectionDragPayload(coords, h.sides[side].data.snippet, source));
    expect(screen.queryByText('Attach as context')).toBeNull();
    act(() => h.sides[side].events.scroll()); expect(screen.queryByText('Attach as context')).toBeNull();
});
it('hides on collapse, scroll out of view, model change, and blur in unified view', async () => {
    const h = await mount('unified'); const side = h.sides.modified; h.select('modified');
    act(() => { side.data.empty = true; side.events.selection(); }); expect(screen.queryByText('Attach as context')).toBeNull();
    h.select('modified'); act(() => { side.data.top = -10; side.events.scroll(); }); expect(screen.queryByText('Attach as context')).toBeNull();
    act(() => { side.data.top = 40; side.events.scroll(); }); expect(screen.getByText('Attach as context')).toBeTruthy();
    await act(async () => { side.data.focused = false; side.events.blur(); await Promise.resolve(); });
    expect(screen.queryByText('Attach as context')).toBeNull();
    h.select('modified'); act(() => { side.data.empty = true; side.events.model(); });
    expect(screen.queryByText('Attach as context')).toBeNull();
});
it('hides with the feature disabled', async () => {
    state.enabled = false; const h = await mount(); h.select('modified');
    expect(screen.queryByText('Attach as context')).toBeNull(); expect(state.route).not.toHaveBeenCalled();
});

it.each(['repo-A', 'remote:one:repo-A', 'remote:two:repo-A'])('keeps destination %s separate from the diff payload workspace on both sides', async destinationId => {
    const h = await mount('split', destinationId);
    for (const side of ['original', 'modified']) {
        h.select(side);
        fireEvent.click(screen.getByRole('button', { name: 'Attach as context' }));
        expect(state.route).toHaveBeenLastCalledWith(destinationId, expect.objectContaining({
            sourceWorkspaceId: 'repo-A', kind: 'coc.diff-selection-context', filePath: 'src/a.ts',
        }));
    }
});
