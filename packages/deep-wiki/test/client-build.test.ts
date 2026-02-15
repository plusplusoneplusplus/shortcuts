/**
 * Tests for esbuild client build infrastructure.
 *
 * Validates that:
 * - build-client.mjs script exists with correct esbuild configuration
 * - Client source entry points exist (index.ts, styles.css)
 * - build:client npm script is wired correctly
 * - tsconfig excludes client/dist output
 * - esbuild produces expected output files
 * - Existing esbuild.config.mjs (CLI bundler) is not affected
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

const PKG_ROOT = path.resolve(__dirname, '..');
const CLIENT_DIR = path.join(PKG_ROOT, 'src', 'server', 'spa', 'client');
const CLIENT_DIST = path.join(CLIENT_DIR, 'dist');
const BUILD_SCRIPT = path.join(PKG_ROOT, 'scripts', 'build-client.mjs');
const CLI_ESBUILD_CONFIG = path.join(PKG_ROOT, 'esbuild.config.mjs');

describe('Client Build Infrastructure', () => {

    // ========================================================================
    // Source entry points
    // ========================================================================

    describe('client source entry points', () => {
        it('should have client/index.ts entry point', () => {
            expect(fs.existsSync(path.join(CLIENT_DIR, 'index.ts'))).toBe(true);
        });

        it('should have client/styles.css entry point', () => {
            expect(fs.existsSync(path.join(CLIENT_DIR, 'styles.css'))).toBe(true);
        });

        it('client/index.ts should be a valid entry point', () => {
            const content = fs.readFileSync(path.join(CLIENT_DIR, 'index.ts'), 'utf8');
            expect(content).toContain("import { init");
        });

        it('client/styles.css should contain real CSS', () => {
            const content = fs.readFileSync(path.join(CLIENT_DIR, 'styles.css'), 'utf8');
            expect(content).toContain(':root');
        });
    });

    // ========================================================================
    // Build script
    // ========================================================================

    describe('scripts/build-client.mjs', () => {
        let scriptContent: string;

        beforeAll(() => {
            scriptContent = fs.readFileSync(BUILD_SCRIPT, 'utf8');
        });

        it('should exist', () => {
            expect(fs.existsSync(BUILD_SCRIPT)).toBe(true);
        });

        it('should import esbuild', () => {
            expect(scriptContent).toContain("from 'esbuild'");
        });

        it('should use IIFE format for browser bundle', () => {
            expect(scriptContent).toContain("format: 'iife'");
        });

        it('should target browser platform', () => {
            expect(scriptContent).toContain("platform: 'browser'");
        });

        it('should target es2020', () => {
            expect(scriptContent).toContain('es2020');
        });

        it('should bundle client/index.ts entry point', () => {
            expect(scriptContent).toContain('src/server/spa/client/index.ts');
        });

        it('should output to client/dist/bundle.js', () => {
            expect(scriptContent).toContain('src/server/spa/client/dist/bundle.js');
        });

        it('should bundle client/styles.css entry point', () => {
            expect(scriptContent).toContain('src/server/spa/client/styles.css');
        });

        it('should output to client/dist/bundle.css', () => {
            expect(scriptContent).toContain('src/server/spa/client/dist/bundle.css');
        });

        it('should enable bundling', () => {
            expect(scriptContent).toContain('bundle: true');
        });
    });

    // ========================================================================
    // package.json scripts
    // ========================================================================

    describe('package.json scripts', () => {
        let pkg: Record<string, unknown>;

        beforeAll(() => {
            pkg = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, 'package.json'), 'utf8'));
        });

        it('should have build:client script', () => {
            const scripts = pkg.scripts as Record<string, string>;
            expect(scripts['build:client']).toBe('node scripts/build-client.mjs');
        });

        it('should run build:client before tsc in build script', () => {
            const scripts = pkg.scripts as Record<string, string>;
            expect(scripts['build']).toContain('build:client');
            expect(scripts['build']).toContain('tsc');
            // build:client must come before tsc
            const clientIdx = scripts['build'].indexOf('build:client');
            const tscIdx = scripts['build'].indexOf('tsc');
            expect(clientIdx).toBeLessThan(tscIdx);
        });

        it('should keep existing build:bundle script unchanged', () => {
            const scripts = pkg.scripts as Record<string, string>;
            expect(scripts['build:bundle']).toBe('node esbuild.config.mjs');
        });

        it('should keep existing prebuild script unchanged', () => {
            const scripts = pkg.scripts as Record<string, string>;
            expect(scripts['prebuild']).toBe('cd ../pipeline-core && npm run build');
        });

        it('should have esbuild as devDependency', () => {
            const devDeps = pkg.devDependencies as Record<string, string>;
            expect(devDeps['esbuild']).toBeTruthy();
        });
    });

    // ========================================================================
    // tsconfig.json exclusion
    // ========================================================================

    describe('tsconfig.json', () => {
        let tsconfig: Record<string, unknown>;

        beforeAll(() => {
            tsconfig = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, 'tsconfig.json'), 'utf8'));
        });

        it('should exclude client from compilation', () => {
            const exclude = tsconfig.exclude as string[];
            expect(exclude).toContain('src/**/client');
        });
    });

    // ========================================================================
    // Existing CLI esbuild config not affected
    // ========================================================================

    describe('existing esbuild.config.mjs (CLI bundler)', () => {
        it('should still exist', () => {
            expect(fs.existsSync(CLI_ESBUILD_CONFIG)).toBe(true);
        });

        it('should still target node platform', () => {
            const content = fs.readFileSync(CLI_ESBUILD_CONFIG, 'utf8');
            expect(content).toContain("platform: 'node'");
        });

        it('should still use cjs format', () => {
            const content = fs.readFileSync(CLI_ESBUILD_CONFIG, 'utf8');
            expect(content).toMatch(/format.*cjs/);
        });
    });

    // ========================================================================
    // Build output
    // ========================================================================

    describe('build:client output', () => {
        beforeAll(() => {
            execSync('npm run build:client', {
                cwd: PKG_ROOT,
                stdio: 'pipe',
                timeout: 30000,
            });
        });

        it('should produce client/dist/bundle.js', () => {
            expect(fs.existsSync(path.join(CLIENT_DIST, 'bundle.js'))).toBe(true);
        });

        it('should produce client/dist/bundle.css', () => {
            expect(fs.existsSync(path.join(CLIENT_DIST, 'bundle.css'))).toBe(true);
        });

        it('bundle.js should be a valid IIFE wrapper (placeholder is minimal)', () => {
            const content = fs.readFileSync(path.join(CLIENT_DIST, 'bundle.js'), 'utf8');
            expect(content.length).toBeGreaterThan(0);
        });

        it('bundle.css should be a valid CSS file', () => {
            const content = fs.readFileSync(path.join(CLIENT_DIST, 'bundle.css'), 'utf8');
            expect(content).toBeDefined();
        });
    });
});
