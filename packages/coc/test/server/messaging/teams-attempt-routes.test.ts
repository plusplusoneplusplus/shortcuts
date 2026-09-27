import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import type { AddressInfo } from 'net';
import type { Route } from '../../../src/server/types';
import { TeamsAttemptStore } from '../../../src/server/messaging/teams-attempt-store';
import { TeamsMessagingManager } from '../../../src/server/messaging/teams-messaging-manager';
import { registerTeamsMessagingRoutes } from '../../../src/server/messaging/teams-messaging-handler';

describe('normal Teams bridge history API', () => {
    const directories: string[] = [];
    afterEach(() => {
        for (const dir of directories.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
    });

    async function setup(enabled: boolean, count: number) {
        const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'teams-history-api-'));
        directories.push(dataDir);
        if (count) {
            const history = new TeamsAttemptStore(dataDir);
            for (let i = 0; i < count; i++) {
                const id = history.start();
                history.phase(id, 'authenticating');
                history.finish(id, 'failed', 'authentication');
            }
        }
        const manager = new TeamsMessagingManager(dataDir, {
            homeDir: path.join(dataDir, 'home'),
            getObservabilityEnabled: () => enabled,
        });
        const routes: Route[] = [];
        registerTeamsMessagingRoutes(routes, { dataDir, manager, getObservabilityEnabled: () => enabled });
        const server = http.createServer((req, res) => {
            const pathname = new URL(req.url!, 'http://localhost').pathname;
            const route = routes.find(r => r.method === req.method && r.pattern.test(pathname));
            if (route) void Promise.resolve(route.handler(req, res, pathname.match(route.pattern)!));
            else { res.writeHead(404); res.end(); }
        });
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/messaging/teams`;
        return {
            base,
            file: path.join(dataDir, 'teams-attempts.json'),
            close: () => new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve())),
        };
    }

    it('returns explicit unavailability and never creates history with the flag off', async () => {
        const api = await setup(false, 0);
        try {
            const status = await (await fetch(api.base + '/status')).json();
            expect(status.teamsBridgeObservabilityEnabled).toBe(false);
            expect((await fetch(api.base + '/attempts')).status).toBe(404);
            expect((await fetch(api.base + '/attempts/00000000-0000-4000-8000-000000000001')).status).toBe(404);
            expect(fs.existsSync(api.file)).toBe(false);
        } finally { await api.close(); }
    });

    it('provides safe newest-first pages and bounded detail with no transport data', async () => {
        const api = await setup(true, 3);
        try {
            const status = await (await fetch(api.base + '/status')).json();
            expect(status.teamsBridgeObservabilityEnabled).toBe(true);
            const page = await (await fetch(api.base + '/attempts?offset=0&limit=2')).json();
            expect(page).toMatchObject({ total: 3, nextOffset: 2 });
            expect(page.attempts).toHaveLength(2);
            const stored = JSON.parse(fs.readFileSync(api.file, 'utf8'));
            expect(page.attempts.map((attempt: { id: string }) => attempt.id))
                .toEqual(stored.slice(0, 2).map((attempt: { id: string }) => attempt.id));
            expect(page.attempts[0]).toMatchObject({
                result: 'failed', stage: 'authenticating', failureCategory: 'authentication',
            });
            expect(page.attempts[0].startedAt).toEqual(expect.any(String));
            expect(page.attempts[0].phases).toBeUndefined();
            const next = await (await fetch(api.base + '/attempts?offset=2&limit=2')).json();
            expect(next).toMatchObject({ total: 3, nextOffset: null });
            expect(next.attempts).toHaveLength(1);
            const detail = await (await fetch(api.base + `/attempts/${page.attempts[0].id}`)).json();
            expect(detail.attempt).toMatchObject({
                id: page.attempts[0].id, result: 'failed',
                phases: [{ stage: 'started' }, { stage: 'authenticating' }],
            });
            expect(JSON.stringify({ page, detail })).not.toMatch(/home|serverUrl|teamName|channelId|token|messageId|error/);
        } finally { await api.close(); }
    });

    it('returns safe errors for invalid pagination and unknown or malformed attempt IDs', async () => {
        const api = await setup(true, 0);
        try {
            for (const query of ['offset=-1', 'offset=1.5', 'limit=0', 'limit=101', 'limit=oops']) {
                const response = await fetch(`${api.base}/attempts?${query}`);
                expect(response.status).toBe(400);
                expect(JSON.stringify(await response.json())).not.toMatch(/home|serverUrl|teamName/);
            }
            expect((await fetch(api.base + '/attempts/not-a-valid-id')).status).toBe(400);
            expect((await fetch(api.base + '/attempts/00000000-0000-4000-8000-000000000001')).status).toBe(404);
        } finally { await api.close(); }
    });

    it('strips unexpected stored fields and never returns provider data or raw parse errors', async () => {
        const api = await setup(true, 1);
        try {
            const records = JSON.parse(fs.readFileSync(api.file, 'utf8'));
            records[0].serverUrl = 'https://secret.example.test/path';
            records[0].token = 'secret-auth-token';
            records[0].phases[0].message = 'private inbound content';
            fs.writeFileSync(api.file, JSON.stringify(records));
            const page = await (await fetch(api.base + '/attempts')).json();
            const detail = await (await fetch(`${api.base}/attempts/${page.attempts[0].id}`)).json();
            expect(JSON.stringify({ page, detail })).not.toMatch(/secret|private inbound/);
            expect(fs.readFileSync(api.file, 'utf8')).not.toMatch(/secret|private inbound/);
        } finally { await api.close(); }

        const corrupt = await setup(true, 0);
        try {
            fs.writeFileSync(corrupt.file, '{');
            const response = await fetch(corrupt.base + '/attempts');
            expect(response.status).toBe(500);
            expect(await response.json()).toMatchObject({ error: 'Teams connection history is unavailable' });
        } finally { await corrupt.close(); }
    });
});
