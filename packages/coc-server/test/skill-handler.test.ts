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

    // -----------------------------------------------------------------------
    // GET /api/workspaces/:id/skills (enriched response)
    // -----------------------------------------------------------------------

    it('GET /api/workspaces/:id/skills returns enriched fields with frontmatter', async () => {
        const skillsDir = path.join(workspaceDir, '.github', 'skills');
        const skillDir = path.join(skillsDir, 'test-skill');
        fs.mkdirSync(skillDir, { recursive: true });
        fs.writeFileSync(path.join(skillDir, 'SKILL.md'), [
            '---',
            'name: test-skill',
            'description: A test skill',
            'version: 1.2.0',
            'variables: [input, context]',
            'output: [result, summary]',
            '---',
            '',
            '# Test Skill',
            '',
            'Do the thing.',
        ].join('\n'));

        // Create references and scripts subdirectories
        const refsDir = path.join(skillDir, 'references');
        fs.mkdirSync(refsDir);
        fs.writeFileSync(path.join(refsDir, 'ref1.prompt.md'), '# Ref');
        fs.writeFileSync(path.join(refsDir, 'ref2.prompt.md'), '# Ref2');

        const scriptsDir = path.join(skillDir, 'scripts');
        fs.mkdirSync(scriptsDir);
        fs.writeFileSync(path.join(scriptsDir, 'helper.py'), 'print("hi")');

        const { statusCode, body } = await dispatchRoute(
            routes, 'GET', `/api/workspaces/${workspaceId}/skills`
        );
        expect(statusCode).toBe(200);
        expect(body.skills).toHaveLength(1);
        const skill = body.skills[0];
        expect(skill.name).toBe('test-skill');
        expect(skill.description).toBe('A test skill');
        expect(skill.version).toBe('1.2.0');
        expect(skill.variables).toEqual(['input', 'context']);
        expect(skill.output).toEqual(['result', 'summary']);
        expect(skill.promptBody).toContain('# Test Skill');
        expect(skill.promptBody).toContain('Do the thing.');
        expect(skill.references).toEqual(['ref1.prompt.md', 'ref2.prompt.md']);
        expect(skill.scripts).toEqual(['helper.py']);
    });

    it('GET /api/workspaces/:id/skills returns empty arrays for references/scripts when none exist', async () => {
        const skillsDir = path.join(workspaceDir, '.github', 'skills');
        const skillDir = path.join(skillsDir, 'bare-skill');
        fs.mkdirSync(skillDir, { recursive: true });
        fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# Bare Skill\n\nJust a prompt.');

        const { statusCode, body } = await dispatchRoute(
            routes, 'GET', `/api/workspaces/${workspaceId}/skills`
        );
        expect(statusCode).toBe(200);
        const skill = body.skills[0];
        expect(skill.name).toBe('bare-skill');
        expect(skill.references).toEqual([]);
        expect(skill.scripts).toEqual([]);
        expect(skill.promptBody).toContain('Bare Skill');
    });

    // -----------------------------------------------------------------------
    // GET /api/workspaces/:id/skills/:name (detail endpoint)
    // -----------------------------------------------------------------------

    it('GET /api/workspaces/:id/skills/:name returns full skill detail', async () => {
        const skillsDir = path.join(workspaceDir, '.github', 'skills');
        const skillDir = path.join(skillsDir, 'detail-skill');
        fs.mkdirSync(skillDir, { recursive: true });
        fs.writeFileSync(path.join(skillDir, 'SKILL.md'), [
            '---',
            'name: detail-skill',
            'description: Detailed skill',
            'version: 2.0.0',
            '---',
            '',
            '# Detail Skill',
            '',
            'Full prompt content here.',
        ].join('\n'));
        const refsDir = path.join(skillDir, 'references');
        fs.mkdirSync(refsDir);
        fs.writeFileSync(path.join(refsDir, 'deep-dive.prompt.md'), '# Deep');

        const { statusCode, body } = await dispatchRoute(
            routes, 'GET', `/api/workspaces/${workspaceId}/skills/detail-skill`
        );
        expect(statusCode).toBe(200);
        expect(body.skill.name).toBe('detail-skill');
        expect(body.skill.description).toBe('Detailed skill');
        expect(body.skill.version).toBe('2.0.0');
        expect(body.skill.promptBody).toContain('Full prompt content here.');
        expect(body.skill.references).toEqual(['deep-dive.prompt.md']);
        expect(body.skill.scripts).toEqual([]);
        expect(body.skill.relativePath).toContain('detail-skill');
    });

    it('GET /api/workspaces/:id/skills/:name returns 404 for non-existent skill', async () => {
        const { statusCode } = await dispatchRoute(
            routes, 'GET', `/api/workspaces/${workspaceId}/skills/nonexistent`
        );
        expect(statusCode).toBe(404);
    });

    it('GET /api/workspaces/:id/skills/:name returns 404 for unknown workspace', async () => {
        const { statusCode } = await dispatchRoute(
            routes, 'GET', `/api/workspaces/unknown-ws/skills/any-skill`
        );
        expect(statusCode).toBe(404);
    });

    it('GET /api/workspaces/:id/skills/:name returns 400 for reserved names', async () => {
        // 'scan' and 'install' are POST-only routes, so GET would hit the detail endpoint
        for (const reserved of ['scan', 'install']) {
            const { statusCode } = await dispatchRoute(
                routes, 'GET', `/api/workspaces/${workspaceId}/skills/${reserved}`
            );
            expect(statusCode).toBe(400);
        }
    });
});
