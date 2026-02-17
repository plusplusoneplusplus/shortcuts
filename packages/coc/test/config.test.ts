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
    CONFIG_SOURCE_KEYS,
    getConfigFilePath,
    getLegacyConfigFilePath,
    loadConfigFile,
    migrateConfigIfNeeded,
    resolveConfig,
    mergeConfig,
    getResolvedConfigWithSource,
    writeConfigFile,
} from '../src/config';
import type { CLIConfig, ResolvedCLIConfig, ConfigSourceKey } from '../src/config';

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
            expect(DEFAULT_CONFIG.persist).toBe(true);
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

        it('should load persist: true', () => {
            const configPath = path.join(tmpDir, 'persist-true.yaml');
            fs.writeFileSync(configPath, 'persist: true\n');
            const result = loadConfigFile(configPath);
            expect(result).toBeDefined();
            expect(result!.persist).toBe(true);
        });

        it('should load persist: false', () => {
            const configPath = path.join(tmpDir, 'persist-false.yaml');
            fs.writeFileSync(configPath, 'persist: false\n');
            const result = loadConfigFile(configPath);
            expect(result).toBeDefined();
            expect(result!.persist).toBe(false);
        });

        it('should reject non-boolean persist', () => {
            const configPath = path.join(tmpDir, 'bad-persist.yaml');
            fs.writeFileSync(configPath, 'persist: "yes"\n');
            const result = loadConfigFile(configPath);
            expect(result).toBeDefined();
            expect(result!.persist).toBeUndefined();
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
                persist: false,
            };
            const result = mergeConfig(DEFAULT_CONFIG, override);
            expect(result.model).toBe('claude');
            expect(result.parallel).toBe(20);
            expect(result.output).toBe('json');
            expect(result.approvePermissions).toBe(true);
            expect(result.mcpConfig).toBe('/path/to/mcp.json');
            expect(result.timeout).toBe(600);
            expect(result.persist).toBe(false);
        });

        it('should not let undefined override overwrite base', () => {
            const base: ResolvedCLIConfig = {
                model: 'gpt-4',
                parallel: 10,
                output: 'json',
                approvePermissions: true,
                persist: false,
            };
            const override: CLIConfig = {};
            const result = mergeConfig(base, override);
            expect(result.model).toBe('gpt-4');
            expect(result.parallel).toBe(10);
            expect(result.persist).toBe(false);
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

    // ========================================================================
    // getResolvedConfigWithSource
    // ========================================================================

    describe('getResolvedConfigWithSource', () => {
        let tmpDir: string;
        let fakeHome: string;

        beforeEach(() => {
            tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-source-'));
            fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-home-src-'));
            vi.mocked(os.homedir).mockReturnValue(fakeHome);
        });

        afterEach(() => {
            fs.rmSync(tmpDir, { recursive: true, force: true });
            fs.rmSync(fakeHome, { recursive: true, force: true });
        });

        it('should mark all sources as default when no config file exists', () => {
            const result = getResolvedConfigWithSource(path.join(tmpDir, 'nonexistent.yaml'));
            expect(result.resolved.parallel).toBe(DEFAULT_CONFIG.parallel);
            expect(result.resolved.output).toBe(DEFAULT_CONFIG.output);
            expect(result.resolved.approvePermissions).toBe(DEFAULT_CONFIG.approvePermissions);
            expect(result.resolved.persist).toBe(DEFAULT_CONFIG.persist);
            for (const key of CONFIG_SOURCE_KEYS) {
                expect(result.sources[key]).toBe('default');
            }
        });

        it('should mark overridden top-level fields as file', () => {
            const configPath = path.join(tmpDir, 'config.yaml');
            fs.writeFileSync(configPath, 'model: gpt-4\nparallel: 10\noutput: json\n');
            const result = getResolvedConfigWithSource(configPath);

            expect(result.sources['model']).toBe('file');
            expect(result.sources['parallel']).toBe('file');
            expect(result.sources['output']).toBe('file');
            expect(result.sources['approvePermissions']).toBe('default');
            expect(result.sources['mcpConfig']).toBe('default');
            expect(result.sources['timeout']).toBe('default');
            expect(result.sources['persist']).toBe('default');
        });

        it('should mark overridden serve sub-fields as file', () => {
            const configPath = path.join(tmpDir, 'config.yaml');
            fs.writeFileSync(configPath, 'serve:\n  port: 8080\n  theme: dark\n');
            const result = getResolvedConfigWithSource(configPath);

            expect(result.sources['serve.port']).toBe('file');
            expect(result.sources['serve.theme']).toBe('file');
            expect(result.sources['serve.host']).toBe('default');
            expect(result.sources['serve.dataDir']).toBe('default');
        });

        it('should return resolved config with defaults applied', () => {
            const configPath = path.join(tmpDir, 'config.yaml');
            fs.writeFileSync(configPath, 'model: claude\n');
            const result = getResolvedConfigWithSource(configPath);

            expect(result.resolved.model).toBe('claude');
            expect(result.resolved.parallel).toBe(5);
            expect(result.resolved.output).toBe('table');
            expect(result.resolved.persist).toBe(true);
        });

        it('should return configFilePath matching getConfigFilePath()', () => {
            const result = getResolvedConfigWithSource(path.join(tmpDir, 'nonexistent.yaml'));
            expect(result.configFilePath).toBe(path.join(fakeHome, '.coc', 'config.yaml'));
        });

        it('should handle config with all fields overridden', () => {
            const configPath = path.join(tmpDir, 'full.yaml');
            fs.writeFileSync(configPath, [
                'model: gpt-4',
                'parallel: 20',
                'output: csv',
                'approvePermissions: true',
                'mcpConfig: /tmp/mcp.json',
                'timeout: 600',
                'persist: false',
                'serve:',
                '  port: 9000',
                '  host: 0.0.0.0',
                '  dataDir: /tmp/coc',
                '  theme: light',
            ].join('\n'));
            const result = getResolvedConfigWithSource(configPath);

            for (const key of CONFIG_SOURCE_KEYS) {
                expect(result.sources[key]).toBe('file');
            }
        });
    });

    // ========================================================================
    // writeConfigFile
    // ========================================================================

    describe('writeConfigFile', () => {
        let tmpDir: string;

        beforeEach(() => {
            tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-write-'));
        });

        afterEach(() => {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        });

        it('should write config as valid YAML that can be read back', () => {
            const configPath = path.join(tmpDir, 'config.yaml');
            const config: CLIConfig = { model: 'gpt-4', parallel: 10, output: 'json' };
            writeConfigFile(configPath, config);

            const loaded = loadConfigFile(configPath);
            expect(loaded).toBeDefined();
            expect(loaded!.model).toBe('gpt-4');
            expect(loaded!.parallel).toBe(10);
            expect(loaded!.output).toBe('json');
        });

        it('should overwrite an existing config file', () => {
            const configPath = path.join(tmpDir, 'config.yaml');
            writeConfigFile(configPath, { model: 'old-model' });
            writeConfigFile(configPath, { model: 'new-model', parallel: 3 });

            const loaded = loadConfigFile(configPath);
            expect(loaded).toBeDefined();
            expect(loaded!.model).toBe('new-model');
            expect(loaded!.parallel).toBe(3);
        });

        it('should create parent directories when missing', () => {
            const configPath = path.join(tmpDir, 'deep', 'nested', 'config.yaml');
            writeConfigFile(configPath, { timeout: 120 });

            expect(fs.existsSync(configPath)).toBe(true);
            const loaded = loadConfigFile(configPath);
            expect(loaded).toBeDefined();
            expect(loaded!.timeout).toBe(120);
        });

        it('should not leave .tmp file after successful write', () => {
            const configPath = path.join(tmpDir, 'config.yaml');
            writeConfigFile(configPath, { model: 'test' });

            expect(fs.existsSync(configPath + '.tmp')).toBe(false);
            expect(fs.existsSync(configPath)).toBe(true);
        });

        it('should handle empty config object', () => {
            const configPath = path.join(tmpDir, 'empty.yaml');
            writeConfigFile(configPath, {});

            expect(fs.existsSync(configPath)).toBe(true);
        });

        it('should persist serve sub-object correctly', () => {
            const configPath = path.join(tmpDir, 'serve.yaml');
            const config: CLIConfig = {
                serve: { port: 9000, host: '0.0.0.0', dataDir: '/tmp/coc', theme: 'dark' },
            };
            writeConfigFile(configPath, config);

            const loaded = loadConfigFile(configPath);
            expect(loaded).toBeDefined();
            expect(loaded!.serve?.port).toBe(9000);
            expect(loaded!.serve?.host).toBe('0.0.0.0');
            expect(loaded!.serve?.dataDir).toBe('/tmp/coc');
            expect(loaded!.serve?.theme).toBe('dark');
        });
    });
});
