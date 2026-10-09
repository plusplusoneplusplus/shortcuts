// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MonacoFileEditor } from '../../../../../src/server/spa/client/react/shared/file-viewer/MonacoFileEditor';
import { MonacoFileEditor as ExplorerEditor } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/MonacoFileEditor';

const stub = vi.hoisted(() => ({ enabled: true, mounted: false, focused: true, empty: true, endColumn: 4,
    position: { top: 60, left: 120, height: 18 } as { top: number; left: number; height: number } | null,
    events: {} as Record<string, () => void>, disposals: [] as ReturnType<typeof vi.fn>[], route: vi.fn(), snippet: 'unsaved text\nmore',
}));
function listen(event: string, handler: () => void) {
    stub.events[event] = handler;
    const dispose = vi.fn(); stub.disposals.push(dispose); return { dispose };
}
vi.mock('@monaco-editor/react', () => ({ default: ({ onMount }: any) => {
    if (!stub.mounted) {
        stub.mounted = true;
        queueMicrotask(() => onMount({
            getModel: () => ({ getValue: () => 'disk text', getValueInRange: () => stub.snippet }),
            getSelection: () => ({ startLineNumber: 24, endLineNumber: 35, endColumn: stub.endColumn,
                isEmpty: () => stub.empty, getEndPosition: () => ({ lineNumber: 35, column: stub.endColumn }) }),
            hasWidgetFocus: () => stub.focused,
            getScrolledVisiblePosition: () => stub.position,
            getLayoutInfo: () => ({ width: 500, height: 300, contentLeft: 40, contentWidth: 450 }),
            onDidChangeCursorSelection: (cb: () => void) => listen('selection', cb),
            onDidScrollChange: (cb: () => void) => listen('scroll', cb),
            onDidLayoutChange: (cb: () => void) => listen('layout', cb),
            onDidChangeModel: (cb: () => void) => listen('model', cb),
            onDidBlurEditorWidget: (cb: () => void) => listen('blur', cb),
            onDidFocusEditorWidget: (cb: () => void) => listen('focus', cb),
            addAction: () => ({ dispose: vi.fn() }), layout: vi.fn(),
        }, { KeyMod: { CtrlCmd: 1 }, KeyCode: { KeyS: 2 } }));
    }
    return <div />;
} }));
vi.mock('../../../../../src/server/spa/client/react/layout/ThemeProvider', () => ({ useTheme: () => ({ theme: 'light' }) }));
vi.mock('../../../../../src/server/spa/client/react/utils/config', () => ({ isSessionContextAttachmentsEnabled: () => stub.enabled }));
vi.mock('../../../../../src/server/spa/client/react/features/chat/activeChatAttach', () => ({ attachSelectionToChat: stub.route }));
beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(stub, { enabled: true, mounted: false, focused: true, empty: true, endColumn: 4,
        position: { top: 60, left: 120, height: 18 }, events: {}, disposals: [], snippet: 'unsaved text\nmore' });
});
afterEach(cleanup);
async function mount(Component = MonacoFileEditor, selectionContext?: { workspaceId: string; filePath: string; destinationId?: string }) {
    const view = render(<Component value="disk text" language="rust" selectionContext={selectionContext} />);
    await act(async () => { await Promise.resolve(); }); return view;
}
const context = { workspaceId: 'repo-A', filePath: 'src/status.rs' };
function select() { act(() => { stub.empty = false; stub.events.selection(); }); }

