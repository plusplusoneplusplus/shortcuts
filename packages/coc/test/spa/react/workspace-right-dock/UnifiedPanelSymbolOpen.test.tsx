/**
 * Go To All (Ctrl+,) in the unified right panel: picking a symbol row.
 *
 * Two regressions these pin:
 *  1. A repeat pick of the *same* symbol used to be a no-op — the descriptor
 *     was reused, nothing re-rendered, and the editor stayed where the user had
 *     scrolled it. `revealNonce` is what makes the second pick re-centre.
 *  2. A pick in repo-group scope opened the file but left the palette stacked
 *     over it, because only the single-repo branch closed the dialog.
 *
 * The palette itself is stubbed down to "am I open, in which scope, and here is
 * a symbol pick" — its search and ranking have their own suites — and it
 * deliberately does *not* close itself, so closing is the panel's job to prove.
 *
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import type React from 'react';

const mockGetRepoGroup = vi.fn();
const mockActivateWorkspaceRoute = vi.fn();
const mockHasWorkspaceRoute = vi.fn();

vi.mock('../../../../src/server/spa/client/react/features/terminal/TerminalView', () => ({
    TerminalView: () => <div data-testid="mock-terminal" />,
}));
vi.mock('../../../../src/server/spa/client/react/features/notes/dock/DockNotesPanel', () => ({
    DockNotesPanel: () => <div data-testid="mock-notes" />,
}));
vi.mock('../../../../src/server/spa/client/react/features/repo-detail/explorer/ExplorerPanel', () => ({
    ExplorerPanel: ({ workspaceId }: { workspaceId: string }) => (
        <div data-testid="mock-explorer">explorer:{workspaceId}</div>
    ),
    getAncestorPaths: (p: string) => {
        const parts = p.split('/').filter(Boolean);
        return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/'));
    },
}));
vi.mock('../../../../src/server/spa/client/react/features/repo-detail/explorer/QuickOpen', () => ({
    QuickOpen: ({ scope, open, mode, onSymbolSelect }: {
        scope: { kind: string };
        open: boolean;
        mode?: string;
        onSymbolSelect?: (result: Record<string, unknown>) => unknown;
    }) => (open ? (
        <div data-testid="quick-open-dialog" data-mode={mode} data-scope={scope.kind}>
            <button
                type="button"
                data-testid="quick-open-symbol-pick"
                onClick={() => void onSymbolSelect?.({
                    name: 'CanvasHeader',
                    containerName: 'demo',
                    kind: 5,
                    path: 'src/render/canvas.cpp',
                    line: 42,
                    col: 8,
                    ...(scope.kind === 'repo-group'
                        ? { workspaceId: 'member-b', repoName: 'Member B' }
                        : {}),
                })}
            >
                pick symbol
            </button>
        </div>
    ) : null),
}));
vi.mock('../../../../src/server/spa/client/react/features/repo-detail/explorer/ExactOpen', () => ({
    TRUSTED_PATH_PREFIX: '__trusted__:',
    fileName: (p: string) => (p.includes('/') ? p.slice(p.lastIndexOf('/') + 1) : p),
    ExactOpen: () => null,
}));
// The buffer is stubbed to exactly the navigation props the tab hands it: what
// these cases are about is which position the pane is asked to show, and how
// often it is asked again.
vi.mock('../../../../src/server/spa/client/react/features/repo-detail/explorer/PreviewPane', () => ({
    PreviewPane: ({ repoId, filePath, revealLine, revealColumn, revealNonce }: {
        repoId: string;
        filePath: string;
        revealLine?: number;
        revealColumn?: number;
        revealNonce?: number;
    }) => (
        <div
            data-testid="preview-pane"
            data-repo={repoId}
            data-path={filePath}
            data-line={revealLine ?? ''}
            data-column={revealColumn ?? ''}
            data-nonce={revealNonce ?? ''}
        />
    ),
}));
vi.mock('../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerApi', () => ({
    explorerApi: {
        searchFiles: async () => ({ results: [] as { path: string }[] }),
        readBlob: async () => ({ content: '', encoding: 'utf-8', mimeType: 'text/plain' }),
        writeBlob: async () => ({ success: true }),
        readTrustedBlob: async () => ({ content: '', encoding: 'utf-8', mimeType: 'text/plain' }),
        tree: async () => ({ entries: [] }),
    },
}));
vi.mock('../../../../src/server/spa/client/react/repos/cloneRegistry', () => ({
    getCocClientForWorkspace: () => ({ canvases: { list: async () => [], create: async () => ({ id: 'c1', title: 'c' }) } }),
    lookupCloneBaseUrl: () => null,
    activateWorkspaceRouteForBaseUrl: (...args: unknown[]) => mockActivateWorkspaceRoute(...args),
    hasWorkspaceRouteForBaseUrl: (...args: unknown[]) => mockHasWorkspaceRoute(...args),
}));
vi.mock('../../../../src/server/spa/client/react/repos/repoGroupService', () => ({
    getRepoGroup: (...args: unknown[]) => mockGetRepoGroup(...args),
}));

import { UnifiedRightPanel } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/UnifiedRightPanel';
import {
    clearUnifiedPanelState,
    readUnifiedPanelState,
} from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelStore';
import { clearUnifiedTreeState } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelTree';
import { clearExplorerQuickOpenRegistry } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/quickOpenRouting';
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
    const dock = props.dock ?? dockStub();
    return render(<UnifiedRightPanel workspaceId={WS} dock={dock} {...props} />);
}

/** Ctrl+, — Go To All. */
function pressGoto() {
    const event = new KeyboardEvent('keydown', { key: ',', ctrlKey: true, bubbles: true, cancelable: true });
    act(() => { document.dispatchEvent(event); });
    return event;
}

