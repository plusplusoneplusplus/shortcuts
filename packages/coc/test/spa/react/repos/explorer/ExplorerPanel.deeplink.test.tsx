// @vitest-environment jsdom
/**
 * The `deepLink` prop decides whether a panel mount owns the global
 * `#repos/:id/explorer/:path` route. The Explorer sub-tab (default `true`) writes
 * it so a selection is shareable and survives a reload; a mount pointed at a
 * workspace the app is not showing — a repo group's dock, aimed at a MEMBER repo
 * — passes `false`, because that hash reads as "select that member repo" and
 * would navigate the user out of the group on every file click.
 *
 * PreviewPane is stubbed so opening a file never pulls Monaco into the graph.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { readFileSync } from 'fs';
import { join } from 'path';

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
    PreviewPane: () => null,
}));

import { ExplorerPanel } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/ExplorerPanel';
import { clearExplorerTreeCache } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerTreeCache';
import type { TreeEntry } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/types';

const ROOT_ENTRIES: TreeEntry[] = [
    { name: 'src', type: 'dir', path: 'src', children: [{ name: 'app.ts', type: 'file', path: 'src/app.ts' }] },
    { name: 'READ ME.md', type: 'file', path: 'READ ME.md' },
];

beforeEach(() => {
    localStorage.clear();
    clearExplorerTreeCache();
    location.hash = '';
    treeSpy.mockReset();
    treeSpy.mockResolvedValue({ entries: ROOT_ENTRIES });
    searchSpy.mockReset();
    searchSpy.mockResolvedValue({ results: [] });
});

async function renderPanel(props: { workspaceId: string; deepLink?: boolean }) {
    render(<ExplorerPanel {...props} />);
    await waitFor(() => expect(screen.getByTestId('explorer-panel')).toBeInTheDocument());
}

function clickFile(path: string) {
    act(() => {
        fireEvent.click(screen.getByTestId(`tree-node-${path}`));
    });
}

describe('ExplorerPanel deep-link ownership', () => {
    it('writes the explorer route hash on selection by default', async () => {
        await renderPanel({ workspaceId: 'repo-alpha' });

        clickFile('READ ME.md');

        expect(location.hash).toBe('#repos/repo-alpha/explorer/READ%20ME.md');
        expect(screen.getByTestId('breadcrumb-segment-0').textContent).toBe('READ ME.md');
    });

    it('writes the hash when deepLink is explicitly true', async () => {
        await renderPanel({ workspaceId: 'repo-alpha', deepLink: true });

        clickFile('src');

        expect(location.hash).toBe('#repos/repo-alpha/explorer/src');
    });

    it('leaves the hash untouched when deepLink is false', async () => {
        location.hash = '#repos/group-ai/chats';
        await renderPanel({ workspaceId: 'repo-alpha', deepLink: false });

        clickFile('READ ME.md');

        // The app stays where it was — no navigation out of the enclosing scope.
        expect(location.hash).toBe('#repos/group-ai/chats');
    });

    it('still selects the file locally when deepLink is false', async () => {
        await renderPanel({ workspaceId: 'repo-alpha', deepLink: false });

        clickFile('READ ME.md');

        expect(screen.getByTestId('breadcrumb-segment-0').textContent).toBe('READ ME.md');
        expect(location.hash).toBe('');
    });

    // The Quick Open (Ctrl+P) handler writes the same hash on its own path, so it
    // has to be guarded too — asserted against the source because driving Quick
    // Open's debounced search adds nothing to what the tree click already proves.
    it('guards every hash write behind the deepLink flag', () => {
        const source = readFileSync(
            join(
                __dirname,
                '../../../../../src/server/spa/client/react/features/repo-detail/explorer/ExplorerPanel.tsx',
            ),
            'utf-8',
        );
        const writes = source.split('\n').filter(line => line.includes('location.hash = '));
        expect(writes).toHaveLength(2);
        for (const write of writes) {
            const idx = source.indexOf(write);
            expect(source.slice(0, idx)).toMatch(/if \(deepLink\) \{\s*$/);
        }
    });
});
