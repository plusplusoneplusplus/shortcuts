/**
 * Integration tests for ContainerWebSocketRouter — routes registered upgrade
 * paths to their handlers, destroys unknown paths, and reuses a single
 * WebSocketServer per path (no per-upgrade allocation) with clean shutdown.
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as http from 'http';
import { WebSocket } from 'ws';
import { ContainerWebSocketRouter } from '../../src/server/websocket-router';

let server: http.Server | undefined;
let router: ContainerWebSocketRouter | undefined;

async function start(register: (r: ContainerWebSocketRouter) => void): Promise<number> {
    router = new ContainerWebSocketRouter();
    register(router);
    server = http.createServer();
    router.attach(server);
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', () => resolve()));
    return (server!.address() as { port: number }).port;
}

afterEach(() => {
    router?.close();
    server?.close();
    router = undefined;
    server = undefined;
});

describe('ContainerWebSocketRouter', () => {
    it('routes a registered upgrade path to its handler', async () => {
        const connected: string[] = [];
        const port = await start(r => r.register('/ws', (ws) => { connected.push('ws'); ws.close(); }));
        const client = new WebSocket(`ws://127.0.0.1:${port}/ws`);
        await new Promise<void>((resolve, reject) => { client.on('open', () => resolve()); client.on('error', reject); });
        await new Promise(r => setTimeout(r, 50));
        expect(connected).toEqual(['ws']);
        client.close();
    });

    it('destroys sockets for unregistered upgrade paths', async () => {
        const port = await start(r => r.register('/ws', () => {}));
        const client = new WebSocket(`ws://127.0.0.1:${port}/nope`);
        const closedOrErrored = await new Promise<boolean>((resolve) => {
            client.on('open', () => resolve(false));
            client.on('error', () => resolve(true));
            client.on('close', () => resolve(true));
        });
        expect(closedOrErrored).toBe(true);
    });

    it('reuses one WebSocketServer per path across multiple upgrades', async () => {
        const connected: number[] = [];
        const port = await start(r => r.register('/ws', (ws) => { connected.push(1); ws.close(); }));
        for (let i = 0; i < 2; i++) {
            const client = new WebSocket(`ws://127.0.0.1:${port}/ws`);
            await new Promise<void>((resolve, reject) => { client.on('open', () => resolve()); client.on('error', reject); });
            await new Promise(r => setTimeout(r, 30));
            client.close();
        }
        expect(connected.length).toBe(2);
        // Exactly one server is owned for /ws — it is not re-allocated per upgrade.
        expect((router as any).servers.size).toBe(1);
    });

    it('close() unregisters routes so later upgrades are destroyed', async () => {
        const port = await start(r => r.register('/ws', () => {}));
        router!.close();
        const client = new WebSocket(`ws://127.0.0.1:${port}/ws`);
        const closedOrErrored = await new Promise<boolean>((resolve) => {
            client.on('open', () => resolve(false));
            client.on('error', () => resolve(true));
            client.on('close', () => resolve(true));
        });
        expect(closedOrErrored).toBe(true);
    });
});
