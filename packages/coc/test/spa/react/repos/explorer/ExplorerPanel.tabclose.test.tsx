// @vitest-environment jsdom
/**
 * AC-04: closing tabs and dirty-buffer safety, plus the AC-02 `beforeunload`
 * guard.
 *
 * Every close path in the Explorer funnels through one guarded entry point, so
 * this file drives each of them (close button, middle click, Ctrl/Cmd+W, and
 * the four context-menu actions) and pins the three prompt outcomes — Save,
 * Don't Save, Cancel — including a failed write, which must leave the file open
 * and dirty rather than reporting a successful close.
 *
 * PreviewPane is mocked with a stub that mimics the real registration contract:
 * an editable buffer hands the panel a save function, a read-only one hands it
 * `null`, and the test decides whether a given file's write succeeds.
 */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { useEffect } from 'react';
import { render, screen, waitFor, fireEvent, cleanup, act } from '@testing-library/react';

const treeSpy = vi.fn();

/** filePath → whether its save succeeds. Missing means success. */
const saveOutcome = new Map<string, boolean>();
/** Files whose save function was actually invoked, in order. */
const saveCalls: string[] = [];

vi.mock('../../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerApi', () => ({
    explorerApi: {
        tree: (...args: unknown[]) => treeSpy(...args),
        searchFiles: vi.fn().mockResolvedValue({ results: [] }),
        reveal: vi.fn(),
    },
}));

vi.mock('../../../../../src/server/spa/client/react/features/repo-detail/explorer/PreviewPane', () => ({
    PreviewPane: ({ filePath, readOnly, onDirtyChange, onRegisterSave, onClose }: {
        filePath: string;
        readOnly?: boolean;
        onDirtyChange?: (d: boolean) => void;
        onRegisterSave?: (save: (() => Promise<boolean>) | null) => void;
        onClose?: () => void;
    }) => {
        useEffect(() => {
            if (!onRegisterSave) return;
            // Read-only buffers never register a way to write (real PreviewPane
            // does the same), which is what makes a write on one impossible.
            if (readOnly) {
                onRegisterSave(null);
                return;
            }
            onRegisterSave(async () => {
                saveCalls.push(filePath);
                const ok = saveOutcome.get(filePath) ?? true;
                if (ok) onDirtyChange?.(false);
                return ok;
            });
            return () => onRegisterSave(null);
        }, [onRegisterSave, readOnly, onDirtyChange, filePath]);
        return (
            <div data-testid={`mock-preview-${filePath}`} data-readonly={readOnly ? 'true' : undefined}>
                <button data-testid={`make-dirty-${filePath}`} onClick={() => onDirtyChange?.(true)}>dirty</button>
                <button data-testid={`preview-close-${filePath}`} onClick={() => onClose?.()}>close</button>
            </div>
        );
    },
}));

vi.mock('../../../../../src/server/spa/client/react/features/repo-detail/explorer/ContentSearchPanel', () => ({
    ContentSearchPanel: ({ onOpenInEditor }: { onOpenInEditor: (text: string, query: string) => void }) => (
        <div data-testid="mock-content-search">
            <button data-testid="open-in-editor" onClick={() => onOpenInEditor('hit one', 'needle')}>editor</button>
        </div>
    ),
}));

import { ExplorerPanel } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/ExplorerPanel';
import { clearExplorerTreeCache } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerTreeCache';
import { clearExplorerSearchBuffers } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerStateStore';
import { isExplorerDirty, clearExplorerDirty } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerDirtyStore';
import { applyRuntimeConfigPatch } from '../../../../../src/server/spa/client/react/utils/config';
import type { TreeEntry } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/types';

const ROOT_ENTRIES: TreeEntry[] = [
    { name: 'a.ts', type: 'file', path: 'a.ts' },
    { name: 'b.ts', type: 'file', path: 'b.ts' },
    { name: 'c.ts', type: 'file', path: 'c.ts' },
];

function openTabIds(): string[] {
    return screen.queryAllByRole('tab')
        .map(node => node.getAttribute('data-tab-id'))
        .filter((id): id is string => id !== null);
}

