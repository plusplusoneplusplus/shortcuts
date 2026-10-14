/**
 * The merged header control drives the existing panel expansion.
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
    NotesView: () => <textarea aria-label="Note draft" defaultValue="Draft" />,
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
import { useWorkspaceDock } from '../../../../src/server/spa/client/react/features/repo-detail/useWorkspaceDock';
import {
    WorkspaceDockToggle,
    setWorkspaceDockOpen,
    openWorkspaceDock,
    workspaceDockWidthStorageKey,
    setWorkspaceDockExpanded,
    useWorkspaceDockExpanded,
} from '../../../../src/server/spa/client/react/features/repo-detail/WorkspaceDockToggle';

const WS = 'ws-expand';
const OTHER_WS = 'ws-expand-other';

function Host() {
    const dock = useWorkspaceDock(WS);
    return <><WorkspaceDockToggle workspaceId={WS} /><UnifiedRightPanel workspaceId={WS} dock={dock} /></>;
}

function renderPanel() {
    const view = render(<Host />);
    act(() => {
        openUnifiedPanelTab(WS, { kind: 'notes', ownerWorkspaceId: WS, chatId: null, resourceId: 'notes', label: 'Notes' });
    });
    return view;
}

const toggle = () => screen.getByTestId('workspace-dock-toggle');
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

describe('Unified panel header cycle', () => {
    it('has one reachable header control and no inner expand button', () => {
        renderPanel();
        expect(screen.queryByTestId('unified-panel-expand-toggle')).toBeNull();
        expect(screen.getAllByTestId('workspace-dock-toggle')).toHaveLength(1);
        expect(screen.getByTestId('unified-panel-tab-strip').contains(toggle())).toBe(false);
        expect(toggle().getAttribute('aria-label')).toBe('Expand right panel');
        fireEvent.click(toggle());
        expect(toggle().getAttribute('aria-label')).toBe('Hide right panel');
        expect(toggle().closest('[data-testid="unified-right-panel"]')).toBeNull();
    });

    it('fills the row, hides, and reopens docked with the same tab and draft', () => {
        renderPanel();
        const draft = screen.getByRole('textbox', { name: 'Note draft' });
        fireEvent.change(draft, { target: { value: 'Unsaved work' } });
        const width = body().style.width;
        const storedWidth = localStorage.getItem(workspaceDockWidthStorageKey(WS));
        const selectedTab = screen.getByRole('tab', { selected: true });
        fireEvent.click(toggle());
        expect(panel().dataset.expanded).toBe('true');
        expect(body().style.width).toBe('');
        expect(screen.queryByTestId('unified-panel-resize-handle')).toBeNull();
        fireEvent.click(toggle());
        expect(panel().dataset.open).toBe('false');
        expect(panel().dataset.expanded).toBe('false');
        fireEvent.click(toggle());
        expect(panel().dataset.open).toBe('true');
        expect(panel().dataset.expanded).toBe('false');
        expect(body().style.width).toBe(width);
        expect(localStorage.getItem(workspaceDockWidthStorageKey(WS))).toBe(storedWidth);
        expect(screen.getByRole('tab', { selected: true })).toBe(selectedTab);
        expect(screen.getByRole('textbox', { name: 'Note draft' })).toBe(draft);
        expect((draft as HTMLTextAreaElement).value).toBe('Unsaved work');
        expect(screen.getByTestId('unified-panel-resize-handle')).toBeTruthy();
    });

    it('Escape restores docked width while leaving editor Escape alone', () => {
        renderPanel();
        fireEvent.click(toggle());
        fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
        expect(panel().dataset.expanded).toBe('true');
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(panel().dataset.expanded).toBe('false');
        expect(panel().dataset.open).toBe('true');
    });

    it('programmatic opens preserve expansion until a close resets it', () => {
        renderPanel();
        fireEvent.click(toggle());
        act(() => openWorkspaceDock(WS));
        expect(panel().dataset.expanded).toBe('true');
        act(() => setWorkspaceDockOpen(WS, false));
        act(() => openWorkspaceDock(WS));
        expect(panel().dataset.expanded).toBe('false');
        expect(body().style.width).not.toBe('');
    });

    it('persists visibility without persisting expansion', () => {
        renderPanel();
        const before = { ...localStorage };
        fireEvent.click(toggle());
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
