/**
 * Tests for health check proxy.
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as http from 'http';
import { checkAgentHealth } from '../../src/proxy/health';

describe('checkAgentHealth', () => {
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

    function startServer(statusCode: number): Promise<number> {
        return new Promise((resolve) => {
            server = http.createServer((_, res) => {
                res.writeHead(statusCode);
                res.end('ok');
            });
            server.listen(0, '127.0.0.1', () => {
                const addr = server!.address() as { port: number };
                resolve(addr.port);
            });
        });
    }

    it('should return true for healthy agent', async () => {
        const port = await startServer(200);
        const result = await checkAgentHealth(`http://127.0.0.1:${port}`);
        expect(result).toBe(true);
    });

    it('should return false for error response', async () => {
        const port = await startServer(500);
        const result = await checkAgentHealth(`http://127.0.0.1:${port}`);
        expect(result).toBe(false);
    });

    it('should return false for unreachable agent', async () => {
        const result = await checkAgentHealth('http://127.0.0.1:19999', 1000);
        expect(result).toBe(false);
    });
});