async function renderPanel(wsId = 'ws-close') {
    render(<ExplorerPanel workspaceId={wsId} />);
    await waitFor(() => expect(screen.getByTestId('tree-node-a.ts')).toBeInTheDocument());
}

/** Open `name` as a pinned tab (double click) and make its buffer dirty. */
async function openDirty(name: string) {
    fireEvent.doubleClick(screen.getByTestId(`tree-node-${name}`));
    await waitFor(() => expect(screen.getByTestId(`make-dirty-${name}`)).toBeInTheDocument());
    fireEvent.click(screen.getByTestId(`make-dirty-${name}`));
    await waitFor(() => expect(screen.getByTestId(`explorer-tab-dirty-file:${name}`)).toBeInTheDocument());
}

async function openPinned(name: string) {
    fireEvent.doubleClick(screen.getByTestId(`tree-node-${name}`));
    await waitFor(() => expect(openTabIds()).toContain(`file:${name}`));
}

beforeEach(() => {
    localStorage.clear();
    location.hash = '';
    clearExplorerTreeCache();
    clearExplorerDirty();
    clearExplorerSearchBuffers();
    saveOutcome.clear();
    saveCalls.length = 0;
    treeSpy.mockReset();
    treeSpy.mockResolvedValue({ entries: ROOT_ENTRIES });
    applyRuntimeConfigPatch({ explorerEditorTabsEnabled: true });
});

afterEach(() => {
    cleanup();
    applyRuntimeConfigPatch({ explorerEditorTabsEnabled: false });
});

describe('ExplorerPanel — closing clean tabs', () => {
    it('closes a clean tab from the strip close button without prompting', async () => {
        await renderPanel();
        await openPinned('a.ts');
        fireEvent.click(screen.getByTestId('explorer-tab-close-file:a.ts'));
        await waitFor(() => expect(openTabIds()).toEqual([]));
        expect(screen.queryByTestId('explorer-close-tabs-prompt')).not.toBeInTheDocument();
    });

    it('closes a clean tab on middle click', async () => {
        await renderPanel();
        await openPinned('a.ts');
        const tab = screen.getByTestId('explorer-tab-file:a.ts');
        act(() => {
            tab.dispatchEvent(new MouseEvent('auxclick', { button: 1, bubbles: true }));
        });
        await waitFor(() => expect(openTabIds()).toEqual([]));
    });

    it('never prompts for a read-only tab, and never asks it to save', async () => {
        await renderPanel();
        // A search-result tab is read-only and owns no writable buffer.
        fireEvent.click(screen.getByTestId('explorer-view-search'));
        fireEvent.click(await screen.findByTestId('open-in-editor'));
        await waitFor(() => expect(openTabIds()).toContain('search:needle'));

        fireEvent.click(screen.getByTestId('explorer-tab-close-search:needle'));
        await waitFor(() => expect(openTabIds()).not.toContain('search:needle'));
        expect(screen.queryByTestId('explorer-close-tabs-prompt')).not.toBeInTheDocument();
        expect(saveCalls).toEqual([]);
    });
});

