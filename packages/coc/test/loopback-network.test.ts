import { getDefaultResultOrder } from 'node:dns';
import { createServer, get } from 'node:http';
import { expect, it } from 'vitest';

it('binds and connects localhost fixtures through IPv4 in the test worker', async () => {
    expect(getDefaultResultOrder()).toBe('ipv4first');
    const server = createServer((request, response) => response.end(request.socket.localAddress));
    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, 'localhost', resolve);
    });
    try {
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('Expected a TCP listener');
        expect(address.family).toBe('IPv4');
        expect(address.address).toBe('127.0.0.1');
        const result = await new Promise<{ status: number | undefined; body: string }>((resolve, reject) => {
            const request = get(`http://localhost:${address.port}`, {
                agent: false,
                signal: AbortSignal.timeout(10_000),
            }, response => {
                let body = '';
                response.setEncoding('utf8');
                response.on('data', chunk => { body += chunk; });
                response.on('error', reject);
                response.on('end', () => resolve({ status: response.statusCode, body }));
            });
            request.on('error', reject);
        });
        expect(result).toEqual({ status: 200, body: address.address });
    } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
});