describe.each([['shared', MonacoFileEditor], ['explorer shim', ExplorerEditor]] as const)('%s file selection pill', (_, Component) => {
    it('routes to the concrete clone owner while keeping the raw workspace in the payload', async () => {
        const destinationId = 'remote:server-a:repo-A';
        const view = await mount(Component, { ...context, destinationId });
        select(); fireEvent.click(screen.getByRole('button'));
        expect(stub.route).toHaveBeenLastCalledWith(destinationId, expect.objectContaining({ sourceWorkspaceId: 'repo-A' }));

        const nextDestinationId = 'remote:server-b:repo-A';
        view.rerender(<Component value="disk text" language="rust" selectionContext={{ ...context, destinationId: nextDestinationId }} />);
        select(); fireEvent.click(screen.getByRole('button'));
        expect(stub.route).toHaveBeenLastCalledWith(nextDestinationId, expect.objectContaining({ sourceWorkspaceId: 'repo-A' }));
        expect(stub.route).toHaveBeenCalledTimes(2);
    });
    it('restores a retained selection on refocus without a selection event', async () => {
        await mount(Component, context); select();
        await act(async () => { stub.focused = false; stub.events.blur(); await Promise.resolve(); });
        expect(screen.queryByRole('button')).toBeNull();
        act(() => { stub.focused = true; stub.events.focus(); });
        fireEvent.click(screen.getByRole('button', { name: 'Attach as context' }));
        expect(stub.route).toHaveBeenCalledWith('repo-A', expect.objectContaining({ snippet: stub.snippet }));
    });
    it('shows below selection, preserves selection, attaches live text and stays dismissed on scroll', async () => {
        await mount(Component, context);
        expect(screen.queryByRole('button')).toBeNull(); select();
        const pill = screen.getByRole('button', { name: 'Attach as context' });
        expect(pill.style.top).toBe('80px'); expect(pill.style.left).toBe('120px');
        expect(fireEvent.mouseDown(pill)).toBe(false); fireEvent.click(pill);
        expect(stub.route).toHaveBeenCalledWith('repo-A', expect.objectContaining({ sourceWorkspaceId: 'repo-A',
            filePath: 'src/status.rs', range: { start: 24, end: 35 }, snippet: 'unsaved text\nmore' }));
        expect(screen.queryByRole('button')).toBeNull(); act(() => stub.events.scroll());
        expect(screen.queryByRole('button')).toBeNull();
        await act(async () => { stub.focused = false; stub.events.blur(); await Promise.resolve(); });
        act(() => { stub.focused = true; stub.events.focus(); });
        expect(screen.queryByRole('button')).toBeNull(); select(); expect(screen.getByRole('button')).toBeTruthy();
    });
});
it('hides on collapse, scrolling out of view, layout clipping, and blur', async () => {
    await mount(MonacoFileEditor, context); select();
    act(() => { stub.empty = true; stub.events.selection(); }); expect(screen.queryByRole('button')).toBeNull(); select();
    act(() => { stub.position = null; stub.events.scroll(); }); expect(screen.queryByRole('button')).toBeNull();
    act(() => { stub.position = { top: 290, left: 100, height: 18 }; stub.events.layout(); }); expect(screen.queryByRole('button')).toBeNull();
    act(() => { stub.position = { top: 60, left: 120, height: 18 }; stub.events.scroll(); }); expect(screen.getByRole('button')).toBeTruthy();
    await act(async () => { stub.focused = false; stub.events.blur(); await Promise.resolve(); }); expect(screen.queryByRole('button')).toBeNull();
});
it('retains the pill when keyboard focus moves to it', async () => {
    await mount(MonacoFileEditor, context); select(); const pill = screen.getByRole('button');
    await act(async () => { pill.focus(); stub.focused = false; stub.events.blur(); await Promise.resolve(); });
    expect(screen.getByRole('button')).toBe(pill); fireEvent.click(pill); expect(stub.route).toHaveBeenCalledTimes(1);
});
it('excludes a trailing line without selected characters', async () => {
    await mount(MonacoFileEditor, context); stub.endColumn = 1; select(); fireEvent.click(screen.getByRole('button'));
    expect(stub.route.mock.calls[0][1].range).toEqual({ start: 24, end: 34 });
});
it('keeps generic viewer hosts outside this feature', async () => {
    await mount(); expect(stub.events.selection).toBeUndefined(); expect(screen.queryByRole('button')).toBeNull();
});
it('hides with the feature flag off', async () => {
    stub.enabled = false; await mount(MonacoFileEditor, context);
    expect(stub.events.selection).toBeUndefined(); expect(screen.queryByRole('button')).toBeNull();
});
it.each(['/tmp/local.rs', 'C:/local.rs'])('rejects invalid repo paths: %s', async filePath => {
    await mount(MonacoFileEditor, { ...context, filePath }); select(); expect(screen.queryByRole('button')).toBeNull();
});
it('rejects whitespace-only text and cleans up listeners', async () => {
    const view = await mount(MonacoFileEditor, context); stub.snippet = '  \n'; select(); expect(screen.queryByRole('button')).toBeNull();
    expect(stub.events.focus).toEqual(expect.any(Function));
    view.unmount(); expect(stub.disposals.every(dispose => dispose.mock.calls.length === 1)).toBe(true);
});
