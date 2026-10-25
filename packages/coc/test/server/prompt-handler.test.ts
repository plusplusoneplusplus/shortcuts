/**
 * Tests for the Skill Discovery REST API endpoint.
 *
 * Uses port 0 (OS-assigned) for test isolation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createExecutionServer } from '../../src/server/index';
import { FileProcessStore } from '@plusplusoneplusplus/forge';
import type { ExecutionServer } from '@plusplusoneplusplus/coc-server';

// ============================================================================
// Helpers
// ============================================================================

/** Make an HTTP request and return status, headers, and body. */
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
            }
        );
        req.on('error', reject);
        if (options.body) {
            req.write(options.body);
        }
        req.end();
    });
}

function postJSON(url: string, data: unknown) {
    return request(url, {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    });
}

// ============================================================================
// Tests
// ============================================================================

describe('Prompt Handler', () => {
    let server: ExecutionServer | undefined;
    let dataDir: string;
    let workspaceDir: string;
    let homeDir: string;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-handler-test-'));
        workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-workspace-'));
        homeDir = path.join(dataDir, 'home');
        fs.mkdirSync(homeDir);
        // Isolate config and automatic skill discovery on Windows and POSIX.
        vi.stubEnv('HOME', homeDir);
        vi.stubEnv('USERPROFILE', homeDir);
    });

    afterEach(async () => {
        try {
            if (server) {
                await server.close();
                server = undefined;
            }
            fs.rmSync(dataDir, { recursive: true, force: true });
            fs.rmSync(workspaceDir, { recursive: true, force: true });
        } finally {
            vi.unstubAllEnvs();
        }
    });

    async function startServer(): Promise<ExecutionServer> {
        const store = new FileProcessStore({ dataDir });
        server = await createExecutionServer({ port: 0, host: 'localhost', store, dataDir, fileConfig: { skills: { defaultSkills: [] } } });
        return server;
    }

    /** Register a workspace and return its ID. */
    async function registerWorkspace(srv: ExecutionServer, rootPath: string): Promise<string> {
        const id = 'test-ws-' + Date.now();
        const res = await postJSON(`${srv.url}/api/workspaces`, {
            id,
            name: 'Test Workspace',
            rootPath,
        });
        expect(res.status).toBe(201);
        return id;
    }

    // ========================================================================
    // File creation helpers
    // ========================================================================

    /** Create skill directories in the workspace. */
    function createSkill(name: string, skillMdContent: string): void {
        const skillDir = path.join(workspaceDir, '.github', 'skills', name);
        fs.mkdirSync(skillDir, { recursive: true });
        fs.writeFileSync(path.join(skillDir, 'SKILL.md'), skillMdContent, 'utf-8');
    }

    // ========================================================================
    // Skills endpoint tests
    // ========================================================================

    describe('GET /api/workspaces/:id/skills', () => {

        it('should return 404 for unknown workspace', async () => {
            const srv = await startServer();
            const res = await request(`${srv.url}/api/workspaces/nonexistent/skills`);
            expect(res.status).toBe(404);
            const body = JSON.parse(res.body);
            expect(body.error).toBe('Workspace not found');
        });

        it('should return empty skills when .github/skills does not exist', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);
            const res = await request(`${srv.url}/api/workspaces/${encodeURIComponent(wsId)}/skills`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.skills).toEqual([]);
        });

        it('should discover configured and automatic skills from the isolated home', async () => {
            const configDir = path.join(homeDir, '.coc');
            fs.mkdirSync(configDir);
            fs.writeFileSync(path.join(configDir, 'config.yaml'),
                'skills:\n  globalExtraFolders:\n    - "~/configured-skills"\n');
            for (const [folder, name] of [
                [path.join(homeDir, 'configured-skills'), 'configured-skill'],
                [path.join(homeDir, 'OneDrive', 'skills'), 'onedrive-skill'],
            ]) {
                const skillDir = path.join(folder, name);
                fs.mkdirSync(skillDir, { recursive: true });
                fs.writeFileSync(path.join(skillDir, 'SKILL.md'), `# ${name}`);
            }
            createSkill('workspace-skill', '# Workspace skill');

            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);
            const res = await request(`${srv.url}/api/workspaces/${encodeURIComponent(wsId)}/skills`);

            expect(res.status).toBe(200);
            expect(JSON.parse(res.body)).toMatchObject({
                skills: [
                    { name: 'workspace-skill', source: 'repo' },
                    { name: 'configured-skill', source: 'global-extra-folder' },
                    { name: 'onedrive-skill', source: 'extra-folder' },
                ],
            });
        });

        it('should discover skill with description from frontmatter', async () => {
            createSkill('go-deep', '---\ndescription: Deep research\n---\n# Go Deep');
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);
            const res = await request(`${srv.url}/api/workspaces/${encodeURIComponent(wsId)}/skills`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.skills.length).toBeGreaterThanOrEqual(1);
            const goDeep = body.skills.find((s: any) => s.name === 'go-deep');
            expect(goDeep).toBeDefined();
            expect(goDeep.description).toBe('Deep research');
        });

        it('should return skill without description when no frontmatter', async () => {
            createSkill('simple', '# Simple Skill');
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);
            const res = await request(`${srv.url}/api/workspaces/${encodeURIComponent(wsId)}/skills`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            const simple = body.skills.find((s: any) => s.name === 'simple');
            expect(simple).toBeDefined();
            expect(simple.description).toBeUndefined();
        });

        it('should return multiple skills sorted alphabetically', async () => {
            createSkill('z-skill', '# Z Skill');
            createSkill('a-skill', '# A Skill');
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);
            const res = await request(`${srv.url}/api/workspaces/${encodeURIComponent(wsId)}/skills`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.skills.map((skill: { name: string }) => skill.name)).toEqual(['a-skill', 'z-skill']);
        });

        it('should only list directories with SKILL.md', async () => {
            // Create a dir without SKILL.md
            const noSkillDir = path.join(workspaceDir, '.github', 'skills', 'no-skill');
            fs.mkdirSync(noSkillDir, { recursive: true });
            // Create a valid skill
            createSkill('valid', '# Valid Skill');
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);
            const res = await request(`${srv.url}/api/workspaces/${encodeURIComponent(wsId)}/skills`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            const names = body.skills.map((s: any) => s.name);
            expect(names).toContain('valid');
            expect(names).not.toContain('no-skill');
        });
    });
});
