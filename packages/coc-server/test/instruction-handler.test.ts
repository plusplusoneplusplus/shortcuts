/**
 * Instruction Handler Tests
 *
 * Tests for:
 *   GET    /api/workspaces/:id/instructions
 *   GET    /api/workspaces/:id/instructions/:mode
 *   PUT    /api/workspaces/:id/instructions/:mode
 *   DELETE /api/workspaces/:id/instructions/:mode
 */

import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRouter } from '../src/shared/router';
import { registerInstructionRoutes } from '../src/instruction-handler';
import { createMockProcessStore } from './helpers/mock-process-store';
import type { MockProcessStore } from './helpers/mock-process-store';
import type { Route } from '../src/types';

// ============================================================================
// Helpers
// ============================================================================

function request(
    url: string,
    options: { method?: string; body?: string } = {},
): Promise<{ status: number; body: string; json: () => any }> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const req = http.request(
            {
                hostname: parsed.hostname,
                port: parsed.port,
                path: parsed.pathname,
                method: options.method || 'GET',
                headers: { 'Content-Type': 'application/json' },
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (c: Buffer) => chunks.push(c));
                res.on('end', () => {
                    const bodyStr = Buffer.concat(chunks).toString('utf-8');
                    resolve({
                        status: res.statusCode || 0,
                        body: bodyStr,
                        json: () => JSON.parse(bodyStr),
                    });
                });
            },
        );
        req.on('error', reject);
        if (options.body) req.write(options.body);
        req.end();
    });
}

// ============================================================================
// Fixtures
// ============================================================================

let repoDir: string;
let server: http.Server;
let port: number;
let store: MockProcessStore;

const WS = {
    id: 'ws-test',
    name: 'test-workspace',
    rootPath: '',   // filled in beforeAll
};

beforeAll(async () => {
    // Create a temp repo dir
    repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'instr-handler-test-'));
    WS.rootPath = repoDir;

    store = createMockProcessStore({ initialWorkspaces: [WS as any] });
    // Override getWorkspaces to return our workspace
    (store.getWorkspaces as any).mockImplementation(async () => [WS]);

    const routes: Route[] = [];
    registerInstructionRoutes(routes, store);

    server = http.createServer(createRouter({ routes, spaHtml: '<html></html>' }));
    await new Promise<void>((res) => server.listen(0, '127.0.0.1', res));
    port = (server.address() as any).port;
});

afterAll(async () => {
    await new Promise<void>((res) => server.close(() => res()));
    fs.rmSync(repoDir, { recursive: true, force: true });
});

beforeEach(() => {
    // Clean up any instruction files between tests
    const dir = path.join(repoDir, '.github', 'coc');
    if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

const base = () => `http://127.0.0.1:${port}`;

// ============================================================================
// GET /api/workspaces/:id/instructions
// ============================================================================

describe('GET /api/workspaces/:id/instructions', () => {
    it('returns null for all modes when no files exist', async () => {
        const res = await request(`${base()}/api/workspaces/ws-test/instructions`);
        expect(res.status).toBe(200);
        const body = res.json();
        expect(body.base).toBeNull();
        expect(body.ask).toBeNull();
        expect(body.plan).toBeNull();
        expect(body.autopilot).toBeNull();
    });

    it('returns content for existing files', async () => {
        const dir = path.join(repoDir, '.github', 'coc');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'instructions.md'), 'base content', 'utf-8');
        fs.writeFileSync(path.join(dir, 'instructions-ask.md'), 'ask content', 'utf-8');

        const res = await request(`${base()}/api/workspaces/ws-test/instructions`);
        expect(res.status).toBe(200);
        const body = res.json();
        expect(body.base).toBe('base content');
        expect(body.ask).toBe('ask content');
        expect(body.plan).toBeNull();
        expect(body.autopilot).toBeNull();
    });

    it('returns 404 for unknown workspace', async () => {
        const res = await request(`${base()}/api/workspaces/unknown/instructions`);
        expect(res.status).toBe(404);
    });
});

