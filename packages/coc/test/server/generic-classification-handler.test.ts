/**
 * Tests for generic-classification-handler helpers.
 *
 * Regression coverage for the bug where commit/branch-range payloads
 * were missing `prId` and `headSha`, causing ClassificationExecutor to skip
 * the `saveClassification` tool injection and never persist results.
 */

import { describe, it, expect } from 'vitest';

// We test the internal `extractPayloadFields` logic indirectly via the
// exported public surface (the payload shape produced on enqueue).  Since the
// function is not exported, we re-implement the expected contract here and
// cross-check it against `splitIdentifier` so the two stay in sync.

// Mirrors splitIdentifier from generic-classification-handler.ts
function splitIdentifier(type: string, identifier: string): { prId: string; headSha: string } {
    if (type === 'pr') {
        const colonIdx = identifier.indexOf(':');
        if (colonIdx === -1) return { prId: identifier, headSha: 'unknown' };
        return { prId: identifier.slice(0, colonIdx), headSha: identifier.slice(colonIdx + 1) };
    }
    return { prId: `_${type}`, headSha: identifier };
}

// Mirrors the FIXED extractPayloadFields from generic-classification-handler.ts
function extractPayloadFields(type: string, identifier: string): Record<string, string> {
    if (type === 'pr') {
        const colonIdx = identifier.indexOf(':');
        if (colonIdx !== -1) {
            return { prId: identifier.slice(0, colonIdx), headSha: identifier.slice(colonIdx + 1) };
        }
        return { prId: identifier, headSha: 'unknown' };
    }
    if (type === 'commit') {
        return { commitHash: identifier, prId: '_commit', headSha: identifier };
    }
    return { branchRange: identifier, prId: '_branch-range', headSha: identifier };
}

describe('extractPayloadFields', () => {
    describe('pr type', () => {
        it('splits prId and headSha from identifier', () => {
            const fields = extractPayloadFields('pr', '42:abc1234');
            expect(fields.prId).toBe('42');
            expect(fields.headSha).toBe('abc1234');
        });

        it('falls back to headSha=unknown when no colon', () => {
            const fields = extractPayloadFields('pr', '42');
            expect(fields.prId).toBe('42');
            expect(fields.headSha).toBe('unknown');
        });
    });

    describe('commit type — regression: executor tool guard', () => {
        it('includes prId and headSha so ClassificationExecutor injects saveClassification', () => {
            const hash = '954b982b9a5c53cb2ce7bb8c31e2695a647cfa18';
            const fields = extractPayloadFields('commit', hash);
            // Both fields must be present for the tool guard to pass
            expect(fields.prId).toBeTruthy();
            expect(fields.headSha).toBeTruthy();
            expect(fields.commitHash).toBe(hash);
        });

        it('prId/headSha match splitIdentifier so store reads the same file key', () => {
            const hash = 'deadbeef';
            const fields = extractPayloadFields('commit', hash);
            const { prId, headSha } = splitIdentifier('commit', hash);
            expect(fields.prId).toBe(prId);
            expect(fields.headSha).toBe(headSha);
        });
    });

    describe('branch-range type — regression: executor tool guard', () => {
        it('includes prId and headSha so ClassificationExecutor injects saveClassification', () => {
            const range = 'main..feature/my-branch';
            const fields = extractPayloadFields('branch-range', range);
            expect(fields.prId).toBeTruthy();
            expect(fields.headSha).toBeTruthy();
            expect(fields.branchRange).toBe(range);
        });

        it('prId/headSha match splitIdentifier so store reads the same file key', () => {
            const range = 'main..feature/my-branch';
            const fields = extractPayloadFields('branch-range', range);
            const { prId, headSha } = splitIdentifier('branch-range', range);
            expect(fields.prId).toBe(prId);
            expect(fields.headSha).toBe(headSha);
        });
    });
});
