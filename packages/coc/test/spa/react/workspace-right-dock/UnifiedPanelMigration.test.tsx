/**
 * AC-05: persistence and migration for the unified panel's tab codec (v2).
 *
 * Two things move here. The preview bit now survives a reload, so a restored
 * preview comes back italic, in the same slot, still replaceable. And the
 * `explorer` kind is gone: a payload written by the previous version restores
 * its other tabs untouched, drops its Explorer descriptor, and opens the tree
 * column instead — the Explorer's replacement — so a user who had it open still
 * lands with a file tree visible. Nothing is lost, because an Explorer tab
 * carried no state of its own.
 *
 * The codec's own rules are unit-tested in `unifiedPanelTabsModel.test.ts`;
 * these cases pin the shell wiring — the mount-time migration, the rewritten
 * storage entry, and the `+` menu's Explorer action selecting the panel mode
 * rather than opening a tab.
 *
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const terminalSpy = vi.fn();

vi.mock('../../../../src/server/spa/client/react/features/terminal/TerminalView', () => ({
    TerminalView: ({ workspaceId }: { workspaceId: string }) => {
        terminalSpy(workspaceId);
        return <div data-testid="mock-terminal">terminal:{workspaceId}</div>;
    },
}));
vi.mock('../../../../src/server/spa/client/react/features/repo-detail/explorer/ExplorerPanel', () => ({
    ExplorerPanel: ({ workspaceId, mode }: { workspaceId: string; mode?: string }) => (
        <div data-testid="mock-explorer" data-mode={mode}>explorer:{workspaceId}</div>
    ),
}));
vi.mock('../../../../src/server/spa/client/react/features/notes/dock/DockNotesPanel', () => ({
    DockNotesPanel: ({ workspaceId }: { workspaceId: string }) => (
        <div data-testid="mock-notes">notes:{workspaceId}</div>
    ),
}));
vi.mock('../../../../src/server/spa/client/react/features/repo-detail/explorer/PreviewPane', () => ({
    PreviewPane: ({ filePath }: { filePath: string }) => <div data-testid={`mock-preview-${filePath}`} />,
}));
vi.mock('../../../../src/server/spa/client/react/repos/cloneRegistry', () => ({
    getCocClientForWorkspace: () => ({ canvases: { list: async () => [], create: async () => ({ id: 'c1', title: 'c' }) } }),
    lookupCloneBaseUrl: () => null,
}));

import { UnifiedRightPanel } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/UnifiedRightPanel';
import { clearUnifiedPanelState } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelStore';
import {
    UNIFIED_PANEL_STATE_VERSION,
    WORKSPACE_SCOPE_KEY,
    unifiedPanelStorageKey,
    unifiedTabId,
} from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelTabsModel';
import {
    clearUnifiedTreeState,
    readUnifiedTreeState,
    writeUnifiedTreeState,
} from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelTree';
import type { WorkspaceDockController } from '../../../../src/server/spa/client/react/features/repo-detail/useWorkspaceDock';

const WS = 'ws-1';

function dockStub(overrides: Partial<WorkspaceDockController> = {}): WorkspaceDockController {
    return {
        isOpen: true,
        toggleOpen: vi.fn(),
        mode: 'explorer',
        selectMode: vi.fn(),
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
    return render(<UnifiedRightPanel workspaceId={WS} dock={props.dock ?? dockStub()} {...props} />);
}

const terminalId = unifiedTabId({ kind: 'terminal', ownerWorkspaceId: WS, chatId: null, resourceId: 'sess-1' });
const legacyExplorerId = ['explorer', WORKSPACE_SCOPE_KEY, WS, 'explorer'].join('|');

/** A v1 payload: a terminal, then an Explorer tab, then a file. */
function seedLegacyState(): void {
    const fileId = unifiedTabId({ kind: 'file', ownerWorkspaceId: WS, chatId: null, resourceId: 'src/a.ts' });
    localStorage.setItem(unifiedPanelStorageKey(WS), JSON.stringify({
        version: 1,
        workspaceTabs: [
            { id: terminalId, kind: 'terminal', ownerWorkspaceId: WS, chatId: null, resourceId: 'sess-1', label: 'bash' },
            { id: legacyExplorerId, kind: 'explorer', ownerWorkspaceId: WS, chatId: null, resourceId: 'explorer', label: 'Explorer' },
        ],
        chatTabs: {
            [WORKSPACE_SCOPE_KEY]: [
                { id: fileId, kind: 'file', ownerWorkspaceId: WS, chatId: null, resourceId: 'src/a.ts', label: 'a.ts' },
            ],
        },
        activeByScope: { [WORKSPACE_SCOPE_KEY]: fileId },
    }));
}