// ============================================================================
// GET /api/workspaces/:id/instructions/:mode
// ============================================================================

describe('GET /api/workspaces/:id/instructions/:mode', () => {
    it('returns 404 when file does not exist', async () => {
        const res = await request(`${base()}/api/workspaces/ws-test/instructions/ask`);
        expect(res.status).toBe(404);
    });

    it('returns content for existing file', async () => {
        const dir = path.join(repoDir, '.github', 'coc');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'instructions-plan.md'), 'plan content', 'utf-8');

        const res = await request(`${base()}/api/workspaces/ws-test/instructions/plan`);
        expect(res.status).toBe(200);
        const body = res.json();
        expect(body.mode).toBe('plan');
        expect(body.content).toBe('plan content');
    });

    it('returns 400 for invalid mode', async () => {
        const res = await request(`${base()}/api/workspaces/ws-test/instructions/invalid`);
        expect(res.status).toBe(400);
    });
});

// ============================================================================
// PUT /api/workspaces/:id/instructions/:mode
// ============================================================================

describe('PUT /api/workspaces/:id/instructions/:mode', () => {
    it('creates file and .github/coc/ directory on first write', async () => {
        const res = await request(`${base()}/api/workspaces/ws-test/instructions/base`, {
            method: 'PUT',
            body: JSON.stringify({ content: 'new base' }),
        });
        expect(res.status).toBe(200);
        const body = res.json();
        expect(body.content).toBe('new base');

        const filePath = path.join(repoDir, '.github', 'coc', 'instructions.md');
        expect(fs.existsSync(filePath)).toBe(true);
        expect(fs.readFileSync(filePath, 'utf-8')).toBe('new base');
    });

    it('updates an existing file', async () => {
        const dir = path.join(repoDir, '.github', 'coc');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'instructions-autopilot.md'), 'old content', 'utf-8');

        await request(`${base()}/api/workspaces/ws-test/instructions/autopilot`, {
            method: 'PUT',
            body: JSON.stringify({ content: 'updated content' }),
        });

        expect(fs.readFileSync(path.join(dir, 'instructions-autopilot.md'), 'utf-8')).toBe('updated content');
    });

    it('returns 400 when content field is missing', async () => {
        const res = await request(`${base()}/api/workspaces/ws-test/instructions/ask`, {
            method: 'PUT',
            body: JSON.stringify({ other: 'field' }),
        });
        expect(res.status).toBe(400);
    });

    it('returns 400 for invalid mode', async () => {
        const res = await request(`${base()}/api/workspaces/ws-test/instructions/unknown`, {
            method: 'PUT',
            body: JSON.stringify({ content: 'x' }),
        });
        expect(res.status).toBe(400);
    });
});

// ============================================================================
// DELETE /api/workspaces/:id/instructions/:mode
// ============================================================================

describe('DELETE /api/workspaces/:id/instructions/:mode', () => {
    it('deletes an existing file', async () => {
        const dir = path.join(repoDir, '.github', 'coc');
        fs.mkdirSync(dir, { recursive: true });
        const filePath = path.join(dir, 'instructions-ask.md');
        fs.writeFileSync(filePath, 'ask', 'utf-8');

        const res = await request(`${base()}/api/workspaces/ws-test/instructions/ask`, {
            method: 'DELETE',
        });
        expect(res.status).toBe(200);
        expect(res.json().success).toBe(true);
        expect(fs.existsSync(filePath)).toBe(false);
    });

    it('returns 404 when file does not exist', async () => {
        const res = await request(`${base()}/api/workspaces/ws-test/instructions/plan`, {
            method: 'DELETE',
        });
        expect(res.status).toBe(404);
    });

    it('returns 400 for invalid mode', async () => {
        const res = await request(`${base()}/api/workspaces/ws-test/instructions/bad`, {
            method: 'DELETE',
        });
        expect(res.status).toBe(400);
    });
});
