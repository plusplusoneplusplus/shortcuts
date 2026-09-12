/**
 * The unified panel's toolbar row (AC-02) — breadcrumbs for the active file tab
 * and the one file-tree toggle.
 *
 * Two rules carry the weight here. The row exists only for a file tab, and when
 * it does not exist the toggle moves into the tab strip, so there is always
 * exactly one visible way to open the tree and never two that disagree. And a
 * breadcrumb click drives the *tree*: it reveals a folder and never opens,
 * closes, or switches a tab — which also means it must go quiet whenever the
 * path cannot be located in the tree on screen.
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
// The tree column stands in for the real sidebar `ExplorerPanel`; each button
// opens one concrete path so a file click is a real user event.
const TREE_FILES = [
    { key: 'app', path: 'src/app.ts', name: 'app.ts' },
    { key: 'deep', path: 'packages/coc/src/server/spa/client/react/features/deep.ts', name: 'deep.ts' },
    { key: 'trusted', path: '__trusted__:/etc/hosts', name: 'hosts' },
];
vi.mock('../../../../src/server/spa/client/react/features/repo-detail/explorer/ExplorerPanel', async () => {
    const actual = await vi.importActual<typeof import('../../../../src/server/spa/client/react/features/repo-detail/explorer/ExplorerPanel')>(
        '../../../../src/server/spa/client/react/features/repo-detail/explorer/ExplorerPanel',
    );
    return {
        // `getAncestorPaths` is real: the panel uses it to expand a revealed folder.
        getAncestorPaths: actual.getAncestorPaths,
        ExplorerPanel: ({ workspaceId, onOpenFile }: {
            workspaceId: string;
            onOpenFile?: (
                file: { path: string; name: string; line?: number },
                options: { preview: boolean; readOnly?: boolean },
            ) => void;
        }) => (
            <div data-testid="mock-explorer">
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
// `PreviewPane` opens a language document for every live repo file; this suite
// is about panel behaviour, not language support.
vi.mock('../../../../src/server/spa/client/react/features/language-servers/languageServerClient',
    async () => await import('../language-servers/inertTransportMock'));


import { UnifiedRightPanel } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/UnifiedRightPanel';
import { clearUnifiedPanelState } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelStore';
import {
    clearUnifiedTreeState,
    writeUnifiedTreeState,
} from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelTree';
import {
    breadcrumbFolderPath,
    unifiedToolbarBreadcrumbs,
} from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelBreadcrumbs';
import type { UnifiedPanelTab } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelTabsModel';
import {
    explorerExpandedStorageKey,
    explorerSelectedStorageKey,
} from '../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerStateStore';
import type { WorkspaceDockController } from '../../../../src/server/spa/client/react/features/repo-detail/useWorkspaceDock';

const WS = 'ws-1';
const MEMBER = 'ws-member';

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

/** Open a workspace resource through the "+" menu, as a user would. */
function openViaMenu(testId: string) {
    fireEvent.click(screen.getByTestId('unified-panel-open-menu'));
    fireEvent.click(screen.getByTestId(testId));
}

/** The tree's persisted expansion for a workspace, straight from the store. */
function expandedPaths(workspaceId: string): string[] {
    const raw = localStorage.getItem(explorerExpandedStorageKey(workspaceId));
    return raw === null ? [] : (JSON.parse(raw) as string[]);
}

function selectedPath(workspaceId: string): unknown {
    const raw = localStorage.getItem(explorerSelectedStorageKey(workspaceId));
    return raw === null ? null : JSON.parse(raw);
}

function fileTab(overrides: Partial<UnifiedPanelTab> = {}): UnifiedPanelTab {
    return {
        id: 'tab-1',
        kind: 'file',
        ownerWorkspaceId: WS,
        chatId: null,
        resourceId: 'src/app.ts',
        label: 'app.ts',
        ...overrides,
    };
}

