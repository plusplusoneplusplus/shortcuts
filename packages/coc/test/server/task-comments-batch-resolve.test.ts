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
        it('returns { revisedContent, commentId } on success', async () => {
            const commentId = await createComment();
            const res = await postJSON(askAiUrl(commentId), {
                commandId: 'resolve',
                documentContent: DOC_CONTENT,
            });
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.revisedContent).toBe('revised document content');
            expect(body.commentId).toBe(commentId);
            // Should NOT have the Q&A shape
            expect(body.aiResponse).toBeUndefined();
            expect(body.reply).toBeUndefined();
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

        it('returns 502 when AI invoker returns success: false', async () => {
            mockAIResponse = { success: false, response: '' } as any;
            const commentId = await createComment();
            const res = await postJSON(askAiUrl(commentId), {
                commandId: 'resolve',
                documentContent: DOC_CONTENT,
            });
            expect(res.status).toBe(502);
        });

        it('returns 503 when AI service throws', async () => {
            mockAIThrow = true;
            const commentId = await createComment();
            const res = await postJSON(askAiUrl(commentId), {
                commandId: 'resolve',
                documentContent: DOC_CONTENT,
            });
            expect(res.status).toBe(503);
        });

        it('builds prompt with the single comment', async () => {
            const commentId = await createComment();
            await postJSON(askAiUrl(commentId), {
                commandId: 'resolve',
                documentContent: DOC_CONTENT,
            });
            expect(capturedPrompt).toContain('# Document Revision Request');
            expect(capturedPrompt).toContain(DOC_CONTENT);
            expect(capturedPrompt).toContain('### Comment 1');
        });
    });

    // ------------------------------------------------------------------
    // Batch resolve endpoint
    // ------------------------------------------------------------------
    describe('POST .../batch-resolve', () => {
        it('returns { revisedContent, commentIds } with correct IDs', async () => {
            const id1 = await createComment({ selectedText: 'text A', comment: 'fix A' });
            const id2 = await createComment({ selectedText: 'text B', comment: 'fix B' });

            const res = await postJSON(batchResolveUrl(), { documentContent: DOC_CONTENT });
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.revisedContent).toBe('revised document content');
            expect(body.commentIds).toContain(id1);
            expect(body.commentIds).toContain(id2);
            expect(body.commentIds).toHaveLength(2);
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

        it('returns 502 when AI invoker returns success: false', async () => {
            mockAIResponse = { success: false, response: '' } as any;
            await createComment();
            const res = await postJSON(batchResolveUrl(), { documentContent: DOC_CONTENT });
            expect(res.status).toBe(502);
        });

        it('returns 503 when AI service throws', async () => {
            mockAIThrow = true;
            await createComment();
            const res = await postJSON(batchResolveUrl(), { documentContent: DOC_CONTENT });
            expect(res.status).toBe(503);
        });

        it('only includes open comments in the prompt and response', async () => {
            const openId = await createComment({ selectedText: 'open text', comment: 'open comment' });
            const resolvedId = await createComment();
            // Resolve the second comment
            await request(`${commentsUrl()}/${resolvedId}`, {
                method: 'PATCH',
                body: JSON.stringify({ status: 'resolved' }),
            });

            const res = await postJSON(batchResolveUrl(), { documentContent: DOC_CONTENT });
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.commentIds).toEqual([openId]);
            expect(capturedPrompt).toContain('open text');
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
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            // Should get batch-resolve response, not "create comment" response
            expect(body.revisedContent).toBeDefined();
            expect(body.comment).toBeUndefined();
        });
    });
});
