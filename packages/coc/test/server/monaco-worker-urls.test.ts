/**
 * Monaco worker URLs must point at files the server actually serves.
 *
 * A worker URL the router cannot resolve falls through to the SPA page, so the
 * browser runs HTML as the worker and Monaco's diff editor never gets line
 * changes (the Editor diff view showed files with no highlights).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createRequestHandler } from '@plusplusoneplusplus/coc-server';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { monacoWorkerUrl } from '../../src/server/spa/client/react/features/repo-detail/explorer/monacoWorkerUrls';

const LABELS = ['editorWorkerService', 'json', 'css', 'scss', 'less', 'html', 'handlebars', 'razor', 'typescript', 'javascript'];
const SPA_HTML = '<!doctype html><html><body>spa</body></html>';

/** Worker file names `scripts/build-client.mjs` writes into `client/dist/`. */
function builtWorkerFiles(): string[] {
    const script = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'build-client.mjs'), 'utf-8');
    const block = /const MONACO_WORKERS = \[([\s\S]*?)\];/.exec(script);
    expect(block, 'MONACO_WORKERS list in build-client.mjs').not.toBeNull();
    return [...block![1].matchAll(/out: '([^']+)'/g)].map(m => m[1]);
}

function get(port: number, urlPath: string): Promise<{ status: number; type: string; body: string }> {
    return new Promise((resolve, reject) => {
        http.get({ hostname: '127.0.0.1', port, path: urlPath }, res => {
            const chunks: Buffer[] = [];
            res.on('data', (c: Buffer) => chunks.push(c));
            res.on('end', () => resolve({
                status: res.statusCode ?? 0,
                type: String(res.headers['content-type'] ?? ''),
                body: Buffer.concat(chunks).toString('utf-8'),
            }));
        }).on('error', reject);
    });
}

describe('monacoWorkerUrl', () => {
    it('maps every label to a worker file the client build emits', () => {
        const built = builtWorkerFiles();
        expect(built).toContain('editor.worker.js');
        for (const label of LABELS) {
            const url = monacoWorkerUrl(label);
            expect(url.startsWith('/'), url).toBe(true);
            expect(built, `${label} → ${url}`).toContain(url.slice(1));
        }
    });

    it('routes language labels to their own worker and others to the editor worker', () => {
        expect(monacoWorkerUrl('json')).toBe('/json.worker.js');
        expect(monacoWorkerUrl('scss')).toBe('/css.worker.js');
        expect(monacoWorkerUrl('razor')).toBe('/html.worker.js');
        expect(monacoWorkerUrl('javascript')).toBe('/ts.worker.js');
        expect(monacoWorkerUrl('editorWorkerService')).toBe('/editor.worker.js');
        expect(monacoWorkerUrl('unknown')).toBe('/editor.worker.js');
    });
});

describe('Monaco worker URLs over the dashboard router', () => {
    let staticDir: string;
    let server: http.Server;
    let port: number;

    beforeAll(async () => {
        staticDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-monaco-workers-'));
        for (const file of builtWorkerFiles()) {
            fs.writeFileSync(path.join(staticDir, file), `/* ${file} */ self.onmessage = () => {};`);
        }
        const store = { getProcessCount: async () => 0 } as unknown as ProcessStore;
        server = http.createServer(createRequestHandler({ routes: [], spaHtml: SPA_HTML, staticDir, store }));
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        port = (server.address() as { port: number }).port;
    });

    afterAll(async () => {
        await new Promise<void>(resolve => server.close(() => resolve()));
        fs.rmSync(staticDir, { recursive: true, force: true });
    });

    it('serves each worker URL as JavaScript, not the SPA page', async () => {
        for (const url of new Set(LABELS.map(monacoWorkerUrl))) {
            const res = await get(port, url);
            expect(res.status, url).toBe(200);
            expect(res.type, url).toContain('javascript');
            expect(res.body, url).toContain(url.slice(1));
            expect(res.body, url).not.toContain(SPA_HTML);
        }
    });
});
