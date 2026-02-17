/**
 * Task Comments Handler Tests
 *
 * Comprehensive tests for the task comments REST API:
 * - TaskCommentsManager unit tests (CRUD, hashing, storage)
 * - REST API integration tests (GET, POST, PATCH, DELETE)
 * - Error handling and validation
 *
 * Uses port 0 (OS-assigned) for test isolation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createExecutionServer } from '../../src/server/index';
import type { ExecutionServer } from '../../src/server/types';
import { TaskCommentsManager } from '../../src/server/task-comments-handler';
import type { TaskComment } from '../../src/server/task-comments-handler';

// ============================================================================
// HTTP Helpers
// ============================================================================

function request(
    url: string,
    options: { method?: string; body?: string; headers?: Record<string, string> } = {}
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const req = http.request(
            {
                hostname: parsed.hostname,
                port: parsed.port,
                path: parsed.pathname + parsed.search,
                method: options.method || 'GET',
                headers: options.headers,
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk: Buffer) => chunks.push(chunk));
                res.on('end', () => {
                    resolve({
                        status: res.statusCode || 0,
                        headers: res.headers,
                        body: Buffer.concat(chunks).toString('utf-8'),
                    });
                });
            }
        );
        req.on('error', reject);
        if (options.body) {
            req.write(options.body);
        }
        req.end();
    });
}

function getJSON(url: string) {
    return request(url);
}

function postJSON(url: string, data: unknown) {
    return request(url, {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    });
}

function patchJSON(url: string, data: unknown) {
    return request(url, {
        method: 'PATCH',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    });
}

function deleteRequest(url: string) {
    return request(url, { method: 'DELETE' });
}

// ============================================================================
// Test Fixtures
// ============================================================================

function makeCommentData(overrides: Partial<TaskComment> = {}): Omit<TaskComment, 'id' | 'createdAt' | 'updatedAt'> {
    return {
        filePath: 'feature/task1.md',
        selection: { startLine: 1, startColumn: 0, endLine: 1, endColumn: 10 },
        selectedText: '# Task One',
        comment: 'This needs clarification',
        status: 'open',
        ...overrides,
    };
}

// ============================================================================
// Unit Tests — TaskCommentsManager
// ============================================================================

describe('TaskCommentsManager', () => {
    let tmpDir: string;
    let manager: TaskCommentsManager;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-comments-unit-'));
        manager = new TaskCommentsManager(tmpDir);
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    // -- File Path Hashing --

    describe('File Path Hashing', () => {
        it('generates consistent hashes for same path', () => {
            const hash1 = manager.hashFilePath('feature/task1.md');
            const hash2 = manager.hashFilePath('feature/task1.md');
            expect(hash1).toBe(hash2);
        });

        it('generates different hashes for different paths', () => {
            const hash1 = manager.hashFilePath('feature/task1.md');
            const hash2 = manager.hashFilePath('feature/task2.md');
            expect(hash1).not.toBe(hash2);
        });

        it('handles special characters in paths', () => {
            const hash = manager.hashFilePath('path/with spaces/file (1).md');
            expect(hash).toBeTruthy();
            expect(hash).toHaveLength(64); // SHA-256 hex length
        });

        it('handles absolute paths', () => {
            const hash = manager.hashFilePath('/Users/test/project/task.md');
            expect(hash).toHaveLength(64);
        });

        it('produces hex string output', () => {
            const hash = manager.hashFilePath('test.md');
            expect(hash).toMatch(/^[0-9a-f]{64}$/);
        });
    });

    // -- Comment CRUD Operations --

    describe('Comment CRUD Operations', () => {
        it('creates a new comment with generated ID and timestamps', async () => {
            const data = makeCommentData();
            const comment = await manager.addComment('ws1', 'task.md', data);
            expect(comment.id).toBeTruthy();
            expect(comment.id).toMatch(/^[0-9a-f]{8}-/); // UUID format
            expect(comment.createdAt).toBeTruthy();
            expect(comment.updatedAt).toBeTruthy();
            expect(comment.comment).toBe('This needs clarification');
            expect(comment.status).toBe('open');
        });

        it('retrieves all comments for a file', async () => {
            await manager.addComment('ws1', 'task.md', makeCommentData({ comment: 'First' }));
            await manager.addComment('ws1', 'task.md', makeCommentData({ comment: 'Second' }));
            const comments = await manager.getComments('ws1', 'task.md');
            expect(comments).toHaveLength(2);
            expect(comments[0].comment).toBe('First');
            expect(comments[1].comment).toBe('Second');
        });

        it('returns empty array for file with no comments', async () => {
            const comments = await manager.getComments('ws1', 'nonexistent.md');
            expect(comments).toEqual([]);
        });

        it('updates comment fields and timestamp', async () => {
            const created = await manager.addComment('ws1', 'task.md', makeCommentData());
            const originalUpdatedAt = created.updatedAt;

            // Small delay to ensure timestamp changes
            await new Promise(r => setTimeout(r, 10));

            const updated = await manager.updateComment('ws1', 'task.md', created.id, {
                comment: 'Updated text',
                status: 'resolved',
            });
            expect(updated).not.toBeNull();
            expect(updated!.comment).toBe('Updated text');
            expect(updated!.status).toBe('resolved');
            expect(updated!.updatedAt).not.toBe(originalUpdatedAt);
        });

        it('does not update createdAt timestamp', async () => {
            const created = await manager.addComment('ws1', 'task.md', makeCommentData());
            await new Promise(r => setTimeout(r, 10));
            const updated = await manager.updateComment('ws1', 'task.md', created.id, {
                comment: 'Changed',
            });
            expect(updated!.createdAt).toBe(created.createdAt);
        });

        it('does not allow updating id via updates object', async () => {
            const created = await manager.addComment('ws1', 'task.md', makeCommentData());
            const updated = await manager.updateComment('ws1', 'task.md', created.id, {
                id: 'hacked-id',
            } as any);
            expect(updated!.id).toBe(created.id);
        });

        it('deletes a comment by ID', async () => {
            const c1 = await manager.addComment('ws1', 'task.md', makeCommentData({ comment: 'Keep' }));
            const c2 = await manager.addComment('ws1', 'task.md', makeCommentData({ comment: 'Delete' }));
            const deleted = await manager.deleteComment('ws1', 'task.md', c2.id);
            expect(deleted).toBe(true);
            const remaining = await manager.getComments('ws1', 'task.md');
            expect(remaining).toHaveLength(1);
            expect(remaining[0].id).toBe(c1.id);
        });

        it('returns false when deleting non-existent comment', async () => {
            const deleted = await manager.deleteComment('ws1', 'task.md', 'nonexistent-id');
            expect(deleted).toBe(false);
        });

        it('gets single comment by ID', async () => {
            const created = await manager.addComment('ws1', 'task.md', makeCommentData());
            const found = await manager.getComment('ws1', 'task.md', created.id);
            expect(found).not.toBeNull();
            expect(found!.id).toBe(created.id);
            expect(found!.comment).toBe(created.comment);
        });

        it('returns null for non-existent comment', async () => {
            const found = await manager.getComment('ws1', 'task.md', 'nonexistent');
            expect(found).toBeNull();
        });

        it('deletes all comments for a task file', async () => {
            await manager.addComment('ws1', 'task.md', makeCommentData());
            await manager.addComment('ws1', 'task.md', makeCommentData());
            await manager.deleteAllComments('ws1', 'task.md');
            const comments = await manager.getComments('ws1', 'task.md');
            expect(comments).toEqual([]);
        });
    });

    // -- Storage and Persistence --

    describe('Storage and Persistence', () => {
        it('persists comments to disk', async () => {
            await manager.addComment('ws1', 'task.md', makeCommentData());
            // Verify by creating a new manager pointing to the same dir
            const manager2 = new TaskCommentsManager(tmpDir);
            const comments = await manager2.getComments('ws1', 'task.md');
            expect(comments).toHaveLength(1);
        });

        it('creates workspace directory if not exists', async () => {
            await manager.addComment('new-workspace', 'task.md', makeCommentData());
            const wsDir = path.join(tmpDir, 'tasks-comments', 'new-workspace');
            expect(fs.existsSync(wsDir)).toBe(true);
        });

        it('stores settings alongside comments', async () => {
            await manager.addComment('ws1', 'task.md', makeCommentData());
            const hash = manager.hashFilePath('task.md');
            const file = path.join(tmpDir, 'tasks-comments', 'ws1', `${hash}.json`);
            const content = JSON.parse(fs.readFileSync(file, 'utf8'));
            expect(content.settings).toEqual({
                showResolved: true,
                highlightColor: '#ffeb3b',
            });
        });

        it('maintains comment order', async () => {
            await manager.addComment('ws1', 'task.md', makeCommentData({ comment: 'A' }));
            await manager.addComment('ws1', 'task.md', makeCommentData({ comment: 'B' }));
            await manager.addComment('ws1', 'task.md', makeCommentData({ comment: 'C' }));
            const comments = await manager.getComments('ws1', 'task.md');
            expect(comments.map(c => c.comment)).toEqual(['A', 'B', 'C']);
        });

        it('writes formatted JSON (pretty-printed)', async () => {
            await manager.addComment('ws1', 'task.md', makeCommentData());
            const hash = manager.hashFilePath('task.md');
            const file = path.join(tmpDir, 'tasks-comments', 'ws1', `${hash}.json`);
            const raw = fs.readFileSync(file, 'utf8');
            expect(raw).toContain('\n'); // pretty-printed
        });

        it('isolates workspaces from each other', async () => {
            await manager.addComment('ws1', 'task.md', makeCommentData({ comment: 'WS1' }));
            await manager.addComment('ws2', 'task.md', makeCommentData({ comment: 'WS2' }));
            const ws1Comments = await manager.getComments('ws1', 'task.md');
            const ws2Comments = await manager.getComments('ws2', 'task.md');
            expect(ws1Comments).toHaveLength(1);
            expect(ws1Comments[0].comment).toBe('WS1');
            expect(ws2Comments).toHaveLength(1);
            expect(ws2Comments[0].comment).toBe('WS2');
        });
    });

    // -- Error Handling --

    describe('Error Handling', () => {
        it('handles corrupted JSON gracefully', async () => {
            const hash = manager.hashFilePath('task.md');
            const wsDir = path.join(tmpDir, 'tasks-comments', 'ws1');
            fs.mkdirSync(wsDir, { recursive: true });
            fs.writeFileSync(path.join(wsDir, `${hash}.json`), '{{invalid json', 'utf8');
            const comments = await manager.getComments('ws1', 'task.md');
            expect(comments).toEqual([]);
        });

        it('handles missing comments field in storage', async () => {
            const hash = manager.hashFilePath('task.md');
            const wsDir = path.join(tmpDir, 'tasks-comments', 'ws1');
            fs.mkdirSync(wsDir, { recursive: true });
            fs.writeFileSync(path.join(wsDir, `${hash}.json`), JSON.stringify({ settings: {} }), 'utf8');
            const comments = await manager.getComments('ws1', 'task.md');
            expect(comments).toEqual([]);
        });

        it('deleteAllComments is safe for non-existent file', async () => {
            // Should not throw
            await manager.deleteAllComments('ws1', 'nonexistent.md');
        });
    });
});

// ============================================================================
// Integration Tests — REST API
// ============================================================================

describe('Task Comments REST API', () => {
    let server: ExecutionServer;
    let baseUrl: string;
    let tmpDir: string;

    beforeEach(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-comments-api-'));
        server = await createExecutionServer({ port: 0, dataDir: tmpDir });
        baseUrl = server.url;
    });

    afterEach(async () => {
        await server.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    const WS_ID = 'test-workspace';
    const TASK_PATH = 'feature/task1.md';

    function commentsUrl(taskPath = TASK_PATH) {
        return `${baseUrl}/api/comments/${WS_ID}/${taskPath}`;
    }

    function commentUrl(commentId: string, taskPath = TASK_PATH) {
        return `${baseUrl}/api/comments/${WS_ID}/${taskPath}/${commentId}`;
    }

    // -- GET /api/comments/:wsId/:taskPath --

    describe('GET /api/comments/:wsId/:taskPath', () => {
        it('returns empty array for task with no comments', async () => {
            const res = await getJSON(commentsUrl());
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.comments).toEqual([]);
        });

        it('returns all comments for a task', async () => {
            await postJSON(commentsUrl(), makeCommentData({ comment: 'First' }));
            await postJSON(commentsUrl(), makeCommentData({ comment: 'Second' }));
            const res = await getJSON(commentsUrl());
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.comments).toHaveLength(2);
        });

        it('handles nested task paths', async () => {
            const nestedPath = 'deep/nested/folder/task.md';
            await postJSON(commentsUrl(nestedPath), makeCommentData());
            const res = await getJSON(commentsUrl(nestedPath));
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.comments).toHaveLength(1);
        });

        it('returns JSON content type', async () => {
            const res = await getJSON(commentsUrl());
            expect(res.headers['content-type']).toContain('application/json');
        });

        it('includes CORS headers', async () => {
            const res = await getJSON(commentsUrl());
            expect(res.headers['access-control-allow-origin']).toBe('*');
        });
    });

    // -- POST /api/comments/:wsId/:taskPath --

    describe('POST /api/comments/:wsId/:taskPath', () => {
        it('creates a new comment and returns 201', async () => {
            const res = await postJSON(commentsUrl(), makeCommentData());
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.comment).toBeDefined();
            expect(body.comment.id).toBeTruthy();
            expect(body.comment.comment).toBe('This needs clarification');
        });

        it('generates UUID for new comment', async () => {
            const res = await postJSON(commentsUrl(), makeCommentData());
            const body = JSON.parse(res.body);
            expect(body.comment.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
        });

        it('sets createdAt and updatedAt timestamps', async () => {
            const res = await postJSON(commentsUrl(), makeCommentData());
            const body = JSON.parse(res.body);
            expect(body.comment.createdAt).toBeTruthy();
            expect(body.comment.updatedAt).toBeTruthy();
            // Timestamps should be valid ISO strings
            expect(new Date(body.comment.createdAt).toISOString()).toBe(body.comment.createdAt);
        });

        it('returns 400 for missing required fields', async () => {
            const res = await postJSON(commentsUrl(), { comment: 'Only comment' });
            expect(res.status).toBe(400);
            const body = JSON.parse(res.body);
            expect(body.error).toContain('Missing required field');
        });

        it('returns 400 for missing filePath', async () => {
            const data = { ...makeCommentData() };
            delete (data as any).filePath;
            const res = await postJSON(commentsUrl(), data);
            expect(res.status).toBe(400);
            expect(JSON.parse(res.body).error).toContain('filePath');
        });

        it('returns 400 for missing selection', async () => {
            const data = { ...makeCommentData() };
            delete (data as any).selection;
            const res = await postJSON(commentsUrl(), data);
            expect(res.status).toBe(400);
            expect(JSON.parse(res.body).error).toContain('selection');
        });

        it('returns 400 for invalid JSON', async () => {
            const res = await request(commentsUrl(), {
                method: 'POST',
                body: '{{invalid',
                headers: { 'Content-Type': 'application/json' },
            });
            expect(res.status).toBe(400);
        });

        it('preserves optional fields (author, tags)', async () => {
            const data = makeCommentData({ author: 'tester', tags: ['bug', 'priority'] } as any);
            const res = await postJSON(commentsUrl(), data);
            const body = JSON.parse(res.body);
            expect(body.comment.author).toBe('tester');
            expect(body.comment.tags).toEqual(['bug', 'priority']);
        });
    });

    // -- GET /api/comments/:wsId/:taskPath/:id --

    describe('GET /api/comments/:wsId/:taskPath/:id', () => {
        it('returns single comment', async () => {
            const createRes = await postJSON(commentsUrl(), makeCommentData());
            const { comment } = JSON.parse(createRes.body);
            const res = await getJSON(commentUrl(comment.id));
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.comment.id).toBe(comment.id);
        });

        it('returns 404 for non-existent comment', async () => {
            const res = await getJSON(commentUrl('00000000-0000-0000-0000-000000000000'));
            expect(res.status).toBe(404);
        });
    });

    // -- PATCH /api/comments/:wsId/:taskPath/:id --

    describe('PATCH /api/comments/:wsId/:taskPath/:id', () => {
        it('updates comment fields', async () => {
            const createRes = await postJSON(commentsUrl(), makeCommentData());
            const { comment } = JSON.parse(createRes.body);
            const res = await patchJSON(commentUrl(comment.id), {
                comment: 'Updated text',
                status: 'resolved',
            });
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.comment.comment).toBe('Updated text');
            expect(body.comment.status).toBe('resolved');
        });

        it('updates updatedAt timestamp', async () => {
            const createRes = await postJSON(commentsUrl(), makeCommentData());
            const { comment } = JSON.parse(createRes.body);
            await new Promise(r => setTimeout(r, 10));
            const res = await patchJSON(commentUrl(comment.id), { comment: 'Changed' });
            const body = JSON.parse(res.body);
            expect(body.comment.updatedAt).not.toBe(comment.updatedAt);
        });

        it('preserves non-updated fields', async () => {
            const createRes = await postJSON(commentsUrl(), makeCommentData());
            const { comment } = JSON.parse(createRes.body);
            const res = await patchJSON(commentUrl(comment.id), { status: 'resolved' });
            const body = JSON.parse(res.body);
            expect(body.comment.comment).toBe('This needs clarification');
            expect(body.comment.selectedText).toBe('# Task One');
        });

        it('does not allow updating id or createdAt', async () => {
            const createRes = await postJSON(commentsUrl(), makeCommentData());
            const { comment } = JSON.parse(createRes.body);
            const res = await patchJSON(commentUrl(comment.id), {
                id: 'hacked-id',
                createdAt: '2000-01-01T00:00:00.000Z',
            });
            const body = JSON.parse(res.body);
            expect(body.comment.id).toBe(comment.id);
            expect(body.comment.createdAt).toBe(comment.createdAt);
        });

        it('returns 404 for non-existent comment', async () => {
            const res = await patchJSON(commentUrl('00000000-0000-0000-0000-000000000000'), {
                comment: 'Updated',
            });
            expect(res.status).toBe(404);
        });

        it('returns 400 for invalid JSON', async () => {
            const createRes = await postJSON(commentsUrl(), makeCommentData());
            const { comment } = JSON.parse(createRes.body);
            const res = await request(commentUrl(comment.id), {
                method: 'PATCH',
                body: 'not-json',
                headers: { 'Content-Type': 'application/json' },
            });
            expect(res.status).toBe(400);
        });
    });

    // -- DELETE /api/comments/:wsId/:taskPath/:id --

    describe('DELETE /api/comments/:wsId/:taskPath/:id', () => {
        it('deletes comment and returns 204', async () => {
            const createRes = await postJSON(commentsUrl(), makeCommentData());
            const { comment } = JSON.parse(createRes.body);
            const res = await deleteRequest(commentUrl(comment.id));
            expect(res.status).toBe(204);
            expect(res.body).toBe('');
        });

        it('returns 404 for non-existent comment', async () => {
            const res = await deleteRequest(commentUrl('00000000-0000-0000-0000-000000000000'));
            expect(res.status).toBe(404);
        });

        it('actually removes the comment from storage', async () => {
            const createRes = await postJSON(commentsUrl(), makeCommentData());
            const { comment } = JSON.parse(createRes.body);
            await deleteRequest(commentUrl(comment.id));
            const getRes = await getJSON(commentsUrl());
            const body = JSON.parse(getRes.body);
            expect(body.comments).toHaveLength(0);
        });
    });

    // -- Validation --

    describe('Validation', () => {
        it('rejects invalid workspace IDs with path traversal', async () => {
            const res = await getJSON(`${baseUrl}/api/comments/../evil/task.md`);
            // The ".." gets resolved by URL parser, so route may not match (404)
            // or wsId regex rejects it (400). Either way, it's not 200.
            expect([400, 404]).toContain(res.status);
        });

        it('accepts valid workspace IDs with hyphens and underscores', async () => {
            const res = await getJSON(`${baseUrl}/api/comments/my-workspace_01/task.md`);
            expect(res.status).toBe(200);
        });
    });

    // -- Persistence --

    describe('File Persistence', () => {
        it('comments persist to disk after POST', async () => {
            await postJSON(commentsUrl(), makeCommentData());
            const commentsDir = path.join(tmpDir, 'tasks-comments', WS_ID);
            expect(fs.existsSync(commentsDir)).toBe(true);
            const files = fs.readdirSync(commentsDir);
            expect(files.length).toBe(1);
            expect(files[0]).toMatch(/\.json$/);
        });

        it('comments survive server restart', async () => {
            await postJSON(commentsUrl(), makeCommentData({ comment: 'Persistent' }));
            await server.close();

            // Restart with same data dir
            server = await createExecutionServer({ port: 0, dataDir: tmpDir });
            baseUrl = server.url;

            const res = await getJSON(`${baseUrl}/api/comments/${WS_ID}/${TASK_PATH}`);
            const body = JSON.parse(res.body);
            expect(body.comments).toHaveLength(1);
            expect(body.comments[0].comment).toBe('Persistent');
        });
    });
});
