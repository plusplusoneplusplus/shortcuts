/**
 * Task Comments Batch Resolve Tests
 *
 * Tests for buildBatchResolvePrompt(), the per-comment resolve command
 * (commandId: 'resolve'), and the POST .../batch-resolve endpoint.
 *
 * Uses vi.mock for the ai-invoker module (dynamic import in handler).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

// Mock the ai-invoker module used by handlers via dynamic import
let mockAIResponse = { success: true, response: 'revised document content' };
let mockAIThrow = false;
let capturedPrompt = '';

vi.mock('../../src/ai-invoker', () => ({
    createCLIAIInvoker: () => {
        return async (prompt: string) => {
            capturedPrompt = prompt;
            if (mockAIThrow) {
                throw new Error('AI unavailable');
            }
            return mockAIResponse;
        };
    },
}));

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
        const prompt = buildBatchResolvePrompt(comments, '# My Doc\n\nContent here', 'feature/task1.md');

        expect(prompt).toContain('# Document Revision Request');
        expect(prompt).toContain('## File: feature/task1.md');
        expect(prompt).toContain('### Full Document Content');
        expect(prompt).toContain('```markdown\n# My Doc\n\nContent here\n```');
        expect(prompt).toContain('### Comment 1 (Line 5)');
        expect(prompt).toContain('**ID:** `aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee`');
        expect(prompt).toContain('**Selected Text:**');
        expect(prompt).toContain('some selected text');
        expect(prompt).toContain('**Comment:** Fix this section');
        expect(prompt).toContain('**Requested Action:** Revise this section to address the comment.');
        expect(prompt).toContain('# Instructions');
        expect(prompt).toContain('Do NOT include any markdown fencing or explanation — output ONLY the revised document');
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
        mockAIResponse = { success: true, response: 'revised document content' };
        mockAIThrow = false;
        capturedPrompt = '';
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
            expect(taskBody.task.type).toBe('resolve-comments');
            expect(taskBody.task.payload.commentIds).toContain(commentId);
            expect(taskBody.task.payload.documentContent).toBe(DOC_CONTENT);
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
            expect(taskBody.task.type).toBe('resolve-comments');
            expect(taskBody.task.payload.commentIds).toContain(id1);
            expect(taskBody.task.payload.commentIds).toContain(id2);
            expect(taskBody.task.payload.commentIds).toHaveLength(2);
            expect(taskBody.task.payload.documentContent).toBe(DOC_CONTENT);
            expect(taskBody.task.payload.filePath).toBe(TASK_PATH);
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
            expect(taskBody.task.payload.commentIds).toEqual([openId]);
        });

        it('includes the batch resolve prompt in the task payload', async () => {
            await createComment({ selectedText: 'my selected text', comment: 'fix this' });

            const res = await postJSON(batchResolveUrl(), { documentContent: DOC_CONTENT });
            expect(res.status).toBe(202);
            const body = JSON.parse(res.body);

            const taskRes = await request(`${baseUrl}/api/queue/${body.taskId}`);
            const taskBody = JSON.parse(taskRes.body);
            expect(taskBody.task.payload.promptTemplate).toContain('# Document Revision Request');
            expect(taskBody.task.payload.promptTemplate).toContain(DOC_CONTENT);
            expect(taskBody.task.payload.promptTemplate).toContain('my selected text');
        });
    });

    // ------------------------------------------------------------------
    // Route registration order
    // ------------------------------------------------------------------
    describe('route registration order', () => {
        it('batchResolvePattern matches before collectionPattern for batch-resolve path', async () => {
            await createComment();
            // POST to batch-resolve should NOT be interpreted as "create comment"
            const res = await postJSON(batchResolveUrl(), { documentContent: DOC_CONTENT });
            // Should get batch-resolve response (202 queued), not "create comment" response
            expect(res.status).toBe(202);
            const body = JSON.parse(res.body);
            expect(body.taskId).toBeDefined();
            expect(body.comment).toBeUndefined();
        });
    });
});
