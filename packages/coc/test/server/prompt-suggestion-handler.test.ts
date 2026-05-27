/**
 * Tests for GET /api/prompt-suggestions — inline ghost-text autocomplete.
 *
 * Verifies query handling, prefix encoding, length limits, the missing-prefix
 * silent no-op, store-method-missing behavior, and the global preference gate.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as http from 'http';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { createRouter } from '../../src/server/shared/router';
import {
    registerPromptSuggestionRoutes,
    type PromptCompletionStore,
} from '../../src/server/processes/prompt-suggestion-handler';
import type { Route } from '../../src/server/types';

// ============================================================================
// HTTP request helper
// ============================================================================

function request(reqUrl: string): Promise<{ status: number; body: any }> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(reqUrl);
        const req = http.request(
            {
                hostname: parsed.hostname,
                port: parsed.port,
                path: parsed.pathname + parsed.search,
                method: 'GET',
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (c) => chunks.push(c));
                res.on('end', () => {
                    const body = Buffer.concat(chunks).toString('utf-8');
                    resolve({
                        status: res.statusCode || 0,
                        body: body ? JSON.parse(body) : null,
                    });
                });
            },
        );
        req.on('error', reject);
        req.end();
    });
}

// ============================================================================
// Server harness
// ============================================================================

interface Harness {
    server: http.Server;
    base: string;
    store: PromptCompletionStore & {
        getBestPromptCompletion: ReturnType<typeof vi.fn>;
        getPromptAutocompleteContext: ReturnType<typeof vi.fn>;
    };
    dataDir: string;
    aiService: { sendMessage: ReturnType<typeof vi.fn> };
}

async function makeHarness(opts?: { withDataDir?: boolean; seedEnabled?: boolean }): Promise<Harness> {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'prompt-suggest-test-'));
    if (opts?.withDataDir && opts.seedEnabled) {
        await fs.writeFile(
            path.join(dataDir, 'preferences.json'),
            JSON.stringify({ global: { promptAutocomplete: { enabled: true } } }),
        );
    }
    const store = {
        getBestPromptCompletion: vi.fn(),
        getPromptAutocompleteContext: vi.fn(),
    } as PromptCompletionStore & {
        getBestPromptCompletion: ReturnType<typeof vi.fn>;
        getPromptAutocompleteContext: ReturnType<typeof vi.fn>;
    };
    const aiService = { sendMessage: vi.fn() };

    const routes: Route[] = [];
    registerPromptSuggestionRoutes(routes, store as any, opts?.withDataDir ? dataDir : undefined, aiService as any);
    const router = createRouter({ routes, spaHtml: '' });

    const server = http.createServer(router);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    return { server, base: `http://127.0.0.1:${port}`, store, dataDir, aiService };
}

async function disposeHarness(h: Harness): Promise<void> {
    await new Promise<void>((resolve) => h.server.close(() => resolve()));
    await fs.rm(h.dataDir, { recursive: true, force: true });
}

// ============================================================================
// Tests
// ============================================================================

describe('GET /api/prompt-suggestions', () => {
    let h: Harness;
    beforeEach(async () => { h = await makeHarness({ withDataDir: true, seedEnabled: true }); });
    afterEach(async () => { await disposeHarness(h); });

    it('returns the completion when store finds one', async () => {
        h.store.getBestPromptCompletion.mockReturnValue({
            completion: 'bug now',
            source: 'initial',
        });
        const r = await request(`${h.base}/api/prompt-suggestions?prefix=fix%20the%20`);
        expect(r.status).toBe(200);
        expect(r.body).toEqual({ completion: 'bug now', source: 'history', historySource: 'initial' });
        expect(h.store.getBestPromptCompletion).toHaveBeenCalledWith('fix the ', { minPrefixLen: 3 });
    });

    it('returns null when store returns null', async () => {
        h.store.getBestPromptCompletion.mockReturnValue(null);
        const r = await request(`${h.base}/api/prompt-suggestions?prefix=hello`);
        expect(r.status).toBe(200);
        expect(r.body.completion).toBeNull();
    });

    it('returns null silently when prefix query param is missing', async () => {
        const r = await request(`${h.base}/api/prompt-suggestions`);
        expect(r.status).toBe(200);
        expect(r.body.completion).toBeNull();
        expect(h.store.getBestPromptCompletion).not.toHaveBeenCalled();
    });

    it('returns null silently when prefix is empty', async () => {
        const r = await request(`${h.base}/api/prompt-suggestions?prefix=`);
        expect(r.status).toBe(200);
        expect(r.body.completion).toBeNull();
        expect(h.store.getBestPromptCompletion).not.toHaveBeenCalled();
    });

    it('decodes URL-encoded prefix correctly (space, plus, unicode)', async () => {
        h.store.getBestPromptCompletion.mockReturnValue({
            completion: 'X',
            source: 'follow-up',
        });
        await request(`${h.base}/api/prompt-suggestions?prefix=hello%20world%2B%C3%A9`);
        expect(h.store.getBestPromptCompletion).toHaveBeenCalledWith('hello world+\u00e9', { minPrefixLen: 3 });
    });

    it('returns null when store lacks getBestPromptCompletion', async () => {
        const routes: Route[] = [];
        registerPromptSuggestionRoutes(routes, {} as PromptCompletionStore);
        const router = createRouter({ routes, spaHtml: '' });
        const server = http.createServer(router);
        await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
        const port = (server.address() as any).port;
        const r = await request(`http://127.0.0.1:${port}/api/prompt-suggestions?prefix=hello`);
        expect(r.status).toBe(200);
        expect(r.body.completion).toBeNull();
        await new Promise<void>((res) => server.close(() => res()));
    });

    it('returns null when store throws', async () => {
        h.store.getBestPromptCompletion.mockImplementation(() => {
            throw new Error('boom');
        });
        const r = await request(`${h.base}/api/prompt-suggestions?prefix=hello`);
        expect(r.status).toBe(200);
        expect(r.body.completion).toBeNull();
    });

    it('passes optional request context through the service path', async () => {
        h.store.getBestPromptCompletion.mockReturnValue({
            completion: 'bug now',
            source: 'initial',
        });
        await request(`${h.base}/api/prompt-suggestions?prefix=fix&workspaceId=ws1&processId=p1&surface=follow-up&mode=history`);
        expect(h.store.getBestPromptCompletion).toHaveBeenCalledWith('fix', { minPrefixLen: 3 });
    });
});

describe('GET /api/prompt-suggestions — preference gate', () => {
    let h: Harness;
    beforeEach(async () => { h = await makeHarness({ withDataDir: true }); });
    afterEach(async () => { await disposeHarness(h); });

    it('returns null when promptAutocomplete preference is absent (disabled by default)', async () => {
        h.store.getBestPromptCompletion.mockReturnValue({
            completion: 'X',
            source: 'initial',
        });
        const r = await request(`${h.base}/api/prompt-suggestions?prefix=hello`);
        expect(r.body.completion).toBeNull();
        expect(h.store.getBestPromptCompletion).not.toHaveBeenCalled();
    });

    it('serves suggestions when promptAutocomplete.enabled is true', async () => {
        await fs.writeFile(
            path.join(h.dataDir, 'preferences.json'),
            JSON.stringify({ global: { promptAutocomplete: { enabled: true } } }),
        );
        h.store.getBestPromptCompletion.mockReturnValue({
            completion: 'X',
            source: 'initial',
        });
        const r = await request(`${h.base}/api/prompt-suggestions?prefix=hello`);
        expect(r.body.completion).toBe('X');
    });

    it('returns null when promptAutocomplete.enabled is false (silent disable)', async () => {
        await fs.writeFile(
            path.join(h.dataDir, 'preferences.json'),
            JSON.stringify({ global: { promptAutocomplete: { enabled: false } } }),
        );
        h.store.getBestPromptCompletion.mockReturnValue({
            completion: 'X',
            source: 'initial',
        });
        const r = await request(`${h.base}/api/prompt-suggestions?prefix=hello`);
        expect(r.body.completion).toBeNull();
        expect(h.store.getBestPromptCompletion).not.toHaveBeenCalled();
    });

    it('returns an AI completion when AI autocomplete is enabled and context is available', async () => {
        await fs.writeFile(
            path.join(h.dataDir, 'preferences.json'),
            JSON.stringify({ global: { promptAutocomplete: { enabled: true, ai: { enabled: true } } } }),
        );
        h.store.getBestPromptCompletion.mockReturnValue({
            completion: 'history suffix',
            source: 'initial',
        });
        h.store.getPromptAutocompleteContext.mockReturnValue({
            exactPrefixMatches: [{
                text: 'fix the AI autocomplete tests',
                source: 'initial',
                workspaceId: 'ws1',
                processId: 'p1',
                timestamp: '2024-06-01T12:00:00.000Z',
                prefixMatch: true,
            }],
            recentWorkspacePrompts: [],
            recentProcessTurns: [],
            historyFingerprint: '1:2024-06-01T12:00:00.000Z:1',
        });
        h.aiService.sendMessage.mockResolvedValue({
            success: true,
            response: JSON.stringify({ completion: 'AI autocomplete tests' }),
        });

        const r = await request(`${h.base}/api/prompt-suggestions?prefix=fix%20the%20&workspaceId=ws1`);

        expect(r.body).toEqual({ completion: 'AI autocomplete tests', source: 'ai' });
        expect(h.store.getPromptAutocompleteContext).toHaveBeenCalledWith('fix the ', {
            workspaceId: 'ws1',
            processId: undefined,
            limit: 12,
            includeGlobalHistory: false,
        });
    });

    it('reuses cached AI completions across route requests', async () => {
        await fs.writeFile(
            path.join(h.dataDir, 'preferences.json'),
            JSON.stringify({ global: { promptAutocomplete: { enabled: true, ai: { enabled: true } } } }),
        );
        h.store.getBestPromptCompletion.mockReturnValue(null);
        h.store.getPromptAutocompleteContext.mockReturnValue({
            exactPrefixMatches: [{
                text: 'write the queue autocomplete implementation',
                source: 'initial',
                workspaceId: 'ws1',
                processId: 'p1',
                timestamp: '2024-06-01T12:00:00.000Z',
                prefixMatch: true,
            }],
            recentWorkspacePrompts: [],
            recentProcessTurns: [],
            historyFingerprint: '1:2024-06-01T12:00:00.000Z:1',
        });
        h.aiService.sendMessage.mockResolvedValue({
            success: true,
            response: JSON.stringify({ completion: 'queue autocomplete implementation' }),
        });

        const first = await request(`${h.base}/api/prompt-suggestions?prefix=write%20the%20&workspaceId=ws1`);
        const second = await request(`${h.base}/api/prompt-suggestions?prefix=write%20the%20&workspaceId=ws1`);

        expect(first.body).toEqual({ completion: 'queue autocomplete implementation', source: 'ai' });
        expect(second.body).toEqual(first.body);
        expect(h.aiService.sendMessage).toHaveBeenCalledTimes(1);
    });

    it('treats mode=ai as an explicit AI opt-in when the master toggle is on and AI preferences are absent', async () => {
        await fs.writeFile(
            path.join(h.dataDir, 'preferences.json'),
            JSON.stringify({ global: { promptAutocomplete: { enabled: true } } }),
        );
        h.store.getBestPromptCompletion.mockReturnValue(null);
        h.store.getPromptAutocompleteContext.mockReturnValue({
            exactPrefixMatches: [],
            recentWorkspacePrompts: [],
            recentProcessTurns: [],
            historyFingerprint: '0::0',
        });
        h.aiService.sendMessage.mockResolvedValue({
            success: true,
            response: JSON.stringify({ completion: 'e' }),
        });

        const r = await request(`${h.base}/api/prompt-suggestions?prefix=Hello%2C%20please%20rebas&workspaceId=ws1&surface=queue&mode=ai`);

        expect(r.body).toEqual({ completion: 'e', source: 'ai' });
        expect(h.aiService.sendMessage).toHaveBeenCalledTimes(1);
    });
});
