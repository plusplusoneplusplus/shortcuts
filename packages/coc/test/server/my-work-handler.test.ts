/**
 * My Work Handler Tests
 *
 * Tests for the My Work REST API endpoints:
 * - POST /api/my-work/sync — append Work IQ data to notes
 * - POST /api/my-work/generate-summary — generate weekly summary
 * - GET /api/my-work/status — check initialization status
 *
 * Uses direct handler registration without full server startup.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { registerMyWorkRoutes } from '../../src/server/workspaces/my-work-handler';
import { MY_WORK_WORKSPACE_ID } from '../../src/server/workspaces/my-work-workspace';
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

function patchJSON(url: string, data?: unknown) {
    return request(url, {
        method: 'PATCH',
        body: data ? JSON.stringify(data) : undefined,
        headers: data ? { 'Content-Type': 'application/json' } : undefined,
    });
}

// ============================================================================
// Tests
// ============================================================================

describe('My Work Handler', () => {
    let dataDir: string;
    let store: FileProcessStore;
    let server: http.Server;
    let baseUrl: string;

    beforeEach(async () => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'my-work-handler-test-'));
        store = new FileProcessStore({ dataDir });

        // Register my_work workspace
        await store.registerWorkspace({
            id: MY_WORK_WORKSPACE_ID,
            name: 'My Work',
            rootPath: path.join(dataDir, 'repos', MY_WORK_WORKSPACE_ID),
            virtual: true,
        });

        // Create notes directory structure
        const notesDir = getRepoDataPath(dataDir, MY_WORK_WORKSPACE_ID, 'notes');
        const weeklyDir = path.join(notesDir, 'Weekly');
        fs.mkdirSync(weeklyDir, { recursive: true });
        fs.writeFileSync(path.join(notesDir, 'Action Items.md'), '# Action Items\n', 'utf-8');
        fs.writeFileSync(path.join(notesDir, 'Follow Ups.md'), '# Follow Ups\n', 'utf-8');

        // Set up routes and server
        const routes: Route[] = [];
        registerMyWorkRoutes(routes, store, dataDir);
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

    /** Read one of the My Work notes back off disk. */
    function readNote(name: string): string {
        const notesDir = getRepoDataPath(dataDir, MY_WORK_WORKSPACE_ID, 'notes');
        return fs.readFileSync(path.join(notesDir, name), 'utf-8');
    }

    // ── GET /api/my-work/status ──────────────────────────────────────────

    describe('GET /api/my-work/status', () => {
        it('returns initialized: true when notes exist', async () => {
            const res = await request(`${baseUrl}/api/my-work/status`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.initialized).toBe(true);
            expect(body.workspaceId).toBe(MY_WORK_WORKSPACE_ID);
        });

        it('returns initialized: false when Action Items.md is missing', async () => {
            const notesDir = getRepoDataPath(dataDir, MY_WORK_WORKSPACE_ID, 'notes');
            fs.unlinkSync(path.join(notesDir, 'Action Items.md'));

            const res = await request(`${baseUrl}/api/my-work/status`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.initialized).toBe(false);
        });
    });

    // ── POST /api/my-work/sync ───────────────────────────────────────────

    describe('POST /api/my-work/sync', () => {
        it('returns 200 with empty body (no items)', async () => {
            const res = await postJSON(`${baseUrl}/api/my-work/sync`, {});
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.synced).toBe(true);
            expect(body.actionItemCount).toBe(0);
            expect(body.followUpCount).toBe(0);
        });

        it('appends action items to Action Items.md', async () => {
            const res = await postJSON(`${baseUrl}/api/my-work/sync`, {
                actionItems: ['Send API spec to Sarah', 'Review budget proposal'],
            });
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.actionItemCount).toBe(2);

            const notesDir = getRepoDataPath(dataDir, MY_WORK_WORKSPACE_ID, 'notes');
            const content = fs.readFileSync(path.join(notesDir, 'Action Items.md'), 'utf-8');
            expect(content).toContain('## Synced');
            expect(content).toContain('- [ ] Send API spec to Sarah');
            expect(content).toContain('- [ ] Review budget proposal');
        });

        it('appends follow-ups grouped by person to Follow Ups.md', async () => {
            const res = await postJSON(`${baseUrl}/api/my-work/sync`, {
                followUps: {
                    'John': ['Waiting on budget approval'],
                    'Sarah': ['Waiting on API migration timeline', 'Waiting on design review'],
                },
            });
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.followUpCount).toBe(3);

            const notesDir = getRepoDataPath(dataDir, MY_WORK_WORKSPACE_ID, 'notes');
            const content = fs.readFileSync(path.join(notesDir, 'Follow Ups.md'), 'utf-8');
            expect(content).toContain('### John');
            expect(content).toContain('- [ ] Waiting on budget approval');
            expect(content).toContain('### Sarah');
            expect(content).toContain('- [ ] Waiting on API migration timeline');
        });

        it('preserves existing content (append-only)', async () => {
            // First sync
            await postJSON(`${baseUrl}/api/my-work/sync`, {
                actionItems: ['First item'],
            });

            // Second sync
            await postJSON(`${baseUrl}/api/my-work/sync`, {
                actionItems: ['Second item'],
            });

            const notesDir = getRepoDataPath(dataDir, MY_WORK_WORKSPACE_ID, 'notes');
            const content = fs.readFileSync(path.join(notesDir, 'Action Items.md'), 'utf-8');
            expect(content).toContain('- [ ] First item');
            expect(content).toContain('- [ ] Second item');
            // Original header preserved
            expect(content).toContain('# Action Items');
        });

        it('handles sync with both action items and follow-ups', async () => {
            const res = await postJSON(`${baseUrl}/api/my-work/sync`, {
                actionItems: ['Write tests'],
                followUps: {
                    'Bob': ['Waiting on code review'],
                },
            });
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.actionItemCount).toBe(1);
            expect(body.followUpCount).toBe(1);
        });

        it('handles empty POST body gracefully', async () => {
            const res = await request(`${baseUrl}/api/my-work/sync`, { method: 'POST' });
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.synced).toBe(true);
        });

        // ── Object items: text plus source link / due / tags ──────────────

        it('serializes an object item with a source link, due date and tags', async () => {
            const res = await postJSON(`${baseUrl}/api/my-work/sync`, {
                actionItems: [
                    {
                        text: 'Send revised cutover plan',
                        due: '2026-08-14',
                        tags: ['contoso'],
                        sourceUrl: 'https://teams.microsoft.com/l/message/19:abc',
                    },
                ],
            });
            expect(res.status).toBe(200);
            expect(JSON.parse(res.body).actionItemCount).toBe(1);

            expect(readNote('Action Items.md')).toContain(
                '- [ ] Send revised cutover plan @due(2026-08-14) #contoso [\u2197](https://teams.microsoft.com/l/message/19:abc)',
            );
        });

        it('accepts strings and objects in the same batch', async () => {
            await postJSON(`${baseUrl}/api/my-work/sync`, {
                actionItems: [
                    'Plain string item',
                    { text: 'Object item', sourceUrl: 'https://x.test/a' },
                ],
            });
            const content = readNote('Action Items.md');
            // The plain string keeps writing exactly the line it always did.
            expect(content).toContain('- [ ] Plain string item\n');
            expect(content).toContain('- [ ] Object item [\u2197](https://x.test/a)');
        });

        it('carries source links through follow-ups too', async () => {
            const res = await postJSON(`${baseUrl}/api/my-work/sync`, {
                followUps: {
                    Priya: [
                        { text: 'Cutover sign-off', sourceUrl: 'https://x.test/p', tags: ['#contoso'] },
                        'Plain waiting item',
                    ],
                },
            });
            expect(JSON.parse(res.body).followUpCount).toBe(2);
            const content = readNote('Follow Ups.md');
            expect(content).toContain('### Priya');
            expect(content).toContain('- [ ] Cutover sign-off #contoso [\u2197](https://x.test/p)');
            expect(content).toContain('- [ ] Plain waiting item');
        });

        it('drops an unusable entry instead of writing a blank checkbox', async () => {
            const res = await postJSON(`${baseUrl}/api/my-work/sync`, {
                actionItems: ['', '   ', { sourceUrl: 'https://x.test/a' }, { text: 'Real one' }],
            });
            expect(JSON.parse(res.body).actionItemCount).toBe(1);
            const content = readNote('Action Items.md');
            expect(content).toContain('- [ ] Real one');
            expect(content).not.toContain('- [ ] \n');
        });

        it('ignores a due date that is not an ISO day', async () => {
            await postJSON(`${baseUrl}/api/my-work/sync`, {
                actionItems: [{ text: 'Ship it', due: 'next tuesday' }],
            });
            const content = readNote('Action Items.md');
            expect(content).toContain('- [ ] Ship it\n');
            expect(content).not.toContain('@due');
        });

        it('keeps a multi-line item on one checkbox line', async () => {
            await postJSON(`${baseUrl}/api/my-work/sync`, {
                actionItems: [{ text: 'first line\n## Archive\n- [x] forged' }],
            });
            const content = readNote('Action Items.md');
            expect(content).toContain('- [ ] first line ## Archive - [x] forged');
            expect(content).not.toContain('\n## Archive');
        });

        it('round-trips a synced source link back out through GET', async () => {
            await postJSON(`${baseUrl}/api/my-work/sync`, {
                actionItems: [
                    {
                        text: 'Send revised cutover plan',
                        due: '2026-08-14',
                        tags: ['contoso'],
                        sourceUrl: 'https://x.test/thread',
                    },
                ],
            });
            const res = await request(`${baseUrl}/api/my-work/tasks`);
            const item = JSON.parse(res.body).actionItems.find(
                (i: any) => i.text === 'Send revised cutover plan',
            );
            expect(item).toBeTruthy();
            expect(item.due).toBe('2026-08-14');
            expect(item.tags).toEqual(['contoso']);
            expect(item.sourceUrl).toBe('https://x.test/thread');
        });
    });

    // ── POST /api/my-work/generate-summary ───────────────────────────────

    describe('POST /api/my-work/generate-summary', () => {
        it('generates a weekly summary file', async () => {
            const res = await postJSON(`${baseUrl}/api/my-work/generate-summary`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.generated).toBe(true);
            expect(body.path).toMatch(/^Weekly\/\d{4}-W\d{2}\.md$/);
        });

        it('includes checked items in Completed section', async () => {
            const notesDir = getRepoDataPath(dataDir, MY_WORK_WORKSPACE_ID, 'notes');
            fs.writeFileSync(
                path.join(notesDir, 'Action Items.md'),
                '# Action Items\n- [x] Sent API spec\n- [ ] Review budget\n',
                'utf-8',
            );

            const res = await postJSON(`${baseUrl}/api/my-work/generate-summary`);
            const body = JSON.parse(res.body);
            expect(body.completedCount).toBe(1);
            expect(body.inProgressCount).toBe(1);

            const weeklyPath = path.join(notesDir, 'Weekly', body.path.replace('Weekly/', ''));
            const content = fs.readFileSync(weeklyPath, 'utf-8');
            expect(content).toContain('## Completed');
            expect(content).toContain('Sent API spec');
            expect(content).toContain('## In Progress');
            expect(content).toContain('Review budget');
        });

        it('includes follow-ups in Waiting On section', async () => {
            const notesDir = getRepoDataPath(dataDir, MY_WORK_WORKSPACE_ID, 'notes');
            fs.writeFileSync(
                path.join(notesDir, 'Follow Ups.md'),
                '# Follow Ups\n- [ ] Waiting on John for budget\n',
                'utf-8',
            );

            const res = await postJSON(`${baseUrl}/api/my-work/generate-summary`);
            const body = JSON.parse(res.body);
            expect(body.waitingOnCount).toBe(1);

            const weeklyPath = path.join(notesDir, 'Weekly', body.path.replace('Weekly/', ''));
            const content = fs.readFileSync(weeklyPath, 'utf-8');
            expect(content).toContain('## Waiting On');
            expect(content).toContain('Waiting on John for budget');
        });

        it('generates summary even with empty notes', async () => {
            const notesDir = getRepoDataPath(dataDir, MY_WORK_WORKSPACE_ID, 'notes');
            fs.writeFileSync(path.join(notesDir, 'Action Items.md'), '', 'utf-8');
            fs.writeFileSync(path.join(notesDir, 'Follow Ups.md'), '', 'utf-8');

            const res = await postJSON(`${baseUrl}/api/my-work/generate-summary`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.generated).toBe(true);
            expect(body.completedCount).toBe(0);
            expect(body.inProgressCount).toBe(0);
        });

        it('includes Next Week placeholder section', async () => {
            const res = await postJSON(`${baseUrl}/api/my-work/generate-summary`);
            const body = JSON.parse(res.body);

            const notesDir = getRepoDataPath(dataDir, MY_WORK_WORKSPACE_ID, 'notes');
            const weeklyPath = path.join(notesDir, 'Weekly', body.path.replace('Weekly/', ''));
            const content = fs.readFileSync(weeklyPath, 'utf-8');
            expect(content).toContain('## Next Week');
        });

        it('overwrites existing weekly file for same week', async () => {
            // First generation
            await postJSON(`${baseUrl}/api/my-work/generate-summary`);

            // Add items and regenerate
            const notesDir = getRepoDataPath(dataDir, MY_WORK_WORKSPACE_ID, 'notes');
            fs.writeFileSync(
                path.join(notesDir, 'Action Items.md'),
                '- [x] New completed item\n',
                'utf-8',
            );

            const res = await postJSON(`${baseUrl}/api/my-work/generate-summary`);
            const body = JSON.parse(res.body);

            const weeklyPath = path.join(notesDir, 'Weekly', body.path.replace('Weekly/', ''));
            const content = fs.readFileSync(weeklyPath, 'utf-8');
            expect(content).toContain('New completed item');
        });
    });

    // ── Task routes (Today view) ─────────────────────────────────────────

    describe('Task routes', () => {
        function notesDir() {
            return getRepoDataPath(dataDir, MY_WORK_WORKSPACE_ID, 'notes');
        }
        function writeActionItems(content: string) {
            fs.writeFileSync(path.join(notesDir(), 'Action Items.md'), content, 'utf-8');
        }
        function writeFollowUps(content: string) {
            fs.writeFileSync(path.join(notesDir(), 'Follow Ups.md'), content, 'utf-8');
        }
        function readActionItems() {
            return fs.readFileSync(path.join(notesDir(), 'Action Items.md'), 'utf-8');
        }
        function readFollowUps() {
            return fs.readFileSync(path.join(notesDir(), 'Follow Ups.md'), 'utf-8');
        }

        // ── GET /api/my-work/tasks ───────────────────────────────────────

        it('GET returns parsed action items and follow-ups', async () => {
            writeActionItems('# Action Items\n- [ ] Ship the slice\n- [x] Write parser\n');
            writeFollowUps('# Follow Ups\n## Sarah\n- [ ] API timeline\n');

            const res = await request(`${baseUrl}/api/my-work/tasks`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.actionItems).toHaveLength(2);
            expect(body.actionItems[0]).toMatchObject({ text: 'Ship the slice', checked: false });
            expect(body.actionItems[1]).toMatchObject({ text: 'Write parser', checked: true });
            expect(body.followUps).toHaveLength(1);
            expect(body.followUps[0]).toMatchObject({ text: 'API timeline', person: 'Sarah' });
            expect(typeof body.actionItems[0].id).toBe('string');
        });

        it('GET stamps synced items with the sync date the handler wrote', async () => {
            // Round-trip: `formatSyncDate()` writes `## Synced Mon D`, the
            // parser must read that back as today's ISO date on every item of
            // the batch — and must not turn the heading into a person.
            const now = new Date();
            const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

            await postJSON(`${baseUrl}/api/my-work/sync`, {
                actionItems: ['Send API spec to Sarah'],
                followUps: { Sarah: ['Waiting on design review'] },
            });

            const body = JSON.parse((await request(`${baseUrl}/api/my-work/tasks`)).body);
            expect(body.actionItems[0]).toMatchObject({
                text: 'Send API spec to Sarah',
                addedAt: today,
            });
            expect(body.followUps[0]).toMatchObject({
                text: 'Waiting on design review',
                person: 'Sarah',
                addedAt: today,
            });
        });

        it('GET leaves hand-added items undated', async () => {
            writeActionItems('# Action Items\n- [ ] Ship the slice\n');
            const body = JSON.parse((await request(`${baseUrl}/api/my-work/tasks`)).body);
            expect(body.actionItems[0].addedAt).toBeUndefined();
        });

        it('GET treats missing files as empty', async () => {
            fs.unlinkSync(path.join(notesDir(), 'Action Items.md'));
            fs.unlinkSync(path.join(notesDir(), 'Follow Ups.md'));

            const res = await request(`${baseUrl}/api/my-work/tasks`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.actionItems).toEqual([]);
            expect(body.followUps).toEqual([]);
        });

        // ── PATCH /api/my-work/tasks/:id ─────────────────────────────────

        it('PATCH toggles a checkbox, flipping only the target line', async () => {
            writeActionItems('# Action Items\n- [ ] First\n- [ ] Second\n- [ ] Third\n');

            const list = JSON.parse((await request(`${baseUrl}/api/my-work/tasks`)).body);
            const second = list.actionItems.find((t: any) => t.text === 'Second');

            const res = await patchJSON(`${baseUrl}/api/my-work/tasks/${second.id}`, { checked: true });
            expect(res.status).toBe(200);
            expect(JSON.parse(res.body)).toEqual({ ok: true });

            const content = readActionItems();
            expect(content).toBe('# Action Items\n- [ ] First\n- [x] Second\n- [ ] Third\n');
        });

        it('PATCH edits item text', async () => {
            writeActionItems('# Action Items\n- [ ] Old text\n');
            const list = JSON.parse((await request(`${baseUrl}/api/my-work/tasks`)).body);
            const id = list.actionItems[0].id;

            const res = await patchJSON(`${baseUrl}/api/my-work/tasks/${id}`, { text: 'New text' });
            expect(res.status).toBe(200);
            expect(readActionItems()).toBe('# Action Items\n- [ ] New text\n');
        });

        it('PATCH snoozes an item by bumping its @due(), leaving the rest of the line alone', async () => {
            writeActionItems('# Action Items\n- [ ] Chase sign-off #contoso [↗](https://x.test/t)\n');
            const list = JSON.parse((await request(`${baseUrl}/api/my-work/tasks`)).body);
            const id = list.actionItems[0].id;

            const res = await patchJSON(`${baseUrl}/api/my-work/tasks/${id}`, { due: '2026-08-19' });
            expect(res.status).toBe(200);
            expect(readActionItems()).toBe(
                '# Action Items\n- [ ] Chase sign-off @due(2026-08-19) #contoso [↗](https://x.test/t)\n',
            );
        });

        it('PATCH clears a due date with an explicit null', async () => {
            writeActionItems('# Action Items\n- [ ] Chase sign-off @due(2026-08-19)\n');
            const list = JSON.parse((await request(`${baseUrl}/api/my-work/tasks`)).body);

            const res = await patchJSON(`${baseUrl}/api/my-work/tasks/${list.actionItems[0].id}`, { due: null });
            expect(res.status).toBe(200);
            expect(readActionItems()).toBe('# Action Items\n- [ ] Chase sign-off\n');
        });

        it('PATCH rejects a due date that is not an ISO day, leaving the file untouched', async () => {
            const original = '# Action Items\n- [ ] Chase sign-off\n';
            writeActionItems(original);
            const list = JSON.parse((await request(`${baseUrl}/api/my-work/tasks`)).body);

            // Anything unparseable would otherwise be written verbatim onto the
            // markdown line, where nothing can read it back.
            const res = await patchJSON(`${baseUrl}/api/my-work/tasks/${list.actionItems[0].id}`, {
                due: 'next tuesday',
            });
            expect(res.status).toBe(400);
            expect(readActionItems()).toBe(original);
        });

        it('PATCH toggles a follow-up item', async () => {
            writeFollowUps('# Follow Ups\n## Bob\n- [ ] Waiting on review\n');
            const list = JSON.parse((await request(`${baseUrl}/api/my-work/tasks`)).body);
            const id = list.followUps[0].id;

            const res = await patchJSON(`${baseUrl}/api/my-work/tasks/${id}`, { checked: true });
            expect(res.status).toBe(200);
            expect(readFollowUps()).toBe('# Follow Ups\n## Bob\n- [x] Waiting on review\n');
        });

        it('PATCH returns 404 for an unknown id', async () => {
            writeActionItems('# Action Items\n- [ ] Only item\n');
            const res = await patchJSON(`${baseUrl}/api/my-work/tasks/deadbeef0000`, { checked: true });
            expect(res.status).toBe(404);
        });

        // ── POST /api/my-work/tasks ──────────────────────────────────────

        it('POST quick-adds an action item', async () => {
            writeActionItems('# Action Items\n- [ ] Existing\n');
            const res = await postJSON(`${baseUrl}/api/my-work/tasks`, {
                list: 'action',
                text: 'Brand new task',
            });
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(typeof body.id).toBe('string');
            expect(readActionItems()).toContain('- [ ] Brand new task');
        });

        it('POST quick-adds a follow-up under a person', async () => {
            writeFollowUps('# Follow Ups\n## Sarah\n- [ ] Existing\n');
            const res = await postJSON(`${baseUrl}/api/my-work/tasks`, {
                list: 'followup',
                person: 'Sarah',
                text: 'Ping about design',
            });
            expect(res.status).toBe(201);
            const content = readFollowUps();
            expect(content).toContain('## Sarah');
            expect(content).toContain('- [ ] Ping about design');
        });

        it('POST rejects empty text', async () => {
            const res = await postJSON(`${baseUrl}/api/my-work/tasks`, { list: 'action', text: '  ' });
            expect(res.status).toBe(400);
        });

        it('POST rejects an unknown list', async () => {
            const res = await postJSON(`${baseUrl}/api/my-work/tasks`, { list: 'bogus', text: 'x' });
            expect(res.status).toBe(400);
        });

        // ── POST /api/my-work/tasks/archive ──────────────────────────────

        it('POST archive moves only checked action items', async () => {
            writeActionItems('# Action Items\n- [ ] Keep me\n- [x] Done one\n- [x] Done two\n');
            const res = await postJSON(`${baseUrl}/api/my-work/tasks/archive`);
            expect(res.status).toBe(200);
            expect(JSON.parse(res.body)).toEqual({ archived: 2 });

            const content = readActionItems();
            expect(content).toContain('- [ ] Keep me');
            expect(content).toContain('## Archive');
            expect(content).toContain('- [x] Done one');
            expect(content).toContain('- [x] Done two');
            // Only one unchecked item remains in the active region (before Archive).
            const active = content.split('## Archive')[0];
            expect(active).toContain('- [ ] Keep me');
            expect(active).not.toContain('Done one');
        });

        it('POST archive reports 0 when nothing is checked', async () => {
            writeActionItems('# Action Items\n- [ ] Nothing done\n');
            const before = readActionItems();
            const res = await postJSON(`${baseUrl}/api/my-work/tasks/archive`);
            expect(res.status).toBe(200);
            expect(JSON.parse(res.body)).toEqual({ archived: 0 });
            expect(readActionItems()).toBe(before);
        });
    });
});
