/**
 * Tests for global-skill-handler API routes.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { registerGlobalSkillRoutes } from '../src/global-skill-handler';
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

describe('registerGlobalSkillRoutes', () => {
    let routes: Route[];
    let store: ReturnType<typeof createMockProcessStore>;
    let dataDir: string;
    let globalSkillsDir: string;
    const workspaceId = 'ws-test-global';
    let workspaceDir: string;

    beforeEach(() => {
        routes = [];
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'global-skill-api-'));
        globalSkillsDir = path.join(dataDir, 'skills');
        fs.mkdirSync(globalSkillsDir, { recursive: true });
        workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'global-skill-ws-'));
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
        registerGlobalSkillRoutes(routes, store, dataDir);
    });

    afterEach(() => {
        fs.rmSync(dataDir, { recursive: true, force: true });
        fs.rmSync(workspaceDir, { recursive: true, force: true });
    });

    // -----------------------------------------------------------------------
    // GET /api/skills — list global skills
    // -----------------------------------------------------------------------

    describe('GET /api/skills', () => {
        it('returns empty array when no skills installed', async () => {
            const { statusCode, body } = await dispatchRoute(routes, 'GET', '/api/skills');
            expect(statusCode).toBe(200);
            expect(body.skills).toEqual([]);
        });

        it('returns installed global skills', async () => {
            const skillDir = path.join(globalSkillsDir, 'my-global-skill');
            fs.mkdirSync(skillDir);
            fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '---\nname: my-global-skill\ndescription: A test skill\nversion: 1.0\n---\n# Test\nHello');

            const { statusCode, body } = await dispatchRoute(routes, 'GET', '/api/skills');
            expect(statusCode).toBe(200);
            expect(body.skills).toHaveLength(1);
            expect(body.skills[0].name).toBe('my-global-skill');
            expect(body.skills[0].description).toBe('A test skill');
            expect(body.skills[0].version).toBe('1.0');
        });

        it('sorts skills by usage when preferences exist', async () => {
            // Create two skills
            const skillA = path.join(globalSkillsDir, 'aaa-skill');
            const skillB = path.join(globalSkillsDir, 'bbb-skill');
            fs.mkdirSync(skillA);
            fs.mkdirSync(skillB);
            fs.writeFileSync(path.join(skillA, 'SKILL.md'), '# aaa-skill\nDescription A');
            fs.writeFileSync(path.join(skillB, 'SKILL.md'), '# bbb-skill\nDescription B');

            // Write usage preferences (bbb used more recently)
            const prefs = { globalSkillUsage: { 'bbb-skill': '2026-01-02T00:00:00Z', 'aaa-skill': '2026-01-01T00:00:00Z' } };
            fs.writeFileSync(path.join(dataDir, 'preferences.json'), JSON.stringify(prefs));

            const { statusCode, body } = await dispatchRoute(routes, 'GET', '/api/skills');
            expect(statusCode).toBe(200);
            expect(body.skills).toHaveLength(2);
            expect(body.skills[0].name).toBe('bbb-skill');
            expect(body.skills[1].name).toBe('aaa-skill');
        });
    });

    // -----------------------------------------------------------------------
    // GET /api/skills/:name — get skill detail
    // -----------------------------------------------------------------------

    describe('GET /api/skills/:name', () => {
        it('returns skill detail', async () => {
            const skillDir = path.join(globalSkillsDir, 'test-skill');
            fs.mkdirSync(skillDir);
            fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '---\nname: test-skill\ndescription: Test\nversion: 2.0\n---\n# Prompt\nDo the thing');
            fs.mkdirSync(path.join(skillDir, 'references'));
            fs.writeFileSync(path.join(skillDir, 'references', 'ref.md'), 'reference content');

            const { statusCode, body } = await dispatchRoute(routes, 'GET', '/api/skills/test-skill');
            expect(statusCode).toBe(200);
            expect(body.skill.name).toBe('test-skill');
            expect(body.skill.version).toBe('2.0');
            expect(body.skill.references).toContain('ref.md');
        });

        it('returns 404 for non-existent skill', async () => {
            const { statusCode, body } = await dispatchRoute(routes, 'GET', '/api/skills/nonexistent');
            expect(statusCode).toBe(404);
            expect(body.error).toBeTruthy();
        });

        it('rejects reserved route names', async () => {
            const { statusCode } = await dispatchRoute(routes, 'GET', '/api/skills/bundled');
            expect(statusCode).toBe(200); // bundled route matches first
        });
    });

    // -----------------------------------------------------------------------
    // DELETE /api/skills/:name — delete global skill
    // -----------------------------------------------------------------------

    describe('DELETE /api/skills/:name', () => {
        it('deletes an existing skill', async () => {
            const skillDir = path.join(globalSkillsDir, 'to-delete');
            fs.mkdirSync(skillDir);
            fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# To Delete\nTest');

            const { statusCode } = await dispatchRoute(routes, 'DELETE', '/api/skills/to-delete');
            expect(statusCode).toBe(204);
            expect(fs.existsSync(skillDir)).toBe(false);
        });

        it('returns 404 for non-existent skill', async () => {
            const { statusCode } = await dispatchRoute(routes, 'DELETE', '/api/skills/missing');
            expect(statusCode).toBe(404);
        });

        it('rejects path traversal', async () => {
            const { statusCode } = await dispatchRoute(routes, 'DELETE', '/api/skills/..%2F..%2Fetc');
            expect(statusCode).toBe(400);
        });
    });

    // -----------------------------------------------------------------------
    // GET /api/skills/config — get global config
    // -----------------------------------------------------------------------

    describe('GET /api/skills/config', () => {
        it('returns empty disabled list when no preferences', async () => {
            const { statusCode, body } = await dispatchRoute(routes, 'GET', '/api/skills/config');
            expect(statusCode).toBe(200);
            expect(body.globalDisabledSkills).toEqual([]);
            expect(body.globalSkillsDir).toBeTruthy();
        });

        it('returns disabled skills from preferences', async () => {
            const prefs = { globalDisabledSkills: ['skill-a', 'skill-b'] };
            fs.writeFileSync(path.join(dataDir, 'preferences.json'), JSON.stringify(prefs));

            const { statusCode, body } = await dispatchRoute(routes, 'GET', '/api/skills/config');
            expect(statusCode).toBe(200);
            expect(body.globalDisabledSkills).toEqual(['skill-a', 'skill-b']);
        });
    });

    // -----------------------------------------------------------------------
    // PUT /api/skills/config — update global config
    // -----------------------------------------------------------------------

    describe('PUT /api/skills/config', () => {
        it('saves disabled skills to preferences', async () => {
            const { statusCode, body } = await dispatchRoute(
                routes, 'PUT', '/api/skills/config',
                { globalDisabledSkills: ['skill-x'] }
            );
            expect(statusCode).toBe(200);
            expect(body.globalDisabledSkills).toEqual(['skill-x']);

            // Verify written to disk
            const prefs = JSON.parse(fs.readFileSync(path.join(dataDir, 'preferences.json'), 'utf-8'));
            expect(prefs.globalDisabledSkills).toEqual(['skill-x']);
        });

        it('rejects invalid payload', async () => {
            const { statusCode } = await dispatchRoute(
                routes, 'PUT', '/api/skills/config',
                { globalDisabledSkills: 'not-an-array' }
            );
            expect(statusCode).toBe(400);
        });

        it('rejects missing field', async () => {
            const { statusCode } = await dispatchRoute(
                routes, 'PUT', '/api/skills/config',
                { something: 'else' }
            );
            expect(statusCode).toBe(400);
        });
    });

    // -----------------------------------------------------------------------
    // POST /api/skills/install — install skills globally
    // -----------------------------------------------------------------------

    describe('POST /api/skills/install', () => {
        it('installs bundled skills', async () => {
            const { statusCode, body } = await dispatchRoute(
                routes, 'POST', '/api/skills/install',
                { source: 'bundled', skills: [], replace: false }
            );
            // Result depends on bundled skills availability; we just verify no crash
            expect(statusCode).toBe(200);
            expect(body).toHaveProperty('installed');
        });

        it('replaces existing skills when replace is true', async () => {
            // First install
            await dispatchRoute(
                routes, 'POST', '/api/skills/install',
                { source: 'bundled', replace: true }
            );

            // Second install with replace: true should succeed and overwrite
            const { statusCode, body } = await dispatchRoute(
                routes, 'POST', '/api/skills/install',
                { source: 'bundled', replace: true }
            );
            expect(statusCode).toBe(200);
            expect(body).toHaveProperty('installed');
            expect(body.skipped).toBe(0);
        });

        it('skips existing skills when replace is false', async () => {
            // First install
            const first = await dispatchRoute(
                routes, 'POST', '/api/skills/install',
                { source: 'bundled', replace: true }
            );
            const installedCount = first.body.installed;

            // Second install with replace: false should skip all
            const { statusCode, body } = await dispatchRoute(
                routes, 'POST', '/api/skills/install',
                { source: 'bundled', replace: false }
            );
            expect(statusCode).toBe(200);
            if (installedCount > 0) {
                expect(body.skipped).toBeGreaterThan(0);
                expect(body.installed).toBe(0);
            }
        });
    });

    // -----------------------------------------------------------------------
    // GET /api/workspaces/:id/skills/all — merged skills
    // -----------------------------------------------------------------------

    describe('GET /api/workspaces/:id/skills/all', () => {
        it('returns global and repo skills with source annotations', async () => {
            // Create a global skill
            const globalSkill = path.join(globalSkillsDir, 'global-skill');
            fs.mkdirSync(globalSkill);
            fs.writeFileSync(path.join(globalSkill, 'SKILL.md'), '# Global Skill\nGlobal description');

            // Create a repo skill
            const repoSkillsDir = path.join(workspaceDir, '.github', 'skills', 'repo-skill');
            fs.mkdirSync(repoSkillsDir, { recursive: true });
            fs.writeFileSync(path.join(repoSkillsDir, 'SKILL.md'), '# Repo Skill\nRepo description');

            const { statusCode, body } = await dispatchRoute(
                routes, 'GET', `/api/workspaces/${workspaceId}/skills/all`
            );
            expect(statusCode).toBe(200);
            expect(body.global).toHaveLength(1);
            expect(body.global[0].name).toBe('global-skill');
            expect(body.global[0].source).toBe('global');
            expect(body.repo).toHaveLength(1);
            expect(body.repo[0].name).toBe('repo-skill');
            expect(body.repo[0].source).toBe('repo');
            expect(body.merged).toHaveLength(2);
        });

        it('repo skill overrides global skill with same name', async () => {
            // Create same-named skill in both global and repo
            const globalSkill = path.join(globalSkillsDir, 'shared-skill');
            fs.mkdirSync(globalSkill);
            fs.writeFileSync(path.join(globalSkill, 'SKILL.md'), '# Shared\nGlobal version');

            const repoSkillsDir = path.join(workspaceDir, '.github', 'skills', 'shared-skill');
            fs.mkdirSync(repoSkillsDir, { recursive: true });
            fs.writeFileSync(path.join(repoSkillsDir, 'SKILL.md'), '# Shared\nRepo version');

            const { statusCode, body } = await dispatchRoute(
                routes, 'GET', `/api/workspaces/${workspaceId}/skills/all`
            );
            expect(statusCode).toBe(200);
            // merged should have only one "shared-skill" — from repo
            expect(body.merged).toHaveLength(1);
            expect(body.merged[0].source).toBe('repo');
        });

        it('returns 404 for unknown workspace', async () => {
            const { statusCode } = await dispatchRoute(
                routes, 'GET', '/api/workspaces/nonexistent/skills/all'
            );
            expect(statusCode).toBe(404);
        });
    });
});
