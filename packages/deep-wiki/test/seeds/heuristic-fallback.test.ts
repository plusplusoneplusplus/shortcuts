/**
 * Seeds Heuristic Fallback Tests
 *
 * Tests for directory-name-based topic seed generation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { generateHeuristicSeeds } from '../../src/seeds/heuristic-fallback';

describe('Heuristic Fallback', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deep-wiki-heuristic-test-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    describe('generateHeuristicSeeds', () => {
        it('should create topics from directory names', () => {
            // Create test directories
            fs.mkdirSync(path.join(tmpDir, 'src'));
            fs.mkdirSync(path.join(tmpDir, 'lib'));
            fs.mkdirSync(path.join(tmpDir, 'tests'));

            const seeds = generateHeuristicSeeds(tmpDir);
            expect(seeds.length).toBeGreaterThanOrEqual(3);

            const topicIds = seeds.map(s => s.topic);
            expect(topicIds).toContain('src');
            expect(topicIds).toContain('lib');
            expect(topicIds).toContain('tests');
        });

        it('should filter out common non-topic directories', () => {
            // Create excluded directories
            fs.mkdirSync(path.join(tmpDir, 'node_modules'));
            fs.mkdirSync(path.join(tmpDir, '.git'));
            fs.mkdirSync(path.join(tmpDir, 'dist'));
            fs.mkdirSync(path.join(tmpDir, 'build'));

            // Create valid directories
            fs.mkdirSync(path.join(tmpDir, 'src'));
            fs.mkdirSync(path.join(tmpDir, 'lib'));

            const seeds = generateHeuristicSeeds(tmpDir);
            const topicIds = seeds.map(s => s.topic);

            expect(topicIds).not.toContain('node-modules');
            expect(topicIds).not.toContain('git');
            expect(topicIds).not.toContain('dist');
            expect(topicIds).not.toContain('build');
            expect(topicIds).toContain('src');
            expect(topicIds).toContain('lib');
        });

        it('should normalize directory names to kebab-case', () => {
            fs.mkdirSync(path.join(tmpDir, 'api_gateway'));
            fs.mkdirSync(path.join(tmpDir, 'UserAuth'));
            fs.mkdirSync(path.join(tmpDir, 'database-layer'));

            const seeds = generateHeuristicSeeds(tmpDir);
            const topicIds = seeds.map(s => s.topic);

            expect(topicIds).toContain('api-gateway');
            // normalizeComponentId converts UserAuth to userauth (no camelCase splitting)
            expect(topicIds).toContain('userauth');
            expect(topicIds).toContain('database-layer');
        });

        it('should include directory name in hints', () => {
            fs.mkdirSync(path.join(tmpDir, 'authentication'));

            const seeds = generateHeuristicSeeds(tmpDir);
            const authSeed = seeds.find(s => s.topic === 'authentication');

            expect(authSeed).toBeDefined();
            expect(authSeed!.hints).toContain('authentication');
        });

        it('should return empty array for empty directory', () => {
            const seeds = generateHeuristicSeeds(tmpDir);
            expect(seeds).toEqual([]);
        });

        it('should skip files and only process directories', () => {
            fs.writeFileSync(path.join(tmpDir, 'file.txt'), 'content');
            fs.mkdirSync(path.join(tmpDir, 'src'));

            const seeds = generateHeuristicSeeds(tmpDir);
            const topicIds = seeds.map(s => s.topic);

            expect(topicIds).not.toContain('file-txt');
            expect(topicIds).toContain('src');
        });

        it('should handle directories with special characters', () => {
            fs.mkdirSync(path.join(tmpDir, 'api-gateway'));
            fs.mkdirSync(path.join(tmpDir, 'user_auth'));
            fs.mkdirSync(path.join(tmpDir, 'database.layer'));

            const seeds = generateHeuristicSeeds(tmpDir);
            expect(seeds.length).toBeGreaterThanOrEqual(3);

            // All topics should be valid kebab-case
            for (const seed of seeds) {
                expect(seed.topic).toMatch(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/);
            }
        });

        it('should return empty array for non-existent directory', () => {
            const seeds = generateHeuristicSeeds('/nonexistent/path/that/doesnt/exist');
            expect(seeds).toEqual([]);
        });

        it('should filter out hidden directories', () => {
            fs.mkdirSync(path.join(tmpDir, '.hidden'));
            fs.mkdirSync(path.join(tmpDir, 'visible'));

            const seeds = generateHeuristicSeeds(tmpDir);
            const topicIds = seeds.map(s => s.topic);

            expect(topicIds).not.toContain('hidden');
            expect(topicIds).toContain('visible');
        });

        it('should create description from directory name', () => {
            fs.mkdirSync(path.join(tmpDir, 'authentication'));

            const seeds = generateHeuristicSeeds(tmpDir);
            const authSeed = seeds.find(s => s.topic === 'authentication');

            expect(authSeed).toBeDefined();
            expect(authSeed!.description).toContain('authentication');
        });
    });
});
