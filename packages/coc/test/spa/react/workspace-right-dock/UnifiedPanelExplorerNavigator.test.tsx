/**
 * The Explorer entry point inside the unified panel: the tree COLUMN.
 *
 * There is no Explorer tab — the tree is panel-level chrome — but it is still a
 * navigator: its selections become file tabs in the panel's own strip. Two
 * things have to hold, and both are checked against the real ExplorerPanel
 * (only its API, PreviewPane and search panel are stubbed):
 *
 *  - a tree selection files an editable file tab in the current chat's scope,
 *    routed at the clone the tree is browsing;
 *  - the tree mounts no editor of its own, so the panel never shows a second,
 *    nested resource tab row — including with the Explorer's own editor-tabs
 *    flag ON, which is the configuration that would otherwise put two tab
 *    strips on screen.
 *
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const treeSpy = vi.fn();
const searchSpy = vi.fn();

vi.mock('../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerApi', () => ({
    explorerApi: {
        tree: (...args: unknown[]) => treeSpy(...args),
        searchFiles: (...args: unknown[]) => searchSpy(...args),
        readTrustedBlob: vi.fn(),
        readBlob: vi.fn(),
        writeBlob: vi.fn(),
        reveal: vi.fn(),
    },
}));
// The file body has its own suite; here only the routing it is handed matters.
vi.mock('../../../../src/server/spa/client/react/features/repo-detail/explorer/PreviewPane', () => ({
    PreviewPane: ({ repoId, filePath, revealLine, readOnly }: {
        repoId: string; filePath: string; revealLine?: number; readOnly?: boolean;
    }) => (
        <div
            data-testid={`mock-preview-${filePath}`}
            data-repo={repoId}
            data-reveal-line={revealLine ?? 'none'}
            data-readonly={readOnly ? 'true' : 'false'}
        />
    ),
}));
vi.mock('../../../../src/server/spa/client/react/features/repo-detail/explorer/ContentSearchPanel', () => ({
    ContentSearchPanel: ({ onOpenMatch, onOpenInEditor }: {
        onOpenMatch: (path: string, line: number) => void;
        onOpenInEditor?: (text: string, query: string) => void;
    }) => (
        <div data-testid="mock-content-search" data-has-open-in-editor={onOpenInEditor ? 'true' : 'false'}>
            <button data-testid="open-match" onClick={() => onOpenMatch('src/b.ts', 42)}>match</button>
        </div>
    ),
}));

import { UnifiedRightPanel } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/UnifiedRightPanel';
import { clearUnifiedPanelState } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelStore';
import { clearUnifiedTreeState, writeUnifiedTreeState } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelTree';
import { unifiedTabId } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelTabsModel';
import { clearExplorerTreeCache } from '../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerTreeCache';
import { clearExplorerSearchBuffers } from '../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerStateStore';
import { applyRuntimeConfigPatch } from '../../../../src/server/spa/client/react/utils/config';
import type { TreeEntry } from '../../../../src/server/spa/client/react/features/repo-detail/explorer/types';
import type { WorkspaceDockController } from '../../../../src/server/spa/client/react/features/repo-detail/useWorkspaceDock';

const WS = 'ws-1';
const CHAT = 'chat-1';
/** A repo-group member: the clone the Explorer browses, not the panel's scope. */
const MEMBER = 'ws-member';

const ROOT_ENTRIES: TreeEntry[] = [
    { name: 'a.ts', type: 'file', path: 'a.ts' },
    { name: 'b.ts', type: 'file', path: 'b.ts' },
];

function dockStub(target = WS): WorkspaceDockController {
    return {
        isOpen: true,
        toggleOpen: vi.fn(),
        mode: 'explorer',
        selectMode: vi.fn(),
        target,
        setTarget: vi.fn(),
        targets: [],
        width: 420,
        maxWidth: 900,
        isDragging: false,
        handleMouseDown: vi.fn(),
        handleTouchStart: vi.fn(),
    };
}

/** Open the tree column the way the "+" menu does, then mount the panel. */
async function renderWithExplorer(owner = WS, repoLabel?: string) {
    writeUnifiedTreeState(WS, { open: true, width: 220 });
    render(
        <UnifiedRightPanel
            workspaceId={WS}
            chatId={CHAT}
            dock={dockStub(owner)}
            {...(repoLabel === undefined ? {} : { targets: [{ workspaceId: owner, label: repoLabel }] })}
        />,
    );
    await waitFor(() => expect(screen.getByTestId('tree-node-a.ts')).toBeInTheDocument());
}

/** The unified strip's tab ids, in order. */
function unifiedTabIds(): string[] {
    return screen.getAllByTestId('unified-panel-tab-list')[0]
        .querySelectorAll('[role="tab"]')
        .values()
        .toArray()
        .map(node => node.getAttribute('data-tab-id') ?? '');
}

