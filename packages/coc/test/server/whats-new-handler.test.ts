/**
 * Tests for the "What's New" service and its HTTP routes.
 *
 * Network is injected in every test — nothing here touches api.github.com.
 * The marker file lives in a per-test temp dir so runs never share state.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createRouter } from '../../src/server/shared/router';
import { registerWhatsNewRoutes } from '../../src/server/whats-new/whats-new-handler';
import {
    WhatsNewService,
    WHATS_NEW_FILE,
    extractWhatsNewBlock,
    parseRelease,
    resolveAppVersion,
    releaseByTagApi,
    type FetchJson,
} from '../../src/server/whats-new/whats-new-service';
import type { Route } from '../../src/server/types';

// ── Helpers ──────────────────────────────────────────────────────────────────

let dataDir: string;
let server: http.Server | undefined;
let baseUrl = '';

const RELEASE_JSON = {
    tag_name: 'v3.4.8',
    name: 'CoC v3.4.8',
    html_url: 'https://github.com/plusplusoneplusplus/shortcuts/releases/tag/v3.4.8',
    prerelease: false,
    body: "## What's New\n\n### Added\n- A shiny thing\n\n## Install\n\nDownload the installer.",
};

/** A FetchJson stub that always answers with the same status/body. */
function stubFetch(status: number, json: unknown): FetchJson & { calls: string[] } {
    const calls: string[] = [];
    const fn = (async (url: string) => {
        calls.push(url);
        return { status, json };
    }) as FetchJson & { calls: string[] };
    fn.calls = calls;
    return fn;
}

function makeService(overrides: {
    version?: string | null;
    fetchJson?: FetchJson;
} = {}): WhatsNewService {
    return new WhatsNewService({
        dataDir,
        appVersion: () => (overrides.version === undefined ? '3.4.8' : overrides.version),
        fetchJson: overrides.fetchJson ?? stubFetch(200, RELEASE_JSON),
        now: () => new Date('2026-09-06T00:00:00.000Z'),
    });
}

function writeMarker(version: string): void {
    fs.writeFileSync(
        path.join(dataDir, WHATS_NEW_FILE),
        JSON.stringify({ lastSeenVersion: version, updatedAt: '2026-01-01T00:00:00.000Z' }),
        'utf-8',
    );
}

function readMarkerRaw(): any {
    return JSON.parse(fs.readFileSync(path.join(dataDir, WHATS_NEW_FILE), 'utf-8'));
}

async function startServer(service: WhatsNewService): Promise<void> {
    const routes: Route[] = [];
    registerWhatsNewRoutes(routes, service);
    server = http.createServer(createRouter({ routes, spaHtml: '' }));
    await new Promise<void>((resolve, reject) => {
        server!.on('error', reject);
        server!.listen(0, '127.0.0.1', () => {
            const addr = server!.address() as { port: number };
            baseUrl = `http://127.0.0.1:${addr.port}`;
            resolve();
        });
    });
}

beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-whats-new-'));
});

afterEach(async () => {
    if (server) {
        await new Promise<void>(resolve => server!.close(() => resolve()));
        server = undefined;
    }
    fs.rmSync(dataDir, { recursive: true, force: true });
});

// ── extractWhatsNewBlock ─────────────────────────────────────────────────────

describe('extractWhatsNewBlock', () => {
    it('takes the heading through the next top-level heading', () => {
        expect(extractWhatsNewBlock(RELEASE_JSON.body)).toBe(
            "## What's New\n\n### Added\n- A shiny thing",
        );
    });

    it('keeps ### subheadings and runs to the end when nothing follows', () => {
        const body = "## What's New\n### Fixed\n- a\n### Changed\n- b";
        expect(extractWhatsNewBlock(body)).toBe(body);
    });

    it('returns null when the body has no What\'s New heading', () => {
        expect(extractWhatsNewBlock('## Install\n\nrun it')).toBeNull();
    });
});

// ── parseRelease ─────────────────────────────────────────────────────────────

