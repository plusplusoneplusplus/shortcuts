import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import type { Route } from '../../../src/server/shared/router';
import { registerSentinelPrOutcomeRoutes } from '../../../src/server/triggers/sentinel-pr-outcome-routes';
import { SentinelPrOutcomeError } from '../../../src/server/triggers/sentinel-pr-outcome-service';

const base = '/api/workspaces/owner/sentinel-todos/parent/items/item/pr-outcomes';

async function request(routes: Route[], method: string, path: string, body?: unknown) {
    const route = routes.find(route => route.method === method && route.pattern.test(path))!;
    const req = new IncomingMessage(new Socket());
    req.method = method;
    req.headers = { 'content-type': 'application/json' };
    req.push(body === undefined ? '' : JSON.stringify(body));
    req.push(null);
    const res = new ServerResponse(req);
    let result: unknown;
    vi.spyOn(res, 'end').mockImplementation((data?: unknown) => {
        result = JSON.parse(String(data));
        return res;
    });
    await route.handler(req, res, path.match(route.pattern));
    return { status: res.statusCode, body: result };
}

describe('PR outcome REST controls', () => {
    it('binds exact owner/item and optimistic request for every operation', async () => {
        const routes: Route[] = [];
        const response = { paused: false, revision: 0, outcomes: [] };
        const list = vi.fn(async () => response);
        const control = vi.fn(async () => response);
        registerSentinelPrOutcomeRoutes(routes, { list, control } as never, () => true);
        expect((await request(routes, 'GET', base)).body).toEqual(response);
        expect(list).toHaveBeenCalledWith({ workspaceId: 'owner', processId: 'parent' }, 'item');
        for (const action of ['pause', 'resume', 'check']) {
            expect((await request(routes, 'POST', `${base}/${action}`, { expectedRevision: 0 })).status).toBe(200);
            expect(control).toHaveBeenLastCalledWith({ workspaceId: 'owner', processId: 'parent' }, 'item', action, { expectedRevision: 0 });
        }
    });

    it.each([404, 409, 400])('surfaces service rejection %s without treating it as delivered', async statusCode => {
        const routes: Route[] = [];
        registerSentinelPrOutcomeRoutes(routes, { list: async () => { throw new SentinelPrOutcomeError(statusCode, 'Rejected'); } } as never, () => true);
        expect((await request(routes, 'GET', base)).status).toBe(statusCode);
    });

    it('explicitly reports disabled and unavailable native infrastructure', async () => {
        const routes: Route[] = [];
        let enabled = false;
        registerSentinelPrOutcomeRoutes(routes, undefined, () => enabled);
        expect((await request(routes, 'GET', base)).status).toBe(404);
        enabled = true;
        expect((await request(routes, 'GET', base)).status).toBe(503);
    });
});
