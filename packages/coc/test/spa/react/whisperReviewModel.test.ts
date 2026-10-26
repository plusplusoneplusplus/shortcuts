/**
 * whisperReviewModel — maps a chat's replayed changes to review-navigator rows
 * and decides which files have both full sides (Monaco) versus patch-only.
 */
import { describe, it, expect } from 'vitest';
import {
    buildWhisperReviewEntries,
    wholeNewFileText,
    whisperReviewContentKey,
} from '../../../src/server/spa/client/react/features/chat/whisper-diff/whisperReviewModel';
import type { WhisperDiffState } from '../../../src/server/spa/client/react/features/chat/whisper-diff/useWhisperDiffState';
import { buildWhisperCombinedDiff } from '../../../src/server/spa/client/react/features/chat/conversation/tool-calls/buildWhisperCombinedDiff';
import { buildWhisperFileDiff } from '../../../src/server/spa/client/react/features/chat/conversation/tool-calls/buildWhisperFileDiff';
import { collectFileEdits, computeFileEditTotals } from '../../../src/server/spa/client/react/features/chat/conversation/tool-calls/toolGroupUtils';

type Call = { toolName: string; args: Record<string, unknown> };

function stateFrom(calls: Call[]): WhisperDiffState {
    const files = collectFileEdits(calls);
    const built = buildWhisperCombinedDiff(calls, files);
    return {
        status: 'success',
        view: { ...built, fileCount: files.length, ...computeFileEditTotals(files) },
        files,
        error: '',
    };
}

describe('wholeNewFileText', () => {
    it('returns the exact created text, trailing newline included', () => {
        const diff = buildWhisperFileDiff([{ toolName: 'create', args: { path: 'a.ts', file_text: 'x\ny\n' } }], 'a.ts')!;
        expect(wholeNewFileText(diff)).toBe('x\ny\n');
    });

    it('returns empty text for an empty created file', () => {
        const diff = buildWhisperFileDiff([{ toolName: 'create', args: { path: 'a.ts', file_text: '' } }], 'a.ts')!;
        expect(wholeNewFileText(diff)).toBe('');
    });

    it('treats an Add File patch as whole', () => {
        const patch = '*** Begin Patch\n*** Add File: a.ts\n+one\n+two\n*** End Patch';
        const diff = buildWhisperFileDiff([{ toolName: 'apply_patch', args: { input: patch } }], 'a.ts')!;
        expect(wholeNewFileText(diff)).toBe('one\ntwo');
    });

    it('rejects snippet edits, multi-step changes and patches with context', () => {
        const edit = buildWhisperFileDiff([{ toolName: 'edit', args: { path: 'a.ts', old_str: 'a', new_str: 'b' } }], 'a.ts')!;
        expect(wholeNewFileText(edit)).toBeNull();
        const twice = buildWhisperFileDiff([
            { toolName: 'create', args: { path: 'a.ts', file_text: 'a\n' } },
            { toolName: 'create', args: { path: 'a.ts', file_text: 'b\n' } },
        ], 'a.ts')!;
        expect(wholeNewFileText(twice)).toBeNull();
        expect(wholeNewFileText('diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n+x')).toBeNull();
        expect(wholeNewFileText('diff --git a/a b/a\n--- /dev/null\n+++ b/a\n@@ -0,0 +1 @@\n+x\n\\ No newline at end of file')).toBeNull();
    });
});

describe('buildWhisperReviewEntries', () => {
    const calls: Call[] = [
        { toolName: 'create', args: { path: '/r/src/new.ts', file_text: 'n\n' } },
        { toolName: 'edit', args: { path: 'C:\\r\\src\\win.ts', old_str: 'a', new_str: 'b' } },
        { toolName: 'create', args: { path: '/r/src/gone.ts', file_text: 't\n' } },
        { toolName: 'bash', args: { command: 'rm -f /r/src/gone.ts' } },
        { toolName: 'apply_patch', args: { changes: [{ path: '/r/src/codex.ts', kind: 'update' }] } },
    ];

    it('maps each captured file to a relative row with status, counts and content kind', () => {
        const entries = buildWhisperReviewEntries(stateFrom(calls), '/r');
        const byPath = Object.fromEntries(entries.map(e => [e.file.path, e]));
        // Counts are the popover's own net counts, carried through unchanged.
        const created = collectFileEdits(calls).find(f => f.path.endsWith('new.ts'))!;
        expect(byPath['src/new.ts'].file).toMatchObject({ status: 'A', additions: created.netInsertions, deletions: 0 });
        expect(byPath['src/new.ts'].content).toMatchObject({ kind: 'whole', original: '', modified: 'n\n' });
        expect(byPath['src/gone.ts'].file.status).toBe('D');
        expect(byPath['src/gone.ts'].content.kind).toBe('deleted');
        expect(byPath['src/codex.ts'].content.kind).toBe('unavailable');
        // A path outside the root keeps its full form, with `/` separators.
        const win = entries.find(e => e.sourcePath.includes('win.ts'))!;
        expect(win.file.path).toBe('C:/r/src/win.ts');
        expect(win.content.kind).toBe('patch');
    });

    it('keys models and content by the captured diff', () => {
        const a = buildWhisperReviewEntries(stateFrom([{ toolName: 'create', args: { path: 'a.ts', file_text: '1' } }]));
        const b = buildWhisperReviewEntries(stateFrom([{ toolName: 'create', args: { path: 'a.ts', file_text: '2' } }]));
        expect(a[0].modelIdentity).not.toBe(b[0].modelIdentity);
        expect(whisperReviewContentKey(a)).not.toBe(whisperReviewContentKey(b));
        expect(whisperReviewContentKey(a)).toBe(whisperReviewContentKey(
            buildWhisperReviewEntries(stateFrom([{ toolName: 'create', args: { path: 'a.ts', file_text: '1' } }])),
        ));
    });
});
