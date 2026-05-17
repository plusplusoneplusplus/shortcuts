/**
 * Tests for skill-handler API routes.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { registerSkillRoutes, sortSkillsByUsage, skillCache, SKILL_CACHE_TTL_MS } from '../../src/server/skills/skill-handler';
import { createMockProcessStore } from './helpers/mock-process-store';
import type { Route } from '../../src/server/types';
import { getRepoDataPath, type WorkspaceInfo } from '@plusplusoneplusplus/forge';
import { ENDEV_STATUS_CACHE_FILE, ENDEV_XDPU_SKILL_NAME } from '../../src/server/endev/endev-detector';

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
        skillCache.clear();
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

    describe('EnDev xDPU wrapper visibility', () => {
        let dataDir: string;
        let routesWithDataDir: Route[];

        function writeEnDevStatus(eligible: boolean, pluginSkillFolder?: string): void {
            const statusPath = getRepoDataPath(dataDir, workspaceId, ENDEV_STATUS_CACHE_FILE);
            fs.mkdirSync(path.dirname(statusPath), { recursive: true });
            fs.writeFileSync(statusPath, JSON.stringify({
                workspaceId,
                workspaceRoot: workspaceDir,
                eligible,
                reason: eligible ? 'eligible' : 'not-xdpu-workspace',
                nativeWsl: true,
                xDpuWorkspace: eligible,
                hasSetupFiles: eligible,
                setupFiles: eligible ? ['.endev'] : [],
                pluginSkillFolder,
                checkedAt: new Date().toISOString(),
                cached: false,
            }));
        }

        beforeEach(() => {
            dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-endev-data-'));
            routesWithDataDir = [];
            registerSkillRoutes(routesWithDataDir, store, dataDir);
        });

        afterEach(() => {
            fs.rmSync(dataDir, { recursive: true, force: true });
        });

        it('hides EnDev-xDpu from workspace skill lists when the workspace is ineligible', async () => {
            const skillsDir = path.join(workspaceDir, '.github', 'skills', ENDEV_XDPU_SKILL_NAME);
            fs.mkdirSync(skillsDir, { recursive: true });
            fs.writeFileSync(path.join(skillsDir, 'SKILL.md'), '# EnDev xDPU');
            writeEnDevStatus(false);

            const { statusCode, body } = await dispatchRoute(
                routesWithDataDir, 'GET', `/api/workspaces/${workspaceId}/skills`
            );

            expect(statusCode).toBe(200);
            expect(body.skills.map((s: any) => s.name)).not.toContain(ENDEV_XDPU_SKILL_NAME);
        });

        it('shows EnDev-xDpu by default when the workspace is eligible', async () => {
            const skillsDir = path.join(workspaceDir, '.github', 'skills', ENDEV_XDPU_SKILL_NAME);
            fs.mkdirSync(skillsDir, { recursive: true });
            fs.writeFileSync(path.join(skillsDir, 'SKILL.md'), '# EnDev xDPU');
            writeEnDevStatus(true);

            const { statusCode, body } = await dispatchRoute(
                routesWithDataDir, 'GET', `/api/workspaces/${workspaceId}/skills`
            );

            expect(statusCode).toBe(200);
            expect(body.skills.map((s: any) => s.name)).toContain(ENDEV_XDPU_SKILL_NAME);
        });
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

    // -----------------------------------------------------------------------
    // GET /api/workspaces/:id/skills (sorted by usage)
    // -----------------------------------------------------------------------

    it('GET /api/workspaces/:id/skills returns skills sorted by usage when dataDir provided', async () => {
        // Create three skills
        const skillsDir = path.join(workspaceDir, '.github', 'skills');
        for (const name of ['beta-skill', 'alpha-skill', 'gamma-skill']) {
            const dir = path.join(skillsDir, name);
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(path.join(dir, 'SKILL.md'), `# ${name}\nA skill`);
        }

        // Create preferences with usage data in per-repo path
        const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-prefs-'));
        const repoPrefsDir = path.join(dataDir, 'repos', workspaceId);
        fs.mkdirSync(repoPrefsDir, { recursive: true });
        const repoPrefs = {
            skillUsageMap: {
                'gamma-skill': '2025-01-03T00:00:00.000Z',
                'alpha-skill': '2025-01-01T00:00:00.000Z',
            },
        };
        fs.writeFileSync(path.join(repoPrefsDir, 'preferences.json'), JSON.stringify(repoPrefs));

        // Re-register routes with dataDir
        const sortedRoutes: Route[] = [];
        registerSkillRoutes(sortedRoutes, store, dataDir);

        const { statusCode, body } = await dispatchRoute(
            sortedRoutes, 'GET', `/api/workspaces/${workspaceId}/skills`
        );
        expect(statusCode).toBe(200);
        expect(body.skills.map((s: any) => s.name)).toEqual([
            'gamma-skill',   // most recent usage
            'alpha-skill',   // older usage
            'beta-skill',    // unused, alphabetical
        ]);

        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    // -----------------------------------------------------------------------
    // GET /api/workspaces/:id/skills-path
    // -----------------------------------------------------------------------

    it('GET /api/workspaces/:id/skills-path returns path and zero count when folder missing', async () => {
        const { statusCode, body } = await dispatchRoute(
            routes, 'GET', `/api/workspaces/${workspaceId}/skills-path`
        );
        expect(statusCode).toBe(200);
        expect(body.path).toContain('.github');
        expect(body.path).toContain('skills');
        expect(body.skillCount).toBe(0);
        expect(body.accessible).toBe(false);
    });

    it('GET /api/workspaces/:id/skills-path returns correct count when skills exist', async () => {
        const skillsDir = path.join(workspaceDir, '.github', 'skills');
        for (const name of ['skill-a', 'skill-b']) {
            const dir = path.join(skillsDir, name);
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(path.join(dir, 'SKILL.md'), `# ${name}`);
        }

        const { statusCode, body } = await dispatchRoute(
            routes, 'GET', `/api/workspaces/${workspaceId}/skills-path`
        );
        expect(statusCode).toBe(200);
        expect(body.skillCount).toBe(2);
        expect(body.accessible).toBe(true);
    });

    it('GET /api/workspaces/:id/skills-path returns 404 for unknown workspace', async () => {
        const { statusCode } = await dispatchRoute(
            routes, 'GET', `/api/workspaces/unknown-id/skills-path`
        );
        expect(statusCode).toBe(404);
    });

    // -----------------------------------------------------------------------
    // GET /api/workspaces/:id/skills — extra folders + linked repo attribution
    // -----------------------------------------------------------------------

    it('GET /api/workspaces/:id/skills includes skills from extraSkillFolders', async () => {
        // Create local skill
        const skillsDir = path.join(workspaceDir, '.github', 'skills');
        fs.mkdirSync(path.join(skillsDir, 'local-skill'), { recursive: true });
        fs.writeFileSync(path.join(skillsDir, 'local-skill', 'SKILL.md'), '# local-skill');

        // Create extra folder with a different skill
        const extraDir = fs.mkdtempSync(path.join(os.tmpdir(), 'extra-skills-'));
        fs.mkdirSync(path.join(extraDir, 'extra-skill'), { recursive: true });
        fs.writeFileSync(path.join(extraDir, 'extra-skill', 'SKILL.md'), '# extra-skill');

        store.getWorkspaces = vi.fn(async () => [{
            id: workspaceId,
            name: 'Test Workspace',
            rootPath: workspaceDir,
            extraSkillFolders: [extraDir],
        } as WorkspaceInfo]);

        const { statusCode, body } = await dispatchRoute(
            routes, 'GET', `/api/workspaces/${workspaceId}/skills`
        );
        expect(statusCode).toBe(200);
        const names = body.skills.map((s: any) => s.name);
        expect(names).toContain('local-skill');
        expect(names).toContain('extra-skill');

        fs.rmSync(extraDir, { recursive: true, force: true });
    });

    it('GET /api/workspaces/:id/skills local skill takes precedence over extra folder skill with same name', async () => {
        const skillsDir = path.join(workspaceDir, '.github', 'skills');
        fs.mkdirSync(path.join(skillsDir, 'shared-skill'), { recursive: true });
        fs.writeFileSync(path.join(skillsDir, 'shared-skill', 'SKILL.md'), '---\ndescription: local version\n---\n# shared-skill');

        const extraDir = fs.mkdtempSync(path.join(os.tmpdir(), 'extra-skills-'));
        fs.mkdirSync(path.join(extraDir, 'shared-skill'), { recursive: true });
        fs.writeFileSync(path.join(extraDir, 'shared-skill', 'SKILL.md'), '---\ndescription: extra version\n---\n# shared-skill');

        store.getWorkspaces = vi.fn(async () => [{
            id: workspaceId,
            name: 'Test Workspace',
            rootPath: workspaceDir,
            extraSkillFolders: [extraDir],
        } as WorkspaceInfo]);

        const { statusCode, body } = await dispatchRoute(
            routes, 'GET', `/api/workspaces/${workspaceId}/skills`
        );
        expect(statusCode).toBe(200);
        const sharedSkill = body.skills.find((s: any) => s.name === 'shared-skill');
        expect(sharedSkill).toBeDefined();
        expect(sharedSkill.description).toBe('local version');

        fs.rmSync(extraDir, { recursive: true, force: true });
    });

    it('GET /api/workspaces/:id/skills tags skills from linked workspace with sourceRepoId', async () => {
        const linkedWsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'linked-ws-'));
        const linkedSkillsDir = path.join(linkedWsDir, '.github', 'skills');
        fs.mkdirSync(path.join(linkedSkillsDir, 'linked-skill'), { recursive: true });
        fs.writeFileSync(path.join(linkedSkillsDir, 'linked-skill', 'SKILL.md'), '# linked-skill');

        const linkedWsId = 'linked-ws-999';
        store.getWorkspaces = vi.fn(async () => [
            { id: workspaceId, name: 'Main', rootPath: workspaceDir, extraSkillFolders: [linkedSkillsDir] } as WorkspaceInfo,
            { id: linkedWsId, name: 'Linked Repo', rootPath: linkedWsDir } as WorkspaceInfo,
        ]);

        const { statusCode, body } = await dispatchRoute(
            routes, 'GET', `/api/workspaces/${workspaceId}/skills`
        );
        expect(statusCode).toBe(200);
        const linkedSkill = body.skills.find((s: any) => s.name === 'linked-skill');
        expect(linkedSkill).toBeDefined();
        expect(linkedSkill.source).toBe('linked-repo');
        expect(linkedSkill.sourceRepoId).toBe(linkedWsId);

        fs.rmSync(linkedWsDir, { recursive: true, force: true });
    });

    // -----------------------------------------------------------------------
    // GET /api/workspaces/:id/skills — folderPath and source tagging
    // -----------------------------------------------------------------------

    it('GET /api/workspaces/:id/skills tags local skills with source=repo and folderPath', async () => {
        const skillsDir = path.join(workspaceDir, '.github', 'skills');
        fs.mkdirSync(path.join(skillsDir, 'local-skill'), { recursive: true });
        fs.writeFileSync(path.join(skillsDir, 'local-skill', 'SKILL.md'), '# local-skill');

        const { statusCode, body } = await dispatchRoute(
            routes, 'GET', `/api/workspaces/${workspaceId}/skills`
        );
        expect(statusCode).toBe(200);
        const skill = body.skills.find((s: any) => s.name === 'local-skill');
        expect(skill).toBeDefined();
        expect(skill.source).toBe('repo');
        expect(skill.folderPath).toContain('.github');
        expect(skill.folderPath).toContain('skills');
    });

    it('GET /api/workspaces/:id/skills includes global skills from dataDir when provided', async () => {
        // Create local skill
        const skillsDir = path.join(workspaceDir, '.github', 'skills');
        fs.mkdirSync(path.join(skillsDir, 'local-skill'), { recursive: true });
        fs.writeFileSync(path.join(skillsDir, 'local-skill', 'SKILL.md'), '# local-skill');

        // Create dataDir with global skills
        const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-data-'));
        const globalSkillsDir = path.join(dataDir, 'skills');
        fs.mkdirSync(path.join(globalSkillsDir, 'global-skill'), { recursive: true });
        fs.writeFileSync(path.join(globalSkillsDir, 'global-skill', 'SKILL.md'), '---\ndescription: A global skill\n---');

        const globalRoutes: Route[] = [];
        registerSkillRoutes(globalRoutes, store, dataDir);

        const { statusCode, body } = await dispatchRoute(
            globalRoutes, 'GET', `/api/workspaces/${workspaceId}/skills`
        );
        expect(statusCode).toBe(200);
        const names = body.skills.map((s: any) => s.name);
        expect(names).toContain('local-skill');
        expect(names).toContain('global-skill');

        const globalSkill = body.skills.find((s: any) => s.name === 'global-skill');
        expect(globalSkill.source).toBe('global');
        expect(globalSkill.folderPath).toBe(globalSkillsDir);

        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    it('GET /api/workspaces/:id/skills global skill is suppressed when local skill has same name', async () => {
        const skillsDir = path.join(workspaceDir, '.github', 'skills');
        fs.mkdirSync(path.join(skillsDir, 'shared-skill'), { recursive: true });
        fs.writeFileSync(path.join(skillsDir, 'shared-skill', 'SKILL.md'), '---\ndescription: local version\n---');

        const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-data-'));
        const globalSkillsDir = path.join(dataDir, 'skills');
        fs.mkdirSync(path.join(globalSkillsDir, 'shared-skill'), { recursive: true });
        fs.writeFileSync(path.join(globalSkillsDir, 'shared-skill', 'SKILL.md'), '---\ndescription: global version\n---');

        const globalRoutes: Route[] = [];
        registerSkillRoutes(globalRoutes, store, dataDir);

        const { statusCode, body } = await dispatchRoute(
            globalRoutes, 'GET', `/api/workspaces/${workspaceId}/skills`
        );
        expect(statusCode).toBe(200);
        const sharedSkills = body.skills.filter((s: any) => s.name === 'shared-skill');
        expect(sharedSkills).toHaveLength(1);
        expect(sharedSkills[0].source).toBe('repo');
        expect(sharedSkills[0].description).toBe('local version');

        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    it('GET /api/workspaces/:id/skills extra-folder skills tagged with source=extra-folder', async () => {
        const extraDir = fs.mkdtempSync(path.join(os.tmpdir(), 'extra-skills-'));
        fs.mkdirSync(path.join(extraDir, 'extra-skill'), { recursive: true });
        fs.writeFileSync(path.join(extraDir, 'extra-skill', 'SKILL.md'), '# extra-skill');

        store.getWorkspaces = vi.fn(async () => [{
            id: workspaceId,
            name: 'Test Workspace',
            rootPath: workspaceDir,
            extraSkillFolders: [extraDir],
        } as WorkspaceInfo]);

        const { statusCode, body } = await dispatchRoute(
            routes, 'GET', `/api/workspaces/${workspaceId}/skills`
        );
        expect(statusCode).toBe(200);
        const extraSkill = body.skills.find((s: any) => s.name === 'extra-skill');
        expect(extraSkill).toBeDefined();
        expect(extraSkill.source).toBe('extra-folder');
        expect(extraSkill.folderPath).toBe(extraDir);

        fs.rmSync(extraDir, { recursive: true, force: true });
    });
    // -----------------------------------------------------------------------
    // Cache behavior
    // -----------------------------------------------------------------------

    it('GET /api/workspaces/:id/skills returns cached data on cache hit (no filesystem re-read)', async () => {
        // Pre-populate cache with a skill that doesn't exist on disk
        skillCache.set(workspaceId, { skills: [{ name: 'cached-skill', source: 'repo' }], refreshing: false, lastUpdated: Date.now() });

        const { statusCode, body } = await dispatchRoute(routes, 'GET', `/api/workspaces/${workspaceId}/skills`);
        expect(statusCode).toBe(200);
        expect(body.skills).toHaveLength(1);
        expect(body.skills[0].name).toBe('cached-skill');
        // Cache entry still present
        expect(skillCache.has(workspaceId)).toBe(true);
    });

    it('GET /api/workspaces/:id/skills populates cache on cache miss', async () => {
        const skillsDir = path.join(workspaceDir, '.github', 'skills');
        fs.mkdirSync(path.join(skillsDir, 'new-skill'), { recursive: true });
        fs.writeFileSync(path.join(skillsDir, 'new-skill', 'SKILL.md'), '# new-skill');

        expect(skillCache.has(workspaceId)).toBe(false);
        await dispatchRoute(routes, 'GET', `/api/workspaces/${workspaceId}/skills`);
        expect(skillCache.has(workspaceId)).toBe(true);
        expect(skillCache.get(workspaceId)!.skills[0].name).toBe('new-skill');
    });

    it('GET /api/workspaces/:id/skills background refresh updates stale cache', async () => {
        // Create skill-v1 on disk
        const skillsDir = path.join(workspaceDir, '.github', 'skills');
        const skillV1Dir = path.join(skillsDir, 'skill-v1');
        fs.mkdirSync(skillV1Dir, { recursive: true });
        fs.writeFileSync(path.join(skillV1Dir, 'SKILL.md'), '# skill-v1');

        // First GET: populates cache with skill-v1
        const call1 = await dispatchRoute(routes, 'GET', `/api/workspaces/${workspaceId}/skills`);
        expect(call1.body.skills[0].name).toBe('skill-v1');

        // Modify filesystem: replace skill-v1 with skill-v2
        fs.rmSync(skillV1Dir, { recursive: true, force: true });
        const skillV2Dir = path.join(skillsDir, 'skill-v2');
        fs.mkdirSync(skillV2Dir, { recursive: true });
        fs.writeFileSync(path.join(skillV2Dir, 'SKILL.md'), '# skill-v2');

        // Make cache entry stale by backdating lastUpdated
        const entry = skillCache.get(workspaceId)!;
        entry.lastUpdated = Date.now() - SKILL_CACHE_TTL_MS - 1;

        // Second GET: returns stale cache (skill-v1), triggers background refresh
        const call2 = await dispatchRoute(routes, 'GET', `/api/workspaces/${workspaceId}/skills`);
        expect(call2.body.skills[0].name).toBe('skill-v1'); // still stale

        // Wait for background refresh to complete
        await new Promise(resolve => setTimeout(resolve, 100));

        // Third GET: cache updated — returns skill-v2
        const call3 = await dispatchRoute(routes, 'GET', `/api/workspaces/${workspaceId}/skills`);
        expect(call3.body.skills[0].name).toBe('skill-v2');
    });

    it('GET /api/workspaces/:id/skills does not trigger background refresh when cache is fresh', async () => {
        const skillsDir = path.join(workspaceDir, '.github', 'skills');
        fs.mkdirSync(path.join(skillsDir, 'fresh-skill'), { recursive: true });
        fs.writeFileSync(path.join(skillsDir, 'fresh-skill', 'SKILL.md'), '# fresh-skill');

        // First GET populates cache
        await dispatchRoute(routes, 'GET', `/api/workspaces/${workspaceId}/skills`);

        // Replace skill on disk
        fs.rmSync(path.join(skillsDir, 'fresh-skill'), { recursive: true, force: true });
        fs.mkdirSync(path.join(skillsDir, 'replaced-skill'), { recursive: true });
        fs.writeFileSync(path.join(skillsDir, 'replaced-skill', 'SKILL.md'), '# replaced');

        // Second GET within TTL — no background refresh should occur
        const call2 = await dispatchRoute(routes, 'GET', `/api/workspaces/${workspaceId}/skills`);
        expect(call2.body.skills[0].name).toBe('fresh-skill');

        await new Promise(resolve => setTimeout(resolve, 100));

        // Third GET — still serves fresh cache, no refresh was triggered
        const call3 = await dispatchRoute(routes, 'GET', `/api/workspaces/${workspaceId}/skills`);
        expect(call3.body.skills[0].name).toBe('fresh-skill');
    });

    it('GET /api/workspaces/:id/skills sets lastUpdated on cache miss', async () => {
        const skillsDir = path.join(workspaceDir, '.github', 'skills');
        fs.mkdirSync(path.join(skillsDir, 'ts-skill'), { recursive: true });
        fs.writeFileSync(path.join(skillsDir, 'ts-skill', 'SKILL.md'), '# ts-skill');

        const before = Date.now();
        await dispatchRoute(routes, 'GET', `/api/workspaces/${workspaceId}/skills`);
        const after = Date.now();

        const entry = skillCache.get(workspaceId)!;
        expect(entry.lastUpdated).toBeGreaterThanOrEqual(before);
        expect(entry.lastUpdated).toBeLessThanOrEqual(after);
    });

    it('DELETE /api/workspaces/:id/skills/:name clears the skill cache for that workspace', async () => {
        const skillsDir = path.join(workspaceDir, '.github', 'skills');
        fs.mkdirSync(path.join(skillsDir, 'del-skill'), { recursive: true });
        fs.writeFileSync(path.join(skillsDir, 'del-skill', 'SKILL.md'), '# del-skill');

        // Populate cache
        skillCache.set(workspaceId, { skills: [{ name: 'del-skill', source: 'repo' }], refreshing: false, lastUpdated: Date.now() });

        await dispatchRoute(routes, 'DELETE', `/api/workspaces/${workspaceId}/skills/del-skill`);
        expect(skillCache.has(workspaceId)).toBe(false);
    });

    it('POST /api/workspaces/:id/skills/install clears the skill cache for that workspace', async () => {
        // Populate cache
        skillCache.set(workspaceId, { skills: [{ name: 'stale-skill', source: 'repo' }], refreshing: false, lastUpdated: Date.now() });

        await dispatchRoute(routes, 'POST', `/api/workspaces/${workspaceId}/skills/install`, { source: 'bundled', skills: [] });
        expect(skillCache.has(workspaceId)).toBe(false);
    });

    it('POST /api/workspaces/:id/skills/scan clears the skill cache for that workspace', async () => {
        // Populate cache
        skillCache.set(workspaceId, { skills: [{ name: 'stale-skill', source: 'repo' }], refreshing: false, lastUpdated: Date.now() });

        await dispatchRoute(routes, 'POST', `/api/workspaces/${workspaceId}/skills/scan`, { url: 'https://github.com/x' });
        expect(skillCache.has(workspaceId)).toBe(false);
    });

});

// ============================================================================
// sortSkillsByUsage
// ============================================================================

describe('sortSkillsByUsage', () => {
    const skill = (name: string) => ({ name }) as any;

    it('returns empty array for empty input', () => {
        expect(sortSkillsByUsage([], {})).toEqual([]);
    });

    it('sorts alphabetically when no usage data', () => {
        const skills = [skill('zebra'), skill('apple'), skill('mango')];
        const result = sortSkillsByUsage(skills, {});
        expect(result.map(s => s.name)).toEqual(['apple', 'mango', 'zebra']);
    });

    it('puts single used skill first, rest alphabetical', () => {
        const skills = [skill('beta'), skill('alpha'), skill('gamma')];
        const result = sortSkillsByUsage(skills, {
            'gamma': '2025-01-01T00:00:00.000Z',
        });
        expect(result.map(s => s.name)).toEqual(['gamma', 'alpha', 'beta']);
    });

    it('orders multiple used skills by most-recent first', () => {
        const skills = [skill('c'), skill('a'), skill('b')];
        const result = sortSkillsByUsage(skills, {
            'a': '2025-01-01T00:00:00.000Z',
            'c': '2025-01-03T00:00:00.000Z',
        });
        expect(result.map(s => s.name)).toEqual(['c', 'a', 'b']);
    });

    it('handles all skills having usage data', () => {
        const skills = [skill('x'), skill('y'), skill('z')];
        const result = sortSkillsByUsage(skills, {
            'z': '2025-01-03T00:00:00.000Z',
            'x': '2025-01-02T00:00:00.000Z',
            'y': '2025-01-01T00:00:00.000Z',
        });
        expect(result.map(s => s.name)).toEqual(['z', 'x', 'y']);
    });

    it('does not mutate the original array', () => {
        const skills = [skill('b'), skill('a')];
        const copy = [...skills];
        sortSkillsByUsage(skills, {});
        expect(skills).toEqual(copy);
    });
});
