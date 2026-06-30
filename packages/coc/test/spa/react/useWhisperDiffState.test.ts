/**
 * Tests for useWhisperDiffState — the renderable-diff state machine for the
 * transient whisper diff panel (AC-02 wiring).
 *
 * Covers: idle for a null context; primary reconstruction from the group's tool
 * calls (no fetch); the empty state when nothing is reconstructable and no
 * commit fallback is available; the commit-backed fallback (latest-detected
 * order, first success wins, full-hash preference, remote clone routing); and
 * the explicit error/empty terminal states for failing or empty fallbacks.
 */
/* @vitest-environment jsdom */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const { getCommitFileDiffMock, remoteGetCommitFileDiffMock, getSpaCocClientMock, getCocClientForMock } = vi.hoisted(() => ({
    getCommitFileDiffMock: vi.fn(),
    remoteGetCommitFileDiffMock: vi.fn(),
    getSpaCocClientMock: vi.fn(),
    getCocClientForMock: vi.fn(),
}));

vi.mock('../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: getSpaCocClientMock,
    getCocClientFor: getCocClientForMock,
    toSpaCocRequestOptions: (options?: RequestInit) => options ?? {},
    translateSpaCocClientError: (error: unknown) => { throw error; },
    getSpaCocClientErrorMessage: (_err: unknown, fallback: string) => fallback,
}));

import { useWhisperDiffState } from '../../../src/server/spa/client/react/features/chat/whisper-diff/useWhisperDiffState';
import type {
    WhisperCombinedDiffContext,
    WhisperFileDiffContext,
} from '../../../src/server/spa/client/react/features/chat/conversation/tool-calls/WhisperCollapsedGroup';
import type { WhisperDiffToolCall } from '../../../src/server/spa/client/react/features/chat/conversation/tool-calls/buildWhisperFileDiff';
import type { FileEdit } from '../../../src/server/spa/client/react/features/chat/conversation/tool-calls/toolGroupUtils';
import type { DetectedCommit } from '../../../src/server/spa/client/react/features/chat/conversation/commitDetection';
import { registerCloneBaseUrls, resetCloneRegistryForTests } from '../../../src/server/spa/client/react/repos/cloneRegistry';

const REMOTE_BASE_URL = 'http://127.0.0.1:4000';

function fileEdit(path: string, over: Partial<FileEdit> = {}): FileEdit {
    return {
        path,
        insertions: 1,
        deletions: 0,
        netInsertions: 1,
        netDeletions: 0,
        isCreate: false,
        isDeleted: false,
        ...over,
    };
}

function commit(shortHash: string, over: Partial<DetectedCommit> = {}): DetectedCommit {
    return {
        shortHash,
        subject: `commit ${shortHash}`,
        toolCallId: `tc-${shortHash}`,
        isFixup: false,
        ...over,
    };
}

function ctx(over: Partial<WhisperFileDiffContext> & { file: FileEdit }): WhisperFileDiffContext {
    return {
        toolCalls: [],
        commits: [],
        workspaceId: 'ws1',
        ...over,
    };
}

beforeEach(() => {
    getCommitFileDiffMock.mockReset();
    remoteGetCommitFileDiffMock.mockReset();
    getSpaCocClientMock.mockReset();
    getCocClientForMock.mockReset();
    getSpaCocClientMock.mockReturnValue({ git: { getCommitFileDiff: getCommitFileDiffMock } });
    getCocClientForMock.mockReturnValue({ git: { getCommitFileDiff: remoteGetCommitFileDiffMock } });
    resetCloneRegistryForTests();
});

