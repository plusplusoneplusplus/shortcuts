/**
 * WikiCacheStatusService Tests
 *
 * Phase cache status mirrors the prerequisites the runner loads when a phase
 * is skipped, so these tests pin the file each phase is judged by.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { WikiCacheStatusService } from '../../../../src/server/wiki/generation';

let tempDir: string;
let wikiDir: string;
let service: WikiCacheStatusService;

function cachePath(...parts: string[]): string {
    return path.join(wikiDir, '.wiki-cache', ...parts);
}

function writeJson(filePath: string, value: unknown): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(value), 'utf-8');
}

function wikiWith(componentIds: Array<{ id: string; domain?: string }>): any {
    return { wikiData: { graph: { components: componentIds } } };
}

beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-cache-status-'));
    wikiDir = path.join(tempDir, 'wiki');
    fs.mkdirSync(wikiDir, { recursive: true });
    service = new WikiCacheStatusService();
});

afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('WikiCacheStatusService — phase status', () => {
    it('reports every phase uncached for an empty output dir', () => {
        const phases = service.getPhaseStatuses(wikiWith([]), wikiDir);

        expect(Object.keys(phases).sort()).toEqual(['1', '2', '3', '4', '5']);
        for (const key of ['1', '2', '3', '4', '5']) {
            expect(phases[key].cached).toBe(false);
        }
    });

    it.each([
        ['1', ['component-graph.json']],
        ['2', ['consolidated-graph.json']],
        ['3', ['analyses', '_metadata.json']],
        ['4', ['articles', '_metadata.json']],
    ])('marks phase %s cached from its own cache file', (phase, parts) => {
        writeJson(cachePath(...parts), { timestamp: '2024-01-02T03:04:05.000Z' });

        const phases = service.getPhaseStatuses(wikiWith([]), wikiDir);

        expect(phases[phase]).toMatchObject({ cached: true, timestamp: '2024-01-02T03:04:05.000Z' });
    });

    it('reads the timestamp out of a metadata wrapper', () => {
        writeJson(cachePath('component-graph.json'), { metadata: { timestamp: '2024-05-06T00:00:00.000Z' } });

        expect(service.getPhaseStatuses(wikiWith([]), wikiDir)['1'].timestamp)
            .toBe('2024-05-06T00:00:00.000Z');
    });

    it('reports cached without a timestamp when the file has none', () => {
        writeJson(cachePath('component-graph.json'), { components: [] });

        expect(service.getPhaseStatuses(wikiWith([]), wikiDir)['1']).toEqual({ cached: true });
    });

    it('treats an unparseable cache file as uncached', () => {
        fs.mkdirSync(path.dirname(cachePath('component-graph.json')), { recursive: true });
        fs.writeFileSync(cachePath('component-graph.json'), 'not json', 'utf-8');

        expect(service.getPhaseStatuses(wikiWith([]), wikiDir)['1'].cached).toBe(false);
    });

    it('marks phase 5 cached from the generated index.html mtime', () => {
        fs.writeFileSync(path.join(wikiDir, 'index.html'), '<html></html>', 'utf-8');

        const phase5 = service.getPhaseStatuses(wikiWith([]), wikiDir)['5'];

        expect(phase5.cached).toBe(true);
        expect(() => new Date(phase5.timestamp!)).not.toThrow();
    });
});

describe('WikiCacheStatusService — per-component article status', () => {
    it('finds an article stored under its domain folder', () => {
        writeJson(cachePath('articles', 'core', 'auth.json'), {
            article: { slug: 'auth' },
            timestamp: '2024-03-04T00:00:00.000Z',
        });

        const phases = service.getPhaseStatuses(wikiWith([{ id: 'auth', domain: 'core' }]), wikiDir);

        expect(phases['4'].components!.auth).toEqual({
            cached: true,
            timestamp: '2024-03-04T00:00:00.000Z',
        });
    });

    it('falls back to the flat article layout', () => {
        writeJson(cachePath('articles', 'auth.json'), { article: { slug: 'auth' } });

        const phases = service.getPhaseStatuses(wikiWith([{ id: 'auth', domain: 'core' }]), wikiDir);

        expect(phases['4'].components!.auth).toEqual({ cached: true, timestamp: undefined });
    });

    it('reports a component with no article as uncached', () => {
        const phases = service.getPhaseStatuses(wikiWith([{ id: 'auth' }, { id: 'db' }]), wikiDir);

        expect(phases['4'].components).toEqual({
            auth: { cached: false },
            db: { cached: false },
        });
    });

    it('ignores an article cache file with no slug', () => {
        writeJson(cachePath('articles', 'auth.json'), { article: {} });

        const phases = service.getPhaseStatuses(wikiWith([{ id: 'auth' }]), wikiDir);

        expect(phases['4'].components!.auth).toEqual({ cached: false });
    });

    it('omits per-component status when the graph is unavailable', () => {
        const phases = service.getPhaseStatuses({ wikiData: { graph: null } } as any, wikiDir);

        expect(phases['4'].components).toBeUndefined();
        expect(phases['1'].cached).toBe(false);
    });
});

describe('WikiCacheStatusService — metadata', () => {
    it('counts graph entities and project labels', () => {
        const wiki = {
            wikiData: {
                graph: {
                    components: [{ id: 'a' }, { id: 'b' }],
                    categories: [{}],
                    themes: [{}, {}],
                    domains: [{}, {}, {}],
                    project: { name: 'Demo', language: 'Go' },
                },
            },
        } as any;

        expect(service.collectMetadata(wiki, wikiDir)).toEqual({
            components: 2,
            categories: 1,
            themes: 2,
            domains: 3,
            analyses: 0,
            articles: 0,
            projectName: 'Demo',
            projectLanguage: 'Go',
        });
    });

    it('counts nested article files but skips underscore-prefixed ones', () => {
        writeJson(cachePath('articles', 'core', 'auth.json'), { article: { slug: 'auth' } });
        writeJson(cachePath('articles', 'core', 'db.json'), { article: { slug: 'db' } });
        writeJson(cachePath('articles', '_metadata.json'), {});

        expect(service.collectMetadata(wikiWith([]), wikiDir).articles).toBe(2);
    });
});
