/**
 * The expand toggle at the far right of the unified panel's tab strip.
 *
 * Expanded, the panel fills the workspace row (the hosts hide their main
 * content — see RepoGroupView.dock.test.tsx), drops its fixed width and its
 * resize handle, and restores both on the way back. The flag is per workspace,
 * session-only, and cleared when the panel closes.
 *
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';

vi.mock('../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerApi', () => ({
    explorerApi: {
        readBlob: vi.fn(async () => ({ content: 'x', encoding: 'utf-8' })),
        writeBlob: vi.fn(),
        readTrustedBlob: vi.fn(),
        searchFiles: vi.fn(async () => ({ results: [] })),
    },
}));
vi.mock('../../../../src/server/spa/client/react/shared/file-viewer/MonacoFileEditor', () => ({
    MonacoFileEditor: () => <div data-testid="mock-monaco" />,
    getMonacoLanguage: () => 'plaintext',
}));
vi.mock('../../../../src/server/spa/client/react/features/terminal/TerminalView', () => ({
    TerminalView: () => <div data-testid="mock-terminal" />,
}));
vi.mock('../../../../src/server/spa/client/react/features/repo-detail/explorer/ExplorerPanel', () => ({
    ExplorerPanel: () => <div data-testid="mock-explorer" />,
}));
vi.mock('../../../../src/server/spa/client/react/features/notes/NotesView', () => ({
    NotesView: () => <div data-testid="mock-notes" />,
}));
vi.mock('../../../../src/server/spa/client/react/repos/cloneRegistry', () => ({
    getCocClientForWorkspace: () => ({ canvases: { list: async () => [] } }),
    lookupCloneBaseUrl: () => null,
}));
vi.mock('../../../../src/server/spa/client/react/features/language-servers/languageServerClient',
    async () => await import('../language-servers/inertTransportMock'));

import { UnifiedRightPanel } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/UnifiedRightPanel';
import { clearUnifiedPanelState } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelStore';
import { openUnifiedPanelTab } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelOpen';
import { clearUnifiedTreeState } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelTree';
import type { WorkspaceDockController } from '../../../../src/server/spa/client/react/features/repo-detail/useWorkspaceDock';
import {
    setWorkspaceDockExpanded,
    useWorkspaceDockExpanded,
} from '../../../../src/server/spa/client/react/features/repo-detail/WorkspaceDockToggle';

const WS = 'ws-expand';
const OTHER_WS = 'ws-expand-other';

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

function renderPanel(dock = dockStub()) {
    const view = render(<UnifiedRightPanel workspaceId={WS} dock={dock} />);
    // A workspace tab keeps the mount-time reconciliation from treating the
    // panel as empty; the stub's `isOpen` is what the panel renders against.
    act(() => {
        openUnifiedPanelTab(WS, { kind: 'terminal', ownerWorkspaceId: WS, chatId: null, resourceId: 'terminal', label: 'Terminal' });
    });
    return view;
}

const toggle = () => screen.getByTestId('unified-panel-expand-toggle');
const panel = () => screen.getByTestId('unified-right-panel');
const body = () => screen.getByTestId('unified-panel-body');

beforeEach(() => {
    localStorage.clear();
    clearUnifiedPanelState(WS);
    clearUnifiedTreeState(WS);
});

afterEach(() => {
    cleanup();
    setWorkspaceDockExpanded(WS, false);
    setWorkspaceDockExpanded(OTHER_WS, false);
});

describe('Unified panel expand toggle', () => {
    it('renders at the far right of the tab strip, collapsed by default', () => {
        renderPanel();
        const strip = screen.getByTestId('unified-panel-tab-strip');
        const buttons = strip.querySelectorAll('button');
        expect(buttons[buttons.length - 1]).toBe(toggle());
        expect(toggle().getAttribute('aria-label')).toBe('Expand panel');
        expect(toggle().getAttribute('aria-pressed')).toBe('false');
        expect(panel().dataset.expanded).toBe('false');
    });

    it('fills the row without its fixed width or resize handle, then restores both', () => {
        renderPanel();
        expect(body().style.width).toBe('420px');
        expect(screen.getByTestId('unified-panel-resize-handle')).toBeTruthy();

        act(() => { fireEvent.click(toggle()); });

        expect(panel().dataset.expanded).toBe('true');
        expect(panel().className).toContain('flex-1');
        expect(panel().className).not.toContain('flex-shrink-0');
        expect(body().style.width).toBe('');
        expect(screen.queryByTestId('unified-panel-resize-handle')).toBeNull();
        expect(toggle().getAttribute('aria-label')).toBe('Restore panel size');
        expect(toggle().getAttribute('aria-pressed')).toBe('true');

        act(() => { fireEvent.click(toggle()); });

        expect(panel().dataset.expanded).toBe('false');
        expect(panel().className).toContain('flex-shrink-0');
        expect(body().style.width).toBe('420px');
        expect(screen.getByTestId('unified-panel-resize-handle')).toBeTruthy();
    });

    it('stays on the strip when a file tab brings its own toolbar row', () => {
        renderPanel();
        act(() => {
            openUnifiedPanelTab(WS, { kind: 'file', ownerWorkspaceId: WS, chatId: null, resourceId: 'src/a.ts', label: 'a.ts' });
        });
        expect(screen.getByTestId('unified-panel-tab-strip').contains(toggle())).toBe(true);
    });

    it('drops the flag when the panel closes, so reopening starts at its own width', () => {
        const view = renderPanel();
        act(() => { fireEvent.click(toggle()); });
        expect(panel().dataset.expanded).toBe('true');

        view.rerender(<UnifiedRightPanel workspaceId={WS} dock={dockStub({ isOpen: false })} />);
        expect(panel().dataset.expanded).toBe('false');

        view.rerender(<UnifiedRightPanel workspaceId={WS} dock={dockStub()} />);
        expect(panel().dataset.expanded).toBe('false');
        expect(body().style.width).toBe('420px');
    });

    it('never writes the flag to localStorage', () => {
        renderPanel();
        const before = { ...localStorage };
        act(() => { fireEvent.click(toggle()); });
        expect({ ...localStorage }).toEqual(before);
    });
});

describe('useWorkspaceDockExpanded', () => {
    it('is scoped per workspace and shared across subscribers', () => {
        const a = renderHook(() => useWorkspaceDockExpanded(WS));
        const b = renderHook(() => useWorkspaceDockExpanded(WS));
        const other = renderHook(() => useWorkspaceDockExpanded(OTHER_WS));

        act(() => setWorkspaceDockExpanded(WS, true));

        expect(a.result.current).toBe(true);
        expect(b.result.current).toBe(true);
        expect(other.result.current).toBe(false);

        act(() => setWorkspaceDockExpanded(WS, false));
        expect(a.result.current).toBe(false);
    });
});
