/**
 * BaseCommentsManager Tests
 *
 * Verifies the shared CRUD methods in BaseCommentsManager:
 *   - getComments / getComment
 *   - writeComments (uses atomicWriteJSON, not inline tmp/rename)
 *   - addCommentCore (UUID + timestamp generation)
 *   - updateComment
 *   - deleteComment
 *   - addReply
 *
 * Also verifies the shared isValidWorkspaceId guard.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    BaseCommentsManager,
    isValidWorkspaceId,
    type BaseComment,
    type BaseReply,
} from '../../src/server/tasks/comments/base-comments-manager';

// ============================================================================
// Minimal concrete implementation for testing
// ============================================================================

interface TestComment extends BaseComment {
    text: string;
}

interface TestReply extends BaseReply {
    // inherits id, author, text, createdAt, isAI
}

interface TestStorage {
    comments: TestComment[];
    settings: { version: number };
}

class TestManager extends BaseCommentsManager<TestComment, TestReply> {
    private readonly root: string;

    constructor(dataDir: string) {
        super();
        this.root = dataDir;
    }

    protected getWorkspaceDir(wsId: string): string {
        return path.join(this.root, wsId);
    }

    protected buildStorage(comments: TestComment[]): TestStorage {
        return { comments, settings: { version: 1 } };
    }

    // Expose protected helpers for testing
    exposedGetStorageFile(wsId: string, key: string): string {
        return this.getStorageFile(wsId, key);
    }

    exposedEnsureWorkspaceDir(wsId: string): void {
        this.ensureWorkspaceDir(wsId);
    }

    async exposedAddCommentCore(
        wsId: string,
        key: string,
        data: Omit<TestComment, 'id' | 'createdAt' | 'updatedAt'>
    ): Promise<TestComment> {
        return this.addCommentCore(wsId, key, data);
    }
}

// ============================================================================
// Helpers
// ============================================================================

function makeCommentData(overrides: Partial<Omit<TestComment, 'id' | 'createdAt' | 'updatedAt'>> = {}) {
    return {
        text: 'hello world',
        replies: undefined,
        ...overrides,
    };
}

// ============================================================================
// Tests
// ============================================================================

describe('isValidWorkspaceId', () => {
    it('accepts alphanumeric IDs', () => {
        expect(isValidWorkspaceId('ws1')).toBe(true);
        expect(isValidWorkspaceId('workspace123')).toBe(true);
    });

    it('accepts hyphens and underscores', () => {
        expect(isValidWorkspaceId('ws-kss6a7')).toBe(true);
        expect(isValidWorkspaceId('ws_kss6a7')).toBe(true);
    });

    it('rejects path traversal with ..', () => {
        expect(isValidWorkspaceId('../etc')).toBe(false);
        expect(isValidWorkspaceId('ws/../evil')).toBe(false);
    });

    it('rejects slashes', () => {
        expect(isValidWorkspaceId('ws/bad')).toBe(false);
        expect(isValidWorkspaceId('ws\\bad')).toBe(false);
    });

    it('rejects empty string', () => {
        expect(isValidWorkspaceId('')).toBe(false);
    });

    it('rejects IDs with spaces', () => {
        expect(isValidWorkspaceId('ws id')).toBe(false);
    });
});

describe('BaseCommentsManager', () => {
    let tmpDir: string;
    let manager: TestManager;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-base-manager-'));
        manager = new TestManager(tmpDir);
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    // ------------------------------------------------------------------
    // getStorageFile
    // ------------------------------------------------------------------

    describe('getStorageFile', () => {
        it('builds path as <wsDir>/<key>.json', () => {
            const file = manager.exposedGetStorageFile('ws1', 'abc123');
            expect(file).toBe(path.join(tmpDir, 'ws1', 'abc123.json'));
        });
    });

    // ------------------------------------------------------------------
    // ensureWorkspaceDir
    // ------------------------------------------------------------------

    describe('ensureWorkspaceDir', () => {
        it('creates the workspace directory if missing', () => {
            const wsDir = path.join(tmpDir, 'newws');
            expect(fs.existsSync(wsDir)).toBe(false);
            manager.exposedEnsureWorkspaceDir('newws');
            expect(fs.existsSync(wsDir)).toBe(true);
        });

        it('is idempotent (no error if dir already exists)', () => {
            manager.exposedEnsureWorkspaceDir('newws');
            expect(() => manager.exposedEnsureWorkspaceDir('newws')).not.toThrow();
        });
    });

    // ------------------------------------------------------------------
    // getComments (empty / absent file)
    // ------------------------------------------------------------------

    describe('getComments', () => {
        it('returns [] when the file does not exist', async () => {
            const result = await manager.getComments('ws1', 'missing-key');
            expect(result).toEqual([]);
        });

        it('returns [] for a corrupted JSON file', async () => {
            const dir = path.join(tmpDir, 'ws1');
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(path.join(dir, 'bad.json'), 'NOT JSON', 'utf8');
            const result = await manager.getComments('ws1', 'bad');
            expect(result).toEqual([]);
        });
    });

    // ------------------------------------------------------------------
    // writeComments (atomicWriteJSON: creates parent dir, tmp→rename)
    // ------------------------------------------------------------------

    describe('writeComments', () => {
        it('persists comments to disk in the correct storage envelope', async () => {
            const comment: TestComment = {
                id: 'c1',
                text: 'hello',
                createdAt: '2024-01-01T00:00:00.000Z',
                updatedAt: '2024-01-01T00:00:00.000Z',
            };
            await manager.writeComments('ws1', 'key1', [comment]);

            const file = manager.exposedGetStorageFile('ws1', 'key1');
            const raw = fs.readFileSync(file, 'utf8');
            const storage: TestStorage = JSON.parse(raw);
            expect(storage.settings).toEqual({ version: 1 });
            expect(storage.comments).toHaveLength(1);
            expect(storage.comments[0].text).toBe('hello');
        });

        it('creates the workspace directory automatically (atomicWriteJSON)', async () => {
            const wsDir = path.join(tmpDir, 'newws2');
            expect(fs.existsSync(wsDir)).toBe(false);
            await manager.writeComments('newws2', 'k', []);
            expect(fs.existsSync(wsDir)).toBe(true);
        });

        it('does not leave a .tmp file on success', async () => {
            await manager.writeComments('ws1', 'key2', []);
            const file = manager.exposedGetStorageFile('ws1', 'key2');
            expect(fs.existsSync(`${file}.tmp`)).toBe(false);
        });
    });

    // ------------------------------------------------------------------
    // addCommentCore
    // ------------------------------------------------------------------

    describe('addCommentCore', () => {
        it('assigns a UUID id', async () => {
            const comment = await manager.exposedAddCommentCore('ws1', 'k', makeCommentData());
            expect(comment.id).toMatch(
                /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
            );
        });

        it('sets createdAt and updatedAt to now', async () => {
            const before = Date.now();
            const comment = await manager.exposedAddCommentCore('ws1', 'k', makeCommentData());
            const after = Date.now();
            expect(new Date(comment.createdAt).getTime()).toBeGreaterThanOrEqual(before);
            expect(new Date(comment.createdAt).getTime()).toBeLessThanOrEqual(after);
            expect(comment.createdAt).toBe(comment.updatedAt);
        });

        it('persists comment so subsequent getComments returns it', async () => {
            await manager.exposedAddCommentCore('ws1', 'k', makeCommentData({ text: 'first' }));
            const comments = await manager.getComments('ws1', 'k');
            expect(comments).toHaveLength(1);
            expect(comments[0].text).toBe('first');
        });

        it('accumulates multiple comments', async () => {
            await manager.exposedAddCommentCore('ws1', 'k', makeCommentData({ text: 'a' }));
            await manager.exposedAddCommentCore('ws1', 'k', makeCommentData({ text: 'b' }));
            const comments = await manager.getComments('ws1', 'k');
            expect(comments).toHaveLength(2);
        });
    });

    // ------------------------------------------------------------------
    // getComment
    // ------------------------------------------------------------------

    describe('getComment', () => {
        it('returns the correct comment by ID', async () => {
            const c = await manager.exposedAddCommentCore('ws1', 'k', makeCommentData({ text: 'x' }));
            const found = await manager.getComment('ws1', 'k', c.id);
            expect(found?.text).toBe('x');
        });

        it('returns null for an unknown ID', async () => {
            await manager.exposedAddCommentCore('ws1', 'k', makeCommentData());
            const found = await manager.getComment('ws1', 'k', 'nonexistent');
            expect(found).toBeNull();
        });
    });

    // ------------------------------------------------------------------
    // updateComment
    // ------------------------------------------------------------------

    describe('updateComment', () => {
        it('returns null for unknown ID', async () => {
            const result = await manager.updateComment('ws1', 'k', 'bad-id', { text: 'new' });
            expect(result).toBeNull();
        });

        it('updates the specified fields', async () => {
            const c = await manager.exposedAddCommentCore('ws1', 'k', makeCommentData({ text: 'old' }));
            const updated = await manager.updateComment('ws1', 'k', c.id, { text: 'new' });
            expect(updated?.text).toBe('new');
        });

        it('advances updatedAt but preserves createdAt', async () => {
            const c = await manager.exposedAddCommentCore('ws1', 'k', makeCommentData());
            await new Promise(r => setTimeout(r, 10));
            const updated = await manager.updateComment('ws1', 'k', c.id, { text: 'changed' });
            expect(updated?.createdAt).toBe(c.createdAt);
            expect(updated?.updatedAt).not.toBe(c.updatedAt);
        });

        it('cannot override id or createdAt via updates', async () => {
            const c = await manager.exposedAddCommentCore('ws1', 'k', makeCommentData());
            const updated = await manager.updateComment('ws1', 'k', c.id, {
                id: 'hacked-id',
                createdAt: '1970-01-01T00:00:00.000Z',
            } as any);
            expect(updated?.id).toBe(c.id);
            expect(updated?.createdAt).toBe(c.createdAt);
        });

        it('persists the update', async () => {
            const c = await manager.exposedAddCommentCore('ws1', 'k', makeCommentData({ text: 'old' }));
            await manager.updateComment('ws1', 'k', c.id, { text: 'persisted' });
            const fresh = await manager.getComment('ws1', 'k', c.id);
            expect(fresh?.text).toBe('persisted');
        });
    });

    // ------------------------------------------------------------------
    // deleteComment
    // ------------------------------------------------------------------

    describe('deleteComment', () => {
        it('returns false when comment does not exist', async () => {
            const result = await manager.deleteComment('ws1', 'k', 'no-such');
            expect(result).toBe(false);
        });

        it('returns true and removes the comment', async () => {
            const c = await manager.exposedAddCommentCore('ws1', 'k', makeCommentData());
            const deleted = await manager.deleteComment('ws1', 'k', c.id);
            expect(deleted).toBe(true);
            const remaining = await manager.getComments('ws1', 'k');
            expect(remaining).toHaveLength(0);
        });

        it('only removes the targeted comment', async () => {
            const c1 = await manager.exposedAddCommentCore('ws1', 'k', makeCommentData({ text: 'keep' }));
            const c2 = await manager.exposedAddCommentCore('ws1', 'k', makeCommentData({ text: 'delete' }));
            await manager.deleteComment('ws1', 'k', c2.id);
            const remaining = await manager.getComments('ws1', 'k');
            expect(remaining).toHaveLength(1);
            expect(remaining[0].id).toBe(c1.id);
        });
    });

    // ------------------------------------------------------------------
    // addReply
    // ------------------------------------------------------------------

    describe('addReply', () => {
        it('returns null when comment does not exist', async () => {
            const reply = await manager.addReply('ws1', 'k', 'no-such', {
                author: 'Alice',
                text: 'hi',
            });
            expect(reply).toBeNull();
        });

        it('creates a reply with UUID and timestamp', async () => {
            const c = await manager.exposedAddCommentCore('ws1', 'k', makeCommentData());
            const reply = await manager.addReply('ws1', 'k', c.id, {
                author: 'Bob',
                text: 'looks good',
            });
            expect(reply).not.toBeNull();
            expect(reply!.id).toMatch(
                /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
            );
            expect(reply!.author).toBe('Bob');
            expect(reply!.text).toBe('looks good');
            expect(reply!.createdAt).toBeTruthy();
        });

        it('persists reply on the comment', async () => {
            const c = await manager.exposedAddCommentCore('ws1', 'k', makeCommentData());
            await manager.addReply('ws1', 'k', c.id, { author: 'AI', text: 'auto', isAI: true });
            const fresh = await manager.getComment('ws1', 'k', c.id);
            expect(fresh?.replies).toHaveLength(1);
            expect(fresh?.replies![0].isAI).toBe(true);
        });

        it('advances comment updatedAt after reply', async () => {
            const c = await manager.exposedAddCommentCore('ws1', 'k', makeCommentData());
            await new Promise(r => setTimeout(r, 10));
            await manager.addReply('ws1', 'k', c.id, { author: 'X', text: 'y' });
            const fresh = await manager.getComment('ws1', 'k', c.id);
            expect(fresh?.updatedAt).not.toBe(c.updatedAt);
        });
    });
});
