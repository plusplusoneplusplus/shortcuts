// @vitest-environment jsdom
/**
 * Behavioural coverage for TreeNode's lazy-load of directory children.
 *
 * The sibling TreeNode.test.ts is a source-mirror test and cannot catch a timing
 * bug, which is what the stuck spinner was: `childrenMap` lives in
 * `useSyncExternalStore`, so `onChildrenLoaded` re-renders and flushes the
 * effect cleanup in the same microtask, before the promise's `.finally` ran —
 * a tracked `loading` flag was therefore never cleared and the row span forever.
 * These tests drive the real `explorerTreeCache` store so that sync-lane path is
 * exercised end to end.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { useCallback } from 'react';

const treeSpy = vi.fn();

vi.mock('../../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerApi', () => ({
    explorerApi: {
        tree: (...args: unknown[]) => treeSpy(...args),
        searchFiles: vi.fn(),
        reveal: vi.fn(),
    },
}));

import { TreeNode } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/TreeNode';
import {
    useExplorerChildrenMap,
    clearExplorerTreeCache,
} from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerTreeCache';
import type { TreeEntry } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/types';

const WS = 'ws-1';
const DIR: TreeEntry = { name: 'refs', type: 'dir', path: '.git/refs' };
const CHILDREN: TreeEntry[] = [
    { name: 'heads', type: 'dir', path: '.git/refs/heads' },
    { name: 'HEAD', type: 'file', path: '.git/refs/HEAD' },
];

/**
 * Mounts a single expanded TreeNode wired to the real per-workspace tree cache,
 * exactly as ExplorerPanel wires it (a stable `useCallback` writer over a fresh
 * Map copy).
 */
function Harness({ expanded = true }: { expanded?: boolean }) {
    const [childrenMap, setChildrenMap] = useExplorerChildrenMap(WS);
    const onChildrenLoaded = useCallback((parentPath: string, children: TreeEntry[]) => {
        setChildrenMap(prev => new Map(prev).set(parentPath, children));
    }, [setChildrenMap]);
    return (
        <TreeNode
            entry={DIR}
            depth={0}
            workspaceId={WS}
            selectedPath={null}
            expandedPaths={expanded ? new Set([DIR.path]) : new Set()}
            childrenMap={childrenMap}
            onToggle={() => {}}
            onSelect={() => {}}
            onChildrenLoaded={onChildrenLoaded}
        />
    );
}

const spinners = () => screen.queryAllByLabelText('Loading');
const errorAffordance = () => screen.queryByTestId(`tree-node-error-${DIR.path}`);

beforeEach(() => {
    cleanup();
    clearExplorerTreeCache();
    treeSpy.mockReset();
});

describe('TreeNode — lazy-loading a directory', () => {
    it('clears the spinner once children load and renders them', async () => {
        treeSpy.mockResolvedValue({ entries: CHILDREN });

        render(<Harness />);
        // Spinner is showing while the listing is in flight.
        expect(spinners()).toHaveLength(1);

        await waitFor(() => expect(screen.getByTestId('tree-node-.git/refs/heads')).toBeInTheDocument());
        expect(screen.getByTestId('tree-node-.git/refs/HEAD')).toBeInTheDocument();
        // Regression: the row's spinner must be gone, not merely overlapped by children.
        expect(spinners()).toHaveLength(0);
        expect(errorAffordance()).not.toBeInTheDocument();
    });

    it('fetches the directory listing exactly once', async () => {
        treeSpy.mockResolvedValue({ entries: CHILDREN });

        render(<Harness />);
        await waitFor(() => expect(screen.getByTestId('tree-node-.git/refs/heads')).toBeInTheDocument());

        expect(treeSpy).toHaveBeenCalledTimes(1);
        expect(treeSpy).toHaveBeenCalledWith(WS, { path: DIR.path });
    });

    it('does not fetch for a collapsed directory', () => {
        treeSpy.mockResolvedValue({ entries: CHILDREN });
        render(<Harness expanded={false} />);
        expect(treeSpy).not.toHaveBeenCalled();
        expect(spinners()).toHaveLength(0);
    });

    it('shows an error affordance instead of a spinner when the listing fails', async () => {
        treeSpy.mockRejectedValue(new Error('permission denied'));

        render(<Harness />);

        await waitFor(() => expect(errorAffordance()).toBeInTheDocument());
        expect(spinners()).toHaveLength(0);
        expect(errorAffordance()).toHaveAttribute('title', expect.stringContaining('permission denied'));
        // No retry storm: the failed state is terminal until the user acts.
        expect(treeSpy).toHaveBeenCalledTimes(1);
    });

    it('retries the fetch when the error affordance is clicked', async () => {
        treeSpy.mockRejectedValueOnce(new Error('permission denied'));
        treeSpy.mockResolvedValue({ entries: CHILDREN });

        render(<Harness />);
        await waitFor(() => expect(errorAffordance()).toBeInTheDocument());

        fireEvent.click(errorAffordance()!);

        await waitFor(() => expect(screen.getByTestId('tree-node-.git/refs/heads')).toBeInTheDocument());
        expect(errorAffordance()).not.toBeInTheDocument();
        expect(spinners()).toHaveLength(0);
        expect(treeSpy).toHaveBeenCalledTimes(2);
    });

    it('clears a stale error when the directory is collapsed', async () => {
        treeSpy.mockRejectedValue(new Error('permission denied'));

        const view = render(<Harness />);
        await waitFor(() => expect(errorAffordance()).toBeInTheDocument());

        view.rerender(<Harness expanded={false} />);
        await waitFor(() => expect(errorAffordance()).not.toBeInTheDocument());
    });
});
