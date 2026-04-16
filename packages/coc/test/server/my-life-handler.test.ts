/**
 * My Life Handler Tests
 *
 * Tests for the My Life REST API endpoints:
 * - POST /api/my-life/sync — append personal data to notes
 * - POST /api/my-life/generate-summary — generate weekly summary
 * - GET /api/my-life/status — check initialization status
 *
 * Uses direct handler registration without full server startup.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { registerMyLifeRoutes } from '../../src/server/my-life-handler';
import { MY_LIFE_WORKSPACE_ID } from '../../src/server/my-life-workspace';
import { createRequestHandler } from '../../src/server/router';
import type { Route } from '../../src/server/types';
import { FileProcessStore, getRepoDataPath } from '@plusplusoneplusplus/forge';

// ============================================================================
// Test Helpers
// ============================================================================

function request(
    url: string,
    options: { method?: string; body?: string; headers?: Record<string, string> } = {}
): Promise<{ status: number; body: string }> {
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
                        body: Buffer.concat(chunks).toString('utf-8'),
                    });
                });
            }
        );
        req.on('error', reject);
        if (options.body) req.write(options.body);
        req.end();
    });
}

function postJSON(url: string, data?: unknown) {
    return request(url, {
        method: 'POST',
        body: data ? JSON.stringify(data) : undefined,
        headers: data ? { 'Content-Type': 'application/json' } : undefined,
    });
}

// ============================================================================
// Tests
// ============================================================================

describe('My Life Handler', () => {
    let dataDir: string;
    let store: FileProcessStore;
    let server: http.Server;
    let baseUrl: string;

    beforeEach(async () => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'my-life-handler-test-'));
        store = new FileProcessStore({ dataDir });

        // Register my_life workspace
        await store.registerWorkspace({
            id: MY_LIFE_WORKSPACE_ID,
            name: 'My Life',
            rootPath: path.join(dataDir, 'repos', MY_LIFE_WORKSPACE_ID),
            virtual: true,
        });

        // Create notes directory structure
        const notesDir = getRepoDataPath(dataDir, MY_LIFE_WORKSPACE_ID, 'notes');
        const weeklyDir = path.join(notesDir, 'Weekly');
        fs.mkdirSync(weeklyDir, { recursive: true });
        fs.writeFileSync(path.join(notesDir, 'Goals.md'), '# Goals\n', 'utf-8');
        fs.writeFileSync(path.join(notesDir, 'Journal.md'), '# Journal\n', 'utf-8');

        // Set up routes and server
        const routes: Route[] = [];
        registerMyLifeRoutes(routes, store, dataDir);
        const handler = createRequestHandler({ routes, spaHtml: () => '<html></html>' });
        server = http.createServer(handler);
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        const addr = server.address() as { port: number };
        baseUrl = `http://127.0.0.1:${addr.port}`;
    });

    afterEach(async () => {
        await new Promise<void>((resolve) => server.close(() => resolve()));
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    // ── GET /api/my-life/status ──

    describe('GET /api/my-life/status', () => {
        it('returns initialized: true when Goals.md exists', async () => {
            const res = await request(`${baseUrl}/api/my-life/status`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.initialized).toBe(true);
            expect(body.workspaceId).toBe(MY_LIFE_WORKSPACE_ID);
        });

        it('returns initialized: false when Goals.md is missing', async () => {
            const notesDir = getRepoDataPath(dataDir, MY_LIFE_WORKSPACE_ID, 'notes');
            fs.unlinkSync(path.join(notesDir, 'Goals.md'));

            const res = await request(`${baseUrl}/api/my-life/status`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.initialized).toBe(false);
        });
    });

    // ── POST /api/my-life/sync ──

    describe('POST /api/my-life/sync', () => {
        it('handles empty body gracefully', async () => {
            const res = await postJSON(`${baseUrl}/api/my-life/sync`, {});
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.synced).toBe(true);
            expect(body.goalCount).toBe(0);
            expect(body.entryCount).toBe(0);
        });

        it('appends goals to Goals.md', async () => {
            const res = await postJSON(`${baseUrl}/api/my-life/sync`, {
                goals: ['Read 12 books', 'Run a marathon'],
            });
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.goalCount).toBe(2);

            const notesDir = getRepoDataPath(dataDir, MY_LIFE_WORKSPACE_ID, 'notes');
            const goalsContent = fs.readFileSync(path.join(notesDir, 'Goals.md'), 'utf-8');
            expect(goalsContent).toContain('Read 12 books');
            expect(goalsContent).toContain('Run a marathon');
        });

        it('appends journal entries grouped by category', async () => {
            const res = await postJSON(`${baseUrl}/api/my-life/sync`, {
                entries: {
                    'Health': ['Went for a 5K run', 'Ate healthy lunch'],
                    'Learning': ['Finished chapter 3'],
                },
            });
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.entryCount).toBe(3);

            const notesDir = getRepoDataPath(dataDir, MY_LIFE_WORKSPACE_ID, 'notes');
            const journalContent = fs.readFileSync(path.join(notesDir, 'Journal.md'), 'utf-8');
            expect(journalContent).toContain('### Health');
            expect(journalContent).toContain('Went for a 5K run');
            expect(journalContent).toContain('### Learning');
        });

        it('is append-only — multiple syncs accumulate', async () => {
            await postJSON(`${baseUrl}/api/my-life/sync`, { goals: ['Goal 1'] });
            await postJSON(`${baseUrl}/api/my-life/sync`, { goals: ['Goal 2'] });

            const notesDir = getRepoDataPath(dataDir, MY_LIFE_WORKSPACE_ID, 'notes');
            const goalsContent = fs.readFileSync(path.join(notesDir, 'Goals.md'), 'utf-8');
            expect(goalsContent).toContain('Goal 1');
            expect(goalsContent).toContain('Goal 2');
        });
    });

    // ── POST /api/my-life/generate-summary ──

    describe('POST /api/my-life/generate-summary', () => {
        it('generates a weekly summary file', async () => {
            const res = await postJSON(`${baseUrl}/api/my-life/generate-summary`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.generated).toBe(true);
            expect(body.path).toMatch(/^Weekly\/\d{4}-W\d{2}\.md$/);
        });

        it('includes completed goals in the summary', async () => {
            const notesDir = getRepoDataPath(dataDir, MY_LIFE_WORKSPACE_ID, 'notes');
            fs.writeFileSync(path.join(notesDir, 'Goals.md'), '# Goals\n- [x] Completed goal\n- [ ] In progress goal\n', 'utf-8');

            const res = await postJSON(`${baseUrl}/api/my-life/generate-summary`);
            const body = JSON.parse(res.body);
            expect(body.completedCount).toBe(1);
            expect(body.inProgressCount).toBe(1);

            const weeklyDir = path.join(notesDir, 'Weekly');
            const files = fs.readdirSync(weeklyDir);
            expect(files.length).toBe(1);

            const content = fs.readFileSync(path.join(weeklyDir, files[0]), 'utf-8');
            expect(content).toContain('Completed goal');
            expect(content).toContain('In Progress');
            expect(content).toContain('Next Week');
        });

        it('handles empty notes gracefully', async () => {
            const notesDir = getRepoDataPath(dataDir, MY_LIFE_WORKSPACE_ID, 'notes');
            fs.unlinkSync(path.join(notesDir, 'Goals.md'));
            fs.unlinkSync(path.join(notesDir, 'Journal.md'));

            const res = await postJSON(`${baseUrl}/api/my-life/generate-summary`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.generated).toBe(true);
            expect(body.completedCount).toBe(0);
        });

        it('overwrites same-week summary', async () => {
            await postJSON(`${baseUrl}/api/my-life/generate-summary`);
            await postJSON(`${baseUrl}/api/my-life/generate-summary`);

            const notesDir = getRepoDataPath(dataDir, MY_LIFE_WORKSPACE_ID, 'notes');
            const weeklyDir = path.join(notesDir, 'Weekly');
            const files = fs.readdirSync(weeklyDir);
            expect(files.length).toBe(1);
        });
    });
});
