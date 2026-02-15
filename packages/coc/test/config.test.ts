/**
 * Config Tests
 *
 * Tests for CLI configuration loading, validation, and resolution.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const _realHomedir = os.homedir;
vi.mock('os', async (importOriginal) => {
    const actual = await importOriginal<typeof os>();
    return { ...actual, homedir: vi.fn(actual.homedir) };
});

import {
    CONFIG_FILE_NAME,
    COC_DIR,
    LEGACY_CONFIG_FILE_NAME,
    DEFAULT_CONFIG,
    getConfigFilePath,
    getLegacyConfigFilePath,
    loadConfigFile,
    migrateConfigIfNeeded,
    resolveConfig,
    mergeConfig,
} from '../src/config';
import type { CLIConfig, ResolvedCLIConfig } from '../src/config';

describe('Config', () => {
    // ========================================================================
    // Constants
    // ========================================================================

    describe('Constants', () => {
        it('should have correct config file name', () => {
            expect(CONFIG_FILE_NAME).toBe('config.yaml');
        });

        it('should have correct legacy config file name', () => {
            expect(LEGACY_CONFIG_FILE_NAME).toBe('.coc.yaml');
        });

        it('should have correct coc directory name', () => {
            expect(COC_DIR).toBe('.coc');
        });

        it('should have correct default config', () => {
            expect(DEFAULT_CONFIG.parallel).toBe(5);
            expect(DEFAULT_CONFIG.output).toBe('table');
            expect(DEFAULT_CONFIG.approvePermissions).toBe(false);
            expect(DEFAULT_CONFIG.model).toBeUndefined();
            expect(DEFAULT_CONFIG.mcpConfig).toBeUndefined();
            expect(DEFAULT_CONFIG.timeout).toBeUndefined();
        });
    });

    // ========================================================================
    // getConfigFilePath
    // ========================================================================

    describe('getConfigFilePath', () => {
        it('should return path in ~/.coc/ directory', () => {
            const result = getConfigFilePath();
            expect(result).toBe(path.join(os.homedir(), '.coc', 'config.yaml'));
        });
    });

    // ========================================================================
    // getLegacyConfigFilePath
    // ========================================================================

    describe('getLegacyConfigFilePath', () => {
        it('should return legacy path in home directory', () => {
            const result = getLegacyConfigFilePath();
            expect(result).toBe(path.join(os.homedir(), '.coc.yaml'));
        });
    });

    // ========================================================================
    // loadConfigFile
    // ========================================================================

    describe('loadConfigFile', () => {
        let tmpDir: string;

        beforeEach(() => {
            tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-config-'));
        });

        afterEach(() => {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        });

        it('should return undefined for non-existent file', () => {
            const result = loadConfigFile(path.join(tmpDir, 'nonexistent.yaml'));
            expect(result).toBeUndefined();
        });

        it('should load valid YAML config', () => {
            const configPath = path.join(tmpDir, 'config.yaml');
            fs.writeFileSync(configPath, `
model: gpt-4
parallel: 10
output: json
approvePermissions: true
mcpConfig: ~/.copilot/mcp-config.json
timeout: 300
`);
            const result = loadConfigFile(configPath);
            expect(result).toBeDefined();
            expect(result!.model).toBe('gpt-4');
            expect(result!.parallel).toBe(10);
            expect(result!.output).toBe('json');
            expect(result!.approvePermissions).toBe(true);
            expect(result!.mcpConfig).toBe('~/.copilot/mcp-config.json');
            expect(result!.timeout).toBe(300);
        });

        it('should handle partial config', () => {
            const configPath = path.join(tmpDir, 'partial.yaml');
            fs.writeFileSync(configPath, 'model: claude-sonnet\n');
            const result = loadConfigFile(configPath);
            expect(result).toBeDefined();
            expect(result!.model).toBe('claude-sonnet');
            expect(result!.parallel).toBeUndefined();
            expect(result!.output).toBeUndefined();
        });

        it('should return undefined for invalid YAML', () => {
            const configPath = path.join(tmpDir, 'invalid.yaml');
            fs.writeFileSync(configPath, '{{invalid yaml content]]');
            const result = loadConfigFile(configPath);
            expect(result).toBeUndefined();
        });

        it('should reject invalid parallel value (string)', () => {
            const configPath = path.join(tmpDir, 'bad-parallel.yaml');
            fs.writeFileSync(configPath, 'parallel: "not-a-number"\n');
            const result = loadConfigFile(configPath);
            expect(result).toBeDefined();
            expect(result!.parallel).toBeUndefined();
        });

        it('should reject negative parallel value', () => {
            const configPath = path.join(tmpDir, 'negative-parallel.yaml');
            fs.writeFileSync(configPath, 'parallel: -5\n');
            const result = loadConfigFile(configPath);
            expect(result).toBeDefined();
            expect(result!.parallel).toBeUndefined();
        });

        it('should reject invalid output format', () => {
            const configPath = path.join(tmpDir, 'bad-output.yaml');
            fs.writeFileSync(configPath, 'output: xml\n');
            const result = loadConfigFile(configPath);
            expect(result).toBeDefined();
            expect(result!.output).toBeUndefined();
        });

        it('should accept valid output formats', () => {
            for (const fmt of ['table', 'json', 'csv', 'markdown']) {
                const configPath = path.join(tmpDir, `output-${fmt}.yaml`);
                fs.writeFileSync(configPath, `output: ${fmt}\n`);
                const result = loadConfigFile(configPath);
                expect(result).toBeDefined();
                expect(result!.output).toBe(fmt);
            }
        });

        it('should handle empty file', () => {
            const configPath = path.join(tmpDir, 'empty.yaml');
            fs.writeFileSync(configPath, '');
            const result = loadConfigFile(configPath);
            expect(result).toBeUndefined();
        });

        it('should handle file with only comments', () => {
            const configPath = path.join(tmpDir, 'comments.yaml');
            fs.writeFileSync(configPath, '# This is just a comment\n');
            const result = loadConfigFile(configPath);
            expect(result).toBeUndefined();
        });

        it('should floor fractional parallel values', () => {
            const configPath = path.join(tmpDir, 'float.yaml');
            fs.writeFileSync(configPath, 'parallel: 7.8\n');
            const result = loadConfigFile(configPath);
            expect(result).toBeDefined();
            expect(result!.parallel).toBe(7);
        });

        it('should reject non-boolean approvePermissions', () => {
            const configPath = path.join(tmpDir, 'bad-bool.yaml');
            fs.writeFileSync(configPath, 'approvePermissions: "yes"\n');
            const result = loadConfigFile(configPath);
            expect(result).toBeDefined();
            expect(result!.approvePermissions).toBeUndefined();
        });

        it('should reject negative timeout', () => {
            const configPath = path.join(tmpDir, 'bad-timeout.yaml');
            fs.writeFileSync(configPath, 'timeout: -10\n');
            const result = loadConfigFile(configPath);
            expect(result).toBeDefined();
            expect(result!.timeout).toBeUndefined();
        });

        it('should bypass fallback and migration when explicit configPath is provided', () => {
            const configPath = path.join(tmpDir, 'custom.yaml');
            fs.writeFileSync(configPath, 'model: custom-model\n');
            const result = loadConfigFile(configPath);
            expect(result).toBeDefined();
            expect(result!.model).toBe('custom-model');
        });
    });

    // ========================================================================
    // Config location fallback and migration
    // ========================================================================

    describe('Config location fallback and migration', () => {
        let fakeHome: string;

        beforeEach(() => {
            fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-home-'));
            vi.mocked(os.homedir).mockReturnValue(fakeHome);
        });

        afterEach(() => {
            vi.mocked(os.homedir).mockImplementation(_realHomedir);
            fs.rmSync(fakeHome, { recursive: true, force: true });
        });

        it('should load from new location (~/.coc/config.yaml)', () => {
            const cocDir = path.join(fakeHome, '.coc');
            fs.mkdirSync(cocDir, { recursive: true });
            fs.writeFileSync(path.join(cocDir, 'config.yaml'), 'model: new-location\n');

            const result = loadConfigFile();
            expect(result).toBeDefined();
            expect(result!.model).toBe('new-location');
        });

        it('should fall back to legacy location (~/.coc.yaml) when new location absent', () => {
            fs.writeFileSync(path.join(fakeHome, '.coc.yaml'), 'model: legacy-location\n');

            const result = loadConfigFile();
            expect(result).toBeDefined();
            expect(result!.model).toBe('legacy-location');
        });

        it('should prefer new location over legacy when both exist', () => {
            const cocDir = path.join(fakeHome, '.coc');
            fs.mkdirSync(cocDir, { recursive: true });
            fs.writeFileSync(path.join(cocDir, 'config.yaml'), 'model: from-new\n');
            fs.writeFileSync(path.join(fakeHome, '.coc.yaml'), 'model: from-legacy\n');

            const result = loadConfigFile();
            expect(result).toBeDefined();
            expect(result!.model).toBe('from-new');
        });

        it('should auto-migrate legacy config to new location', () => {
            fs.writeFileSync(path.join(fakeHome, '.coc.yaml'), 'model: migrated\ntimeout: 60\n');

            loadConfigFile();

            const newPath = path.join(fakeHome, '.coc', 'config.yaml');
            expect(fs.existsSync(newPath)).toBe(true);
            const content = fs.readFileSync(newPath, 'utf-8');
            expect(content).toContain('model: migrated');
            expect(content).toContain('timeout: 60');
        });

        it('should not overwrite new config during migration when both exist', () => {
            const cocDir = path.join(fakeHome, '.coc');
            fs.mkdirSync(cocDir, { recursive: true });
            fs.writeFileSync(path.join(cocDir, 'config.yaml'), 'model: keep-this\n');
            fs.writeFileSync(path.join(fakeHome, '.coc.yaml'), 'model: do-not-overwrite\n');

            migrateConfigIfNeeded();

            const content = fs.readFileSync(path.join(cocDir, 'config.yaml'), 'utf-8');
            expect(content).toContain('model: keep-this');
        });

        it('should return undefined when neither location has config', () => {
            const result = loadConfigFile();
            expect(result).toBeUndefined();
        });

        it('should preserve legacy file after migration (copy, not move)', () => {
            fs.writeFileSync(path.join(fakeHome, '.coc.yaml'), 'model: preserved\n');

            loadConfigFile();

            expect(fs.existsSync(path.join(fakeHome, '.coc.yaml'))).toBe(true);
        });
    });

    // ========================================================================
    // mergeConfig
    // ========================================================================

    describe('mergeConfig', () => {
        it('should return base config when no override', () => {
            const result = mergeConfig(DEFAULT_CONFIG);
            expect(result).toEqual(DEFAULT_CONFIG);
        });

        it('should return base config when override is undefined', () => {
            const result = mergeConfig(DEFAULT_CONFIG, undefined);
            expect(result).toEqual(DEFAULT_CONFIG);
        });

        it('should override specific fields', () => {
            const override: CLIConfig = { model: 'gpt-4', parallel: 10 };
            const result = mergeConfig(DEFAULT_CONFIG, override);
            expect(result.model).toBe('gpt-4');
            expect(result.parallel).toBe(10);
            expect(result.output).toBe('table'); // Default preserved
        });

        it('should override all fields', () => {
            const override: CLIConfig = {
                model: 'claude',
                parallel: 20,
                output: 'json',
                approvePermissions: true,
                mcpConfig: '/path/to/mcp.json',
                timeout: 600,
            };
            const result = mergeConfig(DEFAULT_CONFIG, override);
            expect(result.model).toBe('claude');
            expect(result.parallel).toBe(20);
            expect(result.output).toBe('json');
            expect(result.approvePermissions).toBe(true);
            expect(result.mcpConfig).toBe('/path/to/mcp.json');
            expect(result.timeout).toBe(600);
        });

        it('should not let undefined override overwrite base', () => {
            const base: ResolvedCLIConfig = {
                model: 'gpt-4',
                parallel: 10,
                output: 'json',
                approvePermissions: true,
            };
            const override: CLIConfig = {};
            const result = mergeConfig(base, override);
            expect(result.model).toBe('gpt-4');
            expect(result.parallel).toBe(10);
        });
    });

    // ========================================================================
    // resolveConfig
    // ========================================================================

    describe('resolveConfig', () => {
        let tmpDir: string;

        beforeEach(() => {
            tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-resolve-'));
        });

        afterEach(() => {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        });

        it('should return defaults when no config file exists', () => {
            const result = resolveConfig(path.join(tmpDir, 'nonexistent.yaml'));
            expect(result).toEqual(DEFAULT_CONFIG);
        });

        it('should merge config file with defaults', () => {
            const configPath = path.join(tmpDir, 'config.yaml');
            fs.writeFileSync(configPath, 'model: gpt-4\noutput: csv\n');
            const result = resolveConfig(configPath);
            expect(result.model).toBe('gpt-4');
            expect(result.output).toBe('csv');
            expect(result.parallel).toBe(5); // Default
        });
    });
});
