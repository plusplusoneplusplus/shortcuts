/**
 * Seeds Heuristic Fallback Tests
 *
 * Tests for directory-name-based theme seed generation.
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
        it('should create themes from directory names', () => {
            // Create test directories
            fs.mkdirSync(path.join(tmpDir, 'src'));
            fs.mkdirSync(path.join(tmpDir, 'lib'));
            fs.mkdirSync(path.join(tmpDir, 'tests'));

            const seeds = generateHeuristicSeeds(tmpDir);
            expect(seeds.length).toBeGreaterThanOrEqual(3);

            const themeIds = seeds.map(s => s.theme);
            expect(themeIds).toContain('src');
            expect(themeIds).toContain('lib');
            expect(themeIds).toContain('tests');
        });

        it('should filter out common non-theme directories', () => {
            // Create excluded directories
            fs.mkdirSync(path.join(tmpDir, 'node_modules'));
            fs.mkdirSync(path.join(tmpDir, '.git'));
            fs.mkdirSync(path.join(tmpDir, 'dist'));
            fs.mkdirSync(path.join(tmpDir, 'build'));

            // Create valid directories
            fs.mkdirSync(path.join(tmpDir, 'src'));
            fs.mkdirSync(path.join(tmpDir, 'lib'));

            const seeds = generateHeuristicSeeds(tmpDir);
            const themeIds = seeds.map(s => s.theme);

            expect(themeIds).not.toContain('node-modules');
            expect(themeIds).not.toContain('git');
            expect(themeIds).not.toContain('dist');
            expect(themeIds).not.toContain('build');
            expect(themeIds).toContain('src');
            expect(themeIds).toContain('lib');
        });

        it('should normalize directory names to kebab-case', () => {
            fs.mkdirSync(path.join(tmpDir, 'api_gateway'));
            fs.mkdirSync(path.join(tmpDir, 'UserAuth'));
            fs.mkdirSync(path.join(tmpDir, 'database-layer'));

            const seeds = generateHeuristicSeeds(tmpDir);
            const themeIds = seeds.map(s => s.theme);

            expect(themeIds).toContain('api-gateway');
            // normalizeComponentId converts UserAuth to userauth (no camelCase splitting)
            expect(themeIds).toContain('userauth');
            expect(themeIds).toContain('database-layer');
        });

        it('should include directory name in hints', () => {
            fs.mkdirSync(path.join(tmpDir, 'authentication'));

            const seeds = generateHeuristicSeeds(tmpDir);
            const authSeed = seeds.find(s => s.theme === 'authentication');

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
            const themeIds = seeds.map(s => s.theme);

            expect(themeIds).not.toContain('file-txt');
            expect(themeIds).toContain('src');
        });

        it('should handle directories with special characters', () => {
            fs.mkdirSync(path.join(tmpDir, 'api-gateway'));
            fs.mkdirSync(path.join(tmpDir, 'user_auth'));
            fs.mkdirSync(path.join(tmpDir, 'database.layer'));

            const seeds = generateHeuristicSeeds(tmpDir);
            expect(seeds.length).toBeGreaterThanOrEqual(3);

            // All themes should be valid kebab-case
            for (const seed of seeds) {
                expect(seed.theme).toMatch(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/);
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
            const themeIds = seeds.map(s => s.theme);

            expect(themeIds).not.toContain('hidden');
            expect(themeIds).toContain('visible');
        });

        it('should create description from directory name', () => {
            fs.mkdirSync(path.join(tmpDir, 'authentication'));

            const seeds = generateHeuristicSeeds(tmpDir);
            const authSeed = seeds.find(s => s.theme === 'authentication');

            expect(authSeed).toBeDefined();
            expect(authSeed!.description).toContain('authentication');
        });
    });
});