describe('parseRelease', () => {
    it('normalizes a release payload and extracts the notes', () => {
        const r = parseRelease(RELEASE_JSON)!;
        expect(r.tag).toBe('v3.4.8');
        expect(r.title).toBe('CoC v3.4.8');
        expect(r.notes).toContain('A shiny thing');
        expect(r.notes).not.toContain('Install');
        expect(r.isPrerelease).toBe(false);
    });

    it('falls back to the whole body when there is no What\'s New block', () => {
        const r = parseRelease({ ...RELEASE_JSON, body: '## Install\n\nrun it' })!;
        expect(r.notes).toBe('## Install\n\nrun it');
    });

    it('falls back to the tag when the release has no name', () => {
        expect(parseRelease({ ...RELEASE_JSON, name: '   ' })!.title).toBe('v3.4.8');
    });

    it('returns null for payloads with no tag', () => {
        expect(parseRelease({})).toBeNull();
        expect(parseRelease({ message: 'Not Found' })).toBeNull();
        expect(parseRelease(null)).toBeNull();
        expect(parseRelease([])).toBeNull();
    });
});

// ── resolveAppVersion ────────────────────────────────────────────────────────

describe('resolveAppVersion', () => {
    it('prefers COC_APP_VERSION and strips a leading v', () => {
        expect(resolveAppVersion({ COC_APP_VERSION: 'v3.4.9-alpha.31' } as any)).toBe('3.4.9-alpha.31');
    });

    it('falls back to a coc-desktop package.json found by walking up', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-ver-'));
        const deep = path.join(root, 'node_modules', '@plusplusoneplusplus', 'coc', 'dist');
        fs.mkdirSync(deep, { recursive: true });
        fs.writeFileSync(
            path.join(root, 'package.json'),
            JSON.stringify({ name: '@plusplusoneplusplus/coc-desktop', version: '9.9.9' }),
        );
        expect(resolveAppVersion({} as any, deep)).toBe('9.9.9');
        fs.rmSync(root, { recursive: true, force: true });
    });

    it('ignores a package.json that is not coc-desktop', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-ver-'));
        fs.writeFileSync(
            path.join(root, 'package.json'),
            JSON.stringify({ name: 'something-else', version: '9.9.9' }),
        );
        expect(resolveAppVersion({} as any, root)).toBeNull();
        fs.rmSync(root, { recursive: true, force: true });
    });
});

// ── Service status ───────────────────────────────────────────────────────────