describe('ExplorerPanel — closing a dirty tab', () => {
    it('prompts, and Cancel leaves the tab set unchanged', async () => {
        await renderPanel();
        await openDirty('a.ts');
        fireEvent.click(screen.getByTestId('explorer-tab-close-file:a.ts'));
        await waitFor(() => expect(screen.getByTestId('explorer-close-tabs-prompt')).toBeInTheDocument());
        expect(screen.getByTestId('explorer-close-tabs-file')).toHaveTextContent('a.ts');

        fireEvent.click(screen.getByTestId('explorer-close-cancel-btn'));
        await waitFor(() => expect(screen.queryByTestId('explorer-close-tabs-prompt')).not.toBeInTheDocument());
        expect(openTabIds()).toEqual(['file:a.ts']);
        expect(saveCalls).toEqual([]);
        expect(isExplorerDirty('ws-close')).toBe(true);
    });

    it("Don't Save closes without writing", async () => {
        await renderPanel();
        await openDirty('a.ts');
        fireEvent.click(screen.getByTestId('explorer-tab-close-file:a.ts'));
        await waitFor(() => expect(screen.getByTestId('explorer-close-tabs-prompt')).toBeInTheDocument());

        fireEvent.click(screen.getByTestId('explorer-close-dont-save-btn'));
        await waitFor(() => expect(openTabIds()).toEqual([]));
        expect(saveCalls).toEqual([]);
        await waitFor(() => expect(isExplorerDirty('ws-close')).toBe(false));
    });

    it('Save writes the file and then closes', async () => {
        await renderPanel();
        await openDirty('a.ts');
        fireEvent.click(screen.getByTestId('explorer-tab-close-file:a.ts'));
        await waitFor(() => expect(screen.getByTestId('explorer-close-tabs-prompt')).toBeInTheDocument());

        fireEvent.click(screen.getByTestId('explorer-close-save-btn'));
        await waitFor(() => expect(openTabIds()).toEqual([]));
        expect(saveCalls).toEqual(['a.ts']);
        await waitFor(() => expect(isExplorerDirty('ws-close')).toBe(false));
    });

    it('a failed save keeps the tab open and dirty and reports the error', async () => {
        await renderPanel();
        saveOutcome.set('a.ts', false);
        await openDirty('a.ts');
        fireEvent.click(screen.getByTestId('explorer-tab-close-file:a.ts'));
        await waitFor(() => expect(screen.getByTestId('explorer-close-tabs-prompt')).toBeInTheDocument());

        fireEvent.click(screen.getByTestId('explorer-close-save-btn'));
        await waitFor(() => expect(screen.getByTestId('explorer-close-tabs-error')).toBeInTheDocument());
        expect(openTabIds()).toEqual(['file:a.ts']);
        expect(screen.getByTestId('explorer-tab-dirty-file:a.ts')).toBeInTheDocument();
        expect(isExplorerDirty('ws-close')).toBe(true);

        // Retrying from the same prompt after the write starts working closes it.
        saveOutcome.set('a.ts', true);
        fireEvent.click(screen.getByTestId('explorer-close-save-btn'));
        await waitFor(() => expect(openTabIds()).toEqual([]));
    });

    it('Ctrl+W on a dirty active tab raises the same prompt', async () => {
        await renderPanel();
        await openDirty('a.ts');
        const tab = screen.getByTestId('explorer-tab-file:a.ts');
        act(() => { tab.focus(); });
        fireEvent.keyDown(document, { key: 'w', ctrlKey: true });
        await waitFor(() => expect(screen.getByTestId('explorer-close-tabs-prompt')).toBeInTheDocument());
        expect(openTabIds()).toEqual(['file:a.ts']);
    });
});

