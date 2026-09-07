/**
 * The unified panel's tree column following the active file tab (AC-06) — the
 * shell's half of the contract: which path it hands the column, and when it
 * hands it nothing at all.
 *
 * The column is told one of three things, and the difference matters:
 *
 *  - a path — the active file lives in the tree on screen, so reveal it;
 *  - `null` — the active file exists but has no row here (another clone, or a
 *    `__trusted__:` absolute path), so drop the highlight and stand still;
 *  - nothing — the active tab is not a file at all, so leave the tree exactly
 *    as the user left it, highlight and scroll included.
 *
 * The reveal itself (expanding ancestors, centring the row) belongs to
 * `ExplorerPanel` and is covered in `repos/explorer/ExplorerPanel.activefile.test.tsx`.
 *
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('../../../../src/server/spa/client/react/features/terminal/TerminalView', () => ({
    TerminalView: ({ workspaceId }: { workspaceId: string }) => (
        <div data-testid="mock-terminal">terminal:{workspaceId}</div>
    ),
}));
// The tree column stands in for the real sidebar `ExplorerPanel`. It reports the
// tri-state prop back as an attribute — absent when the shell is not tracking,
// the literal "null" when it is tracking "nothing to show".
const TREE_FILES = [
    { key: 'app', path: 'src/app.ts', name: 'app.ts' },
    { key: 'lib', path: 'src/lib/util.ts', name: 'util.ts' },
    { key: 'trusted', path: '__trusted__:/etc/hosts', name: 'hosts' },
];
vi.mock('../../../../src/server/spa/client/react/features/repo-detail/explorer/ExplorerPanel', async () => {
    const actual = await vi.importActual<typeof import('../../../../src/server/spa/client/react/features/repo-detail/explorer/ExplorerPanel')>(
        '../../../../src/server/spa/client/react/features/repo-detail/explorer/ExplorerPanel',
    );
    return {
        getAncestorPaths: actual.getAncestorPaths,
        ExplorerPanel: ({ workspaceId, activeFilePath, onOpenFile }: {
            workspaceId: string;
            activeFilePath?: string | null;
            onOpenFile?: (
                file: { path: string; name: string; line?: number },
                options: { preview: boolean; readOnly?: boolean },
            ) => void;
        }) => (
            <div
                data-testid="mock-explorer"
                data-tracking={activeFilePath === undefined ? 'off' : 'on'}
                {...(activeFilePath === undefined ? {} : { 'data-active-file': String(activeFilePath) })}
            >
                explorer:{workspaceId}
                {TREE_FILES.map(file => (
                    <button
                        key={file.key}
                        type="button"
                        data-testid={`mock-explorer-open-${file.key}`}
                        onClick={() => onOpenFile?.({ path: file.path, name: file.name }, { preview: true })}
                    >
                        {file.name}
                    </button>
                ))}
            </div>
        ),
    };
});
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
    clearUnifiedTreeState,
    writeUnifiedTreeState,
} from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelTree';
import type { WorkspaceDockController } from '../../../../src/server/spa/client/react/features/repo-detail/WorkspaceRightDock';

const WS = 'ws-1';
const MEMBER = 'ws-member';

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

/** What the column was told to track: a path, `'null'`, or null for "not tracking". */
function tracked(): string | null {
    const column = screen.getByTestId('mock-explorer');
    if (column.getAttribute('data-tracking') === 'off') return null;
    return column.getAttribute('data-active-file');
}

function openViaMenu(testId: string) {
    fireEvent.click(screen.getByTestId('unified-panel-open-menu'));
    fireEvent.click(screen.getByTestId(testId));
}

describe('unified panel tree tracking (AC-06)', () => {
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

    /** Render with the column open; a tree click is the file tab entry point here. */
    function renderWithTree(props: Partial<React.ComponentProps<typeof UnifiedRightPanel>> = {}) {
        writeUnifiedTreeState(WS, { open: true, width: 220 });
        return renderPanel(props);
    }

    it('tracks nothing until a file tab is active', () => {
        renderWithTree();
        expect(tracked()).toBeNull();
    });

    it('tracks the active file tab and follows a switch between two of them', () => {
        renderWithTree();

        fireEvent.click(screen.getByTestId('mock-explorer-open-app'));
        expect(tracked()).toBe('src/app.ts');

        // A second single click reuses the preview slot; the tracked path moves
        // with the active tab, not with the tab count.
        fireEvent.click(screen.getByTestId('mock-explorer-open-lib'));
        expect(tracked()).toBe('src/lib/util.ts');
    });

    it('stops tracking for a non-file tab, so the tree keeps the last highlight', () => {
        renderWithTree();
        fireEvent.click(screen.getByTestId('mock-explorer-open-app'));
        expect(tracked()).toBe('src/app.ts');

        openViaMenu('unified-panel-open-terminal');
        // Not `'null'`: "leave the tree alone" and "clear the highlight" are
        // different instructions, and a terminal tab means the former.
        expect(tracked()).toBeNull();
        expect(screen.getByTestId('mock-explorer').getAttribute('data-tracking')).toBe('off');
    });

    it('clears the highlight for a trusted absolute path, which has no row in any tree', () => {
        renderWithTree();
        fireEvent.click(screen.getByTestId('mock-explorer-open-trusted'));
        expect(tracked()).toBe('null');
    });

    it('clears the highlight when the dock is retargeted away from the file owner', () => {
        const targets = [{ workspaceId: WS, label: 'group' }, { workspaceId: MEMBER, label: 'api' }];
        writeUnifiedTreeState(WS, { open: true, width: 220 });
        const { rerender } = renderPanel({ dock: dockStub({ target: MEMBER, targets }) });

        // Opened from the member's tree, so the tab is owned by the member.
        fireEvent.click(screen.getByTestId('mock-explorer-open-app'));
        expect(tracked()).toBe('src/app.ts');

        // The picker moves the tree to the group repo; the open tab does not move
        // with it, so its path no longer resolves in the tree on screen.
        rerender(<UnifiedRightPanel workspaceId={WS} dock={dockStub({ target: WS, targets })} />);
        expect(tracked()).toBe('null');
        expect(screen.getByTestId('mock-explorer').textContent).toContain(`explorer:${WS}`);

        // Back again: the same tab is trackable once more.
        rerender(<UnifiedRightPanel workspaceId={WS} dock={dockStub({ target: MEMBER, targets })} />);
        expect(tracked()).toBe('src/app.ts');
    });
});
