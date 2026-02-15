/**
 * Review AI Handler Tests
 *
 * Integration tests for the review AI REST API routes.
 * Mocks CopilotSDKService to avoid real AI calls.
 * Uses a temp directory with sample .md files and pre-seeded comments.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createRequestHandler } from '../../src/server/router';
import { registerReviewRoutes } from '../../src/server/review-handler';
import { registerReviewAIRoutes } from '../../src/server/review-ai-handler';
import { registerQueueRoutes } from '../../src/server/queue-handler';
import { TaskQueueManager } from '@plusplusoneplusplus/pipeline-core';
import type { Route } from '../../src/server/types';

// ============================================================================
// Mock SDK Service
// ============================================================================

const mockSendMessage = vi.fn();
const mockIsAvailable = vi.fn();

vi.mock('@plusplusoneplusplus/pipeline-core', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/pipeline-core')>();
    return {
        ...actual,
        getCopilotSDKService: () => ({
            isAvailable: mockIsAvailable,
            sendMessage: mockSendMessage,
        }),
        approveAllPermissions: () => ({ kind: 'approved' }),
    };
});

// ============================================================================
// Helpers
// ============================================================================

function stubStore(): any {
    const processes = new Map<string, any>();
    return {
        addProcess: async (p: any) => { processes.set(p.id, { ...p }); },
        updateProcess: async (id: string, updates: any) => {
            const existing = processes.get(id);
            if (existing) processes.set(id, { ...existing, ...updates });
        },
        getProcess: async (id: string) => processes.get(id),
        getAllProcesses: async () => Array.from(processes.values()),
        removeProcess: async () => {},
        clearProcesses: async () => 0,
        getWorkspaces: async () => [],
        registerWorkspace: async () => {},
        removeWorkspace: async () => false,
        updateWorkspace: async () => undefined,
        getWikis: async () => [],
        registerWiki: async () => {},
        removeWiki: async () => false,
        updateWiki: async () => undefined,
        onProcessOutput: () => () => {},
        emitProcessOutput: () => {},
        emitProcessComplete: () => {},
    };
}

function request(
    baseUrl: string,
    urlPath: string,
    options: { method?: string; body?: string; headers?: Record<string, string> } = {},
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(urlPath, baseUrl);
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
            },
        );
        req.on('error', reject);
        if (options.body) { req.write(options.body); }
        req.end();
    });
}

function postJSON(base: string, urlPath: string, data: unknown) {
    return request(base, urlPath, {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    });
}

// ============================================================================
// Test Setup
// ============================================================================

let tmpDir: string;
let server: http.Server;
let baseUrl: string;
let store: any;
let queueManager: TaskQueueManager;

beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-ai-handler-test-'));

    // Create markdown files
    fs.writeFileSync(path.join(tmpDir, 'README.md'), '# Hello\n\nWorld\n');
    fs.mkdirSync(path.join(tmpDir, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'docs', 'guide.md'), '# Guide\n\nContent here.\n');

    // Create prompt files
    const promptsDir = path.join(tmpDir, '.github', 'prompts');
    fs.mkdirSync(promptsDir, { recursive: true });
    fs.writeFileSync(path.join(promptsDir, 'clarify.prompt.md'), '---\ntitle: Clarify\n---\n# Clarification\n\nPlease clarify.\n');
    fs.writeFileSync(path.join(promptsDir, 'review.prompt.md'), '# Review\n\nReview the code.\n');

    // Create .vscode dir for comments
    fs.mkdirSync(path.join(tmpDir, '.vscode'), { recursive: true });
    fs.writeFileSync(
        path.join(tmpDir, '.vscode', 'md-comments.json'),
        JSON.stringify({ version: 1, comments: [] }),
    );

    // Build routes and server
    store = stubStore();
    queueManager = new TaskQueueManager({
        maxQueueSize: 0,
        keepHistory: true,
        maxHistorySize: 100,
    });

    const routes: Route[] = [];
    const { commentsManager } = registerReviewRoutes(routes, tmpDir);
    registerReviewAIRoutes(routes, {
        projectDir: tmpDir,
        store,
        queueManager,
        commentsManager,
    });
    registerQueueRoutes(routes, queueManager);

    const handler = createRequestHandler({ routes, spaHtml: '<html></html>', store });
    server = http.createServer(handler);

    await new Promise<void>((resolve, reject) => {
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = server.address() as { port: number };
    baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
    });
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
    mockIsAvailable.mockReset();
    mockSendMessage.mockReset();

    // Reset comments
    fs.writeFileSync(
        path.join(tmpDir, '.vscode', 'md-comments.json'),
        JSON.stringify({ version: 1, comments: [] }),
    );
});

// ============================================================================
// POST /api/review/files/:path/ask-ai
// ============================================================================

describe('POST /api/review/files/:path/ask-ai', () => {
    const validBody = {
        selectedText: 'some text',
        startLine: 5,
        endLine: 8,
        instructionType: 'clarify',
    };

    it('returns 202 on successful AI request', async () => {
        mockIsAvailable.mockResolvedValue({ available: true });
        mockSendMessage.mockResolvedValue({ success: true, response: 'Explanation here.' });

        const res = await postJSON(baseUrl, '/api/review/files/README.md/ask-ai', validBody);
        expect(res.status).toBe(202);
        const body = JSON.parse(res.body);
        expect(body.processId).toBeDefined();
    });

    it('returns 400 for missing selectedText', async () => {
        const res = await postJSON(baseUrl, '/api/review/files/README.md/ask-ai', {
            startLine: 1,
            endLine: 1,
            instructionType: 'clarify',
        });
        expect(res.status).toBe(400);
        expect(JSON.parse(res.body).error).toContain('selectedText');
    });

    it('returns 400 for missing startLine', async () => {
        const res = await postJSON(baseUrl, '/api/review/files/README.md/ask-ai', {
            selectedText: 'text',
            endLine: 1,
            instructionType: 'clarify',
        });
        expect(res.status).toBe(400);
        expect(JSON.parse(res.body).error).toContain('startLine');
    });

    it('returns 400 for missing endLine', async () => {
        const res = await postJSON(baseUrl, '/api/review/files/README.md/ask-ai', {
            selectedText: 'text',
            startLine: 1,
            instructionType: 'clarify',
        });
        expect(res.status).toBe(400);
        expect(JSON.parse(res.body).error).toContain('endLine');
    });

    it('returns 400 for invalid instructionType', async () => {
        const res = await postJSON(baseUrl, '/api/review/files/README.md/ask-ai', {
            selectedText: 'text',
            startLine: 1,
            endLine: 1,
            instructionType: 'invalid',
        });
        expect(res.status).toBe(400);
        expect(JSON.parse(res.body).error).toContain('instructionType');
    });

    it('returns 503 when SDK is unavailable', async () => {
        mockIsAvailable.mockResolvedValue({ available: false, error: 'No SDK' });

        const res = await postJSON(baseUrl, '/api/review/files/README.md/ask-ai', validBody);
        expect(res.status).toBe(503);
        expect(JSON.parse(res.body).error).toContain('not available');
    });

    it('returns 400 for path traversal', async () => {
        const res = await postJSON(baseUrl, '/api/review/files/..%2F..%2Fetc%2Fpasswd/ask-ai', validBody);
        expect(res.status).toBe(400);
        expect(JSON.parse(res.body).error).toContain('Invalid path');
    });

    it('returns 400 for invalid JSON', async () => {
        const res = await request(baseUrl, '/api/review/files/README.md/ask-ai', {
            method: 'POST',
            body: 'not json',
            headers: { 'Content-Type': 'application/json' },
        });
        expect(res.status).toBe(400);
    });
});

// ============================================================================
// POST /api/review/files/:path/ask-ai-queued
// ============================================================================

describe('POST /api/review/files/:path/ask-ai-queued', () => {
    const validBody = {
        selectedText: 'some text',
        startLine: 5,
        endLine: 8,
        instructionType: 'clarify',
    };

    it('returns 202 with queue position', async () => {
        const res = await postJSON(baseUrl, '/api/review/files/README.md/ask-ai-queued', validBody);
        expect(res.status).toBe(202);
        const body = JSON.parse(res.body);
        expect(body.taskId).toBeDefined();
        expect(typeof body.position).toBe('number');
        expect(typeof body.totalQueued).toBe('number');
        expect(body.message).toContain('Added to queue');
    });

    it('returns 400 for missing required fields', async () => {
        const res = await postJSON(baseUrl, '/api/review/files/README.md/ask-ai-queued', {
            selectedText: 'text',
        });
        expect(res.status).toBe(400);
    });

    it('returns 400 for path traversal', async () => {
        const res = await postJSON(baseUrl, '/api/review/files/..%2Fetc%2Fpasswd/ask-ai-queued', validBody);
        expect(res.status).toBe(400);
    });

    it('returns 400 for invalid JSON', async () => {
        const res = await request(baseUrl, '/api/review/files/README.md/ask-ai-queued', {
            method: 'POST',
            body: 'not json',
            headers: { 'Content-Type': 'application/json' },
        });
        expect(res.status).toBe(400);
    });
});

// ============================================================================
// POST /api/review/files/:path/generate-prompt
// ============================================================================

describe('POST /api/review/files/:path/generate-prompt', () => {
    it('returns empty prompts when no comments exist', async () => {
        const res = await postJSON(baseUrl, '/api/review/files/README.md/generate-prompt', {});
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.prompts).toEqual([]);
        expect(body.totalComments).toBe(0);
    });

    it('generates prompt from comments', async () => {
        // Seed a comment
        await postJSON(baseUrl, '/api/review/files/README.md/comments', {
            selection: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 7 },
            selectedText: '# Hello',
            comment: 'Needs clarification',
        });

        const res = await postJSON(baseUrl, '/api/review/files/README.md/generate-prompt', {});
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.prompts).toHaveLength(1);
        expect(body.prompts[0].prompt).toContain('Needs clarification');
        expect(body.prompts[0].prompt).toContain('# Hello');
        expect(body.prompts[0].commentCount).toBe(1);
        expect(body.totalComments).toBe(1);
    });

    it('includes custom preamble and instructions', async () => {
        // Seed a comment
        await postJSON(baseUrl, '/api/review/files/README.md/comments', {
            selection: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 7 },
            selectedText: '# Hello',
            comment: 'Test',
        });

        const res = await postJSON(baseUrl, '/api/review/files/README.md/generate-prompt', {
            customPreamble: 'Review this carefully.',
            customInstructions: 'Be concise.',
        });
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.prompts[0].prompt).toContain('Review this carefully.');
        expect(body.prompts[0].prompt).toContain('Be concise.');
    });

    it('excludes resolved comments', async () => {
        // Seed and resolve a comment
        const createRes = await postJSON(baseUrl, '/api/review/files/README.md/comments', {
            selection: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 7 },
            selectedText: '# Hello',
            comment: 'Resolved one',
        });
        const commentId = JSON.parse(createRes.body).id;
        await request(baseUrl, `/api/review/files/README.md/comments/${commentId}`, {
            method: 'PATCH',
            body: JSON.stringify({ status: 'resolved' }),
            headers: { 'Content-Type': 'application/json' },
        });

        const res = await postJSON(baseUrl, '/api/review/files/README.md/generate-prompt', {});
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.prompts).toEqual([]);
        expect(body.totalComments).toBe(0);
    });

    it('returns 400 for path traversal', async () => {
        const res = await postJSON(baseUrl, '/api/review/files/..%2Fetc%2Fpasswd/generate-prompt', {});
        expect(res.status).toBe(400);
    });
});

// ============================================================================
// GET /api/review/prompts
// ============================================================================

describe('GET /api/review/prompts', () => {
    it('lists available .prompt.md files', async () => {
        const res = await request(baseUrl, '/api/review/prompts');
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(Array.isArray(body.prompts)).toBe(true);
        const names = body.prompts.map((p: any) => p.name).sort();
        expect(names).toContain('clarify');
        expect(names).toContain('review');
    });

    it('returns prompt metadata with paths', async () => {
        const res = await request(baseUrl, '/api/review/prompts');
        const body = JSON.parse(res.body);
        for (const p of body.prompts) {
            expect(p.relativePath).toBeDefined();
            expect(p.absolutePath).toBeDefined();
            expect(p.sourceFolder).toBeDefined();
            expect(p.name).toBeDefined();
        }
    });
});

// ============================================================================
// GET /api/review/prompts/:path
// ============================================================================

describe('GET /api/review/prompts/:path', () => {
    it('returns prompt file content with frontmatter stripped', async () => {
        const res = await request(
            baseUrl,
            `/api/review/prompts/${encodeURIComponent('.github/prompts/clarify.prompt.md')}`,
        );
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.name).toBe('clarify');
        expect(body.content).toContain('# Clarification');
        expect(body.content).not.toContain('title: Clarify');
        expect(body.path).toBe('.github/prompts/clarify.prompt.md');
    });

    it('returns content as-is when no frontmatter', async () => {
        const res = await request(
            baseUrl,
            `/api/review/prompts/${encodeURIComponent('.github/prompts/review.prompt.md')}`,
        );
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.content).toContain('# Review');
    });

    it('returns 404 for non-existent prompt file', async () => {
        const res = await request(
            baseUrl,
            `/api/review/prompts/${encodeURIComponent('.github/prompts/missing.prompt.md')}`,
        );
        expect(res.status).toBe(404);
    });

    it('returns 400 for path traversal', async () => {
        const res = await request(
            baseUrl,
            `/api/review/prompts/${encodeURIComponent('../../etc/passwd.prompt.md')}`,
        );
        expect(res.status).toBe(400);
    });

    it('returns 400 for non-.prompt.md path', async () => {
        const res = await request(
            baseUrl,
            `/api/review/prompts/${encodeURIComponent('.github/prompts/readme.md')}`,
        );
        expect(res.status).toBe(400);
        expect(JSON.parse(res.body).error).toContain('.prompt.md');
    });
});
