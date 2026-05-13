/**
 * Tests for HTTP proxy utilities.
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as http from 'http';
import { proxyRequest } from '../../src/proxy/http';

describe('proxyRequest', () => {
    let server: http.Server | null = null;

    afterEach(() => {
        return new Promise<void>((resolve) => {
            if (server) {
                server.close(() => resolve());
                server = null;
            } else {
                resolve();
            }
        });
    });

    function startJsonServer(handler: (req: http.IncomingMessage, res: http.ServerResponse) => void): Promise<number> {
        return new Promise((resolve) => {
            server = http.createServer(handler);
            server.listen(0, '127.0.0.1', () => {
                const addr = server!.address() as { port: number };
                resolve(addr.port);
            });
        });
    }

    it('should GET JSON from agent', async () => {
        const port = await startJsonServer((_, res) => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ workspaces: ['a', 'b'] }));
        });

        const result = await proxyRequest(`http://127.0.0.1:${port}`, 'GET', '/api/workspaces');
        expect(result).toEqual({ workspaces: ['a', 'b'] });
    });

    it('should POST JSON to agent', async () => {
        let receivedBody = '';
        const port = await startJsonServer((req, res) => {
            const chunks: Buffer[] = [];
            req.on('data', (c: Buffer) => chunks.push(c));
            req.on('end', () => {
                receivedBody = Buffer.concat(chunks).toString();
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: true }));
            });
        });

        const result = await proxyRequest(`http://127.0.0.1:${port}`, 'POST', '/api/run', { content: 'test' });
        expect(result).toEqual({ ok: true });
        expect(JSON.parse(receivedBody)).toEqual({ content: 'test' });
    });
});
