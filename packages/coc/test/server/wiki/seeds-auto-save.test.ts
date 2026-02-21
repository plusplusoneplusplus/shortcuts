/**
 * Tests for seeds auto-save behavior in handleGenerateSeeds.
 *
 * Verifies that after successful AI seed generation, the handler
 * automatically writes seeds.yaml to the wiki directory.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import * as path from 'path';
import type { ServerResponse, IncomingMessage } from 'http';

// Mock fs at module level so mkdirSync/writeFileSync are mockable
vi.mock('fs', async (importOriginal) => {
    const actual = await importOriginal<typeof import('fs')>();
    return {
        ...actual,
        mkdirSync: vi.fn(actual.mkdirSync),
        writeFileSync: vi.fn(actual.writeFileSync),
        existsSync: vi.fn(actual.existsSync),
    };
});

// Mock deep-wiki modules
vi.mock('@plusplusoneplusplus/deep-wiki/dist/ai-invoker', () => ({
    checkAIAvailability: vi.fn().mockResolvedValue({ available: true }),
}));

vi.mock('@plusplusoneplusplus/deep-wiki/dist/seeds/seeds-session', () => ({
    runSeedsSession: vi.fn().mockResolvedValue([
        { theme: 'auth', description: 'Authentication module', hints: ['login', 'jwt'] },
        { theme: 'database', description: 'Database layer', hints: ['sql', 'orm'] },
    ]),
}));

import * as fs from 'fs';

// ============================================================================
// Helpers
// ============================================================================

function createMockResponse(): ServerResponse & { _chunks: string[] } {
    const chunks: string[] = [];
    return {
        _chunks: chunks,
        destroyed: false,
        writableEnded: false,
        statusCode: 200,
        writeHead: vi.fn(),
        write: vi.fn((chunk: string) => { chunks.push(chunk); return true; }),
        end: vi.fn(),
        setHeader: vi.fn(),
    } as unknown as ServerResponse & { _chunks: string[] };
}

function createMockRequest(body: string = '{}'): IncomingMessage & EventEmitter {
    const emitter = new EventEmitter();
    const req = emitter as unknown as IncomingMessage & EventEmitter;
    process.nextTick(() => {
        emitter.emit('data', Buffer.from(body));
        emitter.emit('end');
    });
    return req;
}

// ============================================================================
// Auto-save tests
// ============================================================================

describe('handleGenerateSeeds auto-save', () => {
    beforeEach(() => {
        vi.mocked(fs.mkdirSync).mockClear().mockReturnValue(undefined);
        vi.mocked(fs.writeFileSync).mockClear().mockReturnValue(undefined);
    });

    it('auto-saves seeds.yaml to repoPath when repoPath is available', async () => {
        const { handleGenerateSeeds } = await import('../../../src/server/wiki/admin-handlers');

        const req = createMockRequest('{}');
        const res = createMockResponse();
        const mockManager = {
            get: vi.fn().mockReturnValue({
                registration: { repoPath: '/test/repo', wikiDir: '/test/wiki-output' },
            }),
        };

        await handleGenerateSeeds(req, res, 'test-wiki', mockManager as any);

        // Seeds should go to repoPath, not wikiDir
        expect(fs.mkdirSync).toHaveBeenCalledWith('/test/repo', { recursive: true });
        expect(fs.writeFileSync).toHaveBeenCalledWith(
            path.join('/test/repo', 'seeds.yaml'),
            expect.stringContaining('theme'),
            'utf-8',
        );

        const allChunks = res._chunks.join('');
        expect(allChunks).toContain('Seeds saved to');
    });

    it('handlePutSeeds falls back to wikiDir when repoPath is not set', async () => {
        const { handlePutSeeds } = await import('../../../src/server/wiki/admin-handlers');

        const req = createMockRequest(JSON.stringify({ content: { themes: [{ theme: 'api' }] } }));
        const res = createMockResponse();
        const mockManager = {
            get: vi.fn().mockReturnValue({
                registration: { wikiDir: '/test/wiki-output' },
            }),
        };

        await handlePutSeeds(req, res, 'test-wiki', mockManager as any);

        expect(fs.writeFileSync).toHaveBeenCalledWith(
            path.join('/test/wiki-output', 'seeds.yaml'),
            expect.any(String),
            'utf-8',
        );
    });

    it('continues SSE flow when auto-save fails', async () => {
        vi.mocked(fs.mkdirSync).mockImplementation(() => {
            throw new Error('EACCES: permission denied');
        });

        const { handleGenerateSeeds } = await import('../../../src/server/wiki/admin-handlers');

        const req = createMockRequest('{}');
        const res = createMockResponse();
        const mockManager = {
            get: vi.fn().mockReturnValue({
                registration: { repoPath: '/test/repo', wikiDir: '/readonly/path' },
            }),
        };

        await handleGenerateSeeds(req, res, 'test-wiki', mockManager as any);

        const allChunks = res._chunks.join('');
        expect(allChunks).toContain('failed to auto-save seeds');
        expect(allChunks).toContain('"type":"done"');
        expect(allChunks).toContain('"success":true');
        expect(res.end).toHaveBeenCalled();
    });

    it('writes YAML with theme field (not name)', async () => {
        let writtenContent = '';
        vi.mocked(fs.writeFileSync).mockImplementation((_p, data) => {
            writtenContent = String(data);
        });

        const { handleGenerateSeeds } = await import('../../../src/server/wiki/admin-handlers');

        const req = createMockRequest('{}');
        const res = createMockResponse();
        const mockManager = {
            get: vi.fn().mockReturnValue({
                registration: { repoPath: '/test/repo', wikiDir: '/test/wiki-output' },
            }),
        };

        await handleGenerateSeeds(req, res, 'test-wiki', mockManager as any);

        expect(writtenContent).toContain('theme');
        expect(writtenContent).toContain('auth');
        expect(writtenContent).toContain('database');
        expect(writtenContent).not.toContain('[object Object]');
    });

    it('gracefully handles missing wikiDir', async () => {
        const { handleGenerateSeeds } = await import('../../../src/server/wiki/admin-handlers');

        const req = createMockRequest('{}');
        const res = createMockResponse();
        const mockManager = {
            get: vi.fn().mockReturnValue({
                registration: { repoPath: '/test/repo' },
            }),
        };

        await handleGenerateSeeds(req, res, 'test-wiki', mockManager as any);

        const allChunks = res._chunks.join('');
        // Should still complete successfully even if auto-save fails
        expect(allChunks).toContain('"type":"done"');
        expect(allChunks).toContain('"success":true');
        expect(res.end).toHaveBeenCalled();
    });
});
