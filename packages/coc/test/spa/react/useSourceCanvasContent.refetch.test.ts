/**
 * Refetch-identity tests for useSourceCanvasContent — the two behaviours the
 * hook has always relied on but never asserted, now that the fetch itself lives
 * in the shared `useFileContent`:
 *
 *  - AC-07: `:line` / `:start-end` is a scroll target, not part of the file
 *    identity. Changing only the range must not re-read the file.
 *  - AC-08: a superseded read must not write state. Switching files mid-flight
 *    and letting the FIRST request land last must leave no stale content, path,
 *    or workspace attribution behind (the repo chip is keyed off the latter).
 */
/* @vitest-environment jsdom */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

type TestWorkspace = { id: string; rootPath?: string };

const { previewMock, getSpaCocClientMock, getCocClientForMock, workspacesRef } = vi.hoisted(() => ({
    previewMock: vi.fn(),
    getSpaCocClientMock: vi.fn(),
    getCocClientForMock: vi.fn(),
    workspacesRef: { current: [] as TestWorkspace[] },
}));

vi.mock('../../../src/server/spa/client/react/contexts/AppContext', () => ({
    useApp: () => ({ state: { workspaces: workspacesRef.current }, dispatch: vi.fn() }),
}));

vi.mock('../../../src/server/spa/client/react/contexts/ReposContext', () => ({
    useReposOptional: () => null,
}));

vi.mock('../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: getSpaCocClientMock,
    getCocClientFor: getCocClientForMock,
    toSpaCocRequestOptions: (options?: RequestInit) => options ?? {},
    translateSpaCocClientError: (error: unknown) => { throw error; },
    getSpaCocClientErrorMessage: (_err: unknown, fallback: string) => fallback,
}));

import { useSourceCanvasContent } from '../../../src/server/spa/client/react/features/chat/source-canvas/useSourceCanvasContent';
import { resetCloneRegistryForTests } from '../../../src/server/spa/client/react/repos/cloneRegistry';
import type { SourceCanvasFileRef } from '../../../src/server/spa/client/react/features/chat/source-canvas/types';

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((r) => { resolve = r; });
    return { promise, resolve };
}

beforeEach(() => {
    previewMock.mockReset();
    getSpaCocClientMock.mockReset();
    getCocClientForMock.mockReset();
    getSpaCocClientMock.mockReturnValue({ tasks: { previewWorkspaceFile: previewMock } });
    getCocClientForMock.mockReturnValue({ tasks: { previewWorkspaceFile: previewMock } });
    resetCloneRegistryForTests();
    workspacesRef.current = [{ id: 'ws1', rootPath: '/home/u/proj' }];
});

describe('useSourceCanvasContent refetch identity', () => {
    it('does not refetch when only the line range changes', async () => {
        previewMock.mockResolvedValue({ content: 'hello', language: 'typescript' });
        const { result, rerender } = renderHook(
            (ref: SourceCanvasFileRef) => useSourceCanvasContent(ref),
            { initialProps: { fullPath: '/home/u/proj/src/a.ts', line: 3 } },
        );
        await waitFor(() => expect(result.current.status).toBe('success'));
        expect(previewMock).toHaveBeenCalledTimes(1);

        // Same file, different scroll target — and a fresh object identity, which
        // is what the chat link handler actually hands over on every click.
        rerender({ fullPath: '/home/u/proj/src/a.ts', line: 42, endLine: 50 });
        await waitFor(() => expect(result.current.status).toBe('success'));

        expect(previewMock).toHaveBeenCalledTimes(1);
        expect(result.current.content).toBe('hello');
    });

    it('ignores a superseded read that lands after the file was switched', async () => {
        const first = deferred<unknown>();
        const second = deferred<unknown>();
        previewMock.mockImplementation((_ws: string, path: string) => (
            path.endsWith('first.ts') ? first.promise : second.promise
        ));

        const { result, rerender } = renderHook(
            (ref: SourceCanvasFileRef) => useSourceCanvasContent(ref),
            { initialProps: { fullPath: '/home/u/proj/first.ts' } },
        );
        expect(result.current.status).toBe('loading');

        // Switch files while the first read is still in flight.
        rerender({ fullPath: '/home/u/proj/second.ts' });

        // The SECOND read lands first, then the abandoned first read resolves.
        await act(async () => {
            second.resolve({
                content: 'second content',
                path: '/home/u/proj/second.ts',
                resolvedWorkspaceId: 'ws1',
            });
            await second.promise;
        });
        await waitFor(() => expect(result.current.status).toBe('success'));

        await act(async () => {
            first.resolve({
                content: 'first content',
                path: '/other/root/first.ts',
                resolvedWorkspaceId: 'ws-stale',
            });
            await first.promise;
        });

        expect(result.current.status).toBe('success');
        expect(result.current.content).toBe('second content');
        expect(result.current.resolvedPath).toBe('/home/u/proj/second.ts');
        expect(result.current.resolvedWorkspaceId).toBe('ws1');
    });
});
