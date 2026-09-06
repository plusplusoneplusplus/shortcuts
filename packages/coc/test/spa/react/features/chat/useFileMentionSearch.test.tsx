/**
 * @vitest-environment jsdom
 *
 * Multi-repo file-mention search (AC-03).
 *
 * Covers the two behaviours the composer depends on: every repo in the group is
 * queried in parallel and the results merge into one ranked, repo-labelled list;
 * and a superseded query is aborted so only the latest result lands.
 */
import { act, render } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExplorerSearchResult } from '@plusplusoneplusplus/coc-client';

const { mockSearchFiles } = vi.hoisted(() => ({ mockSearchFiles: vi.fn() }));

vi.mock(
    '../../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerApi',
    () => ({ explorerApi: { searchFiles: mockSearchFiles } }),
);

import {
    FILE_MENTION_DEBOUNCE_MS,
    FILE_MENTION_RESULT_LIMIT,
    mergeFileMentionResults,
    useFileMentionSearch,
    type FileMentionRepo,
    type FileMentionResult,
} from '../../../../../src/server/spa/client/react/features/chat/hooks/useFileMentionSearch';

const REPOS: FileMentionRepo[] = [
    { workspaceId: 'ws-a', name: 'alpha' },
    { workspaceId: 'ws-b', name: 'beta' },
];

function hit(path: string, score: number): ExplorerSearchResult {
    return { path, score, indices: [0] };
}

/** Renders the hook and exposes its latest value. */
function Harness({ repos, query, sink }: {
    repos: FileMentionRepo[];
    query: string | null;
    sink: { results: FileMentionResult[]; loading: boolean };
}) {
    const value = useFileMentionSearch(repos, query);
    sink.results = value.results;
    sink.loading = value.loading;
    return null;
}

/** Advance past the debounce and let the search promises settle. */
async function settle() {
    await act(async () => {
        vi.advanceTimersByTime(FILE_MENTION_DEBOUNCE_MS);
        await Promise.resolve();
        await Promise.resolve();
    });
}

describe('mergeFileMentionResults', () => {
    it('ranks by score desc, then repo order, then path length', () => {
        const merged = mergeFileMentionResults([
            { repo: REPOS[0], results: [hit('a/long/path.ts', 5), hit('a/x.ts', 5)] },
            { repo: REPOS[1], results: [hit('b/y.ts', 9), hit('b/z.ts', 5)] },
        ]);

        expect(merged.map(r => r.path)).toEqual([
            'b/y.ts',        // highest score
            'a/x.ts',        // score 5, repo 0, shortest
            'a/long/path.ts',// score 5, repo 0
            'b/z.ts',        // score 5, repo 1
        ]);
    });

    it('labels every row with the repo it came from', () => {
        const merged = mergeFileMentionResults([
            { repo: REPOS[0], results: [hit('a/x.ts', 1)] },
            { repo: REPOS[1], results: [hit('b/y.ts', 2)] },
        ]);

        expect(merged.map(r => [r.path, r.repoName, r.workspaceId])).toEqual([
            ['b/y.ts', 'beta', 'ws-b'],
            ['a/x.ts', 'alpha', 'ws-a'],
        ]);
    });

    it('keeps the scorer match indices intact', () => {
        const merged = mergeFileMentionResults([
            { repo: REPOS[0], results: [{ path: 'src/foo.ts', score: 1, indices: [4, 5, 6] }] },
        ]);
        expect(merged[0].indices).toEqual([4, 5, 6]);
    });
});

describe('useFileMentionSearch', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        mockSearchFiles.mockReset();
    });

    it('queries every repo in the group and merges the results', async () => {
        mockSearchFiles.mockImplementation((workspaceId: string) =>
            Promise.resolve({
                results: workspaceId === 'ws-a' ? [hit('a/foo.ts', 3)] : [hit('b/foo.ts', 7)],
                truncated: false,
            }),
        );

        const sink = { results: [] as FileMentionResult[], loading: false };
        render(<Harness repos={REPOS} query="foo" sink={sink} />);
        await settle();

        expect(mockSearchFiles.mock.calls.map(c => c[0])).toEqual(['ws-a', 'ws-b']);
        expect(mockSearchFiles.mock.calls[0][1]).toBe('foo');
        expect(mockSearchFiles.mock.calls[0][2]).toMatchObject({ limit: FILE_MENTION_RESULT_LIMIT });
        expect(sink.results.map(r => [r.path, r.repoName])).toEqual([
            ['b/foo.ts', 'beta'],
            ['a/foo.ts', 'alpha'],
        ]);
    });

    it('aborts a superseded query so only the latest result is applied', async () => {
        const signals: AbortSignal[] = [];
        mockSearchFiles.mockImplementation((_ws: string, query: string, opts: { signal: AbortSignal }) => {
            signals.push(opts.signal);
            return Promise.resolve({ results: [hit(`${query}.ts`, 1)], truncated: false });
        });

        const sink = { results: [] as FileMentionResult[], loading: false };
        const { rerender } = render(<Harness repos={REPOS} query="fir" sink={sink} />);
        await settle();
        expect(sink.results.map(r => r.path)).toEqual(['fir.ts', 'fir.ts']);

        rerender(<Harness repos={REPOS} query="second" sink={sink} />);
        await settle();

        expect(signals.slice(0, 2).every(s => s.aborted)).toBe(true);
        expect(signals.slice(2).some(s => s.aborted)).toBe(false);
        expect(sink.results.map(r => r.path)).toEqual(['second.ts', 'second.ts']);
    });

    it('debounces: typing without a pause issues no request', () => {
        mockSearchFiles.mockResolvedValue({ results: [], truncated: false });
        const sink = { results: [] as FileMentionResult[], loading: false };
        const { rerender } = render(<Harness repos={REPOS} query="s" sink={sink} />);
        act(() => { vi.advanceTimersByTime(FILE_MENTION_DEBOUNCE_MS - 1); });
        rerender(<Harness repos={REPOS} query="sr" sink={sink} />);
        act(() => { vi.advanceTimersByTime(FILE_MENTION_DEBOUNCE_MS - 1); });

        expect(mockSearchFiles).not.toHaveBeenCalled();
    });

    it('never touches the network for a closed popup, a blank query, or no repos', async () => {
        mockSearchFiles.mockResolvedValue({ results: [], truncated: false });
        const sink = { results: [] as FileMentionResult[], loading: false };

        const { rerender } = render(<Harness repos={REPOS} query={null} sink={sink} />);
        await settle();
        rerender(<Harness repos={REPOS} query="   " sink={sink} />);
        await settle();
        rerender(<Harness repos={[]} query="foo" sink={sink} />);
        await settle();

        expect(mockSearchFiles).not.toHaveBeenCalled();
        expect(sink.results).toEqual([]);
        expect(sink.loading).toBe(false);
    });

    it('keeps the other repos usable when one repo fails', async () => {
        mockSearchFiles.mockImplementation((workspaceId: string) =>
            workspaceId === 'ws-a'
                ? Promise.reject(new Error('index cold'))
                : Promise.resolve({ results: [hit('b/foo.ts', 2)], truncated: false }),
        );

        const sink = { results: [] as FileMentionResult[], loading: false };
        render(<Harness repos={REPOS} query="foo" sink={sink} />);
        await settle();

        expect(sink.results.map(r => r.path)).toEqual(['b/foo.ts']);
        expect(sink.loading).toBe(false);
    });
});
