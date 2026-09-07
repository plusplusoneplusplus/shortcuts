/**
 * The unified panel's file-tree column (AC-01c) — the tree rendered as a
 * panel-level column on the right edge rather than as a tab.
 *
 * What these cases pin is the shell's side of the contract: the column is there
 * for every kind of active tab and for no tabs at all, it survives a tab switch
 * without remounting, it never squeezes the active view below its minimum, and a
 * panel dragged too narrow hides it without discarding the user's open bit. The
 * state module's own rules (clamping maths, the codec) are covered in
 * `unifiedPanelTree.test.tsx`.
 *
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('../../../../src/server/spa/client/react/features/terminal/TerminalView', () => ({
    TerminalView: ({ workspaceId }: { workspaceId: string }) => (
        <div data-testid="mock-terminal">terminal:{workspaceId}</div>
    ),
}));
// The tree is the real `ExplorerPanel` in sidebar mode; here it is stubbed so
// the case exercises the column, not Monaco and the tree API. `onOpenFile` is
// surfaced as a button so a file click is a real user event.
vi.mock('../../../../src/server/spa/client/react/features/repo-detail/explorer/ExplorerPanel', () => ({
    ExplorerPanel: ({ workspaceId, deepLink, mode, onOpenFile }: {
        workspaceId: string;
        deepLink?: boolean;
        mode?: string;
        onOpenFile?: (
            file: { path: string; name: string; line?: number },
            options: { preview: boolean; readOnly?: boolean },
        ) => void;
    }) => (
        <div data-testid="mock-explorer" data-mode={mode}>
            explorer:{workspaceId}:{String(deepLink)}
            <button
                type="button"
                data-testid="mock-explorer-open"
                onClick={() => onOpenFile?.({ path: 'src/app.ts', name: 'app.ts' }, { preview: true })}
            >
                open
            </button>
        </div>
    ),
}));
vi.mock('../../../../src/server/spa/client/react/features/notes/dock/DockNotesPanel', () => ({
    DockNotesPanel: ({ workspaceId }: { workspaceId: string }) => (
        <div data-testid="mock-notes">notes:{workspaceId}</div>
    ),
}));
vi.mock('../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerApi', () => ({
    explorerApi: {
        searchFiles: async () => ({ results: [] as { path: string }[] }),
        readBlob: async () => ({ content: '', encoding: 'utf-8', mimeType: 'text/plain' }),
        writeBlob: async () => ({ success: true }),
        readTrustedBlob: async () => ({ content: '', encoding: 'utf-8', mimeType: 'text/plain' }),
    },
}));
vi.mock('../../../../src/server/spa/client/react/shared/file-viewer/MonacoFileEditor', () => ({
    MonacoFileEditor: () => <div data-testid="mock-monaco" />,
    getMonacoLanguage: () => 'plaintext',
}));
vi.mock('../../../../src/server/spa/client/react/repos/cloneRegistry', () => ({
    getCocClientForWorkspace: () => ({ canvases: { list: async () => [], create: async () => ({ id: 'c1', title: 'c' }) } }),
    lookupCloneBaseUrl: () => null,
}));

import { UnifiedRightPanel } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/UnifiedRightPanel';
import { clearUnifiedPanelState } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelStore';
import {
    UNIFIED_PANEL_VIEW_MIN_WIDTH,
    UNIFIED_TREE_MIN_PANEL_WIDTH,
    clearUnifiedTreeState,
    readUnifiedTreeState,
    writeUnifiedTreeState,
} from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelTree';
import type { WorkspaceDockController } from '../../../../src/server/spa/client/react/features/repo-detail/WorkspaceRightDock';

const WS = 'ws-1';

function dockStub(overrides: Partial<WorkspaceDockController> = {}): WorkspaceDockController {
    return {
        isOpen: true,
        toggleOpen: vi.fn(),
        view: 'terminal',
        setView: vi.fn(),
        views: ['terminal', 'explorer', 'notes'],
        target: WS,
        setTarget: vi.fn(),
        targets: [],
        width: 900,
        maxWidth: 1200,
        isDragging: false,
        handleMouseDown: vi.fn(),
        handleTouchStart: vi.fn(),
        ...overrides,
    };
}

function renderPanel(props: Partial<React.ComponentProps<typeof UnifiedRightPanel>> = {}) {
    const dock = props.dock ?? dockStub();
    return render(<UnifiedRightPanel workspaceId={WS} dock={dock} {...props} />);
}

/** Open a workspace resource through the "+" menu, as a user would. */
function openViaMenu(testId: string) {
    fireEvent.click(screen.getByTestId('unified-panel-open-menu'));
    fireEvent.click(screen.getByTestId(testId));
}

/** The column's rendered width in px, or null when it is not mounted. */
function treeWidth(): number | null {
    const column = screen.queryByTestId('unified-panel-tree');
    const inner = column?.querySelector('[data-tree-width]');
    return inner === null || inner === undefined ? null : Number(inner.getAttribute('data-tree-width'));
}