describe('unifiedToolbarBreadcrumbs', () => {
    it('renders no row for a kind that brings its own toolbar', () => {
        expect(unifiedToolbarBreadcrumbs(null, WS)).toBeNull();
        expect(unifiedToolbarBreadcrumbs(fileTab({ kind: 'terminal' }), WS)).toBeNull();
        expect(unifiedToolbarBreadcrumbs(fileTab({ kind: 'canvas' }), WS)).toBeNull();
    });

    it('splits a repo-relative path into navigable segments', () => {
        expect(unifiedToolbarBreadcrumbs(fileTab(), WS)).toEqual({
            path: 'src/app.ts',
            segments: ['src', 'app.ts'],
            interactive: true,
        });
    });

    it('goes non-interactive for a trusted absolute path', () => {
        const result = unifiedToolbarBreadcrumbs(fileTab({ resourceId: '__trusted__:/etc/hosts' }), WS);
        expect(result).toEqual({ path: '/etc/hosts', segments: [], interactive: false });
    });

    it('goes non-interactive when the file belongs to a repo the tree is not showing', () => {
        const result = unifiedToolbarBreadcrumbs(fileTab({ ownerWorkspaceId: MEMBER, repoLabel: 'api' }), WS);
        expect(result).toEqual({ path: 'src/app.ts', segments: [], interactive: false, repoLabel: 'api' });
    });

    it('keeps the repo label while staying navigable when the tree is on that repo', () => {
        const result = unifiedToolbarBreadcrumbs(fileTab({ ownerWorkspaceId: MEMBER, repoLabel: 'api' }), MEMBER);
        expect(result).toMatchObject({ interactive: true, repoLabel: 'api', segments: ['src', 'app.ts'] });
    });
});

describe('breadcrumbFolderPath', () => {
    it('maps the root crumb to no folder and each other crumb to its prefix', () => {
        const segments = ['packages', 'coc', 'src', 'app.ts'];
        expect(breadcrumbFolderPath(segments, -1)).toBeNull();
        expect(breadcrumbFolderPath(segments, 0)).toBe('packages');
        expect(breadcrumbFolderPath(segments, 2)).toBe('packages/coc/src');
    });
});