const fileTabId = (path: string, owner = WS) =>
    unifiedTabId({ kind: 'file', ownerWorkspaceId: owner, chatId: CHAT, resourceId: path });

beforeEach(() => {
    localStorage.clear();
    location.hash = '';
    clearUnifiedPanelState();
    clearUnifiedTreeState();
    clearExplorerTreeCache();
    clearExplorerSearchBuffers();
    treeSpy.mockReset();
    treeSpy.mockResolvedValue({ entries: ROOT_ENTRIES });
    searchSpy.mockReset();
    searchSpy.mockResolvedValue({ results: [] });
});

afterEach(() => {
    cleanup();
    clearUnifiedPanelState();
    clearUnifiedTreeState();
    applyRuntimeConfigPatch({ explorerEditorTabsEnabled: false });
});

describe('unified panel — the tree column as a navigator', () => {
    it('opens a tree selection as an editable file tab in the panel strip', async () => {
        await renderWithExplorer();

        fireEvent.click(screen.getByTestId('tree-node-a.ts'));

        await waitFor(() => expect(screen.getByTestId(`unified-panel-tab-${fileTabId('a.ts')}`)).toBeInTheDocument());
        const preview = await screen.findByTestId('mock-preview-a.ts');
        // Editable — the Explorer is an authorized entry point, unlike a chat
        // source link, which opens the same view read-only.
        expect(preview).toHaveAttribute('data-readonly', 'false');
        expect(preview).toHaveAttribute('data-repo', WS);
        expect(screen.getByTestId(`unified-panel-tab-${fileTabId('a.ts')}`)).toHaveAttribute('aria-selected', 'true');
    });

    it('keeps one tab per file, with the promoted one left in place', async () => {
        await renderWithExplorer();

        fireEvent.click(screen.getByTestId('tree-node-a.ts'));
        await waitFor(() => expect(unifiedTabIds()).toEqual([fileTabId('a.ts')]));
        // The double click promotes the preview it just opened rather than
        // stacking a second tab on the same file; b.ts then takes the freed
        // slot beside it.
        fireEvent.doubleClick(screen.getByTestId('tree-node-a.ts'));
        fireEvent.click(screen.getByTestId('tree-node-b.ts'));

        await waitFor(() => expect(unifiedTabIds()).toEqual([
            fileTabId('a.ts'),
            fileTabId('b.ts'),
        ]));
    });

    it('routes a group member Explorer at its own clone and labels the tab', async () => {
        await renderWithExplorer(MEMBER, 'member-repo');

        fireEvent.click(screen.getByTestId('tree-node-a.ts'));

        await waitFor(() => expect(screen.getByTestId('mock-preview-a.ts')).toHaveAttribute('data-repo', MEMBER));
        expect(screen.getByTestId(`unified-panel-tab-${fileTabId('a.ts', MEMBER)}`)).toBeInTheDocument();
        expect(screen.getByTestId(`unified-panel-tab-repo-${fileTabId('a.ts', MEMBER)}`)).toHaveTextContent('member-repo');
    });

    it('opens a content-search hit at its matching line', async () => {
        await renderWithExplorer();
        fireEvent.click(screen.getByTestId('explorer-view-search'));

        fireEvent.click(await screen.findByTestId('open-match'));

        await waitFor(() => expect(screen.getByTestId('mock-preview-src/b.ts')).toHaveAttribute('data-reveal-line', '42'));
    });

    it('mounts no editor of its own, so the panel shows one tab strip even with Explorer tabs on', async () => {
        applyRuntimeConfigPatch({ explorerEditorTabsEnabled: true });
        await renderWithExplorer();

        expect(screen.queryByTestId('explorer-preview-pane')).not.toBeInTheDocument();
        expect(screen.queryByTestId('explorer-tabbed-editor')).not.toBeInTheDocument();
        expect(screen.queryByTestId('explorer-resize-handle')).not.toBeInTheDocument();
        expect(screen.getAllByTestId('unified-panel-tab-list')).toHaveLength(1);

        // A file open still goes to the panel, not to a hidden Explorer session.
        fireEvent.click(screen.getByTestId('tree-node-a.ts'));
        await waitFor(() => expect(screen.getByTestId(`unified-panel-tab-${fileTabId('a.ts')}`)).toBeInTheDocument());
        expect(screen.queryByTestId('explorer-tabbed-editor')).not.toBeInTheDocument();
    });

    it('hides "Open in Editor" in the search view, which has no editor to park a buffer in', async () => {
        await renderWithExplorer();
        fireEvent.click(screen.getByTestId('explorer-view-search'));

        expect(await screen.findByTestId('mock-content-search'))
            .toHaveAttribute('data-has-open-in-editor', 'false');
    });
});
