// @vitest-environment jsdom
/**
 * AC-01 / AC-05 (wiring): ExplorerPanel behind `features.explorerEditorTabs`.
 *
 * The tab rules themselves are pinned by explorerTabsModel.test.ts and the strip
 * by ExplorerTabStrip.test.tsx; this file covers the join — that the Explorer's
 * own open paths (tree single/double click, a content-search hit, "Open in
 * Editor", a deep link) route through the tab session, that every open buffer
 * stays mounted with its own state, and that the flag being off leaves the
 * single-preview Explorer exactly as it was.
 *
 * PreviewPane and ContentSearchPanel are mocked to stubs so the test drives the
 * wiring directly without pulling Monaco or the search API into the graph. The
 * PreviewPane stub mimics the real save-registration contract — an editable
 * buffer hands the panel a save function, a read-only one hands it `null` — so
 * "this tab can never be written" is observable from here.
 */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { useEffect } from 'react';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';

const treeSpy = vi.fn();
const searchSpy = vi.fn();
const trustedBlobSpy = vi.fn();

/** filePath → the save function its buffer registered (null = cannot be written). */
const registeredSaves = new Map<string, (() => Promise<boolean>) | null>();

vi.mock('../../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerApi', () => ({
    explorerApi: {
        tree: (...args: unknown[]) => treeSpy(...args),
        searchFiles: (...args: unknown[]) => searchSpy(...args),
        readTrustedBlob: (...args: unknown[]) => trustedBlobSpy(...args),
        reveal: vi.fn(),
    },
}));

vi.mock('../../../../../src/server/spa/client/react/features/repo-detail/explorer/PreviewPane', () => ({
    PreviewPane: ({ filePath, revealLine, readOnly, onDirtyChange, onRegisterSave, onClose }: {
        filePath: string;
        revealLine?: number;
        readOnly?: boolean;
        onDirtyChange?: (d: boolean) => void;
        onRegisterSave?: (save: (() => Promise<boolean>) | null) => void;
        onClose?: () => void;
    }) => {
        useEffect(() => {
            if (!onRegisterSave) return;
            // Read-only buffers never register a way to write, exactly as the
            // real PreviewPane does.
            const save = readOnly ? null : async () => { onDirtyChange?.(false); return true; };
            registeredSaves.set(filePath, save);
            onRegisterSave(save);
        }, [onRegisterSave, readOnly, onDirtyChange, filePath]);
        return (
            <div data-testid={`mock-preview-${filePath}`} data-reveal-line={revealLine} data-readonly={readOnly ? 'true' : undefined}>
                <button data-testid={`make-dirty-${filePath}`} onClick={() => onDirtyChange?.(true)}>dirty</button>
                <button data-testid={`make-clean-${filePath}`} onClick={() => onDirtyChange?.(false)}>clean</button>
                <button data-testid={`preview-close-${filePath}`} onClick={() => onClose?.()}>close</button>
            </div>
        );
    },
}));

vi.mock('../../../../../src/server/spa/client/react/features/repo-detail/explorer/ContentSearchPanel', () => ({
    ContentSearchPanel: ({ onOpenMatch, onOpenInEditor }: {
        onOpenMatch: (path: string, line: number) => void;
        onOpenInEditor: (text: string, query: string) => void;
    }) => (
        <div data-testid="mock-content-search">
            <button data-testid="open-match" onClick={() => onOpenMatch('src/b.ts', 42)}>match</button>
            <button data-testid="open-in-editor" onClick={() => onOpenInEditor('hit one\nhit two', 'needle')}>editor</button>
        </div>
    ),
}));

import { ExplorerPanel } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/ExplorerPanel';
import { clearExplorerTreeCache } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerTreeCache';
import {
    explorerTabsStorageKey,
    clearExplorerSearchBuffers,
} from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerStateStore';
import { isExplorerDirty, clearExplorerDirty } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerDirtyStore';
import { TRUSTED_PATH_PREFIX } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/ExactOpen';
import { applyRuntimeConfigPatch } from '../../../../../src/server/spa/client/react/utils/config';
import type { TreeEntry } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/types';