describe('WhatsNewService.getStatus', () => {
    it('shows the notes for an unseen version', async () => {
        writeMarker('3.4.7');
        const status = await makeService().getStatus();
        expect(status).toMatchObject({
            show: true,
            version: '3.4.8',
            tag: 'v3.4.8',
            title: 'CoC v3.4.8',
            isPrerelease: false,
        });
        expect((status as any).notes).toContain('A shiny thing');
    });

    it('marks a prerelease release as such', async () => {
        writeMarker('3.4.7');
        const service = makeService({
            fetchJson: stubFetch(200, { ...RELEASE_JSON, prerelease: true }),
        });
        expect((await service.getStatus() as any).isPrerelease).toBe(true);
    });

    it('hides an already-seen version without hitting the network', async () => {
        writeMarker('3.4.8');
        const fetchJson = stubFetch(200, RELEASE_JSON);
        const status = await makeService({ fetchJson }).getStatus();
        expect(status).toEqual({ show: false, version: '3.4.8', reason: 'seen' });
        expect(fetchJson.calls).toEqual([]);
    });

    it('reports no-release on a 404', async () => {
        writeMarker('3.4.7');
        const status = await makeService({ fetchJson: stubFetch(404, { message: 'Not Found' }) }).getStatus();
        expect(status).toEqual({ show: false, version: '3.4.8', reason: 'no-release' });
    });

    it('reports fetch-failed when the network throws', async () => {
        writeMarker('3.4.7');
        const service = makeService({
            fetchJson: async () => { throw new Error('offline'); },
        });
        expect(await service.getStatus()).toEqual({ show: false, version: '3.4.8', reason: 'fetch-failed' });
    });

    it('reports fetch-failed when GitHub rate-limits us, and caches the failure', async () => {
        writeMarker('3.4.7');
        const fetchJson = stubFetch(403, { message: 'rate limit exceeded' });
        const service = makeService({ fetchJson });
        expect(await service.getStatus()).toMatchObject({ show: false, reason: 'fetch-failed' });
        expect(await service.getStatus()).toMatchObject({ show: false, reason: 'fetch-failed' });
        expect(fetchJson.calls).toHaveLength(1);
    });

    it('caches a successful lookup for the process lifetime', async () => {
        writeMarker('3.4.7');
        const fetchJson = stubFetch(200, RELEASE_JSON);
        const service = makeService({ fetchJson });
        await service.getStatus();
        await service.getStatus();
        expect(fetchJson.calls).toEqual([releaseByTagApi('v3.4.8')]);
    });

    it('treats a missing marker as first launch and writes the marker', async () => {
        const fetchJson = stubFetch(200, RELEASE_JSON);
        const status = await makeService({ fetchJson }).getStatus();
        expect(status).toEqual({ show: false, version: '3.4.8', reason: 'first-launch' });
        expect(readMarkerRaw().lastSeenVersion).toBe('3.4.8');
        expect(fetchJson.calls).toEqual([]);
    });

    it('treats a corrupt marker as first launch and rewrites it', async () => {
        fs.writeFileSync(path.join(dataDir, WHATS_NEW_FILE), '{ not json', 'utf-8');
        const status = await makeService().getStatus();
        expect(status).toEqual({ show: false, version: '3.4.8', reason: 'first-launch' });
        expect(readMarkerRaw().lastSeenVersion).toBe('3.4.8');
    });

    it('shows nothing when the app version cannot be determined', async () => {
        writeMarker('3.4.7');
        const status = await makeService({ version: null }).getStatus();
        expect(status).toEqual({ show: false, version: '', reason: 'no-release' });
    });

    it('hides a release whose body is empty', async () => {
        writeMarker('3.4.7');
        const service = makeService({ fetchJson: stubFetch(200, { ...RELEASE_JSON, body: '' }) });
        expect(await service.getStatus()).toEqual({ show: false, version: '3.4.8', reason: 'no-release' });
    });
});

// ── HTTP routes ──────────────────────────────────────────────────────────────

describe('whats-new routes', () => {
    it('GET returns the status and POST /ack persists the seen version', async () => {
        writeMarker('3.4.7');
        const service = makeService();
        await startServer(service);

        const first = await (await fetch(`${baseUrl}/api/whats-new`)).json();
        expect(first.show).toBe(true);

        const ack = await fetch(`${baseUrl}/api/whats-new/ack`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ version: '3.4.8' }),
        });
        expect(ack.status).toBe(200);
        expect(await ack.json()).toEqual({ ok: true });
        expect(readMarkerRaw()).toEqual({
            lastSeenVersion: '3.4.8',
            updatedAt: '2026-09-06T00:00:00.000Z',
        });

        const second = await (await fetch(`${baseUrl}/api/whats-new`)).json();
        expect(second).toEqual({ show: false, version: '3.4.8', reason: 'seen' });
    });

    it('POST /ack rejects a missing version', async () => {
        writeMarker('3.4.7');
        await startServer(makeService());
        const res = await fetch(`${baseUrl}/api/whats-new/ack`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });
        expect(res.status).toBe(400);
    });

    it('ack creates the data dir when it does not exist yet', async () => {
        const nested = path.join(dataDir, 'missing', 'deeper');
        const service = new WhatsNewService({
            dataDir: nested,
            appVersion: () => '3.4.8',
            fetchJson: stubFetch(200, RELEASE_JSON),
        });
        await service.ack('3.4.8');
        expect(service.readMarker()?.lastSeenVersion).toBe('3.4.8');
    });
});
