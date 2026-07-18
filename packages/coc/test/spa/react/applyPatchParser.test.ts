import { describe, it, expect } from 'vitest';
import { parseApplyPatchFileChanges } from '../../../src/server/spa/client/react/utils/applyPatchParser';

// ---------------------------------------------------------------------------
// Legacy *** marker format (existing behavior, must be unchanged)
// ---------------------------------------------------------------------------

describe('parseApplyPatchFileChanges — legacy format', () => {
    it('returns [] for empty input', () => {
        expect(parseApplyPatchFileChanges('')).toEqual([]);
    });

    it('returns [] when no file markers are present', () => {
        expect(parseApplyPatchFileChanges('not a patch at all')).toEqual([]);
    });

    it('counts insertions for an Add File section', () => {
        const patch = [
            '*** Begin Patch',
            '*** Add File: src/new.ts',
            '+line1',
            '+line2',
            '*** End Patch',
        ].join('\n');
        const [entry] = parseApplyPatchFileChanges(patch);
        expect(entry.path).toBe('src/new.ts');
        expect(entry.isCreate).toBe(true);
        expect(entry.isDelete).toBe(false);
        expect(entry.insertions).toBe(2);
        expect(entry.deletions).toBe(0);
    });

    it('counts deletions for a Delete File section', () => {
        const patch = [
            '*** Begin Patch',
            '*** Delete File: src/old.ts',
            '-removed1',
            '-removed2',
            '-removed3',
            '*** End Patch',
        ].join('\n');
        const [entry] = parseApplyPatchFileChanges(patch);
        expect(entry.path).toBe('src/old.ts');
        expect(entry.isCreate).toBe(false);
        expect(entry.isDelete).toBe(true);
        expect(entry.insertions).toBe(0);
        expect(entry.deletions).toBe(3);
    });

    it('counts both insertions and deletions for an Update File section', () => {
        const patch = [
            '*** Begin Patch',
            '*** Update File: src/mod.ts',
            '@@',
            '-old line',
            '+new line',
            '+added line',
            '*** End Patch',
        ].join('\n');
        const [entry] = parseApplyPatchFileChanges(patch);
        expect(entry.path).toBe('src/mod.ts');
        expect(entry.isCreate).toBe(false);
        expect(entry.isDelete).toBe(false);
        expect(entry.insertions).toBe(2);
        expect(entry.deletions).toBe(1);
    });

    it('handles multi-file legacy patches and sorts by path', () => {
        const patch = [
            '*** Begin Patch',
            '*** Update File: src/b.ts',
            '-b',
            '+B',
            '*** Add File: src/a.ts',
            '+A',
            '*** End Patch',
        ].join('\n');
        const result = parseApplyPatchFileChanges(patch);
        expect(result.map(e => e.path)).toEqual(['src/a.ts', 'src/b.ts']);
    });

    it('skips --- and +++ file header lines in the body', () => {
        const patch = [
            '*** Update File: src/a.ts',
            '--- a/src/a.ts',
            '+++ b/src/a.ts',
            '-old',
            '+new',
        ].join('\n');
        const [entry] = parseApplyPatchFileChanges(patch);
        expect(entry.insertions).toBe(1);
        expect(entry.deletions).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// Unified diff --git format
// ---------------------------------------------------------------------------

describe('parseApplyPatchFileChanges — unified git diff format', () => {
    it('parses an update section with real +/- counts', () => {
        const patch = [
            'diff --git a/src/mod.ts b/src/mod.ts',
            'index 1111111..2222222 100644',
            '--- a/src/mod.ts',
            '+++ b/src/mod.ts',
            '@@ -1 +1 @@',
            '-export const value = false;',
            '+export const value = true;',
        ].join('\n');
        const [entry] = parseApplyPatchFileChanges(patch);
        expect(entry.path).toBe('src/mod.ts');
        expect(entry.isCreate).toBe(false);
        expect(entry.isDelete).toBe(false);
        expect(entry.insertions).toBe(1);
        expect(entry.deletions).toBe(1);
    });

    it('detects a new file from `new file mode` metadata', () => {
        const patch = [
            'diff --git a/src/new.ts b/src/new.ts',
            'new file mode 100644',
            'index 0000000..1111111',
            '--- /dev/null',
            '+++ b/src/new.ts',
            '@@ -0,0 +1,2 @@',
            '+line1',
            '+line2',
        ].join('\n');
        const [entry] = parseApplyPatchFileChanges(patch);
        expect(entry.path).toBe('src/new.ts');
        expect(entry.isCreate).toBe(true);
        expect(entry.isDelete).toBe(false);
        expect(entry.insertions).toBe(2);
        expect(entry.deletions).toBe(0);
    });

    it('detects a new file from `--- /dev/null` when mode line is absent', () => {
        const patch = [
            'diff --git a/src/new.ts b/src/new.ts',
            '--- /dev/null',
            '+++ b/src/new.ts',
            '@@ -0,0 +1 @@',
            '+hello',
        ].join('\n');
        const [entry] = parseApplyPatchFileChanges(patch);
        expect(entry.isCreate).toBe(true);
        expect(entry.insertions).toBe(1);
    });

    it('detects a deleted file from `deleted file mode`', () => {
        const patch = [
            'diff --git a/src/old.ts b/src/old.ts',
            'deleted file mode 100644',
            'index 1111111..0000000',
            '--- a/src/old.ts',
            '+++ /dev/null',
            '@@ -1,2 +0,0 @@',
            '-line1',
            '-line2',
        ].join('\n');
        const [entry] = parseApplyPatchFileChanges(patch);
        expect(entry.path).toBe('src/old.ts');
        expect(entry.isCreate).toBe(false);
        expect(entry.isDelete).toBe(true);
        expect(entry.insertions).toBe(0);
        expect(entry.deletions).toBe(2);
    });

    it('handles a rename (old path differs from new path)', () => {
        const patch = [
            'diff --git a/src/old-name.ts b/src/new-name.ts',
            'similarity index 90%',
            'rename from src/old-name.ts',
            'rename to src/new-name.ts',
            '--- a/src/old-name.ts',
            '+++ b/src/new-name.ts',
            '@@ -1 +1 @@',
            '-old',
            '+new',
        ].join('\n');
        const [entry] = parseApplyPatchFileChanges(patch);
        expect(entry.path).toBe('src/new-name.ts');
        expect(entry.fromPath).toBe('src/old-name.ts');
        expect(entry.insertions).toBe(1);
        expect(entry.deletions).toBe(1);
    });

    it('handles a multi-file unified diff and sorts by path', () => {
        const patch = [
            'diff --git a/src/b.ts b/src/b.ts',
            '--- a/src/b.ts',
            '+++ b/src/b.ts',
            '@@ -1 +1 @@',
            '-b',
            '+B',
            'diff --git a/src/a.ts b/src/a.ts',
            'new file mode 100644',
            '--- /dev/null',
            '+++ b/src/a.ts',
            '@@ -0,0 +1 @@',
            '+A',
        ].join('\n');
        const result = parseApplyPatchFileChanges(patch);
        expect(result.map(e => e.path)).toEqual(['src/a.ts', 'src/b.ts']);
        expect(result[0].isCreate).toBe(true);
        expect(result[0].insertions).toBe(1);
        expect(result[1].isCreate).toBe(false);
        expect(result[1].insertions).toBe(1);
        expect(result[1].deletions).toBe(1);
    });

    it('skips git metadata lines from body counting (index, similarity, rename, old/new mode)', () => {
        const patch = [
            'diff --git a/src/f.ts b/src/f.ts',
            'index abc1234..def5678 100644',
            'old mode 100644',
            'new mode 100755',
            '--- a/src/f.ts',
            '+++ b/src/f.ts',
            '@@ -1 +1 @@',
            '-a',
            '+b',
        ].join('\n');
        const [entry] = parseApplyPatchFileChanges(patch);
        expect(entry.insertions).toBe(1);
        expect(entry.deletions).toBe(1);
    });

    it('parses a Codex `/dev/null` create header as a single create with no fromPath', () => {
        const patch = [
            'diff --git /dev/null b/src/new.ts',
            'index e69de29bb..50661e98b 100644',
            '--- /dev/null',
            '+++ b/src/new.ts',
            '@@ -0,0 +1,3 @@',
            '+line1',
            '+line2',
            '+line3',
        ].join('\n');
        const result = parseApplyPatchFileChanges(patch);
        expect(result).toHaveLength(1);
        const [entry] = result;
        expect(entry.path).toBe('src/new.ts');
        expect(entry.isCreate).toBe(true);
        expect(entry.isDelete).toBe(false);
        expect(entry.insertions).toBe(3);
        expect(entry.deletions).toBe(0);
        expect(entry.fromPath).toBeUndefined();
    });

    it('handles CRLF line endings', () => {
        const patch = [
            'diff --git a/src/a.ts b/src/a.ts',
            '--- a/src/a.ts',
            '+++ b/src/a.ts',
            '@@ -1 +1 @@',
            '-old',
            '+new',
        ].join('\r\n');
        const [entry] = parseApplyPatchFileChanges(patch);
        expect(entry.insertions).toBe(1);
        expect(entry.deletions).toBe(1);
    });
});
