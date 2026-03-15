/**
 * Wiki Ask Handler Tests (coc-server)
 *
 * Tests for POST /api/wikis/:wikiId/ask — SSE-streamed AI Q&A.
 * Key risks: wiki not found, AI not enabled, missing question, SSE headers.
 *
 * Gap: ask-handler.ts was entirely untested at handler level.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createRouter } from '../src/shared/router';
import { registerWikiRoutes } from '../src/wiki/wiki-routes';
import type { Route } from '../src/types';

// ============================================================================
// Fixtures
// ============================================================================

const MINIMAL_GRAPH = JSON.stringify({
    version: '1.0',
    metadata: {},
    components: [],
    domains: [],
});

function createWikiDir(baseDir: string, wikiId: string): string {
    const wikiDir = path.join(baseDir, 'wikis', wikiId);
    fs.mkdirSync(wikiDir, { recursive: true });
    fs.writeFileSync(path.join(wikiDir, 'component-graph.json'), MINIMAL_GRAPH, 'utf-8');
    return wikiDir;
}

// ============================================================================
// Helpers
// ============================================================================

async function startServer(server: http.Server): Promise<string> {
    return new Promise((resolve, reject) => {
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const addr = server.address() as { port: number };
            resolve(`http://127.0.0.1:${addr.port}`);
        });
    });
}

async function stopServer(server: http.Server): Promise<void> {
    return new Promise(resolve => server.close(() => resolve()));
}

async function jsonRequest(
    baseUrl: string,
    pathname: string,
    body: unknown
): Promise<{ status: number; headers: Record<string, string>; text: string }> {
    const res = await fetch(`${baseUrl}${pathname}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    const text = await res.text();
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => { headers[k] = v; });
    return { status: res.status, headers, text };
}

// ============================================================================
// Tests
// ============================================================================

describe('Wiki Ask Handler', () => {
    let dataDir: string;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-ask-test-'));
    });

    afterEach(() => {
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    // ---- Wiki not found -------------------------------------------------------

    it('returns 400 when wiki does not exist', async () => {
        const routes: Route[] = [];
        registerWikiRoutes(routes, { dataDir });
        const server = http.createServer(createRouter({ routes, spaHtml: '' }));
        const baseUrl = await startServer(server);

        try {
            const { status } = await jsonRequest(baseUrl, '/api/wikis/nonexistent/ask', { question: 'What is this?' });
            expect(status).toBe(400);
        } finally {
            await stopServer(server);
        }
    });

    // ---- AI not enabled -------------------------------------------------------

    it('returns 400 when wiki exists but AI is not enabled', async () => {
        const wikiId = 'no-ai-wiki';
        const wikiDir = createWikiDir(dataDir, wikiId);

        const routes: Route[] = [];
        registerWikiRoutes(routes, {
            dataDir,
            wikis: { [wikiId]: { wikiDir } },
            aiEnabled: false,
        });
        const server = http.createServer(createRouter({ routes, spaHtml: '' }));
        const baseUrl = await startServer(server);

        try {
            const { status } = await jsonRequest(baseUrl, `/api/wikis/${wikiId}/ask`, { question: 'Hello?' });
            expect(status).toBe(400);
        } finally {
            await stopServer(server);
        }
    });

    // ---- AI enabled but no sendMessage function --------------------------------

    it('returns 400 when AI enabled but no sendMessage function configured', async () => {
        const wikiId = 'ai-wiki-no-fn';
        const wikiDir = createWikiDir(dataDir, wikiId);

        const routes: Route[] = [];
        registerWikiRoutes(routes, {
            dataDir,
            wikis: { [wikiId]: { wikiDir } },
            aiEnabled: true,
            // no aiSendMessage provided
        });
        const server = http.createServer(createRouter({ routes, spaHtml: '' }));
        const baseUrl = await startServer(server);

        try {
            const { status } = await jsonRequest(baseUrl, `/api/wikis/${wikiId}/ask`, { question: 'Hello?' });
            expect(status).toBe(400);
        } finally {
            await stopServer(server);
        }
    });

    // ---- Missing question field -----------------------------------------------

    it('returns 400 when question field is missing', async () => {
        const wikiId = 'ask-wiki';
        const wikiDir = createWikiDir(dataDir, wikiId);

        const mockSend = vi.fn();
        const routes: Route[] = [];
        registerWikiRoutes(routes, {
            dataDir,
            wikis: { [wikiId]: { wikiDir } },
            aiEnabled: true,
            aiSendMessage: mockSend,
        });
        const server = http.createServer(createRouter({ routes, spaHtml: '' }));
        const baseUrl = await startServer(server);

        try {
            const { status } = await jsonRequest(baseUrl, `/api/wikis/${wikiId}/ask`, { noQuestion: true });
            expect(status).toBe(400);
        } finally {
            await stopServer(server);
        }
    });

    // ---- SSE streaming response -----------------------------------------------

    it('returns SSE response with text/event-stream content type', async () => {
        const wikiId = 'sse-wiki';
        const wikiDir = createWikiDir(dataDir, wikiId);

        // Mock AI sendMessage to stream a single token
        const mockSend = vi.fn(async (opts: any) => {
            const { onToken } = opts;
            if (onToken) { onToken('Hello world'); }
            return { success: true, response: 'Hello world' };
        });

        const routes: Route[] = [];
        registerWikiRoutes(routes, {
            dataDir,
            wikis: { [wikiId]: { wikiDir } },
            aiEnabled: true,
            aiSendMessage: mockSend as any,
        });
        const server = http.createServer(createRouter({ routes, spaHtml: '' }));
        const baseUrl = await startServer(server);

        try {
            const { status, headers } = await jsonRequest(baseUrl, `/api/wikis/${wikiId}/ask`, { question: 'What is this?' });
            expect(status).toBe(200);
            expect(headers['content-type']).toMatch(/text\/event-stream/i);
        } finally {
            await stopServer(server);
        }
    });

    // ---- Delete session -------------------------------------------------------

    it('returns success when deleting a session for a registered wiki', async () => {
        const wikiId = 'session-wiki';
        const wikiDir = createWikiDir(dataDir, wikiId);

        const routes: Route[] = [];
        registerWikiRoutes(routes, {
            dataDir,
            wikis: { [wikiId]: { wikiDir } },
            aiEnabled: true,
            aiSendMessage: vi.fn() as any,
        });
        const server = http.createServer(createRouter({ routes, spaHtml: '' }));
        const baseUrl = await startServer(server);

        try {
            const res = await fetch(`${baseUrl}/api/wikis/${wikiId}/ask/session/my-session-id`, {
                method: 'DELETE',
            });
            // Session may not exist, but should not 500
            expect(res.status).toBeLessThan(500);
        } finally {
            await stopServer(server);
        }
    });
});