const ROOT_ENTRIES: TreeEntry[] = [
    { name: 'a.ts', type: 'file', path: 'a.ts' },
    { name: 'b.ts', type: 'file', path: 'b.ts' },
    { name: 'c.ts', type: 'file', path: 'c.ts' },
];

/** The persisted tab session for a workspace, as the store wrote it. */
function readTabs(wsId: string): { tabs: { id: string; preview: boolean }[]; activeId: string | null } {
    return JSON.parse(localStorage.getItem(explorerTabsStorageKey(wsId)) ?? '{"tabs":[],"activeId":null}');
}

function openTabIds(): string[] {
    return screen.queryAllByRole('tab')
        .map(node => node.getAttribute('data-tab-id'))
        .filter((id): id is string => id !== null);
}

async function renderPanel(wsId = 'ws-1') {
    render(<ExplorerPanel workspaceId={wsId} />);
    await waitFor(() => expect(screen.getByTestId('tree-node-a.ts')).toBeInTheDocument());
}

/** Open Quick Open with Ctrl+P, type a query, and click the first match. */
async function pickThroughQuickOpen(query: string) {
    fireEvent.keyDown(document, { key: 'p', ctrlKey: true });
    fireEvent.change(await screen.findByTestId('quick-open-input'), { target: { value: query } });
    fireEvent.click(await screen.findByTestId('quick-open-item-0'));
}

/** An absolute path Exact Open resolves through the trusted-fs endpoint. */
const TRUSTED_ABS_PATH = '/etc/hosts';
const TRUSTED_FILE_PATH = `${TRUSTED_PATH_PREFIX}${TRUSTED_ABS_PATH}`;
const TRUSTED_TAB_ID = `file:${TRUSTED_FILE_PATH}`;

beforeEach(() => {
    localStorage.clear();
    location.hash = '';
    clearExplorerTreeCache();
    clearExplorerDirty();
    clearExplorerSearchBuffers();
    treeSpy.mockReset();
    treeSpy.mockResolvedValue({ entries: ROOT_ENTRIES });
    searchSpy.mockReset();
    searchSpy.mockResolvedValue({ results: [] });
    trustedBlobSpy.mockReset();
    trustedBlobSpy.mockResolvedValue({ content: '', encoding: 'utf8' });
    registeredSaves.clear();
    applyRuntimeConfigPatch({ explorerEditorTabsEnabled: true });
});

afterEach(() => {
    cleanup();
    applyRuntimeConfigPatch({ explorerEditorTabsEnabled: false });
});