/** The strip's tabs by resource, in order. */
function tabLabels(): string[] {
    return screen.getAllByTestId('unified-panel-tab-list')[0]
        .querySelectorAll('[role="tab"]')
        .values()
        .toArray()
        // The close affordance's glyph rides along in `textContent`.
        .map(node => (node.getAttribute('data-tab-id') ?? '').split('|').pop() ?? '');
}

function storedPayload(): Record<string, unknown> {
    return JSON.parse(localStorage.getItem(unifiedPanelStorageKey(WS)) ?? '{}');
}

describe('unified panel — codec v2 migration', () => {
    beforeEach(() => {
        localStorage.clear();
        clearUnifiedPanelState();
        clearUnifiedTreeState();
        terminalSpy.mockReset();
    });
    afterEach(() => {
        cleanup();
        clearUnifiedPanelState();
        clearUnifiedTreeState();
    });

    it('keeps the other tabs in order, drops the explorer tab, and opens the tree', async () => {
        seedLegacyState();
        renderPanel();

        expect(tabLabels()).toEqual(['sess-1', 'src/a.ts']);
        expect(screen.queryByTestId(`unified-panel-tab-${legacyExplorerId}`)).toBeNull();
        // The Explorer's replacement is the column, which is now open.
        await waitFor(() => expect(readUnifiedTreeState(WS).open).toBe(true));
        expect(screen.getByTestId('mock-explorer').getAttribute('data-mode')).toBe('sidebar');
    });

    it('rewrites the entry at the current version, so the old shape is migrated once', async () => {
        seedLegacyState();
        renderPanel();

        await waitFor(() => expect(storedPayload().version).toBe(UNIFIED_PANEL_STATE_VERSION));
        const kinds = (storedPayload().workspaceTabs as { kind: string }[]).map(tab => tab.kind);
        expect(kinds).toEqual(['terminal']);
    });

    it('leaves a tree the user already closed alone when nothing needs migrating', async () => {
        writeUnifiedTreeState(WS, { open: false, width: 260 });
        localStorage.setItem(unifiedPanelStorageKey(WS), JSON.stringify({
            version: UNIFIED_PANEL_STATE_VERSION,
            workspaceTabs: [{ id: terminalId, kind: 'terminal', ownerWorkspaceId: WS, chatId: null, resourceId: 'sess-1', label: 'bash' }],
            chatTabs: {},
            activeByScope: {},
        }));
        renderPanel();

        await waitFor(() => expect(screen.getByTestId('unified-panel-tab-list')).toBeInTheDocument());
        expect(readUnifiedTreeState(WS)).toEqual({ open: false, width: 260 });
    });

    it('restores a terminal descriptor without spawning a session before it is activated', async () => {
        seedLegacyState();
        renderPanel();

        // The file tab is the restored selection; the terminal stays a
        // descriptor until the user selects it.
        await waitFor(() => expect(screen.getByTestId('mock-preview-src/a.ts')).toBeInTheDocument());
        expect(terminalSpy).not.toHaveBeenCalled();

        fireEvent.click(screen.getByTestId(`unified-panel-tab-${terminalId}`));
        await waitFor(() => expect(terminalSpy).toHaveBeenCalledWith(WS));
    });

    it('selects Explorer mode from the "+" menu instead of opening a tab', async () => {
        const dock = dockStub();
        renderPanel({ dock });

        fireEvent.click(screen.getByTestId('unified-panel-open-menu'));
        fireEvent.click(screen.getByTestId('unified-panel-open-explorer'));

        await waitFor(() => expect(screen.getByTestId('mock-explorer')).toBeInTheDocument());
        expect(dock.selectMode).toHaveBeenCalledWith('explorer');
        expect(screen.getByTestId('unified-panel-tab-list').querySelectorAll('[role="tab"]')).toHaveLength(0);
    });
});