describe('unified panel file-tree column', () => {
    beforeEach(() => {
        localStorage.clear();
        clearUnifiedPanelState();
        clearUnifiedTreeState();
    });
    afterEach(() => {
        cleanup();
        clearUnifiedPanelState();
        clearUnifiedTreeState();
    });

    it('is absent until the panel scope has the tree open', () => {
        renderPanel();
        expect(screen.queryByTestId('unified-panel-tree')).toBeNull();
        expect(screen.queryByTestId('mock-explorer')).toBeNull();
    });

    it('renders beside the empty state, so closing the last tab leaves the panel open', () => {
        writeUnifiedTreeState(WS, { open: true, width: 220 });
        renderPanel();

        // Tree + "Nothing open" together: the column is panel-level chrome, so
        // an empty tab set is not an empty panel.
        expect(screen.getByTestId('unified-panel-tree')).toBeTruthy();
        expect(screen.getByTestId('unified-panel-empty')).toBeTruthy();
        expect(screen.getByTestId('mock-explorer').getAttribute('data-mode')).toBe('sidebar');
        expect(treeWidth()).toBe(220);
    });

    it('renders for every tab kind and survives a tab switch without remounting', () => {
        writeUnifiedTreeState(WS, { open: true, width: 220 });
        renderPanel();
        openViaMenu('unified-panel-open-terminal');

        const tree = screen.getByTestId('mock-explorer');
        expect(screen.getByTestId('mock-terminal')).toBeTruthy();

        openViaMenu('unified-panel-open-notes');
        // Same DOM node — the column is outside the per-tab view area.
        expect(screen.getByTestId('mock-explorer')).toBe(tree);
        expect(screen.getByTestId('mock-notes')).toBeTruthy();
    });

    it('stays open across a collapse and reopen of the dock', () => {
        writeUnifiedTreeState(WS, { open: true, width: 260 });
        const { rerender } = renderPanel();
        const tree = screen.getByTestId('mock-explorer');

        rerender(<UnifiedRightPanel workspaceId={WS} dock={dockStub({ isOpen: false })} />);
        expect(screen.getByTestId('mock-explorer')).toBe(tree);

        rerender(<UnifiedRightPanel workspaceId={WS} dock={dockStub()} />);
        expect(screen.getByTestId('unified-panel-tree')).toBeTruthy();
        expect(treeWidth()).toBe(260);
    });

    it('points the tree at the dock target and deep-links only for its own workspace', () => {
        writeUnifiedTreeState(WS, { open: true, width: 220 });
        const member = 'ws-member';
        renderPanel({
            dock: dockStub({
                target: member,
                targets: [{ workspaceId: WS, label: 'group' }, { workspaceId: member, label: 'api' }],
            }),
        });
        expect(screen.getByTestId('mock-explorer').textContent).toContain(`explorer:${member}:false`);

        cleanup();
        renderPanel();
        expect(screen.getByTestId('mock-explorer').textContent).toContain(`explorer:${WS}:true`);
    });

    it('opens a file picked in the tree as a tab owned by the target repo', () => {
        writeUnifiedTreeState(WS, { open: true, width: 220 });
        const member = 'ws-member';
        renderPanel({
            dock: dockStub({
                target: member,
                targets: [{ workspaceId: WS, label: 'group' }, { workspaceId: member, label: 'api' }],
            }),
        });

        fireEvent.click(screen.getByTestId('mock-explorer-open'));
        const [tab] = screen.getAllByRole('tab');
        expect(screen.getAllByRole('tab')).toHaveLength(1);
        // Scoped to the tab: the panel's toolbar row now names the same file, so
        // a document-wide text query would match twice.
        expect(tab.querySelector('[data-testid^="unified-panel-tab-label-"]')?.textContent).toBe('app.ts');
        // The owning clone is not the panel's own workspace, so the tab is
        // attributed to it rather than reading as a local file.
        expect(tab.querySelector('[data-testid^="unified-panel-tab-repo-"]')?.textContent).toBe('api');
    });

    it('clamps its width so the active view keeps its minimum', () => {
        // A stored width wider than this panel can afford beside a usable view.
        writeUnifiedTreeState(WS, { open: true, width: 400 });
        renderPanel({ dock: dockStub({ width: 500 }) });
        expect(treeWidth()).toBe(500 - UNIFIED_PANEL_VIEW_MIN_WIDTH);
        // The user's request is untouched — a wider panel gets it back.
        expect(readUnifiedTreeState(WS).width).toBe(400);
    });

    it('hides on a panel too narrow for both columns, and returns when it widens', () => {
        writeUnifiedTreeState(WS, { open: true, width: 220 });
        const narrow = dockStub({ width: UNIFIED_TREE_MIN_PANEL_WIDTH - 1 });
        const { rerender } = renderPanel({ dock: narrow });

        // Hidden, not unmounted: the tree keeps its expansion, and the open bit
        // the user set is not flipped by a drag on the panel edge.
        expect(screen.getByTestId('unified-panel-tree').style.display).toBe('none');
        expect(readUnifiedTreeState(WS).open).toBe(true);

        rerender(<UnifiedRightPanel workspaceId={WS} dock={dockStub({ width: UNIFIED_TREE_MIN_PANEL_WIDTH })} />);
        expect(screen.getByTestId('unified-panel-tree').style.display).toBe('');
    });

    it('persists a width dragged on its own handle', () => {
        writeUnifiedTreeState(WS, { open: true, width: 220 });
        renderPanel();

        const handle = screen.getByTestId('unified-panel-tree-resize-handle');
        expect(handle.getAttribute('aria-valuenow')).toBe('220');
        // Right-anchored: dragging left widens the column.
        fireEvent.mouseDown(handle, { clientX: 600 });
        act(() => { fireEvent.mouseMove(document, { clientX: 550 }); });
        act(() => { fireEvent.mouseUp(document); });

        expect(treeWidth()).toBe(270);
        expect(readUnifiedTreeState(WS).width).toBe(270);
    });

    it('reacts to a tree state written from outside the panel', () => {
        renderPanel();
        expect(screen.queryByTestId('unified-panel-tree')).toBeNull();

        act(() => { writeUnifiedTreeState(WS, { open: true, width: 220 }); });
        expect(screen.getByTestId('unified-panel-tree')).toBeTruthy();

        act(() => { writeUnifiedTreeState(WS, { open: false, width: 220 }); });
        expect(screen.queryByTestId('unified-panel-tree')).toBeNull();
    });
});
