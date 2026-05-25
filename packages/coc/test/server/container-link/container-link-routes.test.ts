/**
 * Tests for container-link config routes (GET/PUT /api/config/container).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerContainerLinkRoutes, type ContainerLinkRouteContext } from '../../../src/server/container-link/container-link-routes';
import type { Route } from '../../../src/server/types';
import { IncomingMessage, ServerResponse } from 'http';
import { Socket } from 'net';

function createMockReq(method: string, body?: string): IncomingMessage {
    const socket = new Socket();
    const req = new IncomingMessage(socket);
    req.method = method;
    if (body) {
        req.headers['content-type'] = 'application/json';
        // Push body data async
        process.nextTick(() => {
            req.push(body);
            req.push(null);
        });
    } else {
        process.nextTick(() => req.push(null));
    }
    return req;
}

function createMockRes(): ServerResponse & { _data: string; _statusCode: number; _headers: Record<string, string> } {
    const socket = new Socket();
    const res = new ServerResponse(new IncomingMessage(socket)) as any;
    res._data = '';
    res._statusCode = 200;
    res._headers = {};
    res.writeHead = function (code: number, headers?: Record<string, string>) {
        res._statusCode = code;
        if (headers) Object.assign(res._headers, headers);
        return res;
    };
    res.end = function (data?: string) {
        if (data) res._data += data;
        return res;
    };
    return res;
}

describe('container-link routes', () => {
    let routes: Route[];
    let ctx: ContainerLinkRouteContext;
    let mockLink: { status: string; assignedAgentId: string | null };

    beforeEach(() => {
        routes = [];
        mockLink = { status: 'disconnected', assignedAgentId: null };
        ctx = {
            getContainerLink: () => mockLink as any,
            getContainerUrl: () => undefined,
            getAgentName: () => undefined,
            setContainerLink: vi.fn(),
            clearContainerLink: vi.fn(),
        };
        registerContainerLinkRoutes(routes, ctx);
    });

    it('registers GET and PUT routes', () => {
        expect(routes.length).toBe(2);
        expect(routes[0].method).toBe('GET');
        expect(routes[0].pattern).toBe('/api/config/container');
        expect(routes[1].method).toBe('PUT');
        expect(routes[1].pattern).toBe('/api/config/container');
    });

    it('GET returns current status', async () => {
        const req = createMockReq('GET');
        const res = createMockRes();
        await routes[0].handler(req, res, {});

        expect(res._statusCode).toBe(200);
        const data = JSON.parse(res._data);
        expect(data.status).toBe('disconnected');
        expect(data.containerUrl).toBeNull();
    });

    it('GET returns connected status with URL', async () => {
        mockLink.status = 'registered';
        mockLink.assignedAgentId = 'ag-1';
        (ctx as any).getContainerUrl = () => 'http://container:5000';
        (ctx as any).getAgentName = () => 'my-agent';

        const req = createMockReq('GET');
        const res = createMockRes();
        await routes[0].handler(req, res, {});

        const data = JSON.parse(res._data);
        expect(data.status).toBe('registered');
        expect(data.containerUrl).toBe('http://container:5000');
        expect(data.agentId).toBe('ag-1');
        expect(data.agentName).toBe('my-agent');
    });

    it('PUT with containerUrl calls setContainerLink', async () => {
        const req = createMockReq('PUT', JSON.stringify({ containerUrl: 'http://new:5000' }));
        const res = createMockRes();
        await routes[1].handler(req, res, {});

        expect(ctx.setContainerLink).toHaveBeenCalledWith('http://new:5000', undefined);
        expect(res._statusCode).toBe(200);
    });

    it('PUT with null containerUrl calls clearContainerLink', async () => {
        const req = createMockReq('PUT', JSON.stringify({ containerUrl: null }));
        const res = createMockRes();
        await routes[1].handler(req, res, {});

        expect(ctx.clearContainerLink).toHaveBeenCalled();
        expect(res._statusCode).toBe(200);
        const data = JSON.parse(res._data);
        expect(data.status).toBe('disconnected');
    });

    it('PUT with empty containerUrl calls clearContainerLink', async () => {
        const req = createMockReq('PUT', JSON.stringify({ containerUrl: '' }));
        const res = createMockRes();
        await routes[1].handler(req, res, {});

        expect(ctx.clearContainerLink).toHaveBeenCalled();
    });
});
