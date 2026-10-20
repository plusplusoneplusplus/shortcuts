// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MonacoFileDiffViewer } from '../../../../../../src/server/spa/client/react/features/git/diff/MonacoFileDiffViewer';
import { createMonacoDiffSelectionDragPayload } from '../../../../../../src/server/spa/client/react/features/git/diff/diffSelectionContext';
import { createFakeDiffEditor, createFakeSelectionEditors, flush } from './fakeDiffEditorAdapter';
import { focusedMonacoSelection } from '../../../../../../src/server/spa/client/react/shared/monaco/focusedSelection';
import { useContentSearchShortcut } from '../../../../../../src/server/spa/client/react/features/repo-detail/content-search/useContentSearchShortcut';
const state = vi.hoisted(() => ({ enabled: true, route: vi.fn() }));
vi.mock('../../../../../../src/server/spa/client/react/layout/ThemeProvider', () => ({ useTheme: () => ({ theme: 'light' }) }));
vi.mock('../../../../../../src/server/spa/client/react/utils/config', () => ({ isSessionContextAttachmentsEnabled: () => state.enabled }));
vi.mock('../../../../../../src/server/spa/client/react/features/chat/activeChatAttach', () => ({ attachSelectionToChat: state.route }));
beforeEach(() => { state.enabled = true; vi.clearAllMocks(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const source = { workspaceId: 'repo-A', filePath: 'src/a.ts', ref: { type: 'working-tree' as const, stage: 'unstaged' as const } };
async function mount(viewMode: 'split' | 'unified' = 'split', destinationId?: string, onAddComment?: (...args: any[]) => void, attachments = true) {
    const fake = createFakeDiffEditor();
    const sides = createFakeSelectionEditors(fake);
    const view = render(<MonacoFileDiffViewer workspaceId="repo-A" relativePath="src/a.ts" stage="unstaged"
        original={'one\nold'} modified={'one\nnew'} viewMode={viewMode} languageFeatures={false}
        onAddComment={onAddComment} diffSelectionDragSource={attachments ? { ...source, destinationId } : undefined} createEditor={async host => {
            host.append(sides.original.host, sides.modified.host); return fake.adapter;
        }} />);
    await act(flush);
    act(() => fake.finishDiff([{ originalStartLineNumber: 2, originalEndLineNumber: 2,
        modifiedStartLineNumber: 2, modifiedEndLineNumber: 2 }]));
    return { fake, sides, view, select: (side: string) => act(() => {
        sides[side].data.empty = false; sides[side].data.focused = true; sides[side].events.selection?.();
    }) };
}
it.each(['original', 'modified'])('attaches %s selection with the existing drag payload', async side => {
    const h = await mount(); expect(screen.queryByText('Attach as context')).toBeNull(); h.select(side);
    const pill = screen.getByRole('button', { name: 'Attach as context' });
    expect(pill.parentElement!.style.top).toBe('62px'); expect(h.sides[side].host.contains(pill)).toBe(true);
    const editorMouseDown = vi.fn(); h.sides[side].host.addEventListener('mousedown', editorMouseDown);
    expect(fireEvent.mouseDown(pill)).toBe(false); expect(editorMouseDown).not.toHaveBeenCalled(); fireEvent.click(pill);
    const coords = side === 'original' ? { oldLineStart: 2, oldLineEnd: 2 } : { newLineStart: 2, newLineEnd: 2 };
    expect(state.route).toHaveBeenCalledWith('repo-A', createMonacoDiffSelectionDragPayload(coords, h.sides[side].data.snippet, source));
    expect(screen.queryByText('Attach as context')).toBeNull();
    act(() => h.sides[side].events.scroll()); expect(screen.queryByText('Attach as context')).toBeNull();
    await act(async () => { h.sides[side].data.focused = false; h.sides[side].events.blur(); await Promise.resolve(); });
    act(() => { h.sides[side].data.focused = true; h.sides[side].events.focus(); });
    expect(screen.queryByText('Attach as context')).toBeNull();
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

it.each(['original', 'modified'])('exposes only the focused %s buffer selection for search', async side => {
    const onOpen = vi.fn();
    renderHook(() => useContentSearchShortcut({
        scope: 'repo', overlayOpen: false, onOpen, onFocusExisting: vi.fn(),
    }));
    const h = await mount();
    h.select('original');
    h.select('modified');
    h.sides[side].buffer.focus();
    expect(focusedMonacoSelection()).toBe(h.sides[side].data.snippet);
    fireEvent.keyDown(h.sides[side].buffer, { key: 'F', ctrlKey: true, shiftKey: true });
    expect(onOpen).toHaveBeenLastCalledWith(h.sides[side].data.snippet);
    h.sides[side].data.empty = true;
    expect(focusedMonacoSelection()).toBeUndefined();
    fireEvent.keyDown(h.sides[side].buffer, { key: 'F', metaKey: true, shiftKey: true });
    expect(onOpen).toHaveBeenLastCalledWith(undefined);
    h.sides[side].buffer.blur();
    expect(focusedMonacoSelection()).toBeUndefined();
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

it.each(['original', 'modified'])('restores the retained %s selection on refocus and disposes listeners', async side => {
    const h = await mount(); h.select(side);
    await act(async () => { h.sides[side].data.focused = false; h.sides[side].events.blur(); await Promise.resolve(); });
    expect(screen.queryByText('Attach as context')).toBeNull();
    act(() => { h.sides[side].data.focused = true; h.sides[side].events.focus(); });
    fireEvent.click(screen.getByRole('button', { name: 'Attach as context' }));
    expect(state.route).toHaveBeenCalledWith('repo-A', expect.objectContaining({ snippet: h.sides[side].data.snippet }));
    h.view.unmount();
    for (const owner of Object.values(h.sides)) {
        expect(owner.events.focus).toEqual(expect.any(Function));
        expect(owner.disposals.every(dispose => dispose.mock.calls.length === 1)).toBe(true);
    }
});

it.each(['unified', 'split'] as const)('comments on either side in %s with attachment support disabled', async mode => {
    state.enabled = false;
    const add = vi.fn();
    const h = await mount(mode, undefined, add, false);
    for (const side of ['original', 'modified']) {
        h.select(side);
        const button = screen.getByRole('button', { name: 'Comment', exact: true });
        expect(screen.queryByText('Attach as context')).toBeNull();
        const bubble = vi.fn();
        h.sides[side].host.addEventListener('pointerdown', bubble);
        expect(fireEvent.pointerDown(button)).toBe(false);
        expect(bubble).not.toHaveBeenCalled();
        fireEvent.click(button);
        expect(add).toHaveBeenLastCalledWith(expect.objectContaining({
            side: side === 'original' ? 'removed' : 'added', startColumn: 0, endColumn: 3,
            ...(side === 'original' ? { oldLineStart: 2, oldLineEnd: 2 } : { newLineStart: 2, newLineEnd: 2 }),
        }), h.sides[side].data.snippet, expect.objectContaining({ top: expect.any(Number), left: expect.any(Number) }));
        expect(screen.queryByRole('button', { name: 'Comment', exact: true })).toBeNull();
        act(() => h.sides[side].events.scroll());
        expect(screen.queryByRole('button', { name: 'Comment', exact: true })).toBeNull();
        h.sides[side].data.focused = false;
    }
});

it('keeps adjacent actions keyboard focusable and selection intact while focus moves between them', async () => {
    const add = vi.fn();
    const h = await mount('unified', undefined, add);
    h.select('modified');
    const comment = screen.getByRole('button', { name: 'Comment', exact: true });
    const attach = screen.getByRole('button', { name: 'Attach as context' });
    expect(comment.parentElement).toBe(attach.parentElement);
    expect(comment.tabIndex).toBe(0);
    expect(attach.tabIndex).toBe(0);
    await act(async () => { comment.focus(); h.sides.modified.data.focused = false; h.sides.modified.events.blur(); await Promise.resolve(); });
    act(() => attach.focus());
    expect(screen.getByRole('button', { name: 'Comment', exact: true })).toBe(comment);
    act(() => comment.focus());
    fireEvent.click(comment); // Native button activation also handles Enter/Space.
    expect(add).toHaveBeenCalledTimes(1);
    expect(h.sides.modified.data.empty).toBe(false);
    expect(state.route).not.toHaveBeenCalled();
});

it('clamps both actions by their measured width and hides when they cannot fit below the selection', async () => {
    const originalRect = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
        return this.getAttribute('aria-label') === 'Selection actions'
            ? { width: 220, height: 28 } as DOMRect : originalRect.call(this);
    });
    const h = await mount('split', undefined, vi.fn());
    h.sides.modified.data.left = 380;
    h.select('modified');
    const group = screen.getByRole('group', { name: 'Selection actions' });
    expect(group.style.left).toBe('172px');
    expect(group.className).toContain('dark:bg-gray-800');
    act(() => { h.sides.modified.data.top = 260; h.sides.modified.events.scroll(); });
    expect(screen.queryByRole('group', { name: 'Selection actions' })).toBeNull();
});

it('uses the live multiline selection and drops Comment when support is removed', async () => {
    const add = vi.fn();
    const h = await mount('split', undefined, add);
    Object.assign(h.sides.original.selection, { endLineNumber: 3, endColumn: 2 });
    h.sides.original.data.snippet = 'old\nnext';
    h.select('original');
    fireEvent.click(screen.getByRole('button', { name: 'Comment', exact: true }));
    expect(add).toHaveBeenCalledWith(expect.objectContaining({
        oldLineStart: 2, oldLineEnd: 3, startColumn: 0, endColumn: 1, side: 'removed',
    }), 'old\nnext', expect.any(Object));
    h.view.rerender(<MonacoFileDiffViewer workspaceId="repo-A" relativePath="src/a.ts" stage="unstaged"
        original={'one\nold'} modified={'one\nnew'} viewMode="split" languageFeatures={false}
        diffSelectionDragSource={source} />);
    h.select('original');
    expect(screen.queryByRole('button', { name: 'Comment', exact: true })).toBeNull();
    expect(screen.getByRole('button', { name: 'Attach as context' })).toBeTruthy();
});
