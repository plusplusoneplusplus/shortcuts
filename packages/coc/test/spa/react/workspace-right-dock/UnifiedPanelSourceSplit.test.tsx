/**
 * Two-pane source split in the unified right panel.
 *
 * The real `PreviewPane` and buffer run here; Monaco is a textarea that hands
 * its host a fake model through `onModelMount`, so the same-file second pane
 * can be checked to attach to that model rather than read its own copy.
 *
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEffect } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockExplorerApi = vi.hoisted(() => ({
    readBlob: vi.fn(),
    writeBlob: vi.fn(),
    readTrustedBlob: vi.fn(),
    searchFiles: vi.fn(async () => ({ results: [] as { path: string }[] })),
}));
vi.mock('../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerApi', () => ({
    explorerApi: mockExplorerApi,
}));

const mirrorEditors = vi.hoisted(() => [] as any[]);
const fakeMonaco = vi.hoisted(() => ({
    editor: {
        EditorOption: { readOnly: 91 },
        create: (_host: HTMLElement, options: any) => {
            const editor: any = {
                options,
                layout: () => undefined,
                updateOptions: () => undefined,
                dispose: () => { editor.disposed = true; },
                addAction: (action: any) => {
                    editor.action = action;
                    return { dispose: () => undefined };
                },
            };
            mirrorEditors.push(editor);
            return editor;
        },
    },
    KeyMod: { CtrlCmd: 2048 },
    KeyCode: { KeyS: 49 },
}));
vi.mock('../../../../src/server/spa/client/react/shared/file-viewer/MonacoFileEditor', async importOriginal => ({
    ...(await importOriginal<object>()),
    MonacoFileEditor: ({ value, onChange, onModelMount }: any) => {
        useEffect(() => {
            if (!onModelMount) return;
            const editor = {
                getSelection: () => null,
                setSelection: () => undefined,
                revealRangeInCenterIfOutsideViewport: () => undefined,
                getLayoutInfo: () => ({ height: 100 }),
                onDidLayoutChange: () => ({ dispose: () => undefined }),
                onDidChangeCursorSelection: () => ({ dispose: () => undefined }),
                getOption: () => false,
                onDidChangeConfiguration: () => ({ dispose: () => undefined }),
                updateOptions: () => undefined,
            };
            const cleanupMount = onModelMount({ editor, monaco: fakeMonaco, model: { modelOf: value } });
            return () => { cleanupMount?.(); };
        }, [onModelMount]);
        return <textarea data-testid="mock-monaco-textarea" value={value} onChange={e => onChange?.(e.target.value)} />;
    },
}));
vi.mock('../../../../src/server/spa/client/react/features/terminal/TerminalView', () => ({
    TerminalView: () => <div data-testid="mock-terminal" />,
}));
vi.mock('../../../../src/server/spa/client/react/features/repo-detail/explorer/ExplorerPanel', () => ({
    ExplorerPanel: ({ onOpenFile }: any) => (
        <button type="button" data-testid="mock-explorer-open"
            onClick={() => onOpenFile({ path: 'src/tree.ts', name: 'tree.ts' }, { preview: false })} />
    ),
}));
vi.mock('../../../../src/server/spa/client/react/features/notes/NotesView', () => ({
    NotesView: () => <div data-testid="mock-notes" />,
}));
vi.mock('../../../../src/server/spa/client/react/repos/cloneRegistry', () => ({
    getCocClientForWorkspace: () => ({}),
    lookupCloneBaseUrl: () => null,
}));
// No language document: the fake model only has to carry identity.
vi.mock('../../../../src/server/spa/client/react/features/language-servers/useLanguageDocument', () => ({
    useLanguageDocument: () => ({
        handleChange: () => undefined,
        markSaved: () => undefined,
        restart: () => undefined,
        view: null,
        snapshot: null,
        markers: [],
    }),
}));

import { UnifiedRightPanel } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/UnifiedRightPanel';
import { clearUnifiedPanelState } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelStore';
import { openUnifiedPanelTab } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelOpen';
import {
    clearSourceSplits,
    readSourceSplit,
    sourceSplitScopeKey,
} from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelSourceSplit';
import { _resetRuntimeConfig, applyRuntimeConfigPatch } from '../../../../src/server/spa/client/react/utils/config';
import type { WorkspaceDockController } from '../../../../src/server/spa/client/react/features/repo-detail/useWorkspaceDock';

const WS = 'ws-1';
const CHAT = 'chat-1';

function dockStub(overrides: Partial<WorkspaceDockController> = {}): WorkspaceDockController {
    return {
        isOpen: true,
        toggleOpen: vi.fn(),
        mode: 'explorer',
        selectMode: vi.fn(),
        target: WS,
        setTarget: vi.fn(() => true),
        targets: [],
        width: 900,
        maxWidth: 1200,
        isDragging: false,
        handleMouseDown: vi.fn(),
        handleTouchStart: vi.fn(),
        ...overrides,
    } as WorkspaceDockController;
}

function openFile(path: string, opts: { owner?: string; routingRef?: string | null; chatId?: string | null; repoLabel?: string } = {}) {
    return openUnifiedPanelTab(WS, {
        kind: 'file',
        ownerWorkspaceId: opts.owner ?? WS,
        ...(opts.routingRef === undefined ? {} : { ownerRoutingRef: opts.routingRef }),
        chatId: opts.chatId === undefined ? CHAT : opts.chatId,
        resourceId: path,
        label: path.split('/').pop() ?? path,
        ...(opts.repoLabel === undefined ? {} : { repoLabel: opts.repoLabel }),
    });
}

function openTerminal() {
    return openUnifiedPanelTab(WS, {
        kind: 'terminal', ownerWorkspaceId: WS, chatId: CHAT, resourceId: 'terminal', label: 'Terminal',
    });
}

// The views area width, as useContainerWidth measures it.
let viewsWidth = 900;
const observers = new Set<() => void>();
class TestResizeObserver {
    private readonly callback: () => void;
    constructor(callback: () => void) { this.callback = callback; }
    observe() { observers.add(this.callback); }
    unobserve() { observers.delete(this.callback); }
    disconnect() { observers.delete(this.callback); }
}
async function resizeViews(width: number) {
    viewsWidth = width;
    await act(async () => {
        observers.forEach(callback => callback());
        // useContainerWidth measures on a zero-delay timer, then a frame.
        await new Promise(resolve => setTimeout(resolve, 0));
        await new Promise(resolve => requestAnimationFrame(() => resolve(null)));
    });
}

const view = (tabId: string) => screen.getByTestId(`unified-panel-view-${tabId}`);
const isShown = (element: HTMLElement) => element.style.display !== 'none';
const splitKey = sourceSplitScopeKey(WS, CHAT);

function renderPanel(chatId: string | null = CHAT, workspaceId = WS) {
    return render(<UnifiedRightPanel workspaceId={workspaceId} chatId={chatId} dock={dockStub()} />);
}

function dragTabToRightEdge(tabId: string) {
    fireEvent.dragStart(screen.getByTestId(`unified-panel-tab-${tabId}`), { dataTransfer: { setData: () => undefined } });
    const target = screen.getByTestId('unified-panel-split-drop-target');
    fireEvent.dragOver(target, { dataTransfer: { dropEffect: 'none' } });
    fireEvent.drop(target, { dataTransfer: {} });
    fireEvent.dragEnd(screen.getByTestId(`unified-panel-tab-${tabId}`));
}

function openToRightFromMenu(tabId: string) {
    fireEvent.contextMenu(screen.getByTestId(`unified-panel-tab-${tabId}`), { clientX: 5, clientY: 5 });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open to the Right' }));
}

beforeEach(() => {
    vi.clearAllMocks();
    mirrorEditors.length = 0;
    mockExplorerApi.readBlob.mockImplementation(async (_ws: string, path: string) => ({
        content: `text of ${path}`, encoding: 'utf-8', mimeType: 'text/plain',
    }));
    mockExplorerApi.writeBlob.mockResolvedValue({ success: true });
    localStorage.clear();
    clearUnifiedPanelState();
    clearSourceSplits();
    _resetRuntimeConfig();
    applyRuntimeConfigPatch({ panelSourceSplitEnabled: true });
    viewsWidth = 900;
    observers.clear();
    vi.stubGlobal('ResizeObserver', TestResizeObserver);
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
        configurable: true,
        get(this: HTMLElement) { return this.dataset.testid === 'unified-panel-views' ? viewsWidth : 0; },
    });
});
afterEach(() => {
    cleanup();
    clearUnifiedPanelState();
    clearSourceSplits();
    _resetRuntimeConfig();
    vi.unstubAllGlobals();
    delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
});

describe('source split creation (AC-01)', () => {
    it('drags a file tab to the right edge to show two panes with a divider', async () => {
        const a = openFile('src/a.ts');
        const b = openFile('src/b.ts');
        renderPanel();
        await screen.findByTestId('mock-monaco-textarea');
        // The last opened file is active; drag the other one to the right.
        dragTabToRightEdge(a);

        await waitFor(() => expect(view(a).dataset.splitPane).toBe('right'));
        expect(view(b).dataset.splitPane).toBe('left');
        expect(isShown(view(a)) && isShown(view(b))).toBe(true);
        expect(screen.getByTestId('unified-panel-split-divider')).toBeTruthy();
        expect(screen.getByTestId('unified-panel-split-pane-header-right').dataset.focused).toBe('true');
        expect(screen.getByTestId(`unified-panel-tab-${a}`).getAttribute('aria-selected')).toBe('true');
        expect(readSourceSplit(splitKey)).toMatchObject({ left: b, right: a, focus: 'right' });
    });

    it('highlights the drop target only during a valid file drag and clears it on cancel', async () => {
        const a = openFile('src/a.ts');
        const term = openTerminal();
        renderPanel();

        fireEvent.dragStart(screen.getByTestId(`unified-panel-tab-${term}`), { dataTransfer: { setData: () => undefined } });
        expect(screen.queryByTestId('unified-panel-split-drop-target')).toBeNull();
        fireEvent.dragEnd(screen.getByTestId(`unified-panel-tab-${term}`));

        fireEvent.dragStart(screen.getByTestId(`unified-panel-tab-${a}`), { dataTransfer: { setData: () => undefined } });
        const target = screen.getByTestId('unified-panel-split-drop-target');
        fireEvent.dragOver(target, { dataTransfer: { dropEffect: 'none' } });
        expect(target.dataset.hover).toBe('true');
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(screen.queryByTestId('unified-panel-split-drop-target')).toBeNull();
        expect(readSourceSplit(splitKey)).toBeNull();
        expect(screen.queryByTestId('unified-panel-split-divider')).toBeNull();
    });

    it('offers "Open to the Right" for file tabs only', async () => {
        const a = openFile('src/a.ts');
        const term = openTerminal();
        renderPanel();

        fireEvent.contextMenu(screen.getByTestId(`unified-panel-tab-${term}`), { clientX: 5, clientY: 5 });
        expect(screen.queryByRole('menuitem', { name: 'Open to the Right' })).toBeNull();
        fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });

        openToRightFromMenu(a);
        await waitFor(() => expect(view(a).dataset.splitPane).toBe('left'));
        // The sole file opens on both sides; the right side is its second view.
        expect(screen.getByTestId('unified-panel-split-mirror')).toBeTruthy();
        expect(readSourceSplit(splitKey)).toMatchObject({ left: a, right: a, focus: 'right' });
    });

    it('replaces the right pane when a file lands on an existing split', async () => {
        const a = openFile('src/a.ts');
        const b = openFile('src/b.ts');
        const c = openFile('src/c.ts');
        renderPanel();
        openToRightFromMenu(b);
        await waitFor(() => expect(view(b).dataset.splitPane).toBe('right'));

        dragTabToRightEdge(a);

        await waitFor(() => expect(view(a).dataset.splitPane).toBe('right'));
        expect(view(c).dataset.splitPane).toBe('left');
        expect(isShown(view(b))).toBe(false);
        expect(screen.getAllByTestId(/^unified-panel-split-pane-header-/)).toHaveLength(2);
    });

    it('is absent while the feature flag is off', async () => {
        _resetRuntimeConfig();
        const a = openFile('src/a.ts');
        renderPanel();
        fireEvent.dragStart(screen.getByTestId(`unified-panel-tab-${a}`), { dataTransfer: { setData: () => undefined } });
        expect(screen.queryByTestId('unified-panel-split-drop-target')).toBeNull();
        fireEvent.dragEnd(screen.getByTestId(`unified-panel-tab-${a}`));
        fireEvent.contextMenu(screen.getByTestId(`unified-panel-tab-${a}`), { clientX: 5, clientY: 5 });
        expect(screen.queryByRole('menuitem', { name: 'Open to the Right' })).toBeNull();
    });
});

describe('editing in two panes (AC-02)', () => {
    it('keeps one buffer for a file shown in both panes and attaches the second view to its model', async () => {
        const a = openFile('src/a.ts');
        renderPanel();
        await screen.findByTestId('mock-monaco-textarea');
        openToRightFromMenu(a);

        await waitFor(() => expect(mirrorEditors).toHaveLength(1));
        // One read, one buffer: the second pane never loads its own copy.
        expect(mockExplorerApi.readBlob).toHaveBeenCalledTimes(1);
        expect(screen.getAllByTestId('mock-monaco-textarea')).toHaveLength(1);
        expect(mirrorEditors[0].options.model).toEqual({ modelOf: 'text of src/a.ts' });

        fireEvent.change(screen.getByTestId('mock-monaco-textarea'), { target: { value: 'shared edit' } });
        await waitFor(() => expect(screen.getByTestId(`unified-panel-tab-dirty-${a}`)).toBeTruthy());
        expect(screen.getByTestId('unified-panel-split-pane-label-right').textContent).toContain('●');

        // Ctrl/Cmd+S in the second view writes through the tab's own save.
        await act(async () => { await mirrorEditors[0].action.run(); });
        expect(mockExplorerApi.writeBlob).toHaveBeenCalledTimes(1);
        expect(mockExplorerApi.writeBlob).toHaveBeenCalledWith(WS, 'src/a.ts', 'shared edit');
        await waitFor(() => expect(screen.queryByTestId(`unified-panel-tab-dirty-${a}`)).toBeNull());
    });

    it('keeps separate buffers for equal paths from different owners', async () => {
        const local = openFile('src/same.ts', { routingRef: null });
        const remote = openFile('src/same.ts', { owner: WS, routingRef: 'remote:host-b|ws-1' });
        expect(local).not.toBe(remote);
        renderPanel();
        openToRightFromMenu(local);
        await waitFor(() => expect(view(local).dataset.splitPane).toBe('right'));
        expect(view(remote).dataset.splitPane).toBe('left');
        await waitFor(() => expect(screen.getAllByTestId('mock-monaco-textarea')).toHaveLength(2));
        expect(screen.queryByTestId('unified-panel-split-mirror')).toBeNull();

        fireEvent.change(view(remote).querySelector('textarea')!, { target: { value: 'remote edit' } });
        await waitFor(() => expect(screen.getByTestId(`unified-panel-tab-dirty-${remote}`)).toBeTruthy());
        expect(screen.queryByTestId(`unified-panel-tab-dirty-${local}`)).toBeNull();
    });

    it('labels same-name panes by filename and puts each repo-qualified path on hover', async () => {
        const api = openFile('src/same.ts', { owner: 'member-api', repoLabel: 'api' });
        const web = openFile('src/same.ts', { owner: 'member-web', repoLabel: 'web' });
        renderPanel();
        openToRightFromMenu(api);
        await waitFor(() => expect(view(api).dataset.splitPane).toBe('right'));
        expect(view(web).dataset.splitPane).toBe('left');

        const left = screen.getByTestId('unified-panel-split-pane-label-left');
        const right = screen.getByTestId('unified-panel-split-pane-label-right');
        expect(left.getAttribute('title')).toBe('web: src/same.ts');
        expect(right.getAttribute('title')).toBe('api: src/same.ts');
        for (const [label, repo] of [[left, 'web'], [right, 'api']] as const) {
            // Visible text is the bare name; the repo stays for screen readers only.
            const visible = [...label.childNodes]
                .filter(node => !(node instanceof HTMLElement && node.classList.contains('sr-only')))
                .map(node => node.textContent).join('');
            expect(visible).toBe('same.ts');
            expect(label.querySelector('.sr-only')?.textContent).toContain(repo);
        }
    });

    it('surfaces a failed save from either pane and keeps the edit', async () => {
        const a = openFile('src/a.ts');
        renderPanel();
        await screen.findByTestId('mock-monaco-textarea');
        openToRightFromMenu(a);
        await waitFor(() => expect(mirrorEditors).toHaveLength(1));
        fireEvent.change(screen.getByTestId('mock-monaco-textarea'), { target: { value: 'unsaved' } });
        mockExplorerApi.writeBlob.mockRejectedValueOnce(new Error('disk full'));

        await act(async () => { await mirrorEditors[0].action.run(); });

        await waitFor(() => expect(screen.getByTestId(`unified-panel-tab-error-${a}`)).toBeTruthy());
        expect(screen.getByTestId('preview-error').textContent).toContain('disk full');
        expect(screen.getByTestId(`unified-panel-tab-${a}`)).toBeTruthy();
    });

    it('guards closing a dirty pane file and keeps the split until the close is confirmed', async () => {
        const a = openFile('src/a.ts');
        const b = openFile('src/b.ts');
        renderPanel();
        openToRightFromMenu(a);
        await waitFor(() => expect(screen.getAllByTestId('mock-monaco-textarea')).toHaveLength(2));
        const editors = screen.getAllByTestId('mock-monaco-textarea');
        fireEvent.change(editors[editors.length - 1], { target: { value: 'pending' } });
        const dirtyId = (await screen.findAllByTestId(/^unified-panel-tab-dirty-/))[0].dataset.testid!
            .slice('unified-panel-tab-dirty-'.length);

        fireEvent.click(screen.getByTestId(`unified-panel-tab-close-${dirtyId}`));
        expect(screen.getByTestId('explorer-close-tabs-prompt')).toBeTruthy();
        fireEvent.click(screen.getByTestId('explorer-close-cancel-btn'));
        expect(readSourceSplit(splitKey)).toMatchObject({ left: b, right: a });

        fireEvent.click(screen.getByTestId(`unified-panel-tab-close-${dirtyId}`));
        fireEvent.click(screen.getByTestId('explorer-close-dont-save-btn'));
        await waitFor(() => expect(readSourceSplit(splitKey)).toBeNull());
        const remaining = dirtyId === a ? b : a;
        expect(screen.getByTestId(`unified-panel-tab-${remaining}`).getAttribute('aria-selected')).toBe('true');
    });

    it('opens Explorer files into the focused pane', async () => {
        const a = openFile('src/a.ts');
        const b = openFile('src/b.ts');
        renderPanel();
        openToRightFromMenu(a);
        await waitFor(() => expect(view(a).dataset.splitPane).toBe('right'));

        // Focus the left pane, then open from the Explorer tree.
        fireEvent.click(screen.getByTestId('unified-panel-split-pane-label-left'));
        expect(readSourceSplit(splitKey)?.focus).toBe('left');
        fireEvent.click(screen.getByTestId('mock-explorer-open'));

        await waitFor(() => expect(readSourceSplit(splitKey)?.left).not.toBe(b));
        expect(readSourceSplit(splitKey)).toMatchObject({ right: a, focus: 'left' });
        expect(screen.getByTestId('unified-panel-split-pane-label-left').textContent).toContain('tree.ts');
    });
});

describe('split layout and lifetime (AC-03)', () => {
    it('shows only the focused pane when narrow and restores both when widened', async () => {
        const a = openFile('src/a.ts');
        const b = openFile('src/b.ts');
        renderPanel();
        openToRightFromMenu(a);
        await waitFor(() => expect(view(a).dataset.splitPane).toBe('right'));

        await resizeViews(563);
        expect(screen.queryByTestId('unified-panel-split-divider')).toBeNull();
        expect(isShown(view(a))).toBe(true);
        expect(isShown(view(b))).toBe(false);
        expect(screen.getByTestId('unified-panel-views').dataset.split).toBe('collapsed');

        await resizeViews(564);
        expect(screen.getByTestId('unified-panel-split-divider')).toBeTruthy();
        expect(isShown(view(b))).toBe(true);
    });

    it('resizes with the keyboard within the minimum pane bounds', async () => {
        const a = openFile('src/a.ts');
        openFile('src/b.ts');
        renderPanel();
        openToRightFromMenu(a);
        const divider = await screen.findByTestId('unified-panel-split-divider');
        expect(divider.getAttribute('aria-valuenow')).toBe('50');
        fireEvent.keyDown(divider, { key: 'ArrowRight' });
        expect(divider.getAttribute('aria-valuenow')).toBe('55');
        fireEvent.keyDown(divider, { key: 'Home' });
        expect(Number(divider.getAttribute('aria-valuenow'))).toBe(Math.round(280 / (900 - 4) * 100));
        fireEvent.keyDown(divider, { key: 'End' });
        expect(Number(divider.getAttribute('aria-valuenow'))).toBe(Math.round((1 - 280 / (900 - 4)) * 100));
    });

    it('keeps the split behind a non-file tab and brings it back on the next file', async () => {
        const a = openFile('src/a.ts');
        const b = openFile('src/b.ts');
        const term = openTerminal();
        renderPanel();
        fireEvent.click(screen.getByTestId(`unified-panel-tab-${b}`));
        openToRightFromMenu(a);
        await waitFor(() => expect(view(a).dataset.splitPane).toBe('right'));

        fireEvent.click(screen.getByTestId(`unified-panel-tab-${term}`));
        await waitFor(() => expect(screen.queryByTestId('unified-panel-split-divider')).toBeNull());
        expect(isShown(view(a))).toBe(false);
        expect(readSourceSplit(splitKey)).toMatchObject({ left: b, right: a });

        fireEvent.click(screen.getByTestId(`unified-panel-tab-${a}`));
        await waitFor(() => expect(screen.getByTestId('unified-panel-split-divider')).toBeTruthy());
        expect(isShown(view(b))).toBe(true);
    });

    it('closes the secondary pane without closing or dirtying its file', async () => {
        const a = openFile('src/a.ts');
        const b = openFile('src/b.ts');
        renderPanel();
        openToRightFromMenu(a);
        await waitFor(() => expect(screen.getAllByTestId('mock-monaco-textarea')).toHaveLength(2));
        const rightEditor = view(a).querySelector('textarea')!;
        fireEvent.change(rightEditor, { target: { value: 'kept' } });
        await waitFor(() => expect(screen.getByTestId(`unified-panel-tab-dirty-${a}`)).toBeTruthy());

        fireEvent.click(screen.getByTestId('unified-panel-split-close-right'));

        expect(readSourceSplit(splitKey)).toBeNull();
        expect(screen.getByTestId(`unified-panel-tab-${a}`)).toBeTruthy();
        expect(screen.getByTestId(`unified-panel-tab-${b}`).getAttribute('aria-selected')).toBe('true');
        expect(screen.getByTestId(`unified-panel-tab-dirty-${a}`)).toBeTruthy();
        expect((view(a).querySelector('textarea') as HTMLTextAreaElement).value).toBe('kept');
    });

    it('isolates splits by chat and never persists them', async () => {
        const a = openFile('src/a.ts');
        openFile('src/b.ts');
        const other = openFile('src/other.ts', { chatId: 'chat-2' });
        const { rerender } = renderPanel();
        openToRightFromMenu(a);
        await waitFor(() => expect(view(a).dataset.splitPane).toBe('right'));

        rerender(<UnifiedRightPanel workspaceId={WS} chatId="chat-2" dock={dockStub()} />);
        await waitFor(() => expect(screen.getByTestId(`unified-panel-tab-${other}`)).toBeTruthy());
        expect(screen.queryByTestId('unified-panel-split-divider')).toBeNull();
        expect(readSourceSplit(sourceSplitScopeKey(WS, 'chat-2'))).toBeNull();

        rerender(<UnifiedRightPanel workspaceId={WS} chatId={CHAT} dock={dockStub()} />);
        await waitFor(() => expect(screen.getByTestId('unified-panel-split-divider')).toBeTruthy());

        const persisted = Object.keys(localStorage).map(key => localStorage.getItem(key) ?? '').join('\n');
        expect(persisted).not.toMatch(/split|ratio|focus/i);

        // A reload drops the in-memory split; ordinary tabs remain.
        cleanup();
        clearSourceSplits();
        renderPanel();
        expect(screen.getByTestId(`unified-panel-tab-${a}`)).toBeTruthy();
        expect(screen.queryByTestId('unified-panel-split-divider')).toBeNull();
    });
});
