/**
 * Task Comments Batch Resolve Tests
 *
 * Tests for buildBatchResolvePrompt(), the per-comment resolve command
 * (commandId: 'resolve'), and the POST .../batch-resolve endpoint.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createExecutionServer } from '../../src/server/index';
import type { ExecutionServer } from '@plusplusoneplusplus/coc-server';
import {
    buildBatchResolvePrompt,
    type TaskComment,
} from '../../src/server/task-comments-handler';


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
                headers: {
                    'Content-Type': 'application/json',
                    ...options.headers,
                },
            },
            (res) => {
                let body = '';
                res.on('data', (c: Buffer) => (body += c.toString()));
                res.on('end', () =>
                    resolve({ status: res.statusCode!, headers: res.headers, body })
                );
            }
        );
        req.on('error', reject);
        if (options.body) req.write(options.body);
        req.end();
    });
}

function postJSON(url: string, data: any) {
    return request(url, { method: 'POST', body: JSON.stringify(data) });
}

function makeCommentData(
    overrides: Partial<TaskComment> = {}
): Omit<TaskComment, 'id' | 'createdAt' | 'updatedAt'> {
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
// buildBatchResolvePrompt — pure function tests
// ============================================================================

describe('buildBatchResolvePrompt', () => {
    function makeComment(overrides: Partial<TaskComment> = {}): TaskComment {
        return {
            id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
            filePath: 'feature/task1.md',
            selection: { startLine: 5, startColumn: 0, endLine: 5, endColumn: 20 },
            selectedText: 'some selected text',
            comment: 'Fix this section',
            status: 'open',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
            ...overrides,
        };
    }

    it('produces correct prompt skeleton with headers and sections', () => {
        const comments = [makeComment()];
        const prompt = buildBatchResolvePrompt(comments, '/workspace/feature/task1.md', 'feature/task1.md');

        expect(prompt).toContain('# Document Revision Request');
        expect(prompt).toContain('## File: feature/task1.md');
        expect(prompt).toContain('The document is located at: /workspace/feature/task1.md');
        expect(prompt).toContain('Read it using your tools before making changes.');
        expect(prompt).toContain('### Comment 1 (Line 5)');
        expect(prompt).toContain('**ID:** `aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee`');
        expect(prompt).toContain('**Selected Text:**');
        expect(prompt).toContain('some selected text');
        expect(prompt).toContain('**Comment:** Fix this section');
        expect(prompt).toContain('**Requested Action:** Revise this section to address the comment.');
        expect(prompt).toContain('# Instructions');
        expect(prompt).toContain('Do NOT include any markdown fencing or explanation');
    });

    it('sorts comments by startLine ascending', () => {
        const c1 = makeComment({ id: 'id-line-10', selection: { startLine: 10, startColumn: 0, endLine: 10, endColumn: 5 } });
        const c2 = makeComment({ id: 'id-line-2', selection: { startLine: 2, startColumn: 0, endLine: 2, endColumn: 5 } });
        const c3 = makeComment({ id: 'id-line-7', selection: { startLine: 7, startColumn: 0, endLine: 7, endColumn: 5 } });

        const prompt = buildBatchResolvePrompt([c1, c2, c3], 'doc', 'file.md');

        const line2Pos = prompt.indexOf('Comment 1 (Line 2)');
        const line7Pos = prompt.indexOf('Comment 2 (Line 7)');
        const line10Pos = prompt.indexOf('Comment 3 (Line 10)');
        expect(line2Pos).toBeGreaterThan(-1);
        expect(line7Pos).toBeGreaterThan(line2Pos);
        expect(line10Pos).toBeGreaterThan(line7Pos);
    });

    it('filters out non-open comments', () => {
        const openComment = makeComment({ id: 'open-1', status: 'open' });
        const resolvedComment = makeComment({ id: 'resolved-1', status: 'resolved' });
        const pendingComment = makeComment({ id: 'pending-1', status: 'pending' });

        const prompt = buildBatchResolvePrompt(
            [openComment, resolvedComment, pendingComment],
            'doc content',
            'file.md'
        );

        expect(prompt).toContain('open-1');
        expect(prompt).not.toContain('resolved-1');
        expect(prompt).not.toContain('pending-1');
        // Only one comment section
        expect(prompt).toContain('### Comment 1');
        expect(prompt).not.toContain('### Comment 2');
    });

    it('handles a single comment correctly', () => {
        const comments = [makeComment()];
        const prompt = buildBatchResolvePrompt(comments, 'single doc', 'path.md');

        expect(prompt).toContain('### Comment 1 (Line 5)');
        expect(prompt).not.toContain('### Comment 2');
        expect(prompt).toContain('# Instructions');
    });

    it('includes resolve_comment tool instructions', () => {
        const comments = [makeComment()];
        const prompt = buildBatchResolvePrompt(comments, '# Doc', 'file.md');

        expect(prompt).toContain('resolve_comment');
        expect(prompt).toContain('Do NOT call `resolve_comment`');
    });

    it('includes optional author/category/tags/replies/aiResponse fields when present', () => {
        const prompt = buildBatchResolvePrompt(
            [
                makeComment({
                    author: 'Alice',
                    category: 'style',
                    tags: ['docs', 'clarity'],
                    aiResponse: 'Consider simplifying this sentence.',
                    replies: [
                        {
                            id: 'reply-1',
                            author: 'Bob',
                            text: 'I agree with this.',
                            createdAt: '2026-01-02T00:00:00.000Z',
                        },
                    ],
                }),
            ],
            '# Doc',
            'file.md'
        );

        expect(prompt).toContain('**Author:** Alice');
        expect(prompt).toContain('**Category:** style');
        expect(prompt).toContain('**Tags:** docs, clarity');
        expect(prompt).toContain('**Previous AI Response:**');
        expect(prompt).toContain('Consider simplifying this sentence.');
        expect(prompt).toContain('**Replies:**');
        expect(prompt).toContain('> Bob: I agree with this.');
    });

    it('trims author and category exactly once (regression: no double-trim)', () => {
        // Values with surrounding whitespace should be trimmed and emitted without the whitespace.
        const prompt = buildBatchResolvePrompt(
            [makeComment({ author: '  Alice  ', category: '  style  ' })],
            '# Doc',
            'file.md'
        );

        expect(prompt).toContain('**Author:** Alice');
        expect(prompt).toContain('**Category:** style');
        expect(prompt).not.toContain('**Author:**   Alice  ');
        expect(prompt).not.toContain('**Category:**   style  ');
    });

    it('omits author and category when they are whitespace-only', () => {
        const prompt = buildBatchResolvePrompt(
            [makeComment({ author: '   ', category: '\t' })],
            '# Doc',
            'file.md'
        );

        expect(prompt).not.toContain('**Author:**');
        expect(prompt).not.toContain('**Category:**');
    });
});

// ============================================================================
// Server endpoint tests
// ============================================================================

describe('batch-resolve endpoints', () => {
    let server: ExecutionServer;
    let baseUrl: string;
    let tmpDir: string;

    const WS_ID = 'test-workspace';
    const TASK_PATH = 'feature/task1.md';
    const DOC_CONTENT = '# Task One\n\nSome content here.\n';

    beforeEach(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-batch-resolve-'));
        server = await createExecutionServer({ port: 0, dataDir: tmpDir });
        baseUrl = server.url;
    });

    afterEach(async () => {
        await server.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    function commentsUrl(taskPath = TASK_PATH) {
        return `${baseUrl}/api/comments/${WS_ID}/${taskPath}`;
    }

    async function createComment(overrides: Partial<TaskComment> = {}): Promise<string> {
        const res = await postJSON(commentsUrl(), makeCommentData(overrides));
        return JSON.parse(res.body).comment.id;
    }

    function askAiUrl(commentId: string, taskPath = TASK_PATH) {
        return `${baseUrl}/api/comments/${WS_ID}/${taskPath}/${commentId}/ask-ai`;
    }

    function batchResolveUrl(taskPath = TASK_PATH) {
        return `${baseUrl}/api/comments/${WS_ID}/${taskPath}/batch-resolve`;
    }

    // ------------------------------------------------------------------
    // Per-comment resolve (commandId: 'resolve')
    // ------------------------------------------------------------------
    describe('POST /ask-ai with commandId=resolve', () => {
        it('returns 202 with taskId when bridge is available (async queue path)', async () => {
            const commentId = await createComment();
            const res = await postJSON(askAiUrl(commentId), {
                commandId: 'resolve',
                documentContent: DOC_CONTENT,
            });
            expect(res.status).toBe(202);
            const body = JSON.parse(res.body);
            expect(body.taskId).toBeDefined();
            expect(typeof body.taskId).toBe('string');
        });

        it('returns 400 when documentContent is missing', async () => {
            const commentId = await createComment();
            const res = await postJSON(askAiUrl(commentId), {
                commandId: 'resolve',
            });
            expect(res.status).toBe(400);
            const body = JSON.parse(res.body);
            expect(body.error).toContain('documentContent');
        });

        it('enqueues with correct comment ID in payload', async () => {
            const commentId = await createComment();
            const res = await postJSON(askAiUrl(commentId), {
                commandId: 'resolve',
                documentContent: DOC_CONTENT,
            });
            expect(res.status).toBe(202);
            const body = JSON.parse(res.body);
            // Verify the task exists in the queue
            const taskRes = await request(`${baseUrl}/api/queue/${body.taskId}`);
            const taskBody = JSON.parse(taskRes.body);
            expect(taskBody.task).toBeDefined();
            expect(taskBody.task.type).toBe('chat');
            expect(taskBody.task.payload.kind).toBe('chat');
            expect(taskBody.task.payload.context.resolveComments.commentIds).toContain(commentId);
            expect(taskBody.task.payload.context.resolveComments.documentContent).toBe(DOC_CONTENT);
        });
        it('sets workingDirectory to wsRootPath, not task data dir', async () => {
            const commentId = await createComment();
            const res = await postJSON(askAiUrl(commentId), {
                commandId: 'resolve',
                documentContent: DOC_CONTENT,
            });
            expect(res.status).toBe(202);
            const body = JSON.parse(res.body);

            const taskRes = await request(`${baseUrl}/api/queue/${body.taskId}`);
            const taskBody = JSON.parse(taskRes.body);
            const wd: string = taskBody.task.payload.workingDirectory;
            expect(wd).not.toContain(path.join('repos', WS_ID, 'tasks'));
            expect(wd).not.toContain(path.join('repos', WS_ID));
        });
    });

    // ------------------------------------------------------------------
    // Batch resolve endpoint
    // ------------------------------------------------------------------
    describe('POST .../batch-resolve', () => {
        it('returns 202 with taskId when bridge is available', async () => {
            const id1 = await createComment({ selectedText: 'text A', comment: 'fix A' });
            const id2 = await createComment({ selectedText: 'text B', comment: 'fix B' });

            const res = await postJSON(batchResolveUrl(), { documentContent: DOC_CONTENT });
            expect(res.status).toBe(202);
            const body = JSON.parse(res.body);
            expect(body.taskId).toBeDefined();
            expect(typeof body.taskId).toBe('string');
        });

        it('enqueues task with all open comment IDs in payload', async () => {
            const id1 = await createComment({ selectedText: 'text A', comment: 'fix A' });
            const id2 = await createComment({ selectedText: 'text B', comment: 'fix B' });

            const res = await postJSON(batchResolveUrl(), { documentContent: DOC_CONTENT });
            expect(res.status).toBe(202);
            const body = JSON.parse(res.body);

            // Verify the task in the queue has correct payload
            const taskRes = await request(`${baseUrl}/api/queue/${body.taskId}`);
            const taskBody = JSON.parse(taskRes.body);
            expect(taskBody.task.type).toBe('chat');
            expect(taskBody.task.payload.kind).toBe('chat');
            expect(taskBody.task.payload.context.resolveComments.commentIds).toContain(id1);
            expect(taskBody.task.payload.context.resolveComments.commentIds).toContain(id2);
            expect(taskBody.task.payload.context.resolveComments.commentIds).toHaveLength(2);
            expect(taskBody.task.payload.context.resolveComments.documentContent).toBe(DOC_CONTENT);
            expect(taskBody.task.payload.context.resolveComments.filePath).toBe(TASK_PATH);
        });

        it('returns 400 when there are no open comments', async () => {
            // Create a resolved comment
            const commentId = await createComment();
            await request(`${commentsUrl()}/${commentId}`, {
                method: 'PATCH',
                body: JSON.stringify({ status: 'resolved' }),
            });

            const res = await postJSON(batchResolveUrl(), { documentContent: DOC_CONTENT });
            expect(res.status).toBe(400);
            const body = JSON.parse(res.body);
            expect(body.error).toContain('No open comments');
        });

        it('returns 400 when documentContent is absent', async () => {
            await createComment();
            const res = await postJSON(batchResolveUrl(), {});
            expect(res.status).toBe(400);
            const body = JSON.parse(res.body);
            expect(body.error).toContain('documentContent');
        });

        it('only includes open comments in the enqueued task', async () => {
            const openId = await createComment({ selectedText: 'open text', comment: 'open comment' });
            const resolvedId = await createComment();
            // Resolve the second comment
            await request(`${commentsUrl()}/${resolvedId}`, {
                method: 'PATCH',
                body: JSON.stringify({ status: 'resolved' }),
            });

            const res = await postJSON(batchResolveUrl(), { documentContent: DOC_CONTENT });
            expect(res.status).toBe(202);
            const body = JSON.parse(res.body);

            const taskRes = await request(`${baseUrl}/api/queue/${body.taskId}`);
            const taskBody = JSON.parse(taskRes.body);
            expect(taskBody.task.payload.context.resolveComments.commentIds).toEqual([openId]);
        });

        it('sets workingDirectory to wsRootPath, not task data dir', async () => {
            await createComment({ selectedText: 'text', comment: 'fix' });

            const res = await postJSON(batchResolveUrl(), { documentContent: DOC_CONTENT });
            expect(res.status).toBe(202);
            const body = JSON.parse(res.body);

            const taskRes = await request(`${baseUrl}/api/queue/${body.taskId}`);
            const taskBody = JSON.parse(taskRes.body);
            const wd: string = taskBody.task.payload.workingDirectory;
            // workingDirectory must NOT point into the data dir (tasks/ folder)
            expect(wd).not.toContain(path.join('repos', WS_ID, 'tasks'));
            expect(wd).not.toContain(path.join('repos', WS_ID));
        });

        it('includes the batch resolve prompt in the task payload', async () => {
            await createComment({ selectedText: 'my selected text', comment: 'fix this' });

            const res = await postJSON(batchResolveUrl(), { documentContent: DOC_CONTENT });
            expect(res.status).toBe(202);
            const body = JSON.parse(res.body);

            const taskRes = await request(`${baseUrl}/api/queue/${body.taskId}`);
            const taskBody = JSON.parse(taskRes.body);
            expect(taskBody.task.payload.prompt).toContain('# Document Revision Request');
            expect(taskBody.task.payload.prompt).toContain('The document is located at:');
            expect(taskBody.task.payload.prompt).toContain('my selected text');
        });

        it('filters to singleCommentId when provided', async () => {
            const targetId = await createComment({ selectedText: 'target text', comment: 'fix target' });
            const otherId = await createComment({ selectedText: 'other text', comment: 'fix other' });

            const res = await postJSON(batchResolveUrl(), {
                documentContent: DOC_CONTENT,
                singleCommentId: targetId,
            });
            expect(res.status).toBe(202);
            const body = JSON.parse(res.body);

            const taskRes = await request(`${baseUrl}/api/queue/${body.taskId}`);
            const taskBody = JSON.parse(taskRes.body);
            expect(taskBody.task.payload.context.resolveComments.commentIds).toEqual([targetId]);
            expect(taskBody.task.payload.context.resolveComments.commentIds).not.toContain(otherId);
        });

        it('returns 400 when singleCommentId targets a non-open comment', async () => {
            const commentId = await createComment();
            // Resolve it first
            await request(`${commentsUrl()}/${commentId}`, {
                method: 'PATCH',
                body: JSON.stringify({ status: 'resolved' }),
            });

            const res = await postJSON(batchResolveUrl(), {
                documentContent: DOC_CONTENT,
                singleCommentId: commentId,
            });
            expect(res.status).toBe(400);
            const body = JSON.parse(res.body);
            expect(body.error).toContain('No open comments');
        });

        it('returns 400 when singleCommentId does not match any comment', async () => {
            await createComment({ selectedText: 'text', comment: 'fix' });
            const res = await postJSON(batchResolveUrl(), {
                documentContent: DOC_CONTENT,
                singleCommentId: 'nonexistent-id',
            });
            expect(res.status).toBe(400);
            const body = JSON.parse(res.body);
            expect(body.error).toContain('No open comments');
        });

        it('sets displayName to "Resolve plan comment" for __wi-plan__ taskPath', async () => {
            const planTaskPath = `__wi-plan__/work-item-abc`;
            const planCommentsUrl = `${baseUrl}/api/comments/${WS_ID}/${planTaskPath}`;
            await postJSON(planCommentsUrl, makeCommentData({ filePath: planTaskPath }));

            const res = await postJSON(`${planCommentsUrl}/batch-resolve`, { documentContent: DOC_CONTENT });
            expect(res.status).toBe(202);
            const body = JSON.parse(res.body);

            const taskRes = await request(`${baseUrl}/api/queue/${body.taskId}`);
            const taskBody = JSON.parse(taskRes.body);
            expect(taskBody.task.displayName).toBe('Resolve plan comment');
        });

        it('sets displayName to "Resolve comments: <path>" for non-plan taskPath', async () => {
            await createComment({ selectedText: 'text', comment: 'fix' });

            const res = await postJSON(batchResolveUrl(), { documentContent: DOC_CONTENT });
            expect(res.status).toBe(202);
            const body = JSON.parse(res.body);

            const taskRes = await request(`${baseUrl}/api/queue/${body.taskId}`);
            const taskBody = JSON.parse(taskRes.body);
            expect(taskBody.task.displayName).toBe(`Resolve comments: ${TASK_PATH}`);
        });
    });

    // ------------------------------------------------------------------
    // URL-encoded taskPath (regression: decodeURIComponent)
    // ------------------------------------------------------------------
    describe('URL-encoded taskPath', () => {
        const ENCODED_TASK_PATH = 'coc%2Fgit-tab-enhancements.plan.md';
        const DECODED_TASK_PATH = 'coc/git-tab-enhancements.plan.md';

        function encodedCommentsUrl() {
            return `${baseUrl}/api/comments/${WS_ID}/${ENCODED_TASK_PATH}`;
        }

        it('creates and retrieves comments when taskPath is URL-encoded', async () => {
            // Create via encoded URL
            const createRes = await postJSON(encodedCommentsUrl(), makeCommentData());
            expect(createRes.status).toBe(201);
            const created = JSON.parse(createRes.body).comment;
            expect(created.id).toBeDefined();

            // List via encoded URL — should find the comment
            const listRes = await request(encodedCommentsUrl());
            expect(listRes.status).toBe(200);
            const listed = JSON.parse(listRes.body).comments;
            expect(listed).toHaveLength(1);
            expect(listed[0].id).toBe(created.id);

            // GET single via encoded URL
            const getRes = await request(`${encodedCommentsUrl()}/${created.id}`);
            expect(getRes.status).toBe(200);
            expect(JSON.parse(getRes.body).comment.id).toBe(created.id);
        });

        it('batch-resolve uses decoded taskPath in enqueued payload', async () => {
            // Create a comment using encoded URL
            await postJSON(encodedCommentsUrl(), makeCommentData());

            const res = await postJSON(`${encodedCommentsUrl()}/batch-resolve`, {
                documentContent: DOC_CONTENT,
            });
            expect(res.status).toBe(202);
            const body = JSON.parse(res.body);

            // Verify the enqueued task contains the decoded path
            const taskRes = await request(`${baseUrl}/api/queue/${body.taskId}`);
            const taskBody = JSON.parse(taskRes.body);
            expect(taskBody.task.payload.context.resolveComments.filePath).toBe(DECODED_TASK_PATH);
            // The prompt should contain the decoded path, not percent-encoded
            expect(taskBody.task.payload.prompt).not.toContain('%2F');
            expect(taskBody.task.payload.prompt).toContain(DECODED_TASK_PATH);
        });

        it('PATCH update works with encoded taskPath', async () => {
            const createRes = await postJSON(encodedCommentsUrl(), makeCommentData());
            const commentId = JSON.parse(createRes.body).comment.id;

            const patchRes = await request(`${encodedCommentsUrl()}/${commentId}`, {
                method: 'PATCH',
                body: JSON.stringify({ status: 'resolved' }),
            });
            expect(patchRes.status).toBe(200);
            expect(JSON.parse(patchRes.body).comment.status).toBe('resolved');
        });

        it('DELETE works with encoded taskPath', async () => {
            const createRes = await postJSON(encodedCommentsUrl(), makeCommentData());
            const commentId = JSON.parse(createRes.body).comment.id;

            const delRes = await request(`${encodedCommentsUrl()}/${commentId}`, {
                method: 'DELETE',
            });
            expect(delRes.status).toBe(204);

            // Confirm it's gone
            const getRes = await request(`${encodedCommentsUrl()}/${commentId}`);
            expect(getRes.status).toBe(404);
        });
    });
});
