/**
 * Bundle Configuration Tests
 *
 * Tests for esbuild bundling configuration and npm publishing readiness.
 * Validates that:
 * - esbuild config exists and defines correct externals
 * - package.json has proper publishing fields
 * - pipeline-core is bundled (not external)
 * - external deps are NOT bundled
 * - bundle output has correct shebang and is executable
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

const PKG_ROOT = path.resolve(__dirname, '..');
const DIST_DIR = path.join(PKG_ROOT, 'dist');
const BUNDLE_PATH = path.join(DIST_DIR, 'index.js');
const PKG_JSON_PATH = path.join(PKG_ROOT, 'package.json');
const ESBUILD_CONFIG_PATH = path.join(PKG_ROOT, 'esbuild.config.mjs');

describe('Bundle Configuration', () => {
    // ========================================================================
    // esbuild config file
    // ========================================================================

    describe('esbuild.config.mjs', () => {
        let configContent: string;

        beforeAll(() => {
            configContent = fs.readFileSync(ESBUILD_CONFIG_PATH, 'utf8');
        });

        it('should exist', () => {
            expect(fs.existsSync(ESBUILD_CONFIG_PATH)).toBe(true);
        });

        it('should mark @github/copilot-sdk as external', () => {
            expect(configContent).toContain('@github/copilot-sdk');
        });

        it('should mark commander as external', () => {
            expect(configContent).toContain('commander');
        });

        it('should mark js-yaml as external', () => {
            expect(configContent).toContain('js-yaml');
        });

        it('should NOT mark @plusplusoneplusplus/pipeline-core as external', () => {
            // Extract the EXTERNAL_DEPS array from the config
            const externalMatch = configContent.match(/EXTERNAL_DEPS\s*=\s*\[([\s\S]*?)\]/);
            expect(externalMatch).toBeTruthy();
            const externalBlock = externalMatch![1];
            expect(externalBlock).not.toContain('@plusplusoneplusplus/pipeline-core');
        });

        it('should target node18', () => {
            expect(configContent).toMatch(/target.*node18/);
        });

        it('should use cjs format', () => {
            expect(configContent).toMatch(/format.*cjs/);
        });

        it('should output to dist/index.js', () => {
            expect(configContent).toMatch(/outfile.*dist\/index\.js/);
        });

        it('should enable sourcemaps', () => {
            expect(configContent).toMatch(/sourcemap.*true/);
        });

        it('should add shebang banner', () => {
            expect(configContent).toContain('#!/usr/bin/env node');
        });

        it('should include strip-shebang plugin to avoid duplicate shebangs', () => {
            expect(configContent).toContain('strip-shebang');
        });

        it('should have platform set to node', () => {
            expect(configContent).toMatch(/platform.*node/);
        });
    });

    // ========================================================================
    // package.json publishing fields
    // ========================================================================

    describe('package.json publishing fields', () => {
        let pkg: Record<string, unknown>;

        beforeAll(() => {
            pkg = JSON.parse(fs.readFileSync(PKG_JSON_PATH, 'utf8'));
        });

        it('should have a scoped package name', () => {
            expect(pkg.name).toBe('@plusplusoneplusplus/deep-wiki');
        });

        it('should have version 1.0.0', () => {
            expect(pkg.version).toBe('1.0.0');
        });

        it('should have a description', () => {
            expect(pkg.description).toBeTruthy();
        });

        it('should have a license field', () => {
            expect(pkg.license).toBe('MIT');
        });

        it('should have files array limited to bundle output only', () => {
            expect(pkg.files).toEqual(['dist/index.js', 'dist/index.js.map']);
        });

        it('should have publishConfig with public access', () => {
            expect(pkg.publishConfig).toEqual({ access: 'public' });
        });

        it('should have bin pointing to dist/index.js', () => {
            expect(pkg.bin).toEqual({ 'deep-wiki': './dist/index.js' });
        });

        it('should have engines requiring node >= 18', () => {
            expect(pkg.engines).toEqual({ node: '>=18' });
        });

        it('should have build:bundle script', () => {
            const scripts = pkg.scripts as Record<string, string>;
            expect(scripts['build:bundle']).toBe('node esbuild.config.mjs');
        });

        it('should have prepublishOnly script that builds and tests', () => {
            const scripts = pkg.scripts as Record<string, string>;
            expect(scripts['prepublishOnly']).toContain('build:bundle');
            expect(scripts['prepublishOnly']).toContain('test:run');
        });

        it('should keep tsc build script for development', () => {
            const scripts = pkg.scripts as Record<string, string>;
            expect(scripts['build']).toBe('tsc');
        });

        it('should have @github/copilot-sdk as runtime dependency', () => {
            const deps = pkg.dependencies as Record<string, string>;
            expect(deps['@github/copilot-sdk']).toBeTruthy();
        });

        it('should have commander as runtime dependency', () => {
            const deps = pkg.dependencies as Record<string, string>;
            expect(deps['commander']).toBeTruthy();
        });

        it('should have js-yaml as runtime dependency', () => {
            const deps = pkg.dependencies as Record<string, string>;
            expect(deps['js-yaml']).toBeTruthy();
        });

        it('should NOT have @plusplusoneplusplus/pipeline-core as runtime dependency', () => {
            const deps = pkg.dependencies as Record<string, string>;
            expect(deps['@plusplusoneplusplus/pipeline-core']).toBeUndefined();
        });

        it('should have @plusplusoneplusplus/pipeline-core as devDependency', () => {
            const devDeps = pkg.devDependencies as Record<string, string>;
            expect(devDeps['@plusplusoneplusplus/pipeline-core']).toBeTruthy();
        });

        it('should have esbuild as devDependency', () => {
            const devDeps = pkg.devDependencies as Record<string, string>;
            expect(devDeps['esbuild']).toBeTruthy();
        });
    });

    // ========================================================================
    // Bundle output validation
    // ========================================================================

    describe('bundle output', () => {
        let bundleExists: boolean;
        let bundleContent: string;

        beforeAll(() => {
            // Build the bundle if it doesn't exist
            bundleExists = fs.existsSync(BUNDLE_PATH);
            if (!bundleExists) {
                try {
                    execSync('npm run build:bundle', {
                        cwd: PKG_ROOT,
                        stdio: 'pipe',
                        timeout: 30000,
                    });
                    bundleExists = fs.existsSync(BUNDLE_PATH);
                } catch {
                    // Bundle build failed — tests will report it
                }
            }
            if (bundleExists) {
                bundleContent = fs.readFileSync(BUNDLE_PATH, 'utf8');
            }
        });

        it('should produce dist/index.js', () => {
            expect(bundleExists).toBe(true);
        });

        it('should produce dist/index.js.map (sourcemap)', () => {
            expect(fs.existsSync(path.join(DIST_DIR, 'index.js.map'))).toBe(true);
        });

        it('should start with exactly one shebang line', () => {
            const lines = bundleContent.split('\n');
            expect(lines[0]).toBe('#!/usr/bin/env node');
            // Second line must NOT be another shebang
            expect(lines[1]).not.toMatch(/^#!/);
        });

        it('should contain bundled pipeline-core code (extractJSON)', () => {
            // extractJSON is a function from pipeline-core that should be inlined
            expect(bundleContent).toContain('extractJSON');
        });

        it('should contain bundled pipeline-core code (CopilotSDKService)', () => {
            expect(bundleContent).toContain('CopilotSDKService');
        });

        it('should NOT contain a require for @plusplusoneplusplus/pipeline-core', () => {
            expect(bundleContent).not.toMatch(
                /require\(["']@plusplusoneplusplus\/pipeline-core["']\)/
            );
        });

        it('should externalize commander (require at runtime)', () => {
            expect(bundleContent).toMatch(/require\(["']commander["']\)/);
        });

        it('should externalize js-yaml (require at runtime)', () => {
            expect(bundleContent).toMatch(/require\(["']js-yaml["']\)/);
        });

        it('should be a reasonable size (< 2MB)', () => {
            const stats = fs.statSync(BUNDLE_PATH);
            const sizeMB = stats.size / (1024 * 1024);
            expect(sizeMB).toBeLessThan(2);
        });

        it('should be a non-trivial size (> 100KB — pipeline-core is bundled)', () => {
            const stats = fs.statSync(BUNDLE_PATH);
            const sizeKB = stats.size / 1024;
            expect(sizeKB).toBeGreaterThan(100);
        });

        it('should be runnable with node --help', () => {
            const result = execSync(`node "${BUNDLE_PATH}" --help`, {
                cwd: PKG_ROOT,
                timeout: 10000,
                encoding: 'utf8',
            });
            expect(result).toContain('deep-wiki');
            expect(result).toContain('discover');
            expect(result).toContain('generate');
            expect(result).toContain('serve');
        });

        it('should show version when run with --version', () => {
            const result = execSync(`node "${BUNDLE_PATH}" --version`, {
                cwd: PKG_ROOT,
                timeout: 10000,
                encoding: 'utf8',
            });
            expect(result.trim()).toMatch(/^\d+\.\d+\.\d+/);
        });

        it('should show discover subcommand help', () => {
            const result = execSync(`node "${BUNDLE_PATH}" discover --help`, {
                cwd: PKG_ROOT,
                timeout: 10000,
                encoding: 'utf8',
            });
            expect(result).toContain('repo-path');
            expect(result).toContain('--output');
            expect(result).toContain('--model');
        });

        it('should show generate subcommand help', () => {
            const result = execSync(`node "${BUNDLE_PATH}" generate --help`, {
                cwd: PKG_ROOT,
                timeout: 10000,
                encoding: 'utf8',
            });
            expect(result).toContain('repo-path');
            expect(result).toContain('--concurrency');
            expect(result).toContain('--depth');
            expect(result).toContain('--phase');
        });

        it('should show serve subcommand help', () => {
            const result = execSync(`node "${BUNDLE_PATH}" serve --help`, {
                cwd: PKG_ROOT,
                timeout: 10000,
                encoding: 'utf8',
            });
            expect(result).toContain('wiki-dir');
            expect(result).toContain('--port');
            expect(result).toContain('--no-ai');
        });
    });

    // ========================================================================
    // Dependency chain validation
    // ========================================================================

    describe('dependency chain', () => {
        let pkg: Record<string, unknown>;
        let pipelineCorePkg: Record<string, unknown>;

        beforeAll(() => {
            pkg = JSON.parse(fs.readFileSync(PKG_JSON_PATH, 'utf8'));
            pipelineCorePkg = JSON.parse(
                fs.readFileSync(
                    path.join(PKG_ROOT, '..', 'pipeline-core', 'package.json'),
                    'utf8'
                )
            );
        });

        it('pipeline-core @github/copilot-sdk version should match deep-wiki', () => {
            const coreDeps = pipelineCorePkg.dependencies as Record<string, string>;
            const deepDeps = pkg.dependencies as Record<string, string>;
            expect(deepDeps['@github/copilot-sdk']).toBe(coreDeps['@github/copilot-sdk']);
        });

        it('all pipeline-core runtime deps should be covered by deep-wiki deps or bundle', () => {
            const coreDeps = pipelineCorePkg.dependencies as Record<string, string>;
            const deepDeps = pkg.dependencies as Record<string, string>;

            for (const dep of Object.keys(coreDeps)) {
                // Each pipeline-core dep should either:
                // 1. Be in deep-wiki's runtime deps (external)
                // 2. Be pipeline-core itself (bundled, not on npm)
                if (dep === '@plusplusoneplusplus/pipeline-core') {
                    continue;
                }
                expect(deepDeps[dep]).toBeTruthy();
            }
        });
    });
});
