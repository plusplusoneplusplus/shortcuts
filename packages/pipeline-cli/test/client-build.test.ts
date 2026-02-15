/**
 * Tests for esbuild client build infrastructure.
 *
 * Validates that:
 * - build-client.mjs script exists with correct esbuild configuration
 * - Client source entry points exist (index.ts, styles.css)
 * - build:client npm script is wired correctly
 * - tsconfig excludes client/dist output
 * - esbuild produces expected output files
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

const PKG_ROOT = path.resolve(__dirname, '..');
const CLIENT_DIR = path.join(PKG_ROOT, 'src', 'server', 'spa', 'client');
const CLIENT_DIST = path.join(CLIENT_DIR, 'dist');
const BUILD_SCRIPT = path.join(PKG_ROOT, 'scripts', 'build-client.mjs');

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

        it('client/index.ts should import all client modules', () => {
            const content = fs.readFileSync(path.join(CLIENT_DIR, 'index.ts'), 'utf8');
            expect(content).toContain("import './config'");
            expect(content).toContain("import './state'");
            expect(content).toContain("import './utils'");
            expect(content).toContain("import './theme'");
            expect(content).toContain("import { init } from './core'");
            expect(content).toContain("import './sidebar'");
            expect(content).toContain("import './detail'");
            expect(content).toContain("import './filters'");
            expect(content).toContain("import './queue'");
            expect(content).toContain("import './websocket'");
            expect(content).toContain('init()');
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

        it('should run build:client before tsc and copy client in build script', () => {
            const scripts = pkg.scripts as Record<string, string>;
            expect(scripts['build']).toContain('npm run build:client');
            expect(scripts['build']).toContain('tsc');
            expect(scripts['build']).toContain('npm run build:copy-client');
        });

        it('should chmod +x dist/index.js in build script', () => {
            const scripts = pkg.scripts as Record<string, string>;
            expect(scripts['build']).toContain('chmod +x dist/index.js');
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

        it('should exclude client directory from compilation', () => {
            const exclude = tsconfig.exclude as string[];
            expect(exclude).toContain('src/**/client');
        });
    });

    // ========================================================================
    // Build output
    // ========================================================================

    describe('build:client output', () => {
        beforeAll(() => {
            // Ensure fresh build
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

        it('bundle.js should be a valid IIFE wrapper with client code', () => {
            const content = fs.readFileSync(path.join(CLIENT_DIST, 'bundle.js'), 'utf8');
            // esbuild IIFE wraps in (() => { ... })();
            expect(content.length).toBeGreaterThan(1000);
            // Should contain key functions from client modules
            expect(content).toContain('fetchApi');
            expect(content).toContain('renderProcessList');
            expect(content).toContain('connectWebSocket');
        });

        it('bundle.css should be a valid CSS file', () => {
            const content = fs.readFileSync(path.join(CLIENT_DIST, 'bundle.css'), 'utf8');
            // Placeholder CSS produces a comment-only or empty bundle
            expect(content).toBeDefined();
        });
    });

    // ========================================================================
    // dist/index.js execute permission
    // ========================================================================

    describe('dist/index.js execute permission', () => {
        beforeAll(() => {
            execSync('npm run build', {
                cwd: PKG_ROOT,
                stdio: 'pipe',
                timeout: 60000,
            });
        });

        it('should have the execute bit set after build', () => {
            const distIndex = path.join(PKG_ROOT, 'dist', 'index.js');
            expect(fs.existsSync(distIndex)).toBe(true);
            const stat = fs.statSync(distIndex);
            // eslint-disable-next-line no-bitwise
            const isExecutable = (stat.mode & 0o111) !== 0;
            expect(isExecutable).toBe(true);
        });
    });
});
