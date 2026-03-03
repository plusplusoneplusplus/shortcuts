/**
 * Tests for skill-handler API routes.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { registerSkillRoutes } from '../src/skill-handler';
import { createMockProcessStore } from './helpers/mock-process-store';
import type { Route } from '../src/types';
import type { WorkspaceInfo } from '@plusplusoneplusplus/pipeline-core';

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

async function dispatchRoute(
    routes: Route[],
    method: string,
    url: string,
    body?: any
): Promise<{ statusCode: number; body: any }> {
    const { res, getStatusCode, getBody } = createMockResponse();
    const req = makeRequest(method, url, body);

    for (const route of routes) {
        const pattern = route.pattern;
        let match: RegExpMatchArray | null = null;

        if (typeof pattern === 'string') {
            if (pattern === url) match = [url];
        } else {
            match = url.match(pattern);
        }

        if (match && route.method === method) {
            await route.handler(req, res, match);
            return { statusCode: getStatusCode(), body: getBody() };
        }
    }

    return { statusCode: 404, body: { error: 'No route matched' } };
}

// ============================================================================
// Tests
// ============================================================================

describe('registerSkillRoutes', () => {
    let routes: Route[];
    let store: ReturnType<typeof createMockProcessStore>;
    let workspaceDir: string;
    const workspaceId = 'ws-test-123';

    beforeEach(() => {
        routes = [];
        workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-api-'));
        store = createMockProcessStore({
            initialWorkspaces: [{
                id: workspaceId,
                name: 'Test Workspace',
                rootPath: workspaceDir,
            } as WorkspaceInfo],
        });
        store.getWorkspaces = vi.fn(async () => [{
            id: workspaceId,
            name: 'Test Workspace',
            rootPath: workspaceDir,
        } as WorkspaceInfo]);
        registerSkillRoutes(routes, store);
    });

    afterEach(() => {
        fs.rmSync(workspaceDir, { recursive: true, force: true });
    });

    // -----------------------------------------------------------------------
    // GET /api/workspaces/:id/skills
    // -----------------------------------------------------------------------

    it('GET /api/workspaces/:id/skills returns empty array when no skills installed', async () => {
        const { statusCode, body } = await dispatchRoute(
            routes, 'GET', `/api/workspaces/${workspaceId}/skills`
        );
        expect(statusCode).toBe(200);
        expect(body.skills).toEqual([]);
    });

    it('GET /api/workspaces/:id/skills lists installed skills', async () => {
        // Create a skill directory with SKILL.md
        const skillsDir = path.join(workspaceDir, '.github', 'skills');
        fs.mkdirSync(skillsDir, { recursive: true });
        const skillDir = path.join(skillsDir, 'my-skill');
        fs.mkdirSync(skillDir);
        fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# My Skill\nA great skill');

        const { statusCode, body } = await dispatchRoute(
            routes, 'GET', `/api/workspaces/${workspaceId}/skills`
        );
        expect(statusCode).toBe(200);
        expect(body.skills).toHaveLength(1);
        expect(body.skills[0].name).toBe('my-skill');
        expect(body.skills[0].description).toBeTruthy();
    });

    it('GET /api/workspaces/:id/skills returns 404 for unknown workspace', async () => {
        const { statusCode } = await dispatchRoute(
            routes, 'GET', `/api/workspaces/unknown-id/skills`
        );
        expect(statusCode).toBe(404);
    });

    // -----------------------------------------------------------------------
    // GET /api/workspaces/:id/skills/bundled
    // -----------------------------------------------------------------------

    it('GET /api/workspaces/:id/skills/bundled returns array', async () => {
        const { statusCode, body } = await dispatchRoute(
            routes, 'GET', `/api/workspaces/${workspaceId}/skills/bundled`
        );
        expect(statusCode).toBe(200);
        expect(Array.isArray(body.skills)).toBe(true);
    });

    // -----------------------------------------------------------------------
    // POST /api/workspaces/:id/skills/scan
    // -----------------------------------------------------------------------

    it('POST /api/workspaces/:id/skills/scan returns error for missing url', async () => {
        const { statusCode, body } = await dispatchRoute(
            routes, 'POST', `/api/workspaces/${workspaceId}/skills/scan`, {}
        );
        expect(statusCode).toBe(400);
        expect(body.error).toContain('url');
    });

    it('POST /api/workspaces/:id/skills/scan returns failure for invalid GitHub URL', async () => {
        const { statusCode, body } = await dispatchRoute(
            routes, 'POST', `/api/workspaces/${workspaceId}/skills/scan`,
            { url: 'https://github.com/x' }
        );
        expect(statusCode).toBe(200);
        expect(body.success).toBe(false);
    });

    // -----------------------------------------------------------------------
    // POST /api/workspaces/:id/skills/install (bundled)
    // -----------------------------------------------------------------------

    it('POST /api/workspaces/:id/skills/install with source=bundled returns result', async () => {
        const { statusCode, body } = await dispatchRoute(
            routes, 'POST', `/api/workspaces/${workspaceId}/skills/install`,
            { source: 'bundled', skills: [] }
        );
        expect(statusCode).toBe(200);
        expect(typeof body.installed).toBe('number');
    });

    it('POST /api/workspaces/:id/skills/install returns 400 for missing url', async () => {
        const { statusCode } = await dispatchRoute(
            routes, 'POST', `/api/workspaces/${workspaceId}/skills/install`, {}
        );
        expect(statusCode).toBe(400);
    });

    // -----------------------------------------------------------------------
    // DELETE /api/workspaces/:id/skills/:name
    // -----------------------------------------------------------------------

    it('DELETE /api/workspaces/:id/skills/:name returns 404 for non-existent skill', async () => {
        const { statusCode } = await dispatchRoute(
            routes, 'DELETE', `/api/workspaces/${workspaceId}/skills/nonexistent`
        );
        expect(statusCode).toBe(404);
    });

    it('DELETE /api/workspaces/:id/skills/:name deletes an installed skill', async () => {
        const skillsDir = path.join(workspaceDir, '.github', 'skills');
        fs.mkdirSync(skillsDir, { recursive: true });
        const skillDir = path.join(skillsDir, 'my-skill');
        fs.mkdirSync(skillDir);
        fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# My Skill');

        const { statusCode } = await dispatchRoute(
            routes, 'DELETE', `/api/workspaces/${workspaceId}/skills/my-skill`
        );
        expect(statusCode).toBe(204);
        expect(fs.existsSync(skillDir)).toBe(false);
    });

    it('DELETE /api/workspaces/:id/skills/bundled returns 400 (reserved name)', async () => {
        const { statusCode } = await dispatchRoute(
            routes, 'DELETE', `/api/workspaces/${workspaceId}/skills/bundled`
        );
        expect(statusCode).toBe(400);
    });
});
