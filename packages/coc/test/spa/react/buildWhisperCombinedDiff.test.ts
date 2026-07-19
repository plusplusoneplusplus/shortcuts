/**
 * Tests for buildWhisperCombinedDiff — concatenating the per-file whisper diffs
 * for a whole whisper group into one combined unified diff (AC-01).
 *
 * Covers the DoD cases: multi-file edits, a created file, a file with only
 * Codex-structured (no line content) changes, and a deleted file — asserting the
 * concatenated string has one `diff --git` section per reconstructable file in
 * group order, and that deleted / non-reconstructable files are reported
 * separately (no diff body) so the panel can list them as "not shown".
 */
import { describe, it, expect } from 'vitest';
import { buildWhisperCombinedDiff } from '../../../src/server/spa/client/react/features/chat/conversation/tool-calls/buildWhisperCombinedDiff';
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

describe('buildWhisperCombinedDiff', () => {
    it('returns empty output for no files', () => {
        const result = buildWhisperCombinedDiff([], []);
        expect(result.diffText).toBe('');
        expect(result.sections).toEqual([]);
        expect(result.deletedFiles).toEqual([]);
        expect(result.nonReconstructableFiles).toEqual([]);
    });

    it('concatenates one `diff --git` section per reconstructable file in group order', () => {
        const toolCalls: WhisperDiffToolCall[] = [
            { toolName: 'edit', args: { path: 'src/a.ts', old_str: 'a1', new_str: 'A1' } },
            { toolName: 'edit', args: { path: 'src/b.ts', old_str: 'b1', new_str: 'B1' } },
        ];
        // Popover order is the fileEdits order — assert it is preserved.
        const fileEdits = [fileEdit('src/a.ts'), fileEdit('src/b.ts')];
        const result = buildWhisperCombinedDiff(toolCalls, fileEdits);

        const headers = result.diffText
            .split('\n')
            .filter(l => l.startsWith('diff --git'));
        expect(headers).toEqual([
            'diff --git a/src/a.ts b/src/a.ts',
            'diff --git a/src/b.ts b/src/b.ts',
        ]);
        // Both files' changes are present, a before b.
        expect(result.diffText).toContain('+A1');
        expect(result.diffText).toContain('+B1');
        expect(result.diffText.indexOf('a/src/a.ts')).toBeLessThan(
            result.diffText.indexOf('a/src/b.ts'),
        );
        expect(result.sections.map(s => s.file.path)).toEqual(['src/a.ts', 'src/b.ts']);
        expect(result.deletedFiles).toEqual([]);
        expect(result.nonReconstructableFiles).toEqual([]);
    });

    it('respects the supplied (popover) file order, not call order', () => {
        const toolCalls: WhisperDiffToolCall[] = [
            { toolName: 'edit', args: { path: 'src/z.ts', old_str: 'z', new_str: 'Z' } },
            { toolName: 'edit', args: { path: 'src/a.ts', old_str: 'a', new_str: 'A' } },
        ];
        // fileEdits sorted by path (as the whisper summary sorts them).
        const fileEdits = [fileEdit('src/a.ts'), fileEdit('src/z.ts')];
        const result = buildWhisperCombinedDiff(toolCalls, fileEdits);
        expect(result.sections.map(s => s.file.path)).toEqual(['src/a.ts', 'src/z.ts']);
        expect(result.diffText.indexOf('a/src/a.ts')).toBeLessThan(
            result.diffText.indexOf('a/src/z.ts'),
        );
    });

    it('includes a created file as a new-file section', () => {
        const toolCalls: WhisperDiffToolCall[] = [
            { toolName: 'edit', args: { path: 'src/a.ts', old_str: 'a', new_str: 'A' } },
            { toolName: 'create', args: { path: 'src/new.ts', file_text: 'l1\nl2' } },
        ];
        const fileEdits = [fileEdit('src/a.ts'), fileEdit('src/new.ts', { isCreate: true })];
        const result = buildWhisperCombinedDiff(toolCalls, fileEdits);

        expect(result.sections.map(s => s.file.path)).toEqual(['src/a.ts', 'src/new.ts']);
        const created = result.sections.find(s => s.file.path === 'src/new.ts')!;
        expect(created.diff).toContain('new file mode 100644');
        expect(created.diff).toContain('--- /dev/null');
        expect(created.diff).toContain('+l1');
        expect(created.diff).toContain('+l2');
        // The concatenated string carries the created file's new-file marker too.
        expect(result.diffText).toContain('new file mode 100644');
    });

    it('includes a Codex `/dev/null`-header create as a reconstructed section, not a non-reconstructable file', () => {
        const unifiedDiff = [
            'diff --git /dev/null b/src/new.ts',
            'index e69de29bb..50661e98b 100644',
            '--- /dev/null',
            '+++ b/src/new.ts',
            '@@ -0,0 +1,2 @@',
            '+l1',
            '+l2',
        ].join('\n');
        const toolCalls: WhisperDiffToolCall[] = [
            { toolName: 'edit', args: { path: 'src/a.ts', old_str: 'a', new_str: 'A' } },
            {
                toolName: 'apply_patch',
                args: { changes: [{ path: 'src/new.ts', kind: 'add' }], diff: unifiedDiff },
            },
        ];
        const fileEdits = [fileEdit('src/a.ts'), fileEdit('src/new.ts', { isCreate: true })];
        const result = buildWhisperCombinedDiff(toolCalls, fileEdits);

        expect(result.sections.map(s => s.file.path)).toEqual(['src/a.ts', 'src/new.ts']);
        const created = result.sections.find(s => s.file.path === 'src/new.ts')!;
        expect(created.diff).toContain('new file mode 100644');
        expect(created.diff).toContain('--- /dev/null');
        expect(created.diff).toContain('+l1');
        expect(created.diff).toContain('+l2');
        expect(result.nonReconstructableFiles).toEqual([]);
        expect(result.deletedFiles).toEqual([]);
    });

    it('reports a file with only Codex-structured (no line content) changes as non-reconstructable', () => {
        const toolCalls: WhisperDiffToolCall[] = [
            { toolName: 'edit', args: { path: 'src/a.ts', old_str: 'a', new_str: 'A' } },
            { toolName: 'file_change', args: { changes: [{ path: 'src/codex.ts', kind: 'update' }] } },
        ];
        const fileEdits = [fileEdit('src/a.ts'), fileEdit('src/codex.ts')];
        const result = buildWhisperCombinedDiff(toolCalls, fileEdits);

        // Reconstructable file is in the diff; the Codex file is not.
        expect(result.sections.map(s => s.file.path)).toEqual(['src/a.ts']);
        expect(result.diffText).not.toContain('src/codex.ts');
        expect(result.nonReconstructableFiles.map(f => f.path)).toEqual(['src/codex.ts']);
        expect(result.deletedFiles).toEqual([]);
    });

    it('reports a deleted file separately and contributes no diff body for it', () => {
        const toolCalls: WhisperDiffToolCall[] = [
            { toolName: 'edit', args: { path: 'src/a.ts', old_str: 'a', new_str: 'A' } },
            { toolName: 'create', args: { path: 'src/gone.ts', file_text: 'temp' } },
        ];
        const fileEdits = [
            fileEdit('src/a.ts'),
            // Marked deleted by a later shell rm — even though it has edit calls,
            // the combined builder must not reconstruct a diff for it.
            fileEdit('src/gone.ts', { isCreate: true, isDeleted: true }),
        ];
        const result = buildWhisperCombinedDiff(toolCalls, fileEdits);

        expect(result.sections.map(s => s.file.path)).toEqual(['src/a.ts']);
        expect(result.diffText).not.toContain('src/gone.ts');
        expect(result.deletedFiles.map(f => f.path)).toEqual(['src/gone.ts']);
        expect(result.nonReconstructableFiles).toEqual([]);
    });

    it('covers all four DoD cases together — edits, create, codex, delete', () => {
        const toolCalls: WhisperDiffToolCall[] = [
            { toolName: 'edit', args: { path: 'src/a.ts', old_str: 'a', new_str: 'A' } },
            { toolName: 'edit', args: { path: 'src/b.ts', old_str: 'b', new_str: 'B' } },
            { toolName: 'create', args: { path: 'src/new.ts', file_text: 'created' } },
            { toolName: 'file_change', args: { changes: [{ path: 'src/codex.ts', kind: 'update' }] } },
            { toolName: 'create', args: { path: 'src/gone.ts', file_text: 'temp' } },
        ];
        const fileEdits = [
            fileEdit('src/a.ts'),
            fileEdit('src/b.ts'),
            fileEdit('src/codex.ts'),
            fileEdit('src/gone.ts', { isDeleted: true }),
            fileEdit('src/new.ts', { isCreate: true }),
        ];
        const result = buildWhisperCombinedDiff(toolCalls, fileEdits);

        // Reconstructable, in group order (deleted/codex excluded from the body).
        expect(result.sections.map(s => s.file.path)).toEqual([
            'src/a.ts',
            'src/b.ts',
            'src/new.ts',
        ]);
        const headers = result.diffText.split('\n').filter(l => l.startsWith('diff --git'));
        expect(headers).toHaveLength(3);
        expect(result.nonReconstructableFiles.map(f => f.path)).toEqual(['src/codex.ts']);
        expect(result.deletedFiles.map(f => f.path)).toEqual(['src/gone.ts']);
    });

    it('reuses buildWhisperFileDiff output verbatim for each section', () => {
        // The concatenation is exactly each file section joined by a newline, so a
        // single-file group yields the same string buildWhisperFileDiff produces.
        const toolCalls: WhisperDiffToolCall[] = [
            { toolName: 'edit', args: { path: 'src/a.ts', old_str: 'a\nb\nc', new_str: 'a\nB\nc' } },
        ];
        const result = buildWhisperCombinedDiff(toolCalls, [fileEdit('src/a.ts')]);
        expect(result.sections).toHaveLength(1);
        expect(result.diffText).toBe(result.sections[0].diff);
        expect(result.diffText).toContain('-b');
        expect(result.diffText).toContain('+B');
        expect(result.diffText).toContain(' a');
        expect(result.diffText).toContain(' c');
    });
});
