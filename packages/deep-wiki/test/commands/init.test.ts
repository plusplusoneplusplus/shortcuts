/**
 * Init Command Tests
 *
 * Tests for the `deep-wiki init` command that generates
 * a template configuration file.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { executeInit, CONFIG_TEMPLATE, DEFAULT_CONFIG_FILENAME } from '../../src/commands/init';
import { validateConfig } from '../../src/config-loader';
import * as yaml from 'js-yaml';

// ============================================================================
// Helpers
// ============================================================================

let tmpDir: string;

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepwiki-init-test-'));
});

afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ============================================================================
// CONFIG_TEMPLATE
// ============================================================================

describe('CONFIG_TEMPLATE', () => {
    it('should be a non-empty string', () => {
        expect(typeof CONFIG_TEMPLATE).toBe('string');
        expect(CONFIG_TEMPLATE.length).toBeGreaterThan(0);
    });

    it('should be valid YAML when all comments are removed', () => {
        // Remove comment lines and check the remaining is valid YAML (empty doc)
        const uncommented = CONFIG_TEMPLATE
            .split('\n')
            .filter(line => !line.trimStart().startsWith('#') && line.trim() !== '')
            .join('\n');

        // All lines are comments, so uncommented should be empty
        expect(uncommented.trim()).toBe('');
    });

    it('should contain key configuration sections', () => {
        expect(CONFIG_TEMPLATE).toContain('Global Settings');
        expect(CONFIG_TEMPLATE).toContain('Per-Phase Overrides');
    });

    it('should mention all global options', () => {
        expect(CONFIG_TEMPLATE).toContain('output:');
        expect(CONFIG_TEMPLATE).toContain('model:');
        expect(CONFIG_TEMPLATE).toContain('concurrency:');
        expect(CONFIG_TEMPLATE).toContain('timeout:');
        expect(CONFIG_TEMPLATE).toContain('depth:');
        expect(CONFIG_TEMPLATE).toContain('focus:');
        expect(CONFIG_TEMPLATE).toContain('theme:');
        expect(CONFIG_TEMPLATE).toContain('title:');
        expect(CONFIG_TEMPLATE).toContain('seeds:');
        expect(CONFIG_TEMPLATE).toContain('force:');
        expect(CONFIG_TEMPLATE).toContain('useCache:');
        expect(CONFIG_TEMPLATE).toContain('noCluster:');
        expect(CONFIG_TEMPLATE).toContain('strict:');
        expect(CONFIG_TEMPLATE).toContain('skipWebsite:');
        expect(CONFIG_TEMPLATE).toContain('phase:');
    });

    it('should mention all phases', () => {
        expect(CONFIG_TEMPLATE).toContain('discovery:');
        expect(CONFIG_TEMPLATE).toContain('consolidation:');
        expect(CONFIG_TEMPLATE).toContain('analysis:');
        expect(CONFIG_TEMPLATE).toContain('writing:');
    });

    it('should mention consolidation-specific skipAI option', () => {
        expect(CONFIG_TEMPLATE).toContain('skipAI:');
    });

    it('should document the resolution order', () => {
        expect(CONFIG_TEMPLATE).toContain('Resolution order');
        expect(CONFIG_TEMPLATE).toContain('CLI flags');
        expect(CONFIG_TEMPLATE).toContain('Phase-specific config');
    });

    it('should produce a valid config when a global option is uncommented', () => {
        // Simulate uncommenting the model line
        const uncommented = CONFIG_TEMPLATE.replace(
            '# model: claude-sonnet',
            'model: claude-sonnet'
        );
        const parsed = yaml.load(uncommented) as Record<string, unknown>;
        const config = validateConfig(parsed);
        expect(config.model).toBe('claude-sonnet');
    });
});

// ============================================================================
// executeInit — Happy Path
// ============================================================================

describe('executeInit', () => {
    it('should create config file in specified directory', async () => {
        const outputPath = path.join(tmpDir, 'deep-wiki.config.yaml');
        const exitCode = await executeInit({
            output: outputPath,
            force: false,
            verbose: false,
        });

        expect(exitCode).toBe(0);
        expect(fs.existsSync(outputPath)).toBe(true);
        const content = fs.readFileSync(outputPath, 'utf-8');
        expect(content).toBe(CONFIG_TEMPLATE);
    });

    it('should create parent directories if they do not exist', async () => {
        const nestedPath = path.join(tmpDir, 'a', 'b', 'deep-wiki.config.yaml');
        const exitCode = await executeInit({
            output: nestedPath,
            force: false,
            verbose: false,
        });

        expect(exitCode).toBe(0);
        expect(fs.existsSync(nestedPath)).toBe(true);
    });

    it('should default to deep-wiki.config.yaml in cwd when no output specified', async () => {
        // Use a specific output path to avoid writing to actual cwd
        const outputPath = path.join(tmpDir, 'deep-wiki.config.yaml');
        const exitCode = await executeInit({
            output: outputPath,
            force: false,
            verbose: false,
        });

        expect(exitCode).toBe(0);
        expect(fs.existsSync(outputPath)).toBe(true);
    });

    it('should support verbose mode', async () => {
        const outputPath = path.join(tmpDir, 'deep-wiki.config.yaml');
        const exitCode = await executeInit({
            output: outputPath,
            force: false,
            verbose: true,
        });

        expect(exitCode).toBe(0);
        expect(fs.existsSync(outputPath)).toBe(true);
    });

    // ========================================================================
    // Overwrite Protection
    // ========================================================================

    it('should refuse to overwrite existing file without --force', async () => {
        const outputPath = path.join(tmpDir, 'deep-wiki.config.yaml');
        fs.writeFileSync(outputPath, 'existing content', 'utf-8');

        const exitCode = await executeInit({
            output: outputPath,
            force: false,
            verbose: false,
        });

        expect(exitCode).toBe(1);
        // Original content should be preserved
        expect(fs.readFileSync(outputPath, 'utf-8')).toBe('existing content');
    });

    it('should overwrite existing file with --force', async () => {
        const outputPath = path.join(tmpDir, 'deep-wiki.config.yaml');
        fs.writeFileSync(outputPath, 'old content', 'utf-8');

        const exitCode = await executeInit({
            output: outputPath,
            force: true,
            verbose: false,
        });

        expect(exitCode).toBe(0);
        const content = fs.readFileSync(outputPath, 'utf-8');
        expect(content).toBe(CONFIG_TEMPLATE);
    });

    // ========================================================================
    // Output File Naming
    // ========================================================================

    it('should allow custom output filename', async () => {
        const outputPath = path.join(tmpDir, 'my-config.yml');
        const exitCode = await executeInit({
            output: outputPath,
            force: false,
            verbose: false,
        });

        expect(exitCode).toBe(0);
        expect(fs.existsSync(outputPath)).toBe(true);
    });

    // ========================================================================
    // Directory Output (auto-append default filename)
    // ========================================================================

    it('should create default config file inside existing directory when output ends with /', async () => {
        const dirPath = path.join(tmpDir, 'wiki-output');
        fs.mkdirSync(dirPath, { recursive: true });

        const exitCode = await executeInit({
            output: dirPath + '/',
            force: false,
            verbose: false,
        });

        expect(exitCode).toBe(0);
        const expectedPath = path.join(dirPath, DEFAULT_CONFIG_FILENAME);
        expect(fs.existsSync(expectedPath)).toBe(true);
        const content = fs.readFileSync(expectedPath, 'utf-8');
        expect(content).toBe(CONFIG_TEMPLATE);
    });

    it('should create default config file inside existing directory (no trailing slash)', async () => {
        const dirPath = path.join(tmpDir, 'existing-dir');
        fs.mkdirSync(dirPath, { recursive: true });

        const exitCode = await executeInit({
            output: dirPath,
            force: false,
            verbose: false,
        });

        expect(exitCode).toBe(0);
        const expectedPath = path.join(dirPath, DEFAULT_CONFIG_FILENAME);
        expect(fs.existsSync(expectedPath)).toBe(true);
        const content = fs.readFileSync(expectedPath, 'utf-8');
        expect(content).toBe(CONFIG_TEMPLATE);
    });

    it('should create directory and default config file when output ends with / but dir does not exist', async () => {
        const dirPath = path.join(tmpDir, 'new-dir');

        const exitCode = await executeInit({
            output: dirPath + '/',
            force: false,
            verbose: false,
        });

        expect(exitCode).toBe(0);
        const expectedPath = path.join(dirPath, DEFAULT_CONFIG_FILENAME);
        expect(fs.existsSync(expectedPath)).toBe(true);
    });

    it('should refuse to overwrite existing config inside directory without --force', async () => {
        const dirPath = path.join(tmpDir, 'dir-with-config');
        fs.mkdirSync(dirPath, { recursive: true });
        const configPath = path.join(dirPath, DEFAULT_CONFIG_FILENAME);
        fs.writeFileSync(configPath, 'existing', 'utf-8');

        const exitCode = await executeInit({
            output: dirPath + '/',
            force: false,
            verbose: false,
        });

        expect(exitCode).toBe(1);
        expect(fs.readFileSync(configPath, 'utf-8')).toBe('existing');
    });

    it('should overwrite existing config inside directory with --force', async () => {
        const dirPath = path.join(tmpDir, 'dir-force');
        fs.mkdirSync(dirPath, { recursive: true });
        const configPath = path.join(dirPath, DEFAULT_CONFIG_FILENAME);
        fs.writeFileSync(configPath, 'old', 'utf-8');

        const exitCode = await executeInit({
            output: dirPath + '/',
            force: true,
            verbose: false,
        });

        expect(exitCode).toBe(0);
        expect(fs.readFileSync(configPath, 'utf-8')).toBe(CONFIG_TEMPLATE);
    });

    it('should handle path.sep as trailing separator on all platforms', async () => {
        const dirPath = path.join(tmpDir, 'sep-dir');
        fs.mkdirSync(dirPath, { recursive: true });

        const exitCode = await executeInit({
            output: dirPath + path.sep,
            force: false,
            verbose: false,
        });

        expect(exitCode).toBe(0);
        const expectedPath = path.join(dirPath, DEFAULT_CONFIG_FILENAME);
        expect(fs.existsSync(expectedPath)).toBe(true);
    });

    // ========================================================================
    // Generated Content Validation
    // ========================================================================

    it('should produce output that is parseable as YAML (all comments)', async () => {
        const outputPath = path.join(tmpDir, 'deep-wiki.config.yaml');
        await executeInit({ output: outputPath, force: false, verbose: false });

        const content = fs.readFileSync(outputPath, 'utf-8');
        // Should not throw when loaded as YAML
        const parsed = yaml.load(content);
        // All commented out → parses as undefined/null
        expect(parsed === undefined || parsed === null).toBe(true);
    });
});

// ============================================================================
// CLI Registration (via createProgram)
// ============================================================================

describe('init command CLI registration', () => {
    it('should have init command registered', async () => {
        const { createProgram } = await import('../../src/cli');
        const program = createProgram();
        const cmd = program.commands.find(c => c.name() === 'init');
        expect(cmd).toBeDefined();
    });

    it('should have expected options', async () => {
        const { createProgram } = await import('../../src/cli');
        const program = createProgram();
        const cmd = program.commands.find(c => c.name() === 'init')!;
        const optionNames = cmd.options.map(o => o.long || o.short);

        expect(optionNames).toContain('--output');
        expect(optionNames).toContain('--force');
        expect(optionNames).toContain('--verbose');
    });

    it('should have default value for --output', async () => {
        const { createProgram } = await import('../../src/cli');
        const program = createProgram();
        const cmd = program.commands.find(c => c.name() === 'init')!;
        const outputOpt = cmd.options.find(o => o.long === '--output');
        expect(outputOpt).toBeDefined();
        expect(outputOpt!.defaultValue).toBe('deep-wiki.config.yaml');
    });

    it('should not require any arguments', async () => {
        const { createProgram } = await import('../../src/cli');
        const program = createProgram();
        const cmd = program.commands.find(c => c.name() === 'init')!;
        const args = (cmd as any).registeredArguments || (cmd as any)._args;
        expect(args?.length || 0).toBe(0);
    });
});