describe('ExplorerPanel — editor tabs (flag on)', () => {
    it('opens a single replaceable preview tab on single click', async () => {
        await renderPanel();
        fireEvent.click(screen.getByTestId('tree-node-a.ts'));
        await waitFor(() => expect(openTabIds()).toEqual(['file:a.ts']));
        expect(screen.getByTestId('explorer-tab-file:a.ts')).toHaveAttribute('data-preview', 'true');

        fireEvent.click(screen.getByTestId('tree-node-b.ts'));
        await waitFor(() => expect(openTabIds()).toEqual(['file:b.ts']));
    });

    it('pins the tab on double click, so the next single click adds a second tab', async () => {
        await renderPanel();
        fireEvent.doubleClick(screen.getByTestId('tree-node-a.ts'));
        await waitFor(() => expect(openTabIds()).toEqual(['file:a.ts']));
        expect(screen.getByTestId('explorer-tab-file:a.ts')).not.toHaveAttribute('data-preview');

        fireEvent.click(screen.getByTestId('tree-node-b.ts'));
        await waitFor(() => expect(openTabIds()).toEqual(['file:a.ts', 'file:b.ts']));
    });

    it('activates the existing tab instead of duplicating an open file', async () => {
        await renderPanel();
        fireEvent.doubleClick(screen.getByTestId('tree-node-a.ts'));
        fireEvent.doubleClick(screen.getByTestId('tree-node-b.ts'));
        await waitFor(() => expect(openTabIds()).toEqual(['file:a.ts', 'file:b.ts']));

        fireEvent.click(screen.getByTestId('tree-node-a.ts'));
        await waitFor(() => expect(screen.getByTestId('explorer-tab-file:a.ts')).toHaveAttribute('aria-selected', 'true'));
        expect(openTabIds()).toEqual(['file:a.ts', 'file:b.ts']);
    });

    it('promotes a preview tab to pinned when its buffer reports the first edit', async () => {
        await renderPanel();
        fireEvent.click(screen.getByTestId('tree-node-a.ts'));
        await waitFor(() => expect(screen.getByTestId('explorer-tab-file:a.ts')).toHaveAttribute('data-preview', 'true'));

        fireEvent.click(screen.getByTestId('make-dirty-a.ts'));
        await waitFor(() => expect(screen.getByTestId('explorer-tab-file:a.ts')).not.toHaveAttribute('data-preview'));
        expect(screen.getByTestId('explorer-tab-file:a.ts')).toHaveAttribute('data-dirty', 'true');

        // Pinned by the edit, so a following single click cannot throw it away.
        fireEvent.click(screen.getByTestId('tree-node-b.ts'));
        await waitFor(() => expect(openTabIds()).toEqual(['file:a.ts', 'file:b.ts']));
    });

    it('reports the aggregate dirtiness of every open tab to the switch guard', async () => {
        await renderPanel();
        fireEvent.doubleClick(screen.getByTestId('tree-node-a.ts'));
        fireEvent.doubleClick(screen.getByTestId('tree-node-b.ts'));
        await waitFor(() => expect(openTabIds()).toHaveLength(2));

        fireEvent.click(screen.getByTestId('make-dirty-a.ts'));
        fireEvent.click(screen.getByTestId('make-dirty-b.ts'));
        await waitFor(() => expect(isExplorerDirty('ws-1')).toBe(true));

        fireEvent.click(screen.getByTestId('make-clean-a.ts'));
        expect(isExplorerDirty('ws-1')).toBe(true);
        fireEvent.click(screen.getByTestId('make-clean-b.ts'));
        await waitFor(() => expect(isExplorerDirty('ws-1')).toBe(false));
    });

    it('keeps every open buffer mounted, hiding the inactive ones', async () => {
        await renderPanel();
        fireEvent.doubleClick(screen.getByTestId('tree-node-a.ts'));
        fireEvent.doubleClick(screen.getByTestId('tree-node-b.ts'));
        await waitFor(() => expect(screen.getByTestId('mock-preview-b.ts')).toBeInTheDocument());

        // Both buffers exist; only the active one is displayed.
        expect(screen.getByTestId('mock-preview-a.ts')).toBeInTheDocument();
        expect(screen.getByTestId('explorer-tab-panel-file:a.ts')).toHaveStyle({ display: 'none' });
        expect(screen.getByTestId('explorer-tab-panel-file:b.ts')).not.toHaveStyle({ display: 'none' });

        fireEvent.click(screen.getByTestId('explorer-tab-file:a.ts'));
        await waitFor(() => expect(screen.getByTestId('explorer-tab-panel-file:b.ts')).toHaveStyle({ display: 'none' }));
        expect(screen.getByTestId('explorer-tab-panel-file:a.ts')).not.toHaveStyle({ display: 'none' });
    });

    it('closes a tab from the strip, leaving the other buffers untouched', async () => {
        await renderPanel();
        fireEvent.doubleClick(screen.getByTestId('tree-node-a.ts'));
        fireEvent.doubleClick(screen.getByTestId('tree-node-b.ts'));
        await waitFor(() => expect(openTabIds()).toHaveLength(2));

        fireEvent.click(screen.getByTestId('explorer-tab-close-file:b.ts'));
        await waitFor(() => expect(openTabIds()).toEqual(['file:a.ts']));
        expect(screen.getByTestId('mock-preview-a.ts')).toBeInTheDocument();
        expect(screen.queryByTestId('mock-preview-b.ts')).toBeNull();
    });

    it('opens a content-search hit as a preview tab carrying its reveal line', async () => {
        await renderPanel();
        fireEvent.click(screen.getByTestId('explorer-view-search'));
        fireEvent.click(await screen.findByTestId('open-match'));

        await waitFor(() => expect(openTabIds()).toEqual(['file:src/b.ts']));
        expect(screen.getByTestId('explorer-tab-file:src/b.ts')).toHaveAttribute('data-preview', 'true');
        expect(screen.getByTestId('mock-preview-src/b.ts')).toHaveAttribute('data-reveal-line', '42');
    });

    it('opens a search result set as a read-only tab that coexists with file tabs', async () => {
        await renderPanel();
        fireEvent.doubleClick(screen.getByTestId('tree-node-a.ts'));
        fireEvent.click(screen.getByTestId('explorer-view-search'));
        fireEvent.click(await screen.findByTestId('open-in-editor'));

        await waitFor(() => expect(openTabIds()).toEqual(['file:a.ts', 'search:needle']));
        expect(screen.getByTestId('explorer-tab-search:needle')).toHaveAttribute('data-readonly', 'true');
        expect(screen.getByTestId('search-editor-text')).toHaveTextContent('hit one');

        fireEvent.click(screen.getByTestId('explorer-tab-close-search:needle'));
        await waitFor(() => expect(openTabIds()).toEqual(['file:a.ts']));
    });

    it('closes a restored search tab whose in-memory buffer did not survive the reload', async () => {
        localStorage.setItem(explorerTabsStorageKey('ws-1'), JSON.stringify({
            tabs: [
                { id: 'file:a.ts', kind: 'file', path: 'a.ts', name: 'a.ts', preview: false, readOnly: false },
                { id: 'search:needle', kind: 'search', path: '', name: 'Search: needle', preview: false, readOnly: true, query: 'needle' },
            ],
            activeId: 'search:needle',
            mru: ['search:needle', 'file:a.ts'],
        }));
        await renderPanel();
        await waitFor(() => expect(openTabIds()).toEqual(['file:a.ts']));
        expect(screen.queryByTestId('search-editor-pane')).toBeNull();
    });

    it('opens a deep-linked file as a pinned tab beside the workspace’s restored tabs', async () => {
        localStorage.setItem(explorerTabsStorageKey('ws-1'), JSON.stringify({
            tabs: [{ id: 'file:a.ts', kind: 'file', path: 'a.ts', name: 'a.ts', preview: false, readOnly: false }],
            activeId: 'file:a.ts',
            mru: ['file:a.ts'],
        }));
        location.hash = '#repos/ws-1/explorer/c.ts';
        await renderPanel();

        await waitFor(() => expect(openTabIds()).toEqual(['file:a.ts', 'file:c.ts']));
        expect(screen.getByTestId('explorer-tab-file:c.ts')).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByTestId('explorer-tab-file:c.ts')).not.toHaveAttribute('data-preview');
    });

    it('opens exactly one preview tab for a file picked through Quick Open', async () => {
        searchSpy.mockResolvedValue({ results: [{ path: 'src/deep/b.ts', score: 1, indices: [] }] });
        await renderPanel();
        await pickThroughQuickOpen('b.ts');

        await waitFor(() => expect(openTabIds()).toEqual(['file:src/deep/b.ts']));
        const tab = screen.getByTestId('explorer-tab-file:src/deep/b.ts');
        expect(tab).toHaveAttribute('data-preview', 'true');
        expect(tab).toHaveAttribute('aria-selected', 'true');
        expect(screen.queryByTestId('quick-open-dialog')).toBeNull();
    });

    it('activates the tab a Quick Open pick is already open in instead of duplicating it', async () => {
        searchSpy.mockResolvedValue({ results: [{ path: 'a.ts', score: 1, indices: [] }] });
        await renderPanel();
        fireEvent.doubleClick(screen.getByTestId('tree-node-a.ts'));
        fireEvent.doubleClick(screen.getByTestId('tree-node-b.ts'));
        await waitFor(() => expect(openTabIds()).toEqual(['file:a.ts', 'file:b.ts']));
        expect(screen.getByTestId('explorer-tab-file:b.ts')).toHaveAttribute('aria-selected', 'true');

        await pickThroughQuickOpen('a.ts');

        await waitFor(() => expect(screen.getByTestId('explorer-tab-file:a.ts')).toHaveAttribute('aria-selected', 'true'));
        expect(openTabIds()).toEqual(['file:a.ts', 'file:b.ts']);
        // Quick Open opens as a preview, but it must not knock an already
        // pinned tab back to the replaceable slot.
        expect(screen.getByTestId('explorer-tab-file:a.ts')).not.toHaveAttribute('data-preview');
    });

    it('adds a trusted Exact Open path to the same strip as a pinned read-only tab that registers no save', async () => {
        await renderPanel();
        fireEvent.doubleClick(screen.getByTestId('tree-node-a.ts'));
        await waitFor(() => expect(openTabIds()).toEqual(['file:a.ts']));

        fireEvent.keyDown(document, { key: 'o', ctrlKey: true });
        fireEvent.change(await screen.findByTestId('exact-open-input'), { target: { value: TRUSTED_ABS_PATH } });
        fireEvent.click(await screen.findByTestId('exact-open-item-0'));

        await waitFor(() => expect(openTabIds()).toEqual(['file:a.ts', TRUSTED_TAB_ID]));
        const tab = screen.getByTestId(`explorer-tab-${TRUSTED_TAB_ID}`);
        expect(tab).toHaveAttribute('data-readonly', 'true');
        expect(tab).toHaveAttribute('aria-selected', 'true');
        expect(tab).not.toHaveAttribute('data-preview');
        expect(tab).toHaveTextContent('hosts');
        expect(screen.getByTestId(`mock-preview-${TRUSTED_FILE_PATH}`)).toHaveAttribute('data-readonly', 'true');

        // Read-only, so its buffer hands the panel no way to write it — while
        // the editable tab beside it does.
        await waitFor(() => expect(registeredSaves.has(TRUSTED_FILE_PATH)).toBe(true));
        expect(registeredSaves.get(TRUSTED_FILE_PATH)).toBeNull();
        expect(registeredSaves.get('a.ts')).not.toBeNull();

        // ...and closing it can never raise the save prompt.
        fireEvent.click(screen.getByTestId(`explorer-tab-close-${TRUSTED_TAB_ID}`));
        await waitFor(() => expect(openTabIds()).toEqual(['file:a.ts']));
        expect(screen.queryByTestId('explorer-close-tabs-prompt')).toBeNull();
    });

    it('persists the tab session per workspace', async () => {
        await renderPanel();
        fireEvent.doubleClick(screen.getByTestId('tree-node-a.ts'));
        await waitFor(() => expect(readTabs('ws-1').tabs.map(t => t.id)).toEqual(['file:a.ts']));
        expect(localStorage.getItem(explorerTabsStorageKey('ws-2'))).toBeNull();
    });
});

describe('ExplorerPanel — editor tabs (flag off)', () => {
    beforeEach(() => {
        applyRuntimeConfigPatch({ explorerEditorTabsEnabled: false });
    });

    it('keeps the single replaceable preview pane and renders no tab strip', async () => {
        await renderPanel();
        fireEvent.click(screen.getByTestId('tree-node-a.ts'));
        await waitFor(() => expect(screen.getByTestId('mock-preview-a.ts')).toBeInTheDocument());
        expect(screen.queryByTestId('explorer-tab-strip')).toBeNull();

        fireEvent.click(screen.getByTestId('tree-node-b.ts'));
        await waitFor(() => expect(screen.getByTestId('mock-preview-b.ts')).toBeInTheDocument());
        expect(screen.queryByTestId('mock-preview-a.ts')).toBeNull();
        expect(localStorage.getItem(explorerTabsStorageKey('ws-1'))).toBeNull();
    });
});
