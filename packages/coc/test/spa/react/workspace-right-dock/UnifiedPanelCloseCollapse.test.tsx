/**
 * Closing the last visible tab collapses the unified right panel.
 *
 * A user close (✕, middle click, Ctrl/Cmd+W, the tab menu's bulk closes) that
 * leaves the visible strip empty clears the dock open bit, unless the
 * Search/Explorer navigator is showing. A cancelled guard, another chat's
 * tabs, and an empty panel opened on purpose never collapse it. The pure rule
 * is pinned in `closeTabRouting.test.ts`; these cases pin the wiring.
 *
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
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
// Monaco never loads in jsdom; the textarea stands in for the edit buffer.
vi.mock('../../../../src/server/spa/client/react/shared/file-viewer/MonacoFileEditor', () => ({
    MonacoFileEditor: ({ value, onChange }: any) => (
        <textarea
            data-testid="mock-monaco-textarea"
            value={value}
            onChange={e => onChange?.(e.target.value)}
        />
    ),
    getMonacoLanguage: () => 'plaintext',
}));
let reportTerminalSessions: (sessions: readonly {
    id: string;
    serverSessionId?: string;
    status: 'running' | 'exited';
}[]) => void = () => {};
vi.mock('../../../../src/server/spa/client/react/features/terminal/TerminalView', () => ({
    TerminalView: ({ onSessionsChange }: {
        onSessionsChange?: (sessions: readonly {
            id: string;
            serverSessionId?: string;
            status: 'running' | 'exited';
        }[]) => void;
    }) => {
        reportTerminalSessions = sessions => onSessionsChange?.(sessions);
        return <div data-testid="mock-terminal" />;
    },
}));
vi.mock('../../../../src/server/spa/client/react/features/repo-detail/explorer/ExplorerPanel', () => ({
    ExplorerPanel: () => <div data-testid="mock-explorer" />,
}));
vi.mock('../../../../src/server/spa/client/react/features/notes/NotesView', () => ({
    NotesView: () => <div data-testid="mock-notes" />,
}));
// The two autosaving views, reduced to their host seams (see the header).
type HostSeams = {
    dirty?: (dirty: boolean) => void;
    register?: (save: (() => Promise<boolean>) | null) => void;
};
let noteSeams: HostSeams = {};
let canvasSeams: HostSeams = {};
vi.mock('../../../../src/server/spa/client/react/features/notes/editor/NoteEditor', () => ({
    NoteEditor: ({ onDirtyChange, onRegisterSave, notePath }: any) => {
        noteSeams = { dirty: onDirtyChange, register: onRegisterSave };
        return <div data-testid="mock-note-editor">{notePath}</div>;
    },
}));
vi.mock('../../../../src/server/spa/client/react/features/canvas/CanvasPanel', () => ({
    CanvasPanel: ({ onDirtyChange, onRegisterSave, canvasId }: any) => {
        canvasSeams = { dirty: onDirtyChange, register: onRegisterSave };
        return <div data-testid="mock-canvas-panel">{canvasId}</div>;
    },
}));

vi.mock('../../../../src/server/spa/client/react/repos/cloneRegistry', () => ({
    getCocClientForWorkspace: () => ({ canvases: { list: async () => [], create: async () => ({ id: 'c1', title: 'c' }) } }),
    lookupCloneBaseUrl: () => null,
}));
// `PreviewPane` opens a language document for every live repo file; this suite
// is about panel behaviour, not language support.
vi.mock('../../../../src/server/spa/client/react/features/language-servers/languageServerClient',
    async () => await import('../language-servers/inertTransportMock'));


import { UnifiedRightPanel } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/UnifiedRightPanel';
import { clearUnifiedPanelState } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelStore';
import { openUnifiedPanelTab } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelOpen';
import {
    clearUnifiedTreeState,
    writeUnifiedTreeState,
} from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelTree';
import type { WorkspaceDockController } from '../../../../src/server/spa/client/react/features/repo-detail/useWorkspaceDock';
import {
    openWorkspaceDock,
    workspaceDockOpenStorageKey,
} from '../../../../src/server/spa/client/react/features/repo-detail/WorkspaceDockToggle';

const WS = 'ws-1';
const CHAT = 'chat-1';

function dockStub(overrides: Partial<WorkspaceDockController> = {}): WorkspaceDockController {
    return {
        isOpen: true,
        toggleOpen: vi.fn(),
        mode: 'explorer',
        selectMode: vi.fn(),
        target: WS,
        setTarget: vi.fn(),
        targets: [],
        width: 420,
        maxWidth: 900,
        isDragging: false,
        handleMouseDown: vi.fn(),
        handleTouchStart: vi.fn(),
        ...overrides,
    };
}

function openFile(path: string, chatId: string | null = CHAT) {
    return openUnifiedPanelTab(WS, {
        kind: 'file',
        ownerWorkspaceId: WS,
        chatId,
        resourceId: path,
        label: path.split('/').pop() ?? path,
    });
}

function renderPanel(chatId: string | null = CHAT) {
    return render(<UnifiedRightPanel workspaceId={WS} chatId={chatId} dock={dockStub()} />);
}

function dockOpenBit(): string | null {
    return localStorage.getItem(workspaceDockOpenStorageKey(WS));
}

function tabNode(tabId: string): HTMLElement {
    return screen.getByTestId(`unified-panel-tab-${tabId}`);
}

beforeEach(() => {
    vi.clearAllMocks();
    mockExplorerApi.searchFiles.mockResolvedValue({ results: [] });
    mockExplorerApi.readBlob.mockResolvedValue({ content: 'hello', encoding: 'utf-8', mimeType: 'text/plain' });
    mockExplorerApi.writeBlob.mockResolvedValue({ success: true });
    localStorage.clear();
    clearUnifiedPanelState();
    clearUnifiedTreeState();
    // The navigator is hidden unless a case turns it on.
    writeUnifiedTreeState(WS, { open: false, width: 220 });
});
afterEach(() => {
    cleanup();
    clearUnifiedPanelState();
    clearUnifiedTreeState();
    noteSeams = {};
    canvasSeams = {};
});

describe('UnifiedRightPanel collapses when its last tab closes', () => {
    it('collapses after the strip ✕ closes the last tab', async () => {
        const tabId = openFile('src/a.ts');
        renderPanel();
        expect(dockOpenBit()).toBe('1');

        fireEvent.click(await screen.findByTestId(`unified-panel-tab-close-${tabId}`));

        expect(screen.queryByTestId(`unified-panel-tab-${tabId}`)).toBeNull();
        expect(dockOpenBit()).toBe('0');
    });

    it('collapses after a middle click closes the last tab', async () => {
        const tabId = openFile('src/a.ts');
        renderPanel();
        await screen.findByTestId(`unified-panel-tab-${tabId}`);

        fireEvent(tabNode(tabId), new MouseEvent('auxclick', { bubbles: true, button: 1 }));

        expect(dockOpenBit()).toBe('0');
    });

    it('collapses after Ctrl/Cmd+W closes the last tab', async () => {
        const tabId = openFile('src/a.ts');
        renderPanel();
        const tab = await screen.findByTestId(`unified-panel-tab-${tabId}`);
        // jsdom runs no layout, so the panel's hidden-pane guard would see a
        // null `offsetParent` on a panel that is plainly on screen.
        const offsetParent = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetParent');
        Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
            configurable: true,
            get(this: HTMLElement) { return this.parentElement ?? document.body; },
        });
        onTestFinished(() => {
            if (offsetParent) Object.defineProperty(HTMLElement.prototype, 'offsetParent', offsetParent);
        });
        act(() => { tab.focus(); });

        const event = new KeyboardEvent('keydown', { key: 'w', ctrlKey: true, bubbles: true, cancelable: true });
        act(() => { document.dispatchEvent(event); });

        expect(screen.queryByTestId(`unified-panel-tab-${tabId}`)).toBeNull();
        expect(dockOpenBit()).toBe('0');
    });

    it('stays open while other tabs remain', async () => {
        const first = openFile('src/a.ts');
        openFile('src/b.ts');
        renderPanel();

        fireEvent.click(await screen.findByTestId(`unified-panel-tab-close-${first}`));

        expect(dockOpenBit()).toBe('1');
    });

    it('collapses once after Close All empties the strip', async () => {
        const first = openFile('src/a.ts');
        const second = openFile('src/b.ts');
        renderPanel();
        await screen.findByTestId(`unified-panel-tab-${second}`);

        fireEvent.contextMenu(tabNode(first), { clientX: 20, clientY: 30 });
        fireEvent.click(screen.getByTestId('unified-panel-tab-menu-close-all'));

        await waitFor(() => expect(screen.queryByTestId(`unified-panel-tab-${second}`)).toBeNull());
        expect(screen.queryByTestId(`unified-panel-tab-${first}`)).toBeNull();
        expect(dockOpenBit()).toBe('0');
    });

    it('stays open when the Explorer navigator is showing', async () => {
        writeUnifiedTreeState(WS, { open: true, width: 220 });
        const tabId = openFile('src/a.ts');
        renderPanel();

        fireEvent.click(await screen.findByTestId(`unified-panel-tab-close-${tabId}`));

        expect(screen.queryByTestId(`unified-panel-tab-${tabId}`)).toBeNull();
        expect(dockOpenBit()).toBe('1');
        expect(screen.getByTestId('mock-explorer')).toBeTruthy();
    });

    it('keeps the tab and the panel when the unsaved-edits prompt is cancelled', async () => {
        const tabId = openFile('src/a.ts');
        renderPanel();
        fireEvent.change(await screen.findByTestId('mock-monaco-textarea'), { target: { value: 'edited' } });
        await waitFor(() => expect(screen.getByTestId(`unified-panel-tab-dirty-${tabId}`)).toBeTruthy());

        fireEvent.click(screen.getByTestId(`unified-panel-tab-close-${tabId}`));
        fireEvent.click(screen.getByTestId('explorer-close-cancel-btn'));

        expect(tabNode(tabId)).toBeTruthy();
        expect(dockOpenBit()).toBe('1');
    });

    it("collapses once Don't Save lets the last dirty tab go", async () => {
        const tabId = openFile('src/a.ts');
        renderPanel();
        fireEvent.change(await screen.findByTestId('mock-monaco-textarea'), { target: { value: 'edited' } });
        await waitFor(() => expect(screen.getByTestId(`unified-panel-tab-dirty-${tabId}`)).toBeTruthy());

        fireEvent.click(screen.getByTestId(`unified-panel-tab-close-${tabId}`));
        expect(dockOpenBit()).toBe('1');
        fireEvent.click(screen.getByTestId('explorer-close-dont-save-btn'));

        expect(dockOpenBit()).toBe('0');
    });

    it('keeps the panel open when a bulk close leaves a cancelled tab behind', async () => {
        const dirty = openFile('src/dirty.ts');
        renderPanel();
        fireEvent.change(await screen.findByTestId('mock-monaco-textarea'), { target: { value: 'edited' } });
        await waitFor(() => expect(screen.getByTestId(`unified-panel-tab-dirty-${dirty}`)).toBeTruthy());
        const clean = openFile('src/clean.ts');
        await screen.findByTestId(`unified-panel-tab-${clean}`);

        fireEvent.contextMenu(tabNode(clean), { clientX: 20, clientY: 30 });
        fireEvent.click(screen.getByTestId('unified-panel-tab-menu-close-all'));
        await screen.findByTestId('explorer-close-tabs-prompt');
        fireEvent.click(screen.getByTestId('explorer-close-cancel-btn'));

        await waitFor(() => expect(screen.queryByTestId(`unified-panel-tab-${clean}`)).toBeNull());
        expect(tabNode(dirty)).toBeTruthy();
        expect(dockOpenBit()).toBe('1');
    });

    it("ignores another chat's tabs when deciding the strip is empty", async () => {
        openFile('src/other.ts', 'chat-2');
        const tabId = openFile('src/a.ts');
        renderPanel();

        fireEvent.click(await screen.findByTestId(`unified-panel-tab-close-${tabId}`));

        expect(dockOpenBit()).toBe('0');
    });

    it('does not auto-close an empty panel reopened on purpose after a collapse', async () => {
        const tabId = openFile('src/a.ts');
        const { rerender } = renderPanel();
        fireEvent.click(await screen.findByTestId(`unified-panel-tab-close-${tabId}`));
        expect(dockOpenBit()).toBe('0');

        act(() => { openWorkspaceDock(WS); });
        rerender(<UnifiedRightPanel workspaceId={WS} chatId={CHAT} dock={dockStub()} />);

        expect(dockOpenBit()).toBe('1');
        expect(screen.getByTestId('unified-panel-empty')).toBeTruthy();
    });
});
