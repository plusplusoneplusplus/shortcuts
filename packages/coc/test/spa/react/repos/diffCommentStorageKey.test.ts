// @vitest-environment node
/**
 * Unit tests for diff comment storage key generation.
 *
 * Tests `DiffCommentsManager.hashContext()` from diff-comments-handler,
 * which computes a stable SHA-256 hex key from a DiffCommentContext.
 *
 * Key invariants:
 *   - Normal diff:    sha256(repositoryId + oldRef + newRef + filePath)
 *   - Working-tree:   sha256(repositoryId + filePath + 'working-tree')
 *   - Output: 64-char lowercase hex string
 */

import { describe, it, expect } from 'vitest';
import { DiffCommentsManager } from '../../../../src/server/diff-comments-handler';
import type { DiffCommentContext } from '../../../../src/server/spa/client/diff-comment-types';

// ============================================================================
// Fixture
// ============================================================================

const mgr = new DiffCommentsManager('/tmp/test-data');

const ctx: DiffCommentContext = {
    repositoryId: 'repo-abc',
    oldRef: 'main',
    newRef: 'feature/x',
    filePath: 'src/foo.ts',
};

// ============================================================================
// Output format
// ============================================================================

describe('DiffCommentsManager.hashContext — output format', () => {
    it('returns a 64-char hex string (SHA-256)', () => {
        const key = mgr.hashContext(ctx);
        expect(key).toMatch(/^[0-9a-f]{64}$/);
    });

    it('output is lowercase hex only', () => {
        const key = mgr.hashContext(ctx);
        expect(key).toBe(key.toLowerCase());
        expect(key).toHaveLength(64);
    });
});

// ============================================================================
// Stability
// ============================================================================

describe('DiffCommentsManager.hashContext — stability', () => {
    it('is stable across repeated calls with the same context', () => {
        const k1 = mgr.hashContext(ctx);
        const k2 = mgr.hashContext(ctx);
        expect(k1).toBe(k2);
    });

    it('is stable across different manager instances with same context', () => {
        const mgr2 = new DiffCommentsManager('/other/path');
        expect(mgr2.hashContext(ctx)).toBe(mgr.hashContext(ctx));
    });
});

// ============================================================================
// Context sensitivity
// ============================================================================

describe('DiffCommentsManager.hashContext — context sensitivity', () => {
    it('differs when filePath changes', () => {
        const other = mgr.hashContext({ ...ctx, filePath: 'src/bar.ts' });
        expect(mgr.hashContext(ctx)).not.toBe(other);
    });

    it('differs when oldRef changes', () => {
        const other = mgr.hashContext({ ...ctx, oldRef: 'develop' });
        expect(mgr.hashContext(ctx)).not.toBe(other);
    });

    it('differs when newRef changes', () => {
        const other = mgr.hashContext({ ...ctx, newRef: 'feature/y' });
        expect(mgr.hashContext(ctx)).not.toBe(other);
    });

    it('differs when repositoryId changes', () => {
        const other = mgr.hashContext({ ...ctx, repositoryId: 'repo-xyz' });
        expect(mgr.hashContext(ctx)).not.toBe(other);
    });
});

// ============================================================================
// Working-tree special case
// ============================================================================

describe('DiffCommentsManager.hashContext — working-tree', () => {
    const wtCtx: DiffCommentContext = {
        repositoryId: 'repo-abc',
        oldRef: 'HEAD',          // oldRef is ignored for working-tree
        newRef: 'working-tree',
        filePath: 'src/foo.ts',
    };

    it('returns a 64-char hex string for working-tree context', () => {
        const key = mgr.hashContext(wtCtx);
        expect(key).toMatch(/^[0-9a-f]{64}$/);
    });

    it('working-tree key differs from normal-diff key even with same file', () => {
        const normalKey = mgr.hashContext(ctx); // same file, different newRef
        const wtKey = mgr.hashContext(wtCtx);
        expect(normalKey).not.toBe(wtKey);
    });

    it('working-tree key is stable regardless of oldRef value', () => {
        const wt1 = mgr.hashContext({ ...wtCtx, oldRef: 'HEAD' });
        const wt2 = mgr.hashContext({ ...wtCtx, oldRef: 'abc123' });
        expect(wt1).toBe(wt2);
    });

    it('working-tree key differs when filePath changes', () => {
        const wt1 = mgr.hashContext(wtCtx);
        const wt2 = mgr.hashContext({ ...wtCtx, filePath: 'src/bar.ts' });
        expect(wt1).not.toBe(wt2);
    });
});
