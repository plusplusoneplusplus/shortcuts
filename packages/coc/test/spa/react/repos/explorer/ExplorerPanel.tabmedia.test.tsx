// @vitest-environment jsdom
/**
 * AC-05: image and binary buffers inside the tab strip.
 *
 * A file the Explorer cannot render as text still gets a tab like any other —
 * it opens, activates, sits beside other buffers and closes — but it is never
 * editable, so it can never go dirty, never raise the save prompt and never
 * issue a write.
 *
 * Unlike the other tab tests this one keeps the REAL PreviewPane (only Monaco is
 * stubbed), because what is being pinned here is which of PreviewPane's three
 * bodies a tab shows for a given blob.
 */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within, fireEvent, cleanup } from '@testing-library/react';

const treeSpy = vi.fn();
const readBlobSpy = vi.fn();
const writeBlobSpy = vi.fn();

vi.mock('../../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerApi', () => ({
    explorerApi: {
        tree: (...args: unknown[]) => treeSpy(...args),
        readBlob: (...args: unknown[]) => readBlobSpy(...args),
        writeBlob: (...args: unknown[]) => writeBlobSpy(...args),
        readTrustedBlob: vi.fn(),
        searchFiles: vi.fn().mockResolvedValue({ results: [] }),
        reveal: vi.fn(),
    },
}));

vi.mock('../../../../../src/server/spa/client/react/features/repo-detail/explorer/MonacoFileEditor', () => ({
    MonacoFileEditor: ({ value, onChange, readOnly }: {
        value: string;
        onChange: (next: string) => void;
        readOnly?: boolean;
    }) => (
        <div data-testid="mock-monaco-editor" data-read-only={String(!!readOnly)}>
            <textarea data-testid="mock-monaco-textarea" value={value} onChange={e => onChange(e.target.value)} />
        </div>
    ),
    getMonacoLanguage: () => 'typescript',
}));

vi.mock('../../../../../src/server/spa/client/react/features/repo-detail/explorer/ContentSearchPanel', () => ({
    ContentSearchPanel: () => <div data-testid="mock-content-search" />,
}));

import { ExplorerPanel } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/ExplorerPanel';
import { clearExplorerTreeCache } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerTreeCache';
import { clearExplorerSearchBuffers } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerStateStore';
import { clearExplorerDirty } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerDirtyStore';
import { applyRuntimeConfigPatch } from '../../../../../src/server/spa/client/react/utils/config';
import type { TreeEntry } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/types';

const ROOT_ENTRIES: TreeEntry[] = [
    { name: 'a.ts', type: 'file', path: 'a.ts' },
    { name: 'logo.png', type: 'file', path: 'logo.png' },
    { name: 'app.bin', type: 'file', path: 'app.bin' },
];

/** A 1×1 transparent GIF, small enough to inline. */
const IMAGE_BASE64 = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const BINARY_BASE64 = 'AAECAwQFBgcICQ==';

function blobFor(path: string) {
    if (path === 'logo.png') return { content: IMAGE_BASE64, encoding: 'base64', mimeType: 'image/gif' };
    if (path === 'app.bin') return { content: BINARY_BASE64, encoding: 'base64', mimeType: 'application/octet-stream' };
    return { content: 'const x = 1;\n', encoding: 'utf-8', mimeType: 'text/plain' };
}

function openTabIds(): string[] {
    return screen.queryAllByRole('tab')
        .map(node => node.getAttribute('data-tab-id'))
        .filter((id): id is string => id !== null);
}

/** The buffer mounted behind a tab, whether or not that tab is the active one. */
function panelFor(tabId: string): HTMLElement {
    return screen.getByTestId(`explorer-tab-panel-${tabId}`);
}

async function renderPanel(wsId = 'ws-media') {
    render(<ExplorerPanel workspaceId={wsId} />);
    await waitFor(() => expect(screen.getByTestId('tree-node-a.ts')).toBeInTheDocument());
}

/** Pin a file as its own tab and wait for its buffer to finish loading. */
async function openPinned(path: string, ready: string) {
    fireEvent.doubleClick(screen.getByTestId(`tree-node-${path}`));
    await waitFor(() => expect(within(panelFor(`file:${path}`)).getByTestId(ready)).toBeInTheDocument());
}

beforeEach(() => {
    localStorage.clear();
    location.hash = '';
    clearExplorerTreeCache();
    clearExplorerDirty();
    clearExplorerSearchBuffers();
    treeSpy.mockReset();
    treeSpy.mockResolvedValue({ entries: ROOT_ENTRIES });
    readBlobSpy.mockReset();
    readBlobSpy.mockImplementation((_ws: string, path: string) => Promise.resolve(blobFor(path)));
    writeBlobSpy.mockReset();
    writeBlobSpy.mockResolvedValue({ success: true });
    applyRuntimeConfigPatch({ explorerEditorTabsEnabled: true });
});

