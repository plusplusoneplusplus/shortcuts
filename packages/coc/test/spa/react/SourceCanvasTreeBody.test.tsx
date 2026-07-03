/**
 * Tests for SourceCanvasTreeBody — the read-only expandable file-tree body of
 * the docked source canvas. Covers the root loading / empty / success / error /
 * truncated states (which reuse the flat listing's data-testids) and tree
 * mechanics: folders expand/collapse in place via the chevron (tree.toggle),
 * files open through onNavigate as `kind: 'code'`, and expanded folders render
 * their cached children, a per-folder spinner while loading, and an inline
 * per-folder error.
 */
/* @vitest-environment jsdom */

import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';

import { SourceCanvasTreeBody } from '../../../src/server/spa/client/react/features/chat/source-canvas/SourceCanvasTreeBody';
import type { SourceCanvasTreeState } from '../../../src/server/spa/client/react/features/chat/source-canvas/useSourceCanvasTree';

const ROOT_ENTRIES = [
    { name: 'sub', type: 'dir' as const, path: 'src/sub' },
    { name: 'a.ts', type: 'file' as const, path: 'src/a.ts', size: 12 },
];

function treeState(over: Partial<SourceCanvasTreeState> = {}): SourceCanvasTreeState {
    return {
        status: 'success',
        rootEntries: ROOT_ENTRIES,
        resolvedPath: '/home/u/proj/src',
        relativePath: 'src',
        wsId: 'ws1',
        truncated: false,
        error: '',
        childrenMap: new Map(),
        expanded: new Set(),
        loadingPaths: new Set(),
        errorPaths: new Map(),
        toggle: vi.fn(),
        ...over,
    };
}

describe('SourceCanvasTreeBody', () => {
    it('renders a spinner in the loading state', () => {
        const { getByTestId, queryByTestId } = render(
            <SourceCanvasTreeBody
                tree={treeState({ status: 'loading', rootEntries: [] })}
                folderName="src"
                onNavigate={() => {}}
            />,
        );
        expect(getByTestId('source-canvas-dir-loading').textContent).toContain('Loading src');
        expect(queryByTestId('source-canvas-dir-listing')).toBeNull();
    });

    it('lists the root entries in API order on success', () => {
        const { getAllByTestId, queryByTestId } = render(
            <SourceCanvasTreeBody tree={treeState()} folderName="src" onNavigate={() => {}} />,
        );
        const rows = getAllByTestId('source-canvas-tree-node');
        expect(rows).toHaveLength(2);
        expect(rows[0].getAttribute('data-entry-path')).toBe('src/sub');
        expect(rows[0].getAttribute('data-entry-type')).toBe('dir');
        expect(rows[1].getAttribute('data-entry-path')).toBe('src/a.ts');
        expect(rows[1].getAttribute('data-entry-type')).toBe('file');
        expect(queryByTestId('source-canvas-dir-truncated')).toBeNull();
    });

    it('shows the empty state for a root folder with no entries', () => {
        const { getByTestId, queryByTestId } = render(
            <SourceCanvasTreeBody
                tree={treeState({ rootEntries: [] })}
                folderName="empty"
                onNavigate={() => {}}
            />,
        );
        expect(getByTestId('source-canvas-dir-empty')).toBeTruthy();
        expect(queryByTestId('source-canvas-tree-node')).toBeNull();
    });

    it('renders the error state with the resolved path and reason', () => {
        const { getByTestId } = render(
            <SourceCanvasTreeBody
                tree={treeState({
                    status: 'error',
                    rootEntries: [],
                    resolvedPath: '/home/u/proj/missing',
                    error: 'Not a directory',
                })}
                folderName="missing"
                onNavigate={() => {}}
            />,
        );
        expect(getByTestId('source-canvas-dir-error-msg').textContent).toBe(
            "Couldn't load /home/u/proj/missing",
        );
        expect(getByTestId('source-canvas-dir-error').textContent).toContain('Not a directory');
    });

    it('surfaces a truncated indicator when the root listing was capped', () => {
        const { getByTestId } = render(
            <SourceCanvasTreeBody
                tree={treeState({ truncated: true })}
                folderName="src"
                onNavigate={() => {}}
            />,
        );
        expect(getByTestId('source-canvas-dir-truncated')).toBeTruthy();
    });

    it('toggles a folder in place (not via onNavigate) when its chevron row is clicked', () => {
        const toggle = vi.fn();
        const onNavigate = vi.fn();
        const { getAllByTestId } = render(
            <SourceCanvasTreeBody tree={treeState({ toggle })} folderName="src" onNavigate={onNavigate} />,
        );
        fireEvent.click(getAllByTestId('source-canvas-tree-node')[0]);
        expect(toggle).toHaveBeenCalledWith('src/sub');
        expect(onNavigate).not.toHaveBeenCalled();
    });

    it('opens a file entry as kind: code carrying the tree workspace id', () => {
        const onNavigate = vi.fn();
        const { getAllByTestId } = render(
            <SourceCanvasTreeBody tree={treeState()} folderName="src" onNavigate={onNavigate} />,
        );
        fireEvent.click(getAllByTestId('source-canvas-tree-node')[1]);
        expect(onNavigate).toHaveBeenCalledWith(
            expect.objectContaining({ fullPath: 'src/a.ts', wsId: 'ws1', kind: 'code' }),
        );
    });

    it('renders an expanded folder\'s cached children indented below it', () => {
        const childrenMap = new Map([
            ['src/sub', [{ name: 'deep.ts', type: 'file' as const, path: 'src/sub/deep.ts' }]],
        ]);
        const { getAllByTestId } = render(
            <SourceCanvasTreeBody
                tree={treeState({ expanded: new Set(['src/sub']), childrenMap })}
                folderName="src"
                onNavigate={() => {}}
            />,
        );
        const rows = getAllByTestId('source-canvas-tree-node');
        // root: sub, sub's child deep.ts, then root file a.ts
        expect(rows.map((r) => r.getAttribute('data-entry-path'))).toEqual([
            'src/sub',
            'src/sub/deep.ts',
            'src/a.ts',
        ]);
        // The expanded folder marks aria-expanded.
        expect(rows[0].getAttribute('aria-expanded')).toBe('true');
    });

    it('shows a per-folder spinner while an expanded folder is loading', () => {
        const { getAllByTestId } = render(
            <SourceCanvasTreeBody
                tree={treeState({
                    expanded: new Set(['src/sub']),
                    loadingPaths: new Set(['src/sub']),
                })}
                folderName="src"
                onNavigate={() => {}}
            />,
        );
        // The subfolder row (first node) contains the inline spinner.
        const subRow = getAllByTestId('source-canvas-tree-node')[0];
        expect(subRow.querySelector('.animate-spin')).toBeTruthy();
    });

    it('renders an inline per-folder error for a failed expansion', () => {
        const { getByTestId } = render(
            <SourceCanvasTreeBody
                tree={treeState({
                    expanded: new Set(['src/sub']),
                    errorPaths: new Map([['src/sub', 'Permission denied']]),
                })}
                folderName="src"
                onNavigate={() => {}}
            />,
        );
        expect(getByTestId('source-canvas-tree-node-error').textContent).toContain('Permission denied');
    });

    it('shows an empty marker for an expanded folder with no children', () => {
        const childrenMap = new Map([['src/sub', []]]);
        const { getByTestId } = render(
            <SourceCanvasTreeBody
                tree={treeState({ expanded: new Set(['src/sub']), childrenMap })}
                folderName="src"
                onNavigate={() => {}}
            />,
        );
        expect(getByTestId('source-canvas-tree-node-empty')).toBeTruthy();
    });
});
