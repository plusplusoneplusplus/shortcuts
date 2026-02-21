/**
 * Wiki Generate Handler — collectCacheMetadata Tests
 *
 * Tests that the analyses count in cache metadata is graph-aware:
 * only analysis files matching current graph component IDs are counted.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { collectCacheMetadata } from '../../src/server/wiki/generate-handler';
import type { CacheMetadataStats } from '../../src/server/wiki/generate-handler';

let tempDir: string;
let outputDir: string;

function makeWiki(components: Array<{ id: string }>, extras?: { categories?: any[]; themes?: any[]; domains?: any[]; project?: any }) {
    return {
        wikiData: {
            graph: {
                components,
                categories: extras?.categories ?? [],
                themes: extras?.themes ?? [],
                domains: extras?.domains ?? [],
                project: extras?.project ?? { name: 'Test', language: 'TypeScript' },
            },
        },
    };
}

function writeAnalysisFile(dir: string, componentId: string): void {
    const analysesDir = path.join(dir, '.wiki-cache', 'analyses');
    fs.mkdirSync(analysesDir, { recursive: true });
    fs.writeFileSync(
        path.join(analysesDir, `${componentId}.json`),
        JSON.stringify({ analysis: { componentId }, gitHash: 'h1', timestamp: Date.now() }),
        'utf-8'
    );
}

function writeMetadataFile(dir: string): void {
    const analysesDir = path.join(dir, '.wiki-cache', 'analyses');
    fs.mkdirSync(analysesDir, { recursive: true });
    fs.writeFileSync(
        path.join(analysesDir, '_metadata.json'),
        JSON.stringify({ gitHash: 'h1', timestamp: Date.now(), version: '1.0.0', componentCount: 0 }),
        'utf-8'
    );
}

beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-generate-test-'));
    outputDir = path.join(tempDir, 'wiki-output');
    fs.mkdirSync(outputDir, { recursive: true });
});

afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('collectCacheMetadata — analyses count', () => {
    it('should count only analyses matching graph component IDs', () => {
        const wiki = makeWiki([{ id: 'auth' }, { id: 'db' }]);

        writeAnalysisFile(outputDir, 'auth');
        writeAnalysisFile(outputDir, 'db');
        writeAnalysisFile(outputDir, 'old-module');
        writeMetadataFile(outputDir);

        const stats: CacheMetadataStats = collectCacheMetadata(wiki, outputDir);

        expect(stats.components).toBe(2);
        expect(stats.analyses).toBe(2);
    });

    it('should return 0 analyses when no files match graph', () => {
        const wiki = makeWiki([{ id: 'auth' }]);

        writeAnalysisFile(outputDir, 'completely-different');
        writeMetadataFile(outputDir);

        const stats = collectCacheMetadata(wiki, outputDir);
        expect(stats.analyses).toBe(0);
    });

    it('should count all files when graph has no components', () => {
        const wiki = makeWiki([]);

        writeAnalysisFile(outputDir, 'auth');
        writeAnalysisFile(outputDir, 'db');
        writeMetadataFile(outputDir);

        const stats = collectCacheMetadata(wiki, outputDir);
        expect(stats.analyses).toBe(2);
    });

    it('should not count _metadata.json as an analysis', () => {
        const wiki = makeWiki([{ id: 'auth' }]);

        writeAnalysisFile(outputDir, 'auth');
        writeMetadataFile(outputDir);

        const stats = collectCacheMetadata(wiki, outputDir);
        expect(stats.analyses).toBe(1);
    });

    it('should return 0 analyses when no cache directory exists', () => {
        const wiki = makeWiki([{ id: 'auth' }]);

        const stats = collectCacheMetadata(wiki, outputDir);
        expect(stats.analyses).toBe(0);
    });

    it('should handle graph with null wikiData gracefully', () => {
        const wiki = { wikiData: { graph: null } };

        writeAnalysisFile(outputDir, 'auth');
        writeMetadataFile(outputDir);

        const stats = collectCacheMetadata(wiki as any, outputDir);
        expect(stats.analyses).toBe(1);
        expect(stats.components).toBe(0);
    });
});

describe('collectCacheMetadata — graph stats', () => {
    it('should report component, category, theme, and domain counts from graph', () => {
        const wiki = makeWiki(
            [{ id: 'auth' }, { id: 'db' }, { id: 'api' }],
            {
                categories: [{ name: 'core' }, { name: 'infra' }],
                themes: [{ id: 't1' }],
                domains: [{ id: 'd1' }, { id: 'd2' }],
                project: { name: 'MyProject', language: 'Go' },
            }
        );

        const stats = collectCacheMetadata(wiki, outputDir);

        expect(stats.components).toBe(3);
        expect(stats.categories).toBe(2);
        expect(stats.themes).toBe(1);
        expect(stats.domains).toBe(2);
        expect(stats.projectName).toBe('MyProject');
        expect(stats.projectLanguage).toBe('Go');
    });
});
