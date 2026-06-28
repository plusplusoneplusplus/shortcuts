/**
 * Tests for buildWhisperFileDiff — reconstructing a per-file unified diff from
 * the file-edit tool calls captured inside a Whisper collapsed group (AC-02:
 * primary diff source is the tool-call data already summarized by the group).
 */
import { describe, it, expect } from 'vitest';
import {
    buildWhisperFileDiff,
    type WhisperDiffToolCall,
} from '../../../src/server/spa/client/react/features/chat/conversation/tool-calls/buildWhisperFileDiff';

describe('buildWhisperFileDiff', () => {
    it('returns null when no tool call touches the target path', () => {
        const calls: WhisperDiffToolCall[] = [
            { toolName: 'edit', args: { path: 'src/a.ts', old_str: 'a', new_str: 'b' } },
        ];
        expect(buildWhisperFileDiff(calls, 'src/other.ts')).toBeNull();
    });

    it('returns null for an empty target path', () => {
        const calls: WhisperDiffToolCall[] = [
            { toolName: 'edit', args: { path: 'src/a.ts', old_str: 'a', new_str: 'b' } },
        ];
        expect(buildWhisperFileDiff(calls, '')).toBeNull();
    });

    it('reconstructs a single edit as a unified diff with a file header and hunk', () => {
        const calls: WhisperDiffToolCall[] = [
            {
                toolName: 'edit',
                args: { path: 'src/a.ts', old_str: 'const x = 1;', new_str: 'const x = 2;' },
            },
        ];
        const diff = buildWhisperFileDiff(calls, 'src/a.ts');
        expect(diff).not.toBeNull();
        const lines = diff!.split('\n');
        expect(lines[0]).toBe('diff --git a/src/a.ts b/src/a.ts');
        expect(lines).toContain('--- a/src/a.ts');
        expect(lines).toContain('+++ b/src/a.ts');
        expect(lines).toContain('@@ -1,1 +1,1 @@');
        expect(lines).toContain('-const x = 1;');
        expect(lines).toContain('+const x = 2;');
        // Not a creation: must not emit /dev/null.
        expect(lines).not.toContain('--- /dev/null');
    });

    it('keeps shared lines as context lines in an edit hunk', () => {
        const calls: WhisperDiffToolCall[] = [
            {
                toolName: 'edit',
                args: { path: 'src/a.ts', old_str: 'a\nb\nc', new_str: 'a\nB\nc' },
            },
        ];
        const lines = buildWhisperFileDiff(calls, 'src/a.ts')!.split('\n');
        expect(lines).toContain(' a');
        expect(lines).toContain('-b');
        expect(lines).toContain('+B');
        expect(lines).toContain(' c');
    });

    it('reconstructs a create as a new-file diff with all-added lines', () => {
        const calls: WhisperDiffToolCall[] = [
            { toolName: 'create', args: { path: 'src/new.ts', file_text: 'line1\nline2' } },
        ];
        const lines = buildWhisperFileDiff(calls, 'src/new.ts')!.split('\n');
        expect(lines[0]).toBe('diff --git a/src/new.ts b/src/new.ts');
        expect(lines).toContain('new file mode 100644');
        expect(lines).toContain('--- /dev/null');
        expect(lines).toContain('+++ b/src/new.ts');
        expect(lines).toContain('@@ -0,0 +1,2 @@');
        expect(lines).toContain('+line1');
        expect(lines).toContain('+line2');
    });

    it('shows multiple edits to the same file as separate ordered hunks', () => {
        const calls: WhisperDiffToolCall[] = [
            { toolName: 'edit', args: { path: 'src/a.ts', old_str: 'one', new_str: 'ONE' } },
            { toolName: 'edit', args: { path: 'src/a.ts', old_str: 'two', new_str: 'TWO' } },
        ];
        const diff = buildWhisperFileDiff(calls, 'src/a.ts')!;
        const lines = diff.split('\n');
        // Exactly one file header, two hunk headers.
        expect(lines.filter(l => l.startsWith('diff --git')).length).toBe(1);
        expect(lines.filter(l => l.startsWith('@@')).length).toBe(2);
        // Chronological order preserved: ONE before TWO.
        expect(diff.indexOf('+ONE')).toBeLessThan(diff.indexOf('+TWO'));
    });

    it('ignores edits to other files when collecting hunks for one file', () => {
        const calls: WhisperDiffToolCall[] = [
            { toolName: 'edit', args: { path: 'src/a.ts', old_str: 'a', new_str: 'A' } },
            { toolName: 'edit', args: { path: 'src/b.ts', old_str: 'b', new_str: 'B' } },
        ];
        const diff = buildWhisperFileDiff(calls, 'src/a.ts')!;
        expect(diff).toContain('+A');
        expect(diff).not.toContain('+B');
        expect(diff).not.toContain('src/b.ts');
    });

    it('normalizes tool name aliases (Edit / Write) and file_path arg', () => {
        const calls: WhisperDiffToolCall[] = [
            { toolName: 'Edit', args: { file_path: 'src/a.ts', old_string: 'x', new_string: 'y' } },
        ];
        const diff = buildWhisperFileDiff(calls, 'src/a.ts')!;
        expect(diff).toContain('-x');
        expect(diff).toContain('+y');

        // Claude Code's `Write` tool stores the body under `content` (not Codex's
        // `file_text`); both must reconstruct.
        const createCalls: WhisperDiffToolCall[] = [
            { toolName: 'Write', args: { file_path: 'src/z.ts', content: 'hi' } },
        ];
        const createDiff = buildWhisperFileDiff(createCalls, 'src/z.ts')!;
        expect(createDiff).toContain('--- /dev/null');
        expect(createDiff).toContain('+hi');
    });

    // Regression: a `Write`-created file carries its body under `content`, not
    // `file_text`. Reading only `file_text` reconstructed an empty new-file diff
    // (`@@ -0,0 +1,0 @@` with no body lines). Accept `content` so the real lines
    // show.
    it('reconstructs a Write create from its `content` arg, not an empty diff', () => {
        const calls: WhisperDiffToolCall[] = [
            { toolName: 'Write', args: { file_path: 'src/new.tsx', content: 'line1\nline2\nline3' } },
        ];
        const lines = buildWhisperFileDiff(calls, 'src/new.tsx')!.split('\n');
        expect(lines[0]).toBe('diff --git a/src/new.tsx b/src/new.tsx');
        expect(lines).toContain('new file mode 100644');
        expect(lines).toContain('--- /dev/null');
        expect(lines).toContain('@@ -0,0 +1,3 @@');
        expect(lines).toContain('+line1');
        expect(lines).toContain('+line2');
        expect(lines).toContain('+line3');
        // The bug produced this empty-file header with no added lines.
        expect(lines).not.toContain('@@ -0,0 +1,0 @@');
    });

    it('prefers `file_text` over `content` when both are present on a create', () => {
        const calls: WhisperDiffToolCall[] = [
            {
                toolName: 'create',
                args: { path: 'src/dup.ts', file_text: 'from-file_text', content: 'from-content' },
            },
        ];
        const diff = buildWhisperFileDiff(calls, 'src/dup.ts')!;
        expect(diff).toContain('+from-file_text');
        expect(diff).not.toContain('+from-content');
    });

    it('matches paths irrespective of slash direction', () => {
        const calls: WhisperDiffToolCall[] = [
            { toolName: 'edit', args: { path: 'src\\win\\a.ts', old_str: 'a', new_str: 'b' } },
        ];
        const diff = buildWhisperFileDiff(calls, 'src/win/a.ts');
        expect(diff).not.toBeNull();
        expect(diff!.split('\n')[0]).toBe('diff --git a/src/win/a.ts b/src/win/a.ts');
    });

    it('reconstructs an apply_patch update file from its captured patch body', () => {
        const patch = [
            '*** Begin Patch',
            '*** Update File: src/a.ts',
            '@@ function foo()',
            ' context line',
            '-old line',
            '+new line',
            '*** End Patch',
        ].join('\n');
        const calls: WhisperDiffToolCall[] = [
            { toolName: 'apply_patch', args: { patch } },
        ];
        const diff = buildWhisperFileDiff(calls, 'src/a.ts')!;
        const lines = diff.split('\n');
        expect(lines[0]).toBe('diff --git a/src/a.ts b/src/a.ts');
        expect(lines).toContain('--- a/src/a.ts');
        expect(lines).toContain('@@ function foo()');
        expect(lines).toContain(' context line');
        expect(lines).toContain('-old line');
        expect(lines).toContain('+new line');
    });

    it('reconstructs an apply_patch add file as a new-file diff', () => {
        const patch = [
            '*** Begin Patch',
            '*** Add File: src/created.ts',
            '+first',
            '+second',
            '*** End Patch',
        ].join('\n');
        const calls: WhisperDiffToolCall[] = [
            { toolName: 'apply_patch', args: { patch } },
        ];
        const lines = buildWhisperFileDiff(calls, 'src/created.ts')!.split('\n');
        expect(lines).toContain('new file mode 100644');
        expect(lines).toContain('--- /dev/null');
        expect(lines).toContain('+first');
        expect(lines).toContain('+second');
    });

    it('only captures the targeted file section of a multi-file apply_patch', () => {
        const patch = [
            '*** Begin Patch',
            '*** Update File: src/a.ts',
            '-a old',
            '+a new',
            '*** Update File: src/b.ts',
            '-b old',
            '+b new',
            '*** End Patch',
        ].join('\n');
        const calls: WhisperDiffToolCall[] = [
            { toolName: 'apply_patch', args: { patch } },
        ];
        const diff = buildWhisperFileDiff(calls, 'src/b.ts')!;
        expect(diff).toContain('+b new');
        expect(diff).not.toContain('+a new');
        expect(diff).not.toContain('-a old');
    });

    it('returns null when a file has only Codex structured changes (no line content)', () => {
        const calls: WhisperDiffToolCall[] = [
            {
                toolName: 'file_change',
                args: { changes: [{ path: 'src/a.ts', kind: 'update' }] },
            },
        ];
        expect(buildWhisperFileDiff(calls, 'src/a.ts')).toBeNull();
    });
});
