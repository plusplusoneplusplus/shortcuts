/**
 * Tests for GET /api/fs/browse-helper — HTML page that browses same-origin
 * and posts results back via postMessage (used for devtunnel auth flow).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createRouter } from '../../src/server/shared/router';
import { registerApiFsRoutes } from '../../src/server/routes/api-fs-routes';
import type { Route } from '../../src/server/types';

let server: http.Server;
let baseUrl: string;
let tmpDir: string;

function makeServer(): http.Server {
    const routes: Route[] = [];
    registerApiFsRoutes(routes);
    const handler = createRouter({ routes, spaHtml: '' });
    return http.createServer(handler);
}

async function startServer(): Promise<void> {
    server = makeServer();
    return new Promise((resolve, reject) => {
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const addr = server.address() as { port: number };
            baseUrl = `http://127.0.0.1:${addr.port}`;
            resolve();
        });
    });
}

async function stopServer(): Promise<void> {
    return new Promise(resolve => server.close(() => resolve()));
}

beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-browse-helper-'));
    fs.mkdirSync(path.join(tmpDir, 'sub-a'));
    fs.mkdirSync(path.join(tmpDir, 'sub-b'));
    await startServer();
});

afterEach(async () => {
    await stopServer();
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('GET /api/fs/browse-helper', () => {
    it('returns an HTML page with Content-Type text/html', async () => {
        const res = await fetch(`${baseUrl}/api/fs/browse-helper?path=${encodeURIComponent(tmpDir)}`);
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toContain('text/html');
    });

    it('embeds the requested path in the HTML script', async () => {
        const res = await fetch(`${baseUrl}/api/fs/browse-helper?path=${encodeURIComponent(tmpDir)}`);
        const html = await res.text();
        // The path should be embedded as a JSON string in the script
        expect(html).toContain(JSON.stringify(tmpDir));
    });

    it('contains postMessage call for browse-result', async () => {
        const res = await fetch(`${baseUrl}/api/fs/browse-helper?path=${encodeURIComponent(tmpDir)}`);
        const html = await res.text();
        expect(html).toContain("'browse-result'");
        expect(html).toContain('postMessage');
    });

    it('contains postMessage call for browse-error on failure', async () => {
        const res = await fetch(`${baseUrl}/api/fs/browse-helper?path=${encodeURIComponent(tmpDir)}`);
        const html = await res.text();
        expect(html).toContain("'browse-error'");
    });

    it('fetches /api/fs/browse same-origin in the script', async () => {
        const res = await fetch(`${baseUrl}/api/fs/browse-helper?path=${encodeURIComponent(tmpDir)}`);
        const html = await res.text();
        expect(html).toContain('/api/fs/browse?path=');
    });

    it('defaults path to ~ when not provided', async () => {
        const res = await fetch(`${baseUrl}/api/fs/browse-helper`);
        expect(res.status).toBe(200);
        const html = await res.text();
        expect(html).toContain(JSON.stringify('~'));
    });

    it('passes showHidden parameter', async () => {
        const res = await fetch(`${baseUrl}/api/fs/browse-helper?path=${encodeURIComponent(tmpDir)}&showHidden=true`);
        const html = await res.text();
        expect(html).toContain(JSON.stringify(true));
    });

    it('includes CORS credentials header when Origin is present', async () => {
        const res = await fetch(`${baseUrl}/api/fs/browse-helper?path=${encodeURIComponent(tmpDir)}`, {
            headers: { 'Origin': 'http://localhost:5000' },
        });
        expect(res.headers.get('access-control-allow-credentials')).toBe('true');
        expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:5000');
    });
});