describe('unified panel toolbar row', () => {
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

    /**
     * Render with the tree column already open and open one of its files —
     * the only entry point that produces a file tab here. The tree state is
     * seeded *before* the render: writing it afterwards notifies
     * `useSyncExternalStore` outside React's batch.
     */
    function renderWithTreeFile(key: string, props: Partial<React.ComponentProps<typeof UnifiedRightPanel>> = {}) {
        writeUnifiedTreeState(WS, { open: true, width: 220 });
        const result = renderPanel(props);
        fireEvent.click(screen.getByTestId(`mock-explorer-open-${key}`));
        return result;
    }

    it('shows breadcrumbs with Search and Explorer controls in the toolbar', () => {
        renderWithTreeFile('app');

        expect(screen.getByTestId('unified-panel-toolbar')).toBeTruthy();
        expect(screen.getByTestId('breadcrumb-segment-root')).toBeTruthy();
        expect(screen.getByTestId('breadcrumb-segment-0').textContent).toBe('src');
        expect(screen.getByTestId('breadcrumb-segment-1').textContent).toBe('app.ts');

        const toggle = screen.getByTestId('unified-panel-tree-toggle');
        expect(toggle.getAttribute('data-placement')).toBe('toolbar');
        expect(toggle.getAttribute('aria-expanded')).toBe('true');
        expect(screen.getAllByTestId('unified-panel-tree-toggle')).toHaveLength(1);
        const search = screen.getByTestId('unified-panel-search-toggle');
        expect(search.getAttribute('data-placement')).toBe('toolbar');
        expect(screen.getByTestId('unified-panel-toolbar').contains(search)).toBe(true);
    });

    it('moves Search and Explorer controls into the strip when the toolbar is absent', () => {
        renderPanel();
        expect(screen.queryByTestId('unified-panel-toolbar')).toBeNull();
        expect(screen.getByTestId('unified-panel-tree-toggle').getAttribute('data-placement')).toBe('strip');
        expect(screen.getByTestId('unified-panel-search-toggle').getAttribute('data-placement')).toBe('strip');

        openViaMenu('unified-panel-open-terminal');
        expect(screen.queryByTestId('unified-panel-toolbar')).toBeNull();
        const toggle = screen.getByTestId('unified-panel-tree-toggle');
        expect(toggle.getAttribute('data-placement')).toBe('strip');
        expect(screen.getByTestId('unified-panel-tab-strip').contains(toggle)).toBe(true);
        expect(screen.getByTestId('unified-panel-tab-strip').contains(screen.getByTestId('unified-panel-search-toggle'))).toBe(true);
    });

    it('opens Search from inside the right panel without closing the panel', () => {
        const selectMode = vi.fn();
        renderPanel({ dock: dockStub({ selectMode }) });

        fireEvent.click(screen.getByRole('button', { name: 'Show Search' }));

        expect(selectMode).toHaveBeenCalledWith('search');
        expect(localStorage.getItem('split-workspace:ws-1:dock-open')).toBeNull();
        expect(screen.getByTestId('unified-panel-navigator-controls')).toBeTruthy();
    });

    it('collapses Search from its panel-local active control', () => {
        writeUnifiedTreeState(WS, { open: true, width: 220 });
        const selectMode = vi.fn();
        renderPanel({ dock: dockStub({ mode: 'search', selectMode }) });

        fireEvent.click(screen.getByRole('button', { name: 'Hide Search' }));

        expect(selectMode).not.toHaveBeenCalled();
        expect(screen.getByRole('button', { name: 'Show Search' }).getAttribute('aria-pressed')).toBe('false');
    });

    it('reveals a folder in the tree on a breadcrumb click without touching tabs', () => {
        renderWithTreeFile('deep');
        const activeBefore = screen.getByRole('tab', { selected: true }).getAttribute('data-tab-id');

        // "src" is index 2 of packages/coc/src/server/spa/client/react/features/deep.ts
        fireEvent.click(screen.getByTestId('breadcrumb-segment-2'));

        expect(selectedPath(WS)).toBe('packages/coc/src');
        // Ancestors too: a row inside a collapsed parent is not revealed.
        expect(expandedPaths(WS).sort()).toEqual(['packages', 'packages/coc', 'packages/coc/src']);
        // The tab set is untouched — this is orientation, not navigation.
        expect(screen.getAllByRole('tab')).toHaveLength(1);
        expect(screen.getByRole('tab', { selected: true }).getAttribute('data-tab-id')).toBe(activeBefore);
    });

    it('clears the tree selection on the root crumb and leaves the expansion alone', () => {
        renderWithTreeFile('deep');
        fireEvent.click(screen.getByTestId('breadcrumb-segment-1'));
        expect(expandedPaths(WS).sort()).toEqual(['packages', 'packages/coc']);

        fireEvent.click(screen.getByTestId('breadcrumb-segment-root'));
        expect(selectedPath(WS)).toBeNull();
        expect(expandedPaths(WS).sort()).toEqual(['packages', 'packages/coc']);
    });

    it('degrades to a plain path label for a trusted absolute path', () => {
        renderWithTreeFile('trusted');

        expect(screen.getByTestId('unified-panel-toolbar')).toBeTruthy();
        expect(screen.queryByTestId('breadcrumb-segment-root')).toBeNull();
        expect(screen.getByTestId('unified-panel-toolbar-path').textContent).toBe('/etc/hosts');
        expect(screen.getByTestId('unified-panel-tree-toggle').getAttribute('data-placement')).toBe('toolbar');
    });

    it('attributes a repo-group member file and stops navigating once the tree retargets', () => {
        const groupDock = dockStub({
            target: MEMBER,
            targets: [{ workspaceId: WS, label: 'group' }, { workspaceId: MEMBER, label: 'api' }],
        });
        const { rerender } = renderWithTreeFile('app', { dock: groupDock });

        // The tree is on the owning member, so the crumbs still navigate it, and
        // the row names the repo because it is not the panel's own workspace.
        expect(screen.getByTestId('unified-panel-toolbar-repo').textContent).toBe('api');
        expect(screen.getByTestId('breadcrumb-segment-0').textContent).toBe('src');

        // Retarget the dock: the open tab keeps its owner, so its path no longer
        // resolves in the tree on screen and the crumbs go quiet.
        rerender(<UnifiedRightPanel workspaceId={WS} dock={dockStub({ ...groupDock, target: WS })} />);
        expect(screen.queryByTestId('breadcrumb-segment-0')).toBeNull();
        expect(screen.getByTestId('unified-panel-toolbar-path').textContent).toBe('src/app.ts');
        expect(screen.getByTestId('unified-panel-toolbar-repo').textContent).toBe('api');
    });

    it('keeps the whole path in a tooltip when it truncates', () => {
        renderWithTreeFile('deep');
        const row = screen.getByTestId('unified-panel-toolbar');
        const scroller = row.querySelector('[title]');
        expect(scroller?.getAttribute('title')).toBe('packages/coc/src/server/spa/client/react/features/deep.ts');
    });
});
