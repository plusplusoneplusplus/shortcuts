/**
 * Tests for useWhisperDiffState — the renderable-diff state for the converged
 * whisper diff panel (AC-01/02).
 *
 * The hook is now fully synchronous: it replays the group's captured tool calls
 * through `buildWhisperCombinedDiff` and returns the whole-group view (sections
 * + "not shown" lists + totals), the ordered file list for the header dropdown,
 * and the entry-point `focusPath`. There is no per-file async/commit-diff
 * fallback anymore — a non-reconstructable file is surfaced only under the
 * All-files "not shown" list.
 */
/* @vitest-environment jsdom */

import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';

import { useWhisperDiffState } from '../../../src/server/spa/client/react/features/chat/whisper-diff/useWhisperDiffState';
import type { WhisperDiffOpenContext } from '../../../src/server/spa/client/react/features/chat/conversation/tool-calls/WhisperCollapsedGroup';
import type { WhisperDiffToolCall } from '../../../src/server/spa/client/react/features/chat/conversation/tool-calls/buildWhisperFileDiff';
import type { FileEdit } from '../../../src/server/spa/client/react/features/chat/conversation/tool-calls/toolGroupUtils';

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

function ctx(
    files: FileEdit[],
    toolCalls: WhisperDiffToolCall[],
    over: Partial<WhisperDiffOpenContext> = {},
): WhisperDiffOpenContext {
    return {
        files,
        toolCalls,
        commits: [],
        workspaceId: 'ws1',
        ...over,
    };
}

describe('useWhisperDiffState', () => {
    it('is idle for a null context', () => {
        const { result } = renderHook(() => useWhisperDiffState(null));
        expect(result.current.status).toBe('idle');
        expect(result.current.files).toEqual([]);
        expect(result.current.view.sections).toEqual([]);
        expect(result.current.focusPath).toBeUndefined();
    });

    it('builds the whole-group diff synchronously from the captured tool calls', () => {
        const { result } = renderHook(() =>
            useWhisperDiffState(ctx(
                [fileEdit('src/a.ts'), fileEdit('src/b.ts')],
                [
                    { toolName: 'edit', args: { path: 'src/a.ts', old_str: 'a1', new_str: 'A1' } },
                    { toolName: 'edit', args: { path: 'src/b.ts', old_str: 'b1', new_str: 'B1' } },
                ],
            )),
        );
        expect(result.current.status).toBe('success');
        expect(result.current.view.sections.map((s) => s.file.path)).toEqual(['src/a.ts', 'src/b.ts']);
        expect(result.current.view.sections[0].diff).toContain('diff --git a/src/a.ts b/src/a.ts');
        expect(result.current.view.sections[1].diff).toContain('diff --git a/src/b.ts b/src/b.ts');
    });

    it('carries the ordered file list and the focus target for the dropdown', () => {
        const files = [fileEdit('src/a.ts'), fileEdit('src/b.ts')];
        const { result } = renderHook(() =>
            useWhisperDiffState(ctx(
                files,
                [{ toolName: 'edit', args: { path: 'src/a.ts', old_str: 'a', new_str: 'A' } }],
                { focusPath: 'src/a.ts' },
            )),
        );
        expect(result.current.files.map((f) => f.path)).toEqual(['src/a.ts', 'src/b.ts']);
        expect(result.current.focusPath).toBe('src/a.ts');
    });

    it('reports the header totals over every file in the group', () => {
        const { result } = renderHook(() =>
            useWhisperDiffState(ctx(
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
        expect(result.current.view.fileCount).toBe(2);
        expect(result.current.view.totalInsertions).toBe(5);
        expect(result.current.view.totalDeletions).toBe(5);
    });

    it('splits deleted and non-reconstructable files into the "not shown" lists', () => {
        const { result } = renderHook(() =>
            useWhisperDiffState(ctx(
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
        expect(result.current.status).toBe('success');
        const { view } = result.current;
        expect(view.sections.map((s) => s.file.path)).toEqual(['src/a.ts']);
        expect(view.nonReconstructableFiles.map((f) => f.path)).toEqual(['src/codex.ts']);
        expect(view.deletedFiles.map((f) => f.path)).toEqual(['src/gone.ts']);
    });

    it('is empty (with the view still populated) when nothing in the group is reconstructable', () => {
        const { result } = renderHook(() =>
            useWhisperDiffState(ctx(
                [fileEdit('src/codex.ts'), fileEdit('src/gone.ts', { isDeleted: true })],
                [{ toolName: 'file_change', args: { changes: [{ path: 'src/codex.ts', kind: 'update' }] } }],
            )),
        );
        expect(result.current.status).toBe('empty');
        expect(result.current.error).toMatch(/no diff/i);
        // The view is still present so the All-files body can list "not shown".
        const { view } = result.current;
        expect(view.sections).toEqual([]);
        expect(view.nonReconstructableFiles.map((f) => f.path)).toEqual(['src/codex.ts']);
        expect(view.deletedFiles.map((f) => f.path)).toEqual(['src/gone.ts']);
    });

    it('returns a stable identity across re-renders with the SAME context (drives selection reset)', () => {
        const held = ctx(
            [fileEdit('src/a.ts')],
            [{ toolName: 'edit', args: { path: 'src/a.ts', old_str: 'a', new_str: 'A' } }],
        );
        const { result, rerender } = renderHook(({ c }) => useWhisperDiffState(c), {
            initialProps: { c: held },
        });
        const first = result.current;
        rerender({ c: held });
        rerender({ c: held });
        // The panel keys its selection-reset effect on this identity; re-renders
        // with the same held context must NOT churn it.
        expect(result.current).toBe(first);
    });
});