describe('ExplorerPanel — batch closes', () => {
    it('Close All prompts once for every dirty file and Save writes them all', async () => {
        await renderPanel();
        await openDirty('a.ts');
        await openDirty('b.ts');
        await openPinned('c.ts'); // clean — no save choice for this one

        fireEvent.contextMenu(screen.getByTestId('explorer-tab-file:a.ts'));
        fireEvent.click(screen.getByTestId('explorer-tab-menu-close-all'));
        await waitFor(() => expect(screen.getByTestId('explorer-close-tabs-prompt')).toBeInTheDocument());
        expect(screen.getAllByTestId('explorer-close-tabs-file').map(n => n.textContent)).toEqual(['a.ts', 'b.ts']);

        fireEvent.click(screen.getByTestId('explorer-close-save-btn'));
        await waitFor(() => expect(openTabIds()).toEqual([]));
        expect(saveCalls).toEqual(['a.ts', 'b.ts']);
    });

    it('Close All with one failing write closes the rest and keeps the failure open', async () => {
        await renderPanel();
        saveOutcome.set('b.ts', false);
        await openDirty('a.ts');
        await openDirty('b.ts');
        await openPinned('c.ts');

        fireEvent.contextMenu(screen.getByTestId('explorer-tab-file:a.ts'));
        fireEvent.click(screen.getByTestId('explorer-tab-menu-close-all'));
        await waitFor(() => expect(screen.getByTestId('explorer-close-tabs-prompt')).toBeInTheDocument());
        fireEvent.click(screen.getByTestId('explorer-close-save-btn'));

        await waitFor(() => expect(openTabIds()).toEqual(['file:b.ts']));
        expect(screen.getByTestId('explorer-close-tabs-error')).toBeInTheDocument();
        expect(screen.getByTestId('explorer-tab-dirty-file:b.ts')).toBeInTheDocument();
        expect(isExplorerDirty('ws-close')).toBe(true);
    });

    it("Close Others prompts only for the other tabs' unsaved edits", async () => {
        await renderPanel();
        await openDirty('a.ts');
        await openPinned('b.ts');

        fireEvent.contextMenu(screen.getByTestId('explorer-tab-file:b.ts'));
        fireEvent.click(screen.getByTestId('explorer-tab-menu-close-others'));
        await waitFor(() => expect(screen.getByTestId('explorer-close-tabs-prompt')).toBeInTheDocument());
        expect(screen.getAllByTestId('explorer-close-tabs-file').map(n => n.textContent)).toEqual(['a.ts']);

        fireEvent.click(screen.getByTestId('explorer-close-dont-save-btn'));
        await waitFor(() => expect(openTabIds()).toEqual(['file:b.ts']));
        expect(saveCalls).toEqual([]);
    });

    it('Close to the Right closes clean tabs to the right immediately', async () => {
        await renderPanel();
        await openPinned('a.ts');
        await openPinned('b.ts');
        await openPinned('c.ts');

        fireEvent.contextMenu(screen.getByTestId('explorer-tab-file:a.ts'));
        fireEvent.click(screen.getByTestId('explorer-tab-menu-close-right'));
        await waitFor(() => expect(openTabIds()).toEqual(['file:a.ts']));
        expect(screen.queryByTestId('explorer-close-tabs-prompt')).not.toBeInTheDocument();
    });

    it('Close to the Right prompts when a tab to the right is dirty', async () => {
        await renderPanel();
        await openPinned('a.ts');
        await openDirty('b.ts');

        fireEvent.contextMenu(screen.getByTestId('explorer-tab-file:a.ts'));
        fireEvent.click(screen.getByTestId('explorer-tab-menu-close-right'));
        await waitFor(() => expect(screen.getByTestId('explorer-close-tabs-prompt')).toBeInTheDocument());
        expect(screen.getAllByTestId('explorer-close-tabs-file').map(n => n.textContent)).toEqual(['b.ts']);
    });
});

describe('ExplorerPanel — unload guard', () => {
    it('warns on reload while a tab is dirty and stops once it is clean', async () => {
        await renderPanel();
        await openPinned('a.ts');

        const clean = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(clean);
        expect(clean.defaultPrevented).toBe(false);

        fireEvent.click(screen.getByTestId('make-dirty-a.ts'));
        await waitFor(() => expect(screen.getByTestId('explorer-tab-dirty-file:a.ts')).toBeInTheDocument());
        const dirty = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(dirty);
        expect(dirty.defaultPrevented).toBe(true);

        fireEvent.click(screen.getByTestId('explorer-tab-close-file:a.ts'));
        await waitFor(() => expect(screen.getByTestId('explorer-close-tabs-prompt')).toBeInTheDocument());
        fireEvent.click(screen.getByTestId('explorer-close-dont-save-btn'));
        await waitFor(() => expect(openTabIds()).toEqual([]));

        const after = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(after);
        expect(after.defaultPrevented).toBe(false);
    });

    it('does not register the guard with the flag off', async () => {
        applyRuntimeConfigPatch({ explorerEditorTabsEnabled: false });
        await renderPanel('ws-flagoff');
        fireEvent.click(screen.getByTestId('tree-node-a.ts'));
        await waitFor(() => expect(screen.getByTestId('make-dirty-a.ts')).toBeInTheDocument());
        fireEvent.click(screen.getByTestId('make-dirty-a.ts'));
        await waitFor(() => expect(isExplorerDirty('ws-flagoff')).toBe(true));

        const event = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(false);
    });
});
