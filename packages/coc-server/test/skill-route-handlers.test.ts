/**
 * Tests for createSkillRouteHandlers factory.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { createSkillRouteHandlers } from '../src/skill-route-handlers';

// ============================================================================
// Test Helpers
// ============================================================================

function createMockResponse(): {
    res: http.ServerResponse;
    getStatusCode: () => number;
    getBody: () => any;
} {
    let statusCode = 0;
    let body = '';

    const res = {
        writeHead: vi.fn((code: number) => { statusCode = code; }),
        end: vi.fn((data?: string) => { if (data) body = data; }),
    } as unknown as http.ServerResponse;

    return {
        res,
        getStatusCode: () => statusCode,
        getBody: () => { try { return JSON.parse(body); } catch { return body; } },
    };
}

function makeRequest(method: string, url: string, body?: any): http.IncomingMessage {
    const req = Object.assign(
        new (require('events').EventEmitter)(),
        { method, url }
    ) as unknown as http.IncomingMessage;

    if (body !== undefined) {
        process.nextTick(() => {
            (req as any).emit('data', Buffer.from(JSON.stringify(body)));
            (req as any).emit('end');
        });
    } else {
        process.nextTick(() => (req as any).emit('end'));
    }

    return req;
}

// ============================================================================
// Tests
// ============================================================================

describe('createSkillRouteHandlers', () => {
    let installDir: string;
    let sourceRoot: string;

    beforeEach(() => {
        installDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-factory-install-'));
        sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-factory-root-'));
    });

    afterEach(() => {
        fs.rmSync(installDir, { recursive: true, force: true });
        fs.rmSync(sourceRoot, { recursive: true, force: true });
    });

    // -----------------------------------------------------------------------
    // handleScan
    // -----------------------------------------------------------------------

    describe('handleScan', () => {
        it('returns 400 when url is missing', async () => {
            const { handleScan } = createSkillRouteHandlers({ installPath: installDir, sourceRoot });
            const { res, getStatusCode, getBody } = createMockResponse();
            const req = makeRequest('POST', '/scan', {});
            await handleScan(req, res);
            expect(getStatusCode()).toBe(400);
            expect(getBody().error).toContain('url');
        });

        it('returns 400 when url is not a string', async () => {
            const { handleScan } = createSkillRouteHandlers({ installPath: installDir, sourceRoot });
            const { res, getStatusCode } = createMockResponse();
            const req = makeRequest('POST', '/scan', { url: 42 });
            await handleScan(req, res);
            expect(getStatusCode()).toBe(400);
        });

        it('returns success:false for invalid GitHub URL', async () => {
            const { handleScan } = createSkillRouteHandlers({ installPath: installDir, sourceRoot });
            const { res, getStatusCode, getBody } = createMockResponse();
            const req = makeRequest('POST', '/scan', { url: 'https://github.com/x' });
            await handleScan(req, res);
            expect(getStatusCode()).toBe(200);
            expect(getBody().success).toBe(false);
        });

        it('returns 400 when request body is invalid JSON', async () => {
            const { handleScan } = createSkillRouteHandlers({ installPath: installDir, sourceRoot });
            const { res, getStatusCode } = createMockResponse();
            const req = Object.assign(
                new (require('events').EventEmitter)(),
                { method: 'POST', url: '/scan' }
            ) as unknown as http.IncomingMessage;
            process.nextTick(() => {
                (req as any).emit('data', Buffer.from('not-json'));
                (req as any).emit('end');
            });
            await handleScan(req, res);
            expect(getStatusCode()).toBe(400);
        });
    });

    // -----------------------------------------------------------------------
    // handleInstall
    // -----------------------------------------------------------------------

    describe('handleInstall', () => {
        it('returns empty result when no matching bundled skills selected', async () => {
            const { handleInstall } = createSkillRouteHandlers({ installPath: installDir, sourceRoot });
            const { res, getStatusCode, getBody } = createMockResponse();
            const req = makeRequest('POST', '/install', { source: 'bundled', skills: [] });
            await handleInstall(req, res);
            expect(getStatusCode()).toBe(200);
            expect(getBody().installed).toBe(0);
        });

        it('returns 400 when url is missing for non-bundled install', async () => {
            const { handleInstall } = createSkillRouteHandlers({ installPath: installDir, sourceRoot });
            const { res, getStatusCode } = createMockResponse();
            const req = makeRequest('POST', '/install', {});
            await handleInstall(req, res);
            expect(getStatusCode()).toBe(400);
        });

        it('creates installDir when ensureInstallDir is true', async () => {
            const newDir = path.join(installDir, 'nested', 'install');
            const { handleInstall } = createSkillRouteHandlers({
                installPath: newDir,
                sourceRoot,
                ensureInstallDir: true,
            });
            const { res } = createMockResponse();
            const req = makeRequest('POST', '/install', { source: 'bundled', skills: [] });
            await handleInstall(req, res);
            expect(fs.existsSync(newDir)).toBe(true);
        });

        it('does not create installDir when ensureInstallDir is false (default)', async () => {
            const newDir = path.join(installDir, 'not-created');
            const { handleInstall } = createSkillRouteHandlers({ installPath: newDir, sourceRoot });
            const { res } = createMockResponse();
            const req = makeRequest('POST', '/install', { source: 'bundled', skills: [] });
            await handleInstall(req, res);
            expect(fs.existsSync(newDir)).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // handleDelete
    // -----------------------------------------------------------------------

    describe('handleDelete', () => {
        it('returns 404 when skill does not exist', async () => {
            const { handleDelete } = createSkillRouteHandlers({ installPath: installDir, sourceRoot });
            const { res, getStatusCode } = createMockResponse();
            await handleDelete(res, 'nonexistent');
            expect(getStatusCode()).toBe(404);
        });

        it('returns 400 for path-traversal skill name', async () => {
            const { handleDelete } = createSkillRouteHandlers({ installPath: installDir, sourceRoot });
            const { res, getStatusCode } = createMockResponse();
            await handleDelete(res, '../escape');
            expect(getStatusCode()).toBe(400);
        });

        it('deletes skill and returns 204', async () => {
            const skillDir = path.join(installDir, 'my-skill');
            fs.mkdirSync(skillDir);
            fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# My Skill');

            const { handleDelete } = createSkillRouteHandlers({ installPath: installDir, sourceRoot });
            const { res, getStatusCode } = createMockResponse();
            await handleDelete(res, 'my-skill');
            expect(getStatusCode()).toBe(204);
            expect(fs.existsSync(skillDir)).toBe(false);
        });

        it('returns 404 when skill directory exists but has no SKILL.md', async () => {
            const skillDir = path.join(installDir, 'incomplete-skill');
            fs.mkdirSync(skillDir);

            const { handleDelete } = createSkillRouteHandlers({ installPath: installDir, sourceRoot });
            const { res, getStatusCode } = createMockResponse();
            await handleDelete(res, 'incomplete-skill');
            expect(getStatusCode()).toBe(404);
        });
    });
});