afterEach(() => {
    cleanup();
    applyRuntimeConfigPatch({ explorerEditorTabsEnabled: false });
});

describe('ExplorerPanel — image and binary tabs', () => {
    it('opens an image file as a tab whose buffer shows the image preview', async () => {
        await renderPanel();
        await openPinned('logo.png', 'preview-image');

        expect(openTabIds()).toEqual(['file:logo.png']);
        expect(screen.getByTestId('explorer-tab-file:logo.png')).toHaveAttribute('aria-selected', 'true');
        const img = within(panelFor('file:logo.png')).getByRole('img');
        expect(img).toHaveAttribute('src', `data:image/gif;base64,${IMAGE_BASE64}`);
        // Not text, so there is no editor and nothing to save.
        expect(within(panelFor('file:logo.png')).queryByTestId('mock-monaco-editor')).toBeNull();
        expect(within(panelFor('file:logo.png')).queryByTestId('save-btn')).toBeNull();
    });

    it('opens a binary file as a tab whose buffer shows the binary placeholder', async () => {
        await renderPanel();
        await openPinned('app.bin', 'preview-binary');

        expect(openTabIds()).toEqual(['file:app.bin']);
        expect(within(panelFor('file:app.bin')).getByTestId('preview-binary')).toHaveTextContent('Binary file');
        expect(within(panelFor('file:app.bin')).queryByTestId('mock-monaco-editor')).toBeNull();
    });

    it('activates an image or binary tab beside text tabs without touching a dirty buffer', async () => {
        await renderPanel();
        await openPinned('a.ts', 'mock-monaco-editor');
        fireEvent.change(within(panelFor('file:a.ts')).getByTestId('mock-monaco-textarea'), {
            target: { value: 'const x = 2;\n' },
        });
        await waitFor(() => expect(screen.getByTestId('explorer-tab-file:a.ts')).toHaveAttribute('data-dirty', 'true'));

        await openPinned('logo.png', 'preview-image');
        await openPinned('app.bin', 'preview-binary');
        expect(openTabIds()).toEqual(['file:a.ts', 'file:logo.png', 'file:app.bin']);

        // Switching between them hides and shows buffers; it never unmounts the
        // edited one or loses its edit.
        fireEvent.click(screen.getByTestId('explorer-tab-file:logo.png'));
        await waitFor(() => expect(panelFor('file:logo.png')).not.toHaveStyle({ display: 'none' }));
        expect(panelFor('file:a.ts')).toHaveStyle({ display: 'none' });
        expect(screen.getByTestId('explorer-tab-file:a.ts')).toHaveAttribute('data-dirty', 'true');
        expect(within(panelFor('file:a.ts')).getByTestId('mock-monaco-textarea')).toHaveValue('const x = 2;\n');

        fireEvent.click(screen.getByTestId('explorer-tab-file:a.ts'));
        await waitFor(() => expect(panelFor('file:a.ts')).not.toHaveStyle({ display: 'none' }));
        expect(within(panelFor('file:a.ts')).getByTestId('mock-monaco-textarea')).toHaveValue('const x = 2;\n');
        // Neither media tab can be dirty, so nothing has been written.
        expect(writeBlobSpy).not.toHaveBeenCalled();
    });

    it('closes an image or binary tab with no save prompt and no write', async () => {
        await renderPanel();
        await openPinned('a.ts', 'mock-monaco-editor');
        fireEvent.change(within(panelFor('file:a.ts')).getByTestId('mock-monaco-textarea'), {
            target: { value: 'edited\n' },
        });
        await waitFor(() => expect(screen.getByTestId('explorer-tab-file:a.ts')).toHaveAttribute('data-dirty', 'true'));
        await openPinned('logo.png', 'preview-image');
        await openPinned('app.bin', 'preview-binary');

        fireEvent.click(screen.getByTestId('explorer-tab-close-file:logo.png'));
        await waitFor(() => expect(openTabIds()).toEqual(['file:a.ts', 'file:app.bin']));
        expect(screen.queryByTestId('explorer-close-tabs-prompt')).toBeNull();

        fireEvent.click(screen.getByTestId('explorer-tab-close-file:app.bin'));
        await waitFor(() => expect(openTabIds()).toEqual(['file:a.ts']));
        expect(screen.queryByTestId('explorer-close-tabs-prompt')).toBeNull();
        expect(writeBlobSpy).not.toHaveBeenCalled();

        // The dirty text tab is untouched by either close and still guards itself.
        expect(screen.getByTestId('explorer-tab-file:a.ts')).toHaveAttribute('data-dirty', 'true');
        fireEvent.click(screen.getByTestId('explorer-tab-close-file:a.ts'));
        await waitFor(() => expect(screen.getByTestId('explorer-close-tabs-prompt')).toBeInTheDocument());
    });
});