async function pickSymbol() {
    await act(async () => { screen.getByTestId('quick-open-symbol-pick').click(); });
}

/** Every file tab in the strip, with the pinned/preview distinction. */
function fileTabs(): { label: string; preview: boolean }[] {
    return Array.from(document.querySelectorAll('[role="tab"][data-kind="file"]')).map(node => ({
        label: node.querySelector('[data-testid^="unified-panel-tab-label-"]')?.textContent ?? '',
        preview: node.getAttribute('data-preview') === 'true',
    }));
}

/** The persisted descriptor for the one open file tab. */
function storedFileTab(scope = WS) {
    const state = readUnifiedPanelState(scope);
    const tabs = [...state.workspaceTabs, ...Object.values(state.chatTabs).flat()];
    return tabs.find(tab => tab.kind === 'file');
}

describe('unified panel Go To All', () => {
    beforeEach(() => {
        localStorage.clear();
        clearUnifiedPanelState();
        clearUnifiedTreeState();
        clearExplorerQuickOpenRegistry();
        mockGetRepoGroup.mockReset().mockResolvedValue({
            members: [{ workspaceId: 'member-b', stale: false, name: 'Member B' }],
        });
        mockActivateWorkspaceRoute.mockReset().mockReturnValue(true);
        mockHasWorkspaceRoute.mockReset().mockReturnValue(true);
    });
    afterEach(() => {
        cleanup();
        clearUnifiedPanelState();
        clearUnifiedTreeState();
        clearExplorerQuickOpenRegistry();
    });

    it('opens a picked symbol as a pinned tab on its line and column, and closes the palette', async () => {
        renderPanel();
        pressGoto();
        expect(screen.getByTestId('quick-open-dialog').dataset.mode).toBe('symbols');

        await pickSymbol();

        expect(fileTabs()).toEqual([{ label: 'canvas.cpp', preview: false }]);
        expect(storedFileTab()).toMatchObject({
            ownerWorkspaceId: WS,
            resourceId: 'src/render/canvas.cpp',
            line: 42,
            column: 8,
        });
        const pane = screen.getByTestId('preview-pane');
        expect(pane.dataset.path).toBe('src/render/canvas.cpp');
        expect(pane.dataset.line).toBe('42');
        expect(pane.dataset.column).toBe('8');
        expect(screen.queryByTestId('quick-open-dialog')).toBeNull();
    });

    it('opens a group member symbol on its own clone, and closes the palette there too', async () => {
        const setTarget = vi.fn().mockReturnValue(true);
        renderPanel({
            workspaceId: 'group-1',
            dock: dockStub({ target: 'member-a', setTarget }),
            repoGroup: { id: 'group-1', name: 'Group', liveRepoCount: 2 },
        });
        pressGoto();
        expect(screen.getByTestId('quick-open-dialog').dataset.scope).toBe('repo-group');

        await pickSymbol();

        expect(setTarget).toHaveBeenCalledWith('member-b');
        expect(fileTabs()).toEqual([{ label: 'canvas.cpp', preview: false }]);
        expect(storedFileTab('group-1')).toMatchObject({
            ownerWorkspaceId: 'member-b',
            repoLabel: 'Member B',
            resourceId: 'src/render/canvas.cpp',
            line: 42,
            column: 8,
        });
        // The regression: the file opened, but the dialog stayed on top of it.
        await waitFor(() => expect(screen.queryByTestId('quick-open-dialog')).toBeNull());
    });

    it('asks for a fresh reveal when the same symbol is picked again', async () => {
        renderPanel();
        pressGoto();
        await pickSymbol();
        const first = screen.getByTestId('preview-pane').dataset.nonce;
        expect(first).not.toBe('');

        // The user scrolled away, then picked the very same row again.
        pressGoto();
        await pickSymbol();

        const pane = screen.getByTestId('preview-pane');
        expect(pane.dataset.line).toBe('42');
        expect(pane.dataset.column).toBe('8');
        expect(Number(pane.dataset.nonce)).toBeGreaterThan(Number(first));
        expect(fileTabs()).toHaveLength(1);
    });

    it('keeps the reveal position, and does not re-reveal, when the tab is merely re-focused', async () => {
        renderPanel();
        pressGoto();
        await pickSymbol();
        const nonce = screen.getByTestId('preview-pane').dataset.nonce;

        // Clicking the tab in the strip carries no position of its own.
        await act(async () => {
            screen.getByRole('tab', { name: /canvas\.cpp/ }).click();
        });

        const pane = screen.getByTestId('preview-pane');
        expect(pane.dataset.line).toBe('42');
        expect(pane.dataset.nonce).toBe(nonce);
    });
});
