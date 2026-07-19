// @vitest-environment jsdom
/**
 * AC-03 of preserve-explorer-state (wiring): ExplorerPanel forwards its preview
 * editor's dirtiness into the per-workspace dirty store, keyed per workspace, and
 * clears it when the panel unmounts (i.e. after a workspace switch discards it).
 *
 * PreviewPane is mocked to a stub exposing buttons that drive `onDirtyChange`, so
 * the test never pulls Monaco into the graph and can toggle dirtiness directly.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const treeSpy = vi.fn();
const searchSpy = vi.fn();

vi.mock('../../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerApi', () => ({
    explorerApi: {
        tree: (...args: unknown[]) => treeSpy(...args),
        searchFiles: (...args: unknown[]) => searchSpy(...args),
        reveal: vi.fn(),
    },
}));

vi.mock('../../../../../src/server/spa/client/react/features/repo-detail/explorer/PreviewPane', () => ({
    PreviewPane: ({ onDirtyChange }: { onDirtyChange?: (d: boolean) => void }) => (
        <div data-testid="mock-preview">
            <button data-testid="make-dirty" onClick={() => onDirtyChange?.(true)}>dirty</button>
            <button data-testid="make-clean" onClick={() => onDirtyChange?.(false)}>clean</button>
        </div>
    ),
}));

import { ExplorerPanel } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/ExplorerPanel';
import { clearExplorerTreeCache } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerTreeCache';
import { explorerPreviewStorageKey } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerStateStore';
import { isExplorerDirty, clearExplorerDirty } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerDirtyStore';
import type { TreeEntry } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/types';

const ROOT_ENTRIES: TreeEntry[] = [
    { name: 'a.ts', type: 'file', path: 'a.ts' },
];

/** Open a preview file for a workspace so ExplorerPanel renders PreviewPane. */
function seedOpenFile(wsId: string) {
    localStorage.setItem(explorerPreviewStorageKey(wsId), JSON.stringify({ path: 'a.ts', name: 'a.ts' }));
}

beforeEach(() => {
    localStorage.clear();
    clearExplorerTreeCache();
    clearExplorerDirty();
    treeSpy.mockReset();
    treeSpy.mockResolvedValue({ entries: ROOT_ENTRIES });
    searchSpy.mockReset();
    searchSpy.mockResolvedValue({ results: [] });
});

describe('ExplorerPanel — dirty reporting into the switch-guard store (AC-03)', () => {
    it('marks the workspace dirty when the preview reports unsaved edits, and clean again', async () => {
        seedOpenFile('ws-1');
        render(<ExplorerPanel workspaceId="ws-1" />);
        await waitFor(() => expect(screen.getByTestId('mock-preview')).toBeInTheDocument());
        expect(isExplorerDirty('ws-1')).toBe(false);

        fireEvent.click(screen.getByTestId('make-dirty'));
        expect(isExplorerDirty('ws-1')).toBe(true);

        fireEvent.click(screen.getByTestId('make-clean'));
        expect(isExplorerDirty('ws-1')).toBe(false);
    });

    it('tracks dirtiness per workspace', async () => {
        seedOpenFile('ws-1');
        render(<ExplorerPanel workspaceId="ws-1" />);
        await waitFor(() => expect(screen.getByTestId('mock-preview')).toBeInTheDocument());

        fireEvent.click(screen.getByTestId('make-dirty'));
        expect(isExplorerDirty('ws-1')).toBe(true);
        expect(isExplorerDirty('ws-2')).toBe(false);
    });

    it('clears the workspace dirty flag when the panel unmounts (switch discards the buffer)', async () => {
        seedOpenFile('ws-1');
        const view = render(<ExplorerPanel workspaceId="ws-1" />);
        await waitFor(() => expect(screen.getByTestId('mock-preview')).toBeInTheDocument());

        fireEvent.click(screen.getByTestId('make-dirty'));
        expect(isExplorerDirty('ws-1')).toBe(true);

        // A confirmed workspace switch unmounts the `key={ws.id}` panel entirely.
        view.unmount();
        expect(isExplorerDirty('ws-1')).toBe(false);
    });
});
