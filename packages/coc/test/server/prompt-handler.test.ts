/**
 * Prompt Handler Tests
 *
 * Tests for the Skill Discovery REST API endpoint.
 *
 * Uses port 0 (OS-assigned) for test isolation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createExecutionServer } from '../../src/server/index';
import { FileProcessStore } from '@plusplusoneplusplus/pipeline-core';
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

/** POST JSON helper. */
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

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-handler-test-'));
        workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-workspace-'));
    });

    afterEach(async () => {
        if (server) {
            await server.close();
            server = undefined;
        }
        fs.rmSync(dataDir, { recursive: true, force: true });
        fs.rmSync(workspaceDir, { recursive: true, force: true });
    });

    async function startServer(): Promise<ExecutionServer> {
        const store = new FileProcessStore({ dataDir });
        server = await createExecutionServer({ port: 0, host: 'localhost', store, dataDir });
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
            expect(body.skills[0].name).toBe('a-skill');
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
