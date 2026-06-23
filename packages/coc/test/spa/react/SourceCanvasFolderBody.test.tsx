/**
 * Tests for SourceCanvasFolderBody — the read-only folder-explorer body of the
 * docked source canvas (AC-01 + AC-02). Covers the loading / empty / success /
 * error / truncated states and in-place navigation: clicking a subfolder
 * re-opens it as `kind: 'dir'`; clicking a file opens the read-only code viewer
 * (`kind: 'code'`). Entries carry the listing's workspace id so navigation
 * resolves through the same chosen workspace.
 */
/* @vitest-environment jsdom */

import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';

import { SourceCanvasFolderBody } from '../../../src/server/spa/client/react/features/chat/source-canvas/SourceCanvasFolderBody';
import type { SourceCanvasDirectoryState } from '../../../src/server/spa/client/react/features/chat/source-canvas/useSourceCanvasDirectory';

const ENTRIES = [
    { name: 'sub', type: 'dir' as const, path: 'src/sub' },
    { name: 'a.ts', type: 'file' as const, path: 'src/a.ts', size: 12 },
];

function successState(over: Partial<SourceCanvasDirectoryState> = {}): SourceCanvasDirectoryState {
    return {
        status: 'success',
        entries: ENTRIES,
        resolvedPath: '/home/u/proj/src',
        relativePath: 'src',
        wsId: 'ws1',
        truncated: false,
        error: '',
        ...over,
    };
}

describe('SourceCanvasFolderBody', () => {
    it('renders a spinner in the loading state', () => {
        const { getByTestId, queryByTestId } = render(
            <SourceCanvasFolderBody
                dir={{ status: 'loading', entries: [], resolvedPath: '', relativePath: '', wsId: '', truncated: false, error: '' }}
                folderName="src"
                onNavigate={() => {}}
            />,
        );
        expect(getByTestId('source-canvas-dir-loading').textContent).toContain('Loading src');
        expect(queryByTestId('source-canvas-dir-listing')).toBeNull();
    });

    it('lists entries in API order on success', () => {
        const { getAllByTestId, queryByTestId } = render(
            <SourceCanvasFolderBody dir={successState()} folderName="src" onNavigate={() => {}} />,
        );
        const rows = getAllByTestId('source-canvas-dir-entry');
        expect(rows).toHaveLength(2);
        expect(rows[0].getAttribute('data-entry-path')).toBe('src/sub');
        expect(rows[0].getAttribute('data-entry-type')).toBe('dir');
        expect(rows[1].getAttribute('data-entry-path')).toBe('src/a.ts');
        expect(rows[1].getAttribute('data-entry-type')).toBe('file');
        expect(queryByTestId('source-canvas-dir-truncated')).toBeNull();
    });

    it('shows the empty state for a folder with no entries', () => {
        const { getByTestId, queryByTestId } = render(
            <SourceCanvasFolderBody
                dir={successState({ entries: [] })}
                folderName="empty"
                onNavigate={() => {}}
            />,
        );
        expect(getByTestId('source-canvas-dir-empty')).toBeTruthy();
        expect(queryByTestId('source-canvas-dir-entry')).toBeNull();
    });

    it('renders the error state with the resolved path and reason', () => {
        const { getByTestId } = render(
            <SourceCanvasFolderBody
                dir={{ status: 'error', entries: [], resolvedPath: '/home/u/proj/missing', relativePath: 'missing', wsId: 'ws1', truncated: false, error: 'Not a directory' }}
                folderName="missing"
                onNavigate={() => {}}
            />,
        );
        expect(getByTestId('source-canvas-dir-error-msg').textContent).toBe(
            "Couldn't load /home/u/proj/missing",
        );
        expect(getByTestId('source-canvas-dir-error').textContent).toContain('Not a directory');
    });

    it('surfaces a truncated indicator when the listing was capped', () => {
        const { getByTestId } = render(
            <SourceCanvasFolderBody
                dir={successState({ truncated: true })}
                folderName="src"
                onNavigate={() => {}}
            />,
        );
        expect(getByTestId('source-canvas-dir-truncated')).toBeTruthy();
    });

    it('navigates into a subfolder as kind: dir, carrying the listing workspace id', () => {
        const onNavigate = vi.fn();
        const { getAllByTestId } = render(
            <SourceCanvasFolderBody dir={successState()} folderName="src" onNavigate={onNavigate} />,
        );
        fireEvent.click(getAllByTestId('source-canvas-dir-entry')[0]);
        expect(onNavigate).toHaveBeenCalledWith(
            expect.objectContaining({ fullPath: 'src/sub', wsId: 'ws1', kind: 'dir' }),
        );
    });

    it('opens a file entry as kind: code in the same panel', () => {
        const onNavigate = vi.fn();
        const { getAllByTestId } = render(
            <SourceCanvasFolderBody dir={successState()} folderName="src" onNavigate={onNavigate} />,
        );
        fireEvent.click(getAllByTestId('source-canvas-dir-entry')[1]);
        expect(onNavigate).toHaveBeenCalledWith(
            expect.objectContaining({ fullPath: 'src/a.ts', wsId: 'ws1', kind: 'code' }),
        );
    });
});
