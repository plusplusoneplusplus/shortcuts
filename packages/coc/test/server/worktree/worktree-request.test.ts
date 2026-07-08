/**
 * Unit tests for the worktree execution request parser/validator (AC-01).
 */

import { describe, it, expect } from 'vitest';
import { parseWorktreeExecutionRequest } from '../../../src/server/worktree/worktree-request';

describe('parseWorktreeExecutionRequest', () => {
    // ── omitted / opted-out → no request, no error ─────────────────────────
    it('treats an absent worktree field as no request', () => {
        expect(parseWorktreeExecutionRequest(undefined)).toEqual({ ok: true, value: undefined });
    });

    it('treats null as no request', () => {
        expect(parseWorktreeExecutionRequest(null)).toEqual({ ok: true, value: undefined });
    });

    it('treats { enabled: false } as opted out (no request)', () => {
        expect(parseWorktreeExecutionRequest({ enabled: false })).toEqual({ ok: true, value: undefined });
    });

    // ── enabled requests ───────────────────────────────────────────────────
    it('accepts { enabled: true } with no baseRef', () => {
        expect(parseWorktreeExecutionRequest({ enabled: true })).toEqual({
            ok: true,
            value: { enabled: true },
        });
    });

    it('accepts a plausible baseRef and trims it', () => {
        expect(parseWorktreeExecutionRequest({ enabled: true, baseRef: '  feature/x  ' })).toEqual({
            ok: true,
            value: { enabled: true, baseRef: 'feature/x' },
        });
    });

    it.each([
        'HEAD',
        'HEAD~3',
        'HEAD^',
        'main',
        'origin/main',
        'release/1.2.3',
        'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0',
        'v1.0.0',
    ])('accepts ref %s', (ref) => {
        expect(parseWorktreeExecutionRequest({ enabled: true, baseRef: ref })).toEqual({
            ok: true,
            value: { enabled: true, baseRef: ref },
        });
    });

    it('treats an empty/whitespace baseRef as "use HEAD" (no baseRef)', () => {
        expect(parseWorktreeExecutionRequest({ enabled: true, baseRef: '   ' })).toEqual({
            ok: true,
            value: { enabled: true },
        });
        expect(parseWorktreeExecutionRequest({ enabled: true, baseRef: '' })).toEqual({
            ok: true,
            value: { enabled: true },
        });
    });

    it('ignores a null baseRef (use HEAD)', () => {
        expect(parseWorktreeExecutionRequest({ enabled: true, baseRef: null })).toEqual({
            ok: true,
            value: { enabled: true },
        });
    });

    // ── malformed → error ────────────────────────────────────────────────────
    it('rejects a non-object worktree field', () => {
        const result = parseWorktreeExecutionRequest('yes');
        expect(result.ok).toBe(false);
        expect((result as { error: string }).error).toMatch(/worktree must be an object/i);
    });

    it('rejects an array worktree field', () => {
        const result = parseWorktreeExecutionRequest([{ enabled: true }]);
        expect(result.ok).toBe(false);
        expect((result as { error: string }).error).toMatch(/must be an object/i);
    });

    it('rejects a non-boolean enabled value', () => {
        const result = parseWorktreeExecutionRequest({ enabled: 'true' });
        expect(result.ok).toBe(false);
        expect((result as { error: string }).error).toMatch(/enabled must be a boolean/i);
    });

    it('rejects a missing enabled value', () => {
        const result = parseWorktreeExecutionRequest({ baseRef: 'main' });
        expect(result.ok).toBe(false);
        expect((result as { error: string }).error).toMatch(/enabled must be a boolean/i);
    });

    it('rejects a non-string baseRef', () => {
        const result = parseWorktreeExecutionRequest({ enabled: true, baseRef: 123 });
        expect(result.ok).toBe(false);
        expect((result as { error: string }).error).toMatch(/baseRef must be a string/i);
    });

    it('rejects a baseRef that starts with "-" (flag injection guard)', () => {
        const result = parseWorktreeExecutionRequest({ enabled: true, baseRef: '--upload-pack=evil' });
        expect(result.ok).toBe(false);
        expect((result as { error: string }).error).toMatch(/must not start with/i);
    });

    it('rejects a baseRef containing whitespace', () => {
        const result = parseWorktreeExecutionRequest({ enabled: true, baseRef: 'feature x' });
        expect(result.ok).toBe(false);
        expect((result as { error: string }).error).toMatch(/whitespace or control/i);
    });

    it('rejects a baseRef containing ".." (range syntax)', () => {
        const result = parseWorktreeExecutionRequest({ enabled: true, baseRef: 'main..dev' });
        expect(result.ok).toBe(false);
        expect((result as { error: string }).error).toMatch(/must not contain/i);
    });

    it('rejects an over-long baseRef', () => {
        const result = parseWorktreeExecutionRequest({ enabled: true, baseRef: 'a'.repeat(256) });
        expect(result.ok).toBe(false);
        expect((result as { error: string }).error).toMatch(/at most 255 characters/i);
    });
});
