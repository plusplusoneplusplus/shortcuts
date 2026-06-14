/**
 * Tests for useSourceCanvasContent — the loading/success/error state machine
 * for the docked source canvas body (AC-06). Mocks the app workspaces and the
 * preview API to cover: loading→success (content + lines fallback + language),
 * fetch failure → error, no-workspace → error without fetching, null ref, and
 * that the resolved path is passed to the preview API.
 */
/* @vitest-environment jsdom */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const { previewMock, workspacesRef } = vi.hoisted(() => ({
    previewMock: vi.fn(),
    workspacesRef: { current: [] as Array<{ id: string; rootPath?: string }> },
}));

vi.mock('../../../src/server/spa/client/react/contexts/AppContext', () => ({
    useApp: () => ({ state: { workspaces: workspacesRef.current }, dispatch: vi.fn() }),
}));

vi.mock('../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({ tasks: { previewWorkspaceFile: previewMock } }),
    getSpaCocClientErrorMessage: (_err: unknown, fallback: string) => fallback,
}));

import { useSourceCanvasContent } from '../../../src/server/spa/client/react/features/chat/source-canvas/useSourceCanvasContent';

beforeEach(() => {
    previewMock.mockReset();
    workspacesRef.current = [{ id: 'ws1', rootPath: '/home/u/proj' }];
});

describe('useSourceCanvasContent', () => {
    it('returns loading then success with content + language', async () => {
        previewMock.mockResolvedValue({ content: 'hello world\n', language: 'typescript' });
        const { result } = renderHook(() =>
            useSourceCanvasContent({ fullPath: '/home/u/proj/src/a.ts' }),
        );
        expect(result.current.status).toBe('loading');
        await waitFor(() => expect(result.current.status).toBe('success'));
        expect(result.current.content).toBe('hello world\n');
        expect(result.current.language).toBe('typescript');
        expect(result.current.resolvedPath).toBe('/home/u/proj/src/a.ts');
        expect(previewMock).toHaveBeenCalledWith('ws1', '/home/u/proj/src/a.ts', { lines: 0 });
    });

    it('reconstructs content from the lines array when content is absent', async () => {
        previewMock.mockResolvedValue({ lines: ['line1', 'line2'] });
        const { result } = renderHook(() =>
            useSourceCanvasContent({ fullPath: '/home/u/proj/src/b.ts' }),
        );
        await waitFor(() => expect(result.current.status).toBe('success'));
        expect(result.current.content).toBe('line1\nline2');
        expect(result.current.language).toBe('');
    });

    it('enters the error state when the fetch rejects', async () => {
        previewMock.mockRejectedValue(new Error('boom'));
        const { result } = renderHook(() =>
            useSourceCanvasContent({ fullPath: '/home/u/proj/missing.ts' }),
        );
        await waitFor(() => expect(result.current.status).toBe('error'));
        expect(result.current.error).toBe('Failed to load file');
        expect(result.current.resolvedPath).toBe('/home/u/proj/missing.ts');
    });

    it('errors without fetching when no workspace can be resolved', async () => {
        workspacesRef.current = [];
        const { result } = renderHook(() =>
            useSourceCanvasContent({ fullPath: '/x/y.ts' }),
        );
        await waitFor(() => expect(result.current.status).toBe('error'));
        expect(result.current.error).toBe('No workspace available');
        expect(result.current.resolvedPath).toBe('/x/y.ts');
        expect(previewMock).not.toHaveBeenCalled();
    });

    it('stays in loading and does not fetch for a null ref', () => {
        const { result } = renderHook(() => useSourceCanvasContent(null));
        expect(result.current.status).toBe('loading');
        expect(previewMock).not.toHaveBeenCalled();
    });

    it('fetches the relative-resolved path against the source file', async () => {
        previewMock.mockResolvedValue({ content: 'x' });
        renderHook(() =>
            useSourceCanvasContent({
                fullPath: './util/c.ts',
                sourceFilePath: '/home/u/proj/src/index.ts',
            }),
        );
        await waitFor(() =>
            expect(previewMock).toHaveBeenCalledWith('ws1', '/home/u/proj/src/util/c.ts', {
                lines: 0,
            }),
        );
    });
});
