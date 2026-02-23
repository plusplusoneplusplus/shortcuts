/**
 * Task Comments Ask-AI Endpoint Tests
 *
 * Tests for the enriched POST /api/comments/:wsId/:taskPath/:id/ask-ai endpoint.
 * Covers commandId branching, document context, custom questions, and fallback logic.
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
import type { TaskComment } from '../../src/server/task-comments-handler';

// Mock the ai-invoker module used by the ask-ai handler via dynamic import
let mockAIResponse = { success: true, response: 'AI mock response' };
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
// Tests
// ============================================================================

describe('POST /ask-ai', () => {
    let server: ExecutionServer;
    let baseUrl: string;
    let tmpDir: string;

    const WS_ID = 'test-workspace';
    const TASK_PATH = 'feature/task1.md';

    beforeEach(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-ask-ai-'));
        server = await createExecutionServer({ port: 0, dataDir: tmpDir });
        baseUrl = server.url;
        mockAIResponse = { success: true, response: 'AI mock response' };
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

    // ------------------------------------------------------------------
    // Backward compatibility — no commandId
    // ------------------------------------------------------------------
    it('legacy: no commandId uses buildAIPrompt with question', async () => {
        const commentId = await createComment();
        const res = await postJSON(askAiUrl(commentId), { question: 'What is this?' });
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.aiResponse).toBe('AI mock response');
        expect(body.reply).toBeDefined();
        expect(body.reply.isAI).toBe(true);
        // Legacy buildAIPrompt should contain the question
        expect(capturedPrompt).toContain('What is this?');
    });

    it('legacy: no commandId with default question', async () => {
        const commentId = await createComment();
        const res = await postJSON(askAiUrl(commentId), {});
        expect(res.status).toBe(200);
        expect(capturedPrompt).toContain('Please explain this section and suggest improvements.');
    });

    // ------------------------------------------------------------------
    // commandId=clarify with document context
    // ------------------------------------------------------------------
    it('commandId=clarify uses buildPromptFromContext with clarify template', async () => {
        const commentId = await createComment();
        const res = await postJSON(askAiUrl(commentId), {
            commandId: 'clarify',
            documentContext: {
                surroundingLines: 'line above\nline below',
                nearestHeading: '## Setup',
                allHeadings: ['## Setup', '## Usage'],
                filePath: 'docs/guide.md',
            },
        });
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.aiResponse).toBe('AI mock response');
        // buildPromptFromContext should include the selected text and file path
        expect(capturedPrompt).toContain('# Task One');
        expect(capturedPrompt).toContain('docs/guide.md');
        // Should not contain raw template tokens
        expect(capturedPrompt).not.toContain('{{');
    });

    // ------------------------------------------------------------------
    // commandId=custom with customQuestion
    // ------------------------------------------------------------------
    it('commandId=custom with customQuestion uses custom text as prompt', async () => {
        const commentId = await createComment();
        const res = await postJSON(askAiUrl(commentId), {
            commandId: 'custom',
            customQuestion: 'Is this thread-safe?',
        });
        expect(res.status).toBe(200);
        expect(capturedPrompt).toContain('Is this thread-safe?');
    });

    // ------------------------------------------------------------------
    // commandId=custom without customQuestion
    // ------------------------------------------------------------------
    it('commandId=custom without customQuestion uses default template', async () => {
        const commentId = await createComment();
        const res = await postJSON(askAiUrl(commentId), {
            commandId: 'custom',
        });
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.aiResponse).toBe('AI mock response');
        // Should use the default custom prompt template
        expect(capturedPrompt.length).toBeGreaterThan(0);
    });

    // ------------------------------------------------------------------
    // Unknown commandId falls back to legacy
    // ------------------------------------------------------------------
    it('unknown commandId falls back to buildAIPrompt', async () => {
        const commentId = await createComment();
        const res = await postJSON(askAiUrl(commentId), {
            commandId: 'nonexistent',
            question: 'fallback?',
        });
        expect(res.status).toBe(200);
        // Falls back to legacy buildAIPrompt with the question
        expect(capturedPrompt).toContain('fallback?');
    });

    it('unknown commandId with customQuestion uses customQuestion as fallback', async () => {
        const commentId = await createComment();
        const res = await postJSON(askAiUrl(commentId), {
            commandId: 'nonexistent',
            customQuestion: 'custom fallback',
        });
        expect(res.status).toBe(200);
        expect(capturedPrompt).toContain('custom fallback');
    });

    // ------------------------------------------------------------------
    // AI service unavailable (503)
    // ------------------------------------------------------------------
    it('returns 503 when AI service is unavailable', async () => {
        mockAIThrow = true;
        const commentId = await createComment();
        const res = await postJSON(askAiUrl(commentId), {
            commandId: 'clarify',
        });
        expect(res.status).toBe(503);
    });

    it('returns 503 when AI service is unavailable (legacy path)', async () => {
        mockAIThrow = true;
        const commentId = await createComment();
        const res = await postJSON(askAiUrl(commentId), {
            question: 'test',
        });
        expect(res.status).toBe(503);
    });

    // ------------------------------------------------------------------
    // commandId=go-deeper
    // ------------------------------------------------------------------
    it('commandId=go-deeper uses go-deeper template', async () => {
        const commentId = await createComment();
        const res = await postJSON(askAiUrl(commentId), {
            commandId: 'go-deeper',
        });
        expect(res.status).toBe(200);
        expect(capturedPrompt).toContain('# Task One');
    });

    // ------------------------------------------------------------------
    // Edge cases
    // ------------------------------------------------------------------
    it('returns 404 for non-existent comment', async () => {
        // Must use a valid UUID format to match the route pattern
        const res = await postJSON(askAiUrl('00000000-0000-0000-0000-000000000000'), {
            commandId: 'clarify',
        });
        expect(res.status).toBe(404);
    });

    it('documentContext.filePath overrides comment.filePath', async () => {
        const commentId = await createComment({ filePath: 'original/path.md' });
        const res = await postJSON(askAiUrl(commentId), {
            commandId: 'clarify',
            documentContext: {
                filePath: 'overridden/path.md',
            },
        });
        expect(res.status).toBe(200);
        expect(capturedPrompt).toContain('overridden/path.md');
    });

    it('stores AI response and creates AI reply', async () => {
        const commentId = await createComment();
        const res = await postJSON(askAiUrl(commentId), {
            commandId: 'clarify',
        });
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.aiResponse).toBe('AI mock response');
        expect(body.reply).toBeDefined();
        expect(body.reply.author).toBe('AI');
        expect(body.reply.text).toBe('AI mock response');
        expect(body.reply.isAI).toBe(true);
    });
});
