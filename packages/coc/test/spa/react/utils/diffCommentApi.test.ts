/**
 * Tests for diffCommentApi shared utilities.
 *
 * Verifies computeStorageKey, buildDiffCommentUrl, patchDiffComment,
 * and deleteDiffCommentById.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    computeStorageKey,
    buildDiffCommentUrl,
    patchDiffComment,
    deleteDiffCommentById,
} from '../../../../src/server/spa/client/react/utils/diffCommentApi';
import type { DiffCommentContext } from '../../../../src/server/spa/client/comments/diff-comment-types';

// ============================================================================
// Shared test data
// ============================================================================

const ctx: DiffCommentContext = {
    repositoryId: 'repo-1',
    oldRef: 'abc123',
    newRef: 'def456',
    filePath: 'src/index.ts',
};

const workingTreeCtx: DiffCommentContext = {
    repositoryId: 'repo-1',
    oldRef: 'abc123',
    newRef: 'working-tree',
    filePath: 'src/index.ts',
};

function deterministicKey(): string {
    return new Uint8Array(32).fill(0xab).reduce((s, b) => s + b.toString(16).padStart(2, '0'), '');
}

// ============================================================================
// Setup / Teardown
// ============================================================================

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
    vi.stubGlobal('crypto', {
        subtle: {
            digest: vi.fn().mockImplementation(async () =>
                new Uint8Array(32).fill(0xab).buffer
            ),
        },
    });

    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
});

// ============================================================================
// computeStorageKey
// ============================================================================

describe('computeStorageKey', () => {
    it('returns a 64-char hex string for a normal diff context', async () => {
        const key = await computeStorageKey(ctx);
        expect(key).toHaveLength(64);
        expect(key).toMatch(/^[0-9a-f]+$/);
    });

    it('returns a 64-char hex string for a working-tree context', async () => {
        const key = await computeStorageKey(workingTreeCtx);
        expect(key).toHaveLength(64);
    });

    it('encodes normal diff as repositoryId+oldRef+newRef+filePath', async () => {
        const encoder = new TextEncoder();
        const digestSpy = vi.mocked(crypto.subtle.digest);

        await computeStorageKey(ctx);

        expect(digestSpy).toHaveBeenCalledWith(
            'SHA-256',
            encoder.encode(ctx.repositoryId + ctx.oldRef + ctx.newRef + ctx.filePath),
        );
    });

    it('encodes working-tree diff as repositoryId+filePath+"working-tree"', async () => {
        const encoder = new TextEncoder();
        const digestSpy = vi.mocked(crypto.subtle.digest);

        await computeStorageKey(workingTreeCtx);

        expect(digestSpy).toHaveBeenCalledWith(
            'SHA-256',
            encoder.encode(workingTreeCtx.repositoryId + workingTreeCtx.filePath + 'working-tree'),
        );
    });
});

// ============================================================================
// buildDiffCommentUrl
// ============================================================================

describe('buildDiffCommentUrl', () => {
    it('includes wsId, storageKey, and commentId in the URL', () => {
        const url = buildDiffCommentUrl('ws-1', 'key123', 'comment-abc');
        expect(url).toContain('/diff-comments/ws-1/key123/comment-abc');
    });

    it('URL-encodes wsId with special characters', () => {
        const url = buildDiffCommentUrl('ws/1', 'key', 'cid');
        expect(url).toContain(encodeURIComponent('ws/1'));
    });

    it('URL-encodes commentId with special characters', () => {
        const url = buildDiffCommentUrl('ws', 'key', 'id with spaces');
        expect(url).toContain(encodeURIComponent('id with spaces'));
    });
});

// ============================================================================
// patchDiffComment
// ============================================================================

describe('patchDiffComment', () => {
    it('sends a PATCH request and returns the updated comment', async () => {
        const updated = { id: 'c1', status: 'resolved', comment: 'text' };
        fetchMock.mockResolvedValue({
            ok: true,
            json: async () => ({ comment: updated }),
        });

        const result = await patchDiffComment('ws-1', deterministicKey(), 'c1', { status: 'resolved' });

        expect(fetchMock).toHaveBeenCalledOnce();
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toContain('c1');
        expect(init.method).toBe('PATCH');
        expect(JSON.parse(init.body as string)).toEqual({ status: 'resolved' });
        expect(result).toEqual(updated);
    });

    it('throws when the response is not ok', async () => {
        fetchMock.mockResolvedValue({ ok: false, status: 500 });

        await expect(
            patchDiffComment('ws-1', deterministicKey(), 'c1', { status: 'resolved' })
        ).rejects.toThrow('CoC API request failed: 500');
    });
});

// ============================================================================
// deleteDiffCommentById
// ============================================================================

describe('deleteDiffCommentById', () => {
    it('sends a DELETE request', async () => {
        fetchMock.mockResolvedValue({ ok: true, status: 204 });

        await deleteDiffCommentById('ws-1', deterministicKey(), 'c1');

        expect(fetchMock).toHaveBeenCalledOnce();
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toContain('c1');
        expect(init.method).toBe('DELETE');
    });

    it('throws when the response is not ok', async () => {
        fetchMock.mockResolvedValue({ ok: false, status: 404 });

        await expect(
            deleteDiffCommentById('ws-1', deterministicKey(), 'c1')
        ).rejects.toThrow('CoC API request failed: 404');
    });
});