describe('useWhisperDiffState', () => {
    it('is idle and does not fetch for a null context', () => {
        const { result } = renderHook(() => useWhisperDiffState(null));
        expect(result.current.status).toBe('idle');
        expect(result.current.file).toBeNull();
        expect(getCommitFileDiffMock).not.toHaveBeenCalled();
    });

    it('reconstructs the diff from the group tool calls without any fetch', async () => {
        const { result } = renderHook(() =>
            useWhisperDiffState(ctx({
                file: fileEdit('src/a.ts'),
                toolCalls: [
                    { toolName: 'edit', args: { path: 'src/a.ts', old_str: 'foo', new_str: 'bar' } },
                ],
            })),
        );
        await waitFor(() => expect(result.current.status).toBe('success'));
        expect(result.current.diffText).toContain('diff --git a/src/a.ts b/src/a.ts');
        expect(result.current.diffText).toContain('-foo');
        expect(result.current.diffText).toContain('+bar');
        expect(result.current.file?.path).toBe('src/a.ts');
        expect(getCommitFileDiffMock).not.toHaveBeenCalled();
    });

    it('is empty when nothing is reconstructable and there is no commit fallback', async () => {
        const { result } = renderHook(() =>
            useWhisperDiffState(ctx({ file: fileEdit('src/a.ts'), toolCalls: [], commits: [] })),
        );
        await waitFor(() => expect(result.current.status).toBe('empty'));
        expect(result.current.error).toMatch(/no diff/i);
        expect(getCommitFileDiffMock).not.toHaveBeenCalled();
    });

    it('is empty (no fetch) when commits exist but there is no workspace to route through', async () => {
        const { result } = renderHook(() =>
            useWhisperDiffState(ctx({
                file: fileEdit('src/a.ts'),
                toolCalls: [],
                commits: [commit('aaaaaaa')],
                workspaceId: undefined,
            })),
        );
        await waitFor(() => expect(result.current.status).toBe('empty'));
        expect(getCommitFileDiffMock).not.toHaveBeenCalled();
    });

    it('falls back to a commit single-file diff, preferring the full hash', async () => {
        getCommitFileDiffMock.mockResolvedValue({ diff: 'diff --git a/src/a.ts b/src/a.ts\n@@ -1 +1 @@\n-x\n+y' });
        const { result } = renderHook(() =>
            useWhisperDiffState(ctx({
                file: fileEdit('src/a.ts'),
                toolCalls: [],
                commits: [commit('aaaaaaa', { fullHash: 'aaaaaaa0000000000000000000000000000000' })],
            })),
        );
        await waitFor(() => expect(result.current.status).toBe('success'));
        expect(result.current.diffText).toContain('+y');
        expect(getCommitFileDiffMock).toHaveBeenCalledWith(
            'ws1',
            'aaaaaaa0000000000000000000000000000000',
            'src/a.ts',
        );
    });

    it('tries commits in latest-detected order and uses the first success', async () => {
        // Detection collects commits chronologically; the latest (last) is tried first.
        getCommitFileDiffMock.mockImplementation((_ws: string, hash: string) =>
            hash === 'newer11'
                ? Promise.resolve({ diff: 'diff --git a/src/a.ts b/src/a.ts\n@@ @@\n+from-newer' })
                : Promise.resolve({ diff: '' }),
        );
        const { result } = renderHook(() =>
            useWhisperDiffState(ctx({
                file: fileEdit('src/a.ts'),
                toolCalls: [],
                commits: [commit('older00'), commit('newer11')],
            })),
        );
        await waitFor(() => expect(result.current.status).toBe('success'));
        expect(result.current.diffText).toContain('+from-newer');
        // First call targets the newest commit; the older one is never reached.
        expect(getCommitFileDiffMock.mock.calls[0][1]).toBe('newer11');
        expect(getCommitFileDiffMock).toHaveBeenCalledTimes(1);
    });

    it('surfaces an explicit error state when the commit fallback fetch fails', async () => {
        getCommitFileDiffMock.mockRejectedValue(new Error('boom'));
        const { result } = renderHook(() =>
            useWhisperDiffState(ctx({
                file: fileEdit('src/a.ts'),
                toolCalls: [],
                commits: [commit('aaaaaaa')],
            })),
        );
        await waitFor(() => expect(result.current.status).toBe('error'));
        expect(result.current.error).toBe('Failed to load diff');
    });

    it('is empty when every commit returns no diff for the file', async () => {
        getCommitFileDiffMock.mockResolvedValue({ diff: '' });
        const { result } = renderHook(() =>
            useWhisperDiffState(ctx({
                file: fileEdit('src/a.ts'),
                toolCalls: [],
                commits: [commit('aaaaaaa'), commit('bbbbbbb')],
            })),
        );
        await waitFor(() => expect(result.current.status).toBe('empty'));
        expect(getCommitFileDiffMock).toHaveBeenCalledTimes(2);
    });

    it('does not re-fire the effect when re-rendered with a fresh but equal context (no render loop)', async () => {
        // Regression guard: the effect must key on stable derived values, not the
        // `ctx` object identity. A caller (or React) that passes a freshly built
        // context object on every render must NOT retrigger the commit fetch —
        // otherwise setState → re-render → effect → setState loops forever (OOM).
        getCommitFileDiffMock.mockResolvedValue({ diff: 'diff --git a/src/a.ts b/src/a.ts\n@@ @@\n+y' });
        const makeCtx = () => ctx({
            file: fileEdit('src/a.ts'),
            toolCalls: [],
            commits: [commit('aaaaaaa')],
        });
        const { result, rerender } = renderHook(({ c }) => useWhisperDiffState(c), {
            initialProps: { c: makeCtx() },
        });
        await waitFor(() => expect(result.current.status).toBe('success'));
        expect(getCommitFileDiffMock).toHaveBeenCalledTimes(1);
        // Re-render several times with brand-new (deep-equal) context objects.
        rerender({ c: makeCtx() });
        rerender({ c: makeCtx() });
        rerender({ c: makeCtx() });
        await waitFor(() => expect(result.current.status).toBe('success'));
        // Stable deps ⇒ the fetch still ran exactly once across all the re-renders.
        expect(getCommitFileDiffMock).toHaveBeenCalledTimes(1);
    });

    it('routes the commit fallback through a remote clone for a remote workspace', async () => {
        registerCloneBaseUrls([{ workspaceId: 'remote-ws', baseUrl: REMOTE_BASE_URL }]);
        remoteGetCommitFileDiffMock.mockResolvedValue({ diff: 'diff --git a/x b/x\n+remote' });
        const { result } = renderHook(() =>
            useWhisperDiffState(ctx({
                file: fileEdit('x'),
                toolCalls: [],
                commits: [commit('aaaaaaa')],
                workspaceId: 'remote-ws',
            })),
        );
        await waitFor(() => expect(result.current.status).toBe('success'));
        expect(result.current.diffText).toContain('+remote');
        // Remote clone routing preserved: the remote client is used, not the local default.
        expect(getCocClientForMock).toHaveBeenCalledWith(REMOTE_BASE_URL);
        expect(remoteGetCommitFileDiffMock).toHaveBeenCalledWith('remote-ws', 'aaaaaaa', 'x');
        expect(getCommitFileDiffMock).not.toHaveBeenCalled();
    });
});

