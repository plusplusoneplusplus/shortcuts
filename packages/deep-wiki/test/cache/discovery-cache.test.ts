/**
 * Discovery Cache Tests
 *
 * Tests for Phase 1 intermediate discovery caching:
 * seeds, probe results, structural scan, domain sub-graphs,
 * metadata, and cleanup.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type {
    TopicSeed,
    TopicProbeResult,
    StructuralScanResult,
    ComponentGraph,
    DiscoveryProgressMetadata,
} from '../../src/types';

import {
    getDiscoveryCacheDir,
    saveSeedsCache,
    getCachedSeeds,
    getCachedSeedsAny,
    saveProbeResult,
    getCachedProbeResult,
    scanCachedProbes,
    scanCachedProbesAny,
    saveStructuralScan,
    getCachedStructuralScan,
    getCachedStructuralScanAny,
    saveDomainSubGraph,
    getCachedDomainSubGraph,
    scanCachedDomains,
    scanCachedDomainsAny,
    saveDiscoveryMetadata,
    getDiscoveryMetadata,
    clearDiscoveryCache,
} from '../../src/cache';

// ============================================================================
// Test Helpers
// ============================================================================

let tempDir: string;
let outputDir: string;

function createTestSeeds(count: number = 3): TopicSeed[] {
    const topics = ['authentication', 'database', 'api-routes'];
    return topics.slice(0, count).map(topic => ({
        topic,
        description: `Description of ${topic}`,
        hints: [`${topic}-hint1`, `${topic}-hint2`],
    }));
}

function createTestProbeResult(topic: string): TopicProbeResult {
    return {
        topic,
        foundComponents: [
            {
                id: `${topic}-service`,
                name: `${topic} Service`,
                path: `src/${topic}/`,
                purpose: `Handles ${topic}`,
                keyFiles: [`src/${topic}/index.ts`],
                evidence: `Found in src/${topic}/`,
            },
        ],
        discoveredTopics: [
            {
                topic: `${topic}-ext`,
                description: `Extension of ${topic}`,
                hints: ['ext'],
                source: topic,
            },
        ],
        dependencies: [],
        confidence: 0.85,
    };
}

function createTestScanResult(): StructuralScanResult {
    return {
        fileCount: 5000,
        domains: [
            { name: 'Frontend', path: 'packages/frontend', description: 'React UI' },
            { name: 'Backend', path: 'packages/backend', description: 'Express API' },
        ],
        projectInfo: {
            name: 'test-project',
            language: 'TypeScript',
        },
    };
}

function createTestGraph(componentIds: string[]): ComponentGraph {
    return {
        project: {
            name: 'Test',
            description: 'Test project',
            language: 'TypeScript',
            buildSystem: 'npm',
            entryPoints: [],
        },
        components: componentIds.map(id => ({
            id,
            name: id,
            path: `src/${id}/`,
            purpose: `${id} component`,
            keyFiles: [`src/${id}/index.ts`],
            dependencies: [],
            dependents: [],
            complexity: 'medium' as const,
            category: 'core',
        })),
        categories: [{ name: 'core', description: 'Core components' }],
        architectureNotes: 'Test architecture',
    };
}

beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deep-wiki-discovery-cache-test-'));
    outputDir = path.join(tempDir, 'output');
});

afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
});

// ============================================================================
// getDiscoveryCacheDir
// ============================================================================

describe('getDiscoveryCacheDir', () => {
    it('should return path under .wiki-cache/discovery/', () => {
        const dir = getDiscoveryCacheDir(outputDir);
        expect(dir).toContain('.wiki-cache');
        expect(dir).toContain('discovery');
        expect(dir.endsWith(path.join('.wiki-cache', 'discovery'))).toBe(true);
    });
});

// ============================================================================
// Seeds Cache
// ============================================================================

describe('seeds cache', () => {
    const gitHash = 'abc123';

    it('should save and load seeds (round-trip)', () => {
        const seeds = createTestSeeds();
        saveSeedsCache(seeds, outputDir, gitHash);

        const loaded = getCachedSeeds(outputDir, gitHash);
        expect(loaded).not.toBeNull();
        expect(loaded).toHaveLength(3);
        expect(loaded![0].topic).toBe('authentication');
        expect(loaded![1].topic).toBe('database');
    });

    it('should return null for git hash mismatch', () => {
        const seeds = createTestSeeds();
        saveSeedsCache(seeds, outputDir, 'old_hash');

        const loaded = getCachedSeeds(outputDir, 'new_hash');
        expect(loaded).toBeNull();
    });

    it('should return null when no cache exists', () => {
        const loaded = getCachedSeeds(outputDir, gitHash);
        expect(loaded).toBeNull();
    });

    it('should handle corrupted JSON gracefully', () => {
        const discoveryDir = getDiscoveryCacheDir(outputDir);
        fs.mkdirSync(discoveryDir, { recursive: true });
        fs.writeFileSync(path.join(discoveryDir, 'seeds.json'), 'not json!!!', 'utf-8');

        const loaded = getCachedSeeds(outputDir, gitHash);
        expect(loaded).toBeNull();
    });

    it('getCachedSeedsAny should ignore git hash', () => {
        const seeds = createTestSeeds(2);
        saveSeedsCache(seeds, outputDir, 'any_old_hash');

        const loaded = getCachedSeedsAny(outputDir);
        expect(loaded).not.toBeNull();
        expect(loaded).toHaveLength(2);
    });

    it('getCachedSeedsAny should return null when no cache exists', () => {
        const loaded = getCachedSeedsAny(outputDir);
        expect(loaded).toBeNull();
    });

    it('should overwrite existing seeds', () => {
        saveSeedsCache(createTestSeeds(2), outputDir, gitHash);
        saveSeedsCache(createTestSeeds(3), outputDir, gitHash);

        const loaded = getCachedSeeds(outputDir, gitHash);
        expect(loaded).toHaveLength(3);
    });
});

// ============================================================================
// Probe Results Cache
// ============================================================================

describe('probe results cache', () => {
    const gitHash = 'hash123';

    it('should save and load a single probe result (round-trip)', () => {
        const result = createTestProbeResult('authentication');
        saveProbeResult('authentication', result, outputDir, gitHash);

        const loaded = getCachedProbeResult('authentication', outputDir, gitHash);
        expect(loaded).not.toBeNull();
        expect(loaded!.topic).toBe('authentication');
        expect(loaded!.foundComponents).toHaveLength(1);
        expect(loaded!.confidence).toBe(0.85);
    });

    it('should return null for git hash mismatch', () => {
        saveProbeResult('auth', createTestProbeResult('auth'), outputDir, 'old');

        const loaded = getCachedProbeResult('auth', outputDir, 'new');
        expect(loaded).toBeNull();
    });

    it('should return null for non-existent topic', () => {
        const loaded = getCachedProbeResult('nonexistent', outputDir, gitHash);
        expect(loaded).toBeNull();
    });

    it('should handle corrupted probe file', () => {
        const probesDir = path.join(getDiscoveryCacheDir(outputDir), 'probes');
        fs.mkdirSync(probesDir, { recursive: true });
        fs.writeFileSync(path.join(probesDir, 'bad.json'), 'corrupted', 'utf-8');

        const loaded = getCachedProbeResult('bad', outputDir, gitHash);
        expect(loaded).toBeNull();
    });

    it('should normalize topic names for file paths', () => {
        const result = createTestProbeResult('API Routes');
        saveProbeResult('API Routes', result, outputDir, gitHash);

        const loaded = getCachedProbeResult('API Routes', outputDir, gitHash);
        expect(loaded).not.toBeNull();
        expect(loaded!.topic).toBe('API Routes');
    });
});

// ============================================================================
// scanCachedProbes
// ============================================================================

describe('scanCachedProbes', () => {
    const gitHash = 'scan_hash';

    it('should find cached probes and identify missing ones', () => {
        saveProbeResult('auth', createTestProbeResult('auth'), outputDir, gitHash);
        saveProbeResult('database', createTestProbeResult('database'), outputDir, gitHash);

        const { found, missing } = scanCachedProbes(
            ['auth', 'database', 'api'],
            outputDir,
            gitHash
        );

        expect(found.size).toBe(2);
        expect(found.has('auth')).toBe(true);
        expect(found.has('database')).toBe(true);
        expect(missing).toEqual(['api']);
    });

    it('should return all missing when no cache exists', () => {
        const { found, missing } = scanCachedProbes(
            ['auth', 'db'],
            outputDir,
            gitHash
        );

        expect(found.size).toBe(0);
        expect(missing).toEqual(['auth', 'db']);
    });

    it('should exclude stale probes (different git hash)', () => {
        saveProbeResult('auth', createTestProbeResult('auth'), outputDir, 'old_hash');
        saveProbeResult('db', createTestProbeResult('db'), outputDir, gitHash);

        const { found, missing } = scanCachedProbes(
            ['auth', 'db'],
            outputDir,
            gitHash
        );

        expect(found.size).toBe(1);
        expect(found.has('db')).toBe(true);
        expect(missing).toEqual(['auth']);
    });

    it('should handle empty topic list', () => {
        const { found, missing } = scanCachedProbes([], outputDir, gitHash);
        expect(found.size).toBe(0);
        expect(missing).toEqual([]);
    });

    it('scanCachedProbesAny should ignore git hash', () => {
        saveProbeResult('auth', createTestProbeResult('auth'), outputDir, 'old_hash');
        saveProbeResult('db', createTestProbeResult('db'), outputDir, 'another_hash');

        const { found, missing } = scanCachedProbesAny(
            ['auth', 'db', 'api'],
            outputDir
        );

        expect(found.size).toBe(2);
        expect(missing).toEqual(['api']);
    });
});

// ============================================================================
// Structural Scan Cache
// ============================================================================

describe('structural scan cache', () => {
    const gitHash = 'struct_hash';

    it('should save and load structural scan (round-trip)', () => {
        const scan = createTestScanResult();
        saveStructuralScan(scan, outputDir, gitHash);

        const loaded = getCachedStructuralScan(outputDir, gitHash);
        expect(loaded).not.toBeNull();
        expect(loaded!.fileCount).toBe(5000);
        expect(loaded!.domains).toHaveLength(2);
        expect(loaded!.domains[0].name).toBe('Frontend');
    });

    it('should return null for git hash mismatch', () => {
        saveStructuralScan(createTestScanResult(), outputDir, 'old');

        const loaded = getCachedStructuralScan(outputDir, 'new');
        expect(loaded).toBeNull();
    });

    it('should return null when no cache exists', () => {
        const loaded = getCachedStructuralScan(outputDir, gitHash);
        expect(loaded).toBeNull();
    });

    it('should handle corrupted JSON', () => {
        const discoveryDir = getDiscoveryCacheDir(outputDir);
        fs.mkdirSync(discoveryDir, { recursive: true });
        fs.writeFileSync(
            path.join(discoveryDir, 'structural-scan.json'),
            'invalid',
            'utf-8'
        );

        const loaded = getCachedStructuralScan(outputDir, gitHash);
        expect(loaded).toBeNull();
    });

    it('getCachedStructuralScanAny should ignore git hash', () => {
        saveStructuralScan(createTestScanResult(), outputDir, 'any_hash');

        const loaded = getCachedStructuralScanAny(outputDir);
        expect(loaded).not.toBeNull();
        expect(loaded!.fileCount).toBe(5000);
    });

    it('getCachedStructuralScanAny should return null when no cache', () => {
        const loaded = getCachedStructuralScanAny(outputDir);
        expect(loaded).toBeNull();
    });
});

// ============================================================================
// Domain Sub-Graph Cache
// ============================================================================

describe('domain sub-graph cache', () => {
    const gitHash = 'area_hash';

    it('should save and load domain sub-graph (round-trip)', () => {
        const graph = createTestGraph(['fe-component', 'fe-router']);
        saveDomainSubGraph('packages/frontend', graph, outputDir, gitHash);

        const loaded = getCachedDomainSubGraph('packages/frontend', outputDir, gitHash);
        expect(loaded).not.toBeNull();
        expect(loaded!.components).toHaveLength(2);
        expect(loaded!.components[0].id).toBe('fe-component');
    });

    it('should return null for git hash mismatch', () => {
        saveDomainSubGraph('frontend', createTestGraph(['fe']), outputDir, 'old');

        const loaded = getCachedDomainSubGraph('frontend', outputDir, 'new');
        expect(loaded).toBeNull();
    });

    it('should return null when no cache exists', () => {
        const loaded = getCachedDomainSubGraph('nonexistent', outputDir, gitHash);
        expect(loaded).toBeNull();
    });

    it('should handle corrupted area file', () => {
        const domainsDir = path.join(getDiscoveryCacheDir(outputDir), 'domains');
        fs.mkdirSync(domainsDir, { recursive: true });
        fs.writeFileSync(path.join(domainsDir, 'bad.json'), 'not json', 'utf-8');

        const loaded = getCachedDomainSubGraph('bad', outputDir, gitHash);
        expect(loaded).toBeNull();
    });
});

// ============================================================================
// scanCachedDomains
// ============================================================================

describe('scanCachedDomains', () => {
    const gitHash = 'areas_hash';

    it('should find cached domains and identify missing ones', () => {
        saveDomainSubGraph('frontend', createTestGraph(['fe']), outputDir, gitHash);
        saveDomainSubGraph('backend', createTestGraph(['be']), outputDir, gitHash);

        const { found, missing } = scanCachedDomains(
            ['frontend', 'backend', 'shared'],
            outputDir,
            gitHash
        );

        expect(found.size).toBe(2);
        expect(found.has('frontend')).toBe(true);
        expect(found.has('backend')).toBe(true);
        expect(missing).toEqual(['shared']);
    });

    it('should return all missing when no cache exists', () => {
        const { found, missing } = scanCachedDomains(
            ['frontend', 'backend'],
            outputDir,
            gitHash
        );

        expect(found.size).toBe(0);
        expect(missing).toEqual(['frontend', 'backend']);
    });

    it('should exclude stale domains', () => {
        saveDomainSubGraph('frontend', createTestGraph(['fe']), outputDir, 'old');
        saveDomainSubGraph('backend', createTestGraph(['be']), outputDir, gitHash);

        const { found, missing } = scanCachedDomains(
            ['frontend', 'backend'],
            outputDir,
            gitHash
        );

        expect(found.size).toBe(1);
        expect(found.has('backend')).toBe(true);
        expect(missing).toEqual(['frontend']);
    });

    it('scanCachedDomainsAny should ignore git hash', () => {
        saveDomainSubGraph('frontend', createTestGraph(['fe']), outputDir, 'hash1');
        saveDomainSubGraph('backend', createTestGraph(['be']), outputDir, 'hash2');

        const { found, missing } = scanCachedDomainsAny(
            ['frontend', 'backend', 'shared'],
            outputDir
        );

        expect(found.size).toBe(2);
        expect(missing).toEqual(['shared']);
    });

    it('should handle empty area list', () => {
        const { found, missing } = scanCachedDomains([], outputDir, gitHash);
        expect(found.size).toBe(0);
        expect(missing).toEqual([]);
    });
});

// ============================================================================
// Discovery Metadata
// ============================================================================

describe('discovery metadata', () => {
    it('should save and load metadata (round-trip)', () => {
        const metadata: DiscoveryProgressMetadata = {
            gitHash: 'meta_hash',
            timestamp: Date.now(),
            mode: 'iterative',
            currentRound: 2,
            maxRounds: 3,
            completedTopics: ['auth', 'database'],
            pendingTopics: ['caching'],
            converged: false,
            coverage: 0.65,
        };

        saveDiscoveryMetadata(metadata, outputDir);

        const loaded = getDiscoveryMetadata(outputDir);
        expect(loaded).not.toBeNull();
        expect(loaded!.mode).toBe('iterative');
        expect(loaded!.currentRound).toBe(2);
        expect(loaded!.completedTopics).toEqual(['auth', 'database']);
        expect(loaded!.coverage).toBe(0.65);
    });

    it('should return null when no metadata exists', () => {
        const loaded = getDiscoveryMetadata(outputDir);
        expect(loaded).toBeNull();
    });

    it('should handle corrupted metadata', () => {
        const discoveryDir = getDiscoveryCacheDir(outputDir);
        fs.mkdirSync(discoveryDir, { recursive: true });
        fs.writeFileSync(
            path.join(discoveryDir, '_metadata.json'),
            'invalid json',
            'utf-8'
        );

        const loaded = getDiscoveryMetadata(outputDir);
        expect(loaded).toBeNull();
    });

    it('should overwrite existing metadata', () => {
        const meta1: DiscoveryProgressMetadata = {
            gitHash: 'hash1',
            timestamp: Date.now(),
            mode: 'iterative',
            currentRound: 1,
            maxRounds: 3,
            completedTopics: ['auth'],
            pendingTopics: ['db', 'api'],
            converged: false,
            coverage: 0.3,
        };

        const meta2: DiscoveryProgressMetadata = {
            ...meta1,
            currentRound: 2,
            completedTopics: ['auth', 'db'],
            pendingTopics: ['api'],
            coverage: 0.6,
        };

        saveDiscoveryMetadata(meta1, outputDir);
        saveDiscoveryMetadata(meta2, outputDir);

        const loaded = getDiscoveryMetadata(outputDir);
        expect(loaded!.currentRound).toBe(2);
        expect(loaded!.completedTopics).toEqual(['auth', 'db']);
    });
});

// ============================================================================
// clearDiscoveryCache
// ============================================================================

describe('clearDiscoveryCache', () => {
    it('should remove all discovery cache artifacts', () => {
        const gitHash = 'clear_hash';

        // Create various cache entries
        saveSeedsCache(createTestSeeds(), outputDir, gitHash);
        saveProbeResult('auth', createTestProbeResult('auth'), outputDir, gitHash);
        saveStructuralScan(createTestScanResult(), outputDir, gitHash);
        saveDomainSubGraph('frontend', createTestGraph(['fe']), outputDir, gitHash);
        saveDiscoveryMetadata({
            gitHash,
            timestamp: Date.now(),
            mode: 'iterative',
            currentRound: 1,
            maxRounds: 3,
            completedTopics: [],
            pendingTopics: [],
            converged: false,
            coverage: 0,
        }, outputDir);

        // Verify they exist
        expect(getCachedSeeds(outputDir, gitHash)).not.toBeNull();
        expect(getCachedProbeResult('auth', outputDir, gitHash)).not.toBeNull();

        // Clear
        const cleared = clearDiscoveryCache(outputDir);
        expect(cleared).toBe(true);

        // Verify all gone
        expect(getCachedSeeds(outputDir, gitHash)).toBeNull();
        expect(getCachedProbeResult('auth', outputDir, gitHash)).toBeNull();
        expect(getCachedStructuralScan(outputDir, gitHash)).toBeNull();
        expect(getCachedDomainSubGraph('frontend', outputDir, gitHash)).toBeNull();
        expect(getDiscoveryMetadata(outputDir)).toBeNull();

        // Verify directory is gone
        const discoveryDir = getDiscoveryCacheDir(outputDir);
        expect(fs.existsSync(discoveryDir)).toBe(false);
    });

    it('should return false when no cache exists', () => {
        const cleared = clearDiscoveryCache(outputDir);
        expect(cleared).toBe(false);
    });

    it('should not affect other cache directories', () => {
        const gitHash = 'clear_hash';

        // Create discovery cache
        saveSeedsCache(createTestSeeds(), outputDir, gitHash);

        // Create a file in the parent cache dir (simulate graph cache)
        const cacheDir = path.resolve(outputDir, '.wiki-cache');
        fs.writeFileSync(
            path.join(cacheDir, 'component-graph.json'),
            '{"test": true}',
            'utf-8'
        );

        // Clear discovery cache
        clearDiscoveryCache(outputDir);

        // Graph cache should still exist
        expect(fs.existsSync(path.join(cacheDir, 'component-graph.json'))).toBe(true);
    });
});

// ============================================================================
// Edge Cases
// ============================================================================

describe('edge cases', () => {
    it('should handle missing directory gracefully on reads', () => {
        // All reads should return null without error
        expect(getCachedSeeds('/nonexistent/path', 'hash')).toBeNull();
        expect(getCachedProbeResult('topic', '/nonexistent/path', 'hash')).toBeNull();
        expect(getCachedStructuralScan('/nonexistent/path', 'hash')).toBeNull();
        expect(getCachedDomainSubGraph('area', '/nonexistent/path', 'hash')).toBeNull();
        expect(getDiscoveryMetadata('/nonexistent/path')).toBeNull();
    });

    it('should handle file with missing data field', () => {
        const discoveryDir = getDiscoveryCacheDir(outputDir);
        fs.mkdirSync(discoveryDir, { recursive: true });

        // Seeds file with no seeds field
        fs.writeFileSync(
            path.join(discoveryDir, 'seeds.json'),
            JSON.stringify({ gitHash: 'hash', timestamp: Date.now() }),
            'utf-8'
        );

        expect(getCachedSeeds(outputDir, 'hash')).toBeNull();
    });

    it('should handle probe with missing probeResult field', () => {
        const probesDir = path.join(getDiscoveryCacheDir(outputDir), 'probes');
        fs.mkdirSync(probesDir, { recursive: true });

        fs.writeFileSync(
            path.join(probesDir, 'incomplete.json'),
            JSON.stringify({ gitHash: 'hash', timestamp: Date.now() }),
            'utf-8'
        );

        expect(getCachedProbeResult('incomplete', outputDir, 'hash')).toBeNull();
    });

    it('should handle structural scan with missing scanResult field', () => {
        const discoveryDir = getDiscoveryCacheDir(outputDir);
        fs.mkdirSync(discoveryDir, { recursive: true });

        fs.writeFileSync(
            path.join(discoveryDir, 'structural-scan.json'),
            JSON.stringify({ gitHash: 'hash', timestamp: Date.now() }),
            'utf-8'
        );

        expect(getCachedStructuralScan(outputDir, 'hash')).toBeNull();
    });

    it('should handle area with missing graph field', () => {
        const domainsDir = path.join(getDiscoveryCacheDir(outputDir), 'domains');
        fs.mkdirSync(domainsDir, { recursive: true });

        fs.writeFileSync(
            path.join(domainsDir, 'incomplete.json'),
            JSON.stringify({ gitHash: 'hash', timestamp: Date.now() }),
            'utf-8'
        );

        expect(getCachedDomainSubGraph('incomplete', outputDir, 'hash')).toBeNull();
    });

    it('should handle mixed cache states in scanCachedProbes', () => {
        const gitHash = 'mixed_hash';

        // Valid
        saveProbeResult('valid', createTestProbeResult('valid'), outputDir, gitHash);

        // Stale (different hash)
        saveProbeResult('stale', createTestProbeResult('stale'), outputDir, 'old_hash');

        // Corrupted
        const probesDir = path.join(getDiscoveryCacheDir(outputDir), 'probes');
        fs.writeFileSync(
            path.join(probesDir, 'corrupted.json'),
            'invalid json',
            'utf-8'
        );

        const { found, missing } = scanCachedProbes(
            ['valid', 'stale', 'corrupted', 'absent'],
            outputDir,
            gitHash
        );

        expect(found.size).toBe(1);
        expect(found.has('valid')).toBe(true);
        expect(missing.sort()).toEqual(['absent', 'corrupted', 'stale']);
    });
});
