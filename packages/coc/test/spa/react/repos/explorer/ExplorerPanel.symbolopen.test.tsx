// @vitest-environment jsdom
/**
 * Go To All (Ctrl+,) from the Explorer sub-tab — `mode="editor"`, the surface
 * that owns the shortcut whenever no right panel has focus.
 *
 * The palette is real here (only its symbol source is faked), so this covers
 * the whole click → `onSymbolSelect` → tab-open path and pins what the buffer
 * is finally asked to show: the symbol's path, line and column.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';

const symbolsState = {
    results: [{
        name: 'CanvasHeader',
        containerName: 'demo',
        kind: 5,
        path: 'src/render/canvas.cpp',
        line: 42,
        col: 8,
        definitionId: 'coc-symbols',
        indices: [0, 1, 2],
    }] as unknown[],
    loading: false,
    streaming: false,
    status: null as string | null,
    indexing: false,
    unavailable: null as { detail: string; recoveryCommand?: string } | null,
};

vi.mock('../../../../../src/server/spa/client/react/features/language-servers/useWorkspaceSymbols', () => ({
    useWorkspaceSymbols: () => symbolsState,
}));
vi.mock('../../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerApi', () => ({
    explorerApi: {
        tree: async () => ({ entries: [{ name: 'src', type: 'dir', path: 'src' }] }),
        searchFiles: async () => ({ results: [] }),
        reveal: async () => ({ entries: [] }),
        readBlob: async () => ({ content: 'x\n', encoding: 'utf-8', mimeType: 'text/plain' }),
    },
}));
// The buffer is stubbed to the navigation props it is handed: what this case
// proves is that the pick reaches a pane pointed at the symbol.
vi.mock('../../../../../src/server/spa/client/react/features/repo-detail/explorer/PreviewPane', () => ({
    PreviewPane: ({ filePath, revealLine, revealColumn }: {
        filePath: string; revealLine?: number; revealColumn?: number;
    }) => (
        <div
            data-testid="preview-pane"
            data-path={filePath}
            data-line={revealLine ?? ''}
            data-column={revealColumn ?? ''}
        />
    ),
}));
vi.mock('../../../../../src/server/spa/client/react/repos/repoGroupService', () => ({
    searchRepoGroupFiles: vi.fn(async () => ({ results: [], status: 'complete' })),
    getRepoGroup: vi.fn(async () => ({ members: [] })),
}));

import { ExplorerPanel } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/ExplorerPanel';
import { clearExplorerQuickOpenRegistry } from '../../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/quickOpenRouting';

const WS = 'ws-cpp';

beforeEach(() => {
    localStorage.clear();
    clearExplorerQuickOpenRegistry();
});
afterEach(() => {
    cleanup();
    clearExplorerQuickOpenRegistry();
});

/** Ctrl+, — Go To All, dispatched from inside the Explorer that owns it. */
function pressGoto(target: Element) {
    const event = new KeyboardEvent('keydown', { key: ',', ctrlKey: true, bubbles: true, cancelable: true });
    act(() => { target.dispatchEvent(event); });
}

describe('Explorer sub-tab Go To All', () => {
    it('opens the picked symbol in the preview pane at its line and column', async () => {
        const { container } = render(<ExplorerPanel workspaceId={WS} mode="editor" />);
        const root = (container.querySelector('[data-testid="explorer-sidebar"]')?.parentElement
            ?? container) as HTMLElement;
        root.tabIndex = -1;
        root.focus();
        pressGoto(root);

        await waitFor(() => screen.getByTestId('quick-open-input'));
        fireEvent.change(screen.getByTestId('quick-open-input'), { target: { value: 'CanvasHeader' } });
        expect(screen.getByTestId('quick-open-item-0').textContent).toContain('CanvasHeader');

        await act(async () => { fireEvent.click(screen.getByTestId('quick-open-item-0')); });

        await waitFor(() => {
            const pane = screen.getByTestId('preview-pane');
            expect(pane.dataset.path).toBe('src/render/canvas.cpp');
            expect(pane.dataset.line).toBe('42');
            expect(pane.dataset.column).toBe('8');
        });
        expect(screen.queryByTestId('quick-open-input')).toBeNull();
    });
});