// ── Combined "All changes" mode (AC-03) ──────────────────────────────────────

function combinedCtx(
    files: FileEdit[],
    toolCalls: WhisperDiffToolCall[],
    over: Partial<WhisperCombinedDiffContext> = {},
): WhisperCombinedDiffContext {
    return {
        combined: true,
        files,
        toolCalls,
        commits: [],
        workspaceId: 'ws1',
        ...over,
    };
}

describe('useWhisperDiffState — combined mode', () => {
    it('builds the whole-group diff synchronously from the captured tool calls (no fetch)', async () => {
        const { result } = renderHook(() =>
            useWhisperDiffState(combinedCtx(
                [fileEdit('src/a.ts'), fileEdit('src/b.ts')],
                [
                    { toolName: 'edit', args: { path: 'src/a.ts', old_str: 'a1', new_str: 'A1' } },
                    { toolName: 'edit', args: { path: 'src/b.ts', old_str: 'b1', new_str: 'B1' } },
                ],
            )),
        );
        await waitFor(() => expect(result.current.status).toBe('success'));
        const combined = result.current.combined!;
        expect(combined).toBeTruthy();
        expect(combined.sections.map((s) => s.file.path)).toEqual(['src/a.ts', 'src/b.ts']);
        expect(result.current.diffText).toContain('diff --git a/src/a.ts b/src/a.ts');
        expect(result.current.diffText).toContain('diff --git a/src/b.ts b/src/b.ts');
        // Combined mode is single-file-`file`-less and never falls back to a fetch.
        expect(result.current.file).toBeNull();
        expect(getCommitFileDiffMock).not.toHaveBeenCalled();
    });

    it('reports the header totals over every file in the group', async () => {
        const { result } = renderHook(() =>
            useWhisperDiffState(combinedCtx(
                [
                    fileEdit('src/a.ts', { netInsertions: 3, netDeletions: 1 }),
                    fileEdit('src/b.ts', { netInsertions: 2, netDeletions: 4 }),
                ],
                [
                    { toolName: 'edit', args: { path: 'src/a.ts', old_str: 'a', new_str: 'A' } },
                    { toolName: 'edit', args: { path: 'src/b.ts', old_str: 'b', new_str: 'B' } },
                ],
            )),
        );
        await waitFor(() => expect(result.current.combined).toBeTruthy());
        const combined = result.current.combined!;
        expect(combined.fileCount).toBe(2);
        expect(combined.totalInsertions).toBe(5);
        expect(combined.totalDeletions).toBe(5);
    });

    it('splits deleted and non-reconstructable files into the "not shown" lists', async () => {
        const { result } = renderHook(() =>
            useWhisperDiffState(combinedCtx(
                [
                    fileEdit('src/a.ts'),
                    fileEdit('src/codex.ts'),
                    fileEdit('src/gone.ts', { isDeleted: true }),
                ],
                [
                    { toolName: 'edit', args: { path: 'src/a.ts', old_str: 'a', new_str: 'A' } },
                    { toolName: 'file_change', args: { changes: [{ path: 'src/codex.ts', kind: 'update' }] } },
                ],
            )),
        );
        await waitFor(() => expect(result.current.status).toBe('success'));
        const combined = result.current.combined!;
        expect(combined.sections.map((s) => s.file.path)).toEqual(['src/a.ts']);
        expect(combined.nonReconstructableFiles.map((f) => f.path)).toEqual(['src/codex.ts']);
        expect(combined.deletedFiles.map((f) => f.path)).toEqual(['src/gone.ts']);
    });

    it('is empty (with the combined payload) when nothing in the group is reconstructable', async () => {
        const { result } = renderHook(() =>
            useWhisperDiffState(combinedCtx(
                [fileEdit('src/codex.ts'), fileEdit('src/gone.ts', { isDeleted: true })],
                [
                    { toolName: 'file_change', args: { changes: [{ path: 'src/codex.ts', kind: 'update' }] } },
                ],
            )),
        );
        await waitFor(() => expect(result.current.status).toBe('empty'));
        expect(result.current.error).toMatch(/no diff/i);
        // The combined payload is still present so the panel can list "not shown".
        const combined = result.current.combined!;
        expect(combined.sections).toEqual([]);
        expect(combined.nonReconstructableFiles.map((f) => f.path)).toEqual(['src/codex.ts']);
        expect(combined.deletedFiles.map((f) => f.path)).toEqual(['src/gone.ts']);
    });

    it('never fetches a commit fallback in combined mode even when commits exist', async () => {
        const { result } = renderHook(() =>
            useWhisperDiffState(combinedCtx(
                [fileEdit('src/codex.ts')],
                [{ toolName: 'file_change', args: { changes: [{ path: 'src/codex.ts', kind: 'update' }] } }],
                { commits: [commit('aaaaaaa')] },
            )),
        );
        await waitFor(() => expect(result.current.status).toBe('empty'));
        expect(getCommitFileDiffMock).not.toHaveBeenCalled();
        expect(remoteGetCommitFileDiffMock).not.toHaveBeenCalled();
    });
});
