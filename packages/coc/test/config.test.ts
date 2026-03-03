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
    DEFAULT_CONFIG,
    CONFIG_SOURCE_KEYS,
    getConfigFilePath,
    loadConfigFile,
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

        it('should have correct coc directory name', () => {
            expect(COC_DIR).toBe('.coc');
        });

        it('should have correct default config', () => {
            expect(DEFAULT_CONFIG.parallel).toBe(5);
            expect(DEFAULT_CONFIG.output).toBe('table');
            expect(DEFAULT_CONFIG.approvePermissions).toBe(false);
            expect(DEFAULT_CONFIG.persist).toBe(true);
            expect(DEFAULT_CONFIG.showReportIntent).toBe(false);
            expect(DEFAULT_CONFIG.toolCompactness).toBe(0);
            expect(DEFAULT_CONFIG.model).toBeUndefined();
            expect(DEFAULT_CONFIG.mcpConfig).toBeUndefined();
            expect(DEFAULT_CONFIG.timeout).toBeUndefined();
            expect(DEFAULT_CONFIG.chat).toEqual({
                followUpSuggestions: { enabled: true, count: 3 },
            });
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

        it('should throw for invalid YAML', () => {
            const configPath = path.join(tmpDir, 'invalid.yaml');
            fs.writeFileSync(configPath, '{{invalid yaml content]]');
            expect(() => loadConfigFile(configPath)).toThrow('Failed to parse');
        });

        it('should throw for invalid parallel value (string)', () => {
            const configPath = path.join(tmpDir, 'bad-parallel.yaml');
            fs.writeFileSync(configPath, 'parallel: "not-a-number"\n');
            expect(() => loadConfigFile(configPath)).toThrow('Invalid config file');
        });

        it('should throw for negative parallel value', () => {
            const configPath = path.join(tmpDir, 'negative-parallel.yaml');
            fs.writeFileSync(configPath, 'parallel: -5\n');
            expect(() => loadConfigFile(configPath)).toThrow('Invalid config file');
        });

        it('should throw for invalid output format', () => {
            const configPath = path.join(tmpDir, 'bad-output.yaml');
            fs.writeFileSync(configPath, 'output: xml\n');
            expect(() => loadConfigFile(configPath)).toThrow('Invalid config file');
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

        it('should throw for fractional parallel values', () => {
            const configPath = path.join(tmpDir, 'float.yaml');
            fs.writeFileSync(configPath, 'parallel: 7.8\n');
            expect(() => loadConfigFile(configPath)).toThrow('Invalid config file');
        });

        it('should throw for non-boolean approvePermissions', () => {
            const configPath = path.join(tmpDir, 'bad-bool.yaml');
            fs.writeFileSync(configPath, 'approvePermissions: "yes"\n');
            expect(() => loadConfigFile(configPath)).toThrow('Invalid config file');
        });

        it('should throw for negative timeout', () => {
            const configPath = path.join(tmpDir, 'bad-timeout.yaml');
            fs.writeFileSync(configPath, 'timeout: -10\n');
            expect(() => loadConfigFile(configPath)).toThrow('Invalid config file');
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

        it('should throw for non-boolean persist', () => {
            const configPath = path.join(tmpDir, 'bad-persist.yaml');
            fs.writeFileSync(configPath, 'persist: "yes"\n');
            expect(() => loadConfigFile(configPath)).toThrow('Invalid config file');
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

        it('should ignore ~/.coc.yaml (legacy path no longer supported)', () => {
            fs.writeFileSync(path.join(fakeHome, '.coc.yaml'), 'model: legacy-location\n');

            const result = loadConfigFile();
            expect(result).toBeUndefined();
        });

        it('should return undefined when no config exists', () => {
            const result = loadConfigFile();
            expect(result).toBeUndefined();
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
                showReportIntent: true,
                chat: { followUpSuggestions: { enabled: true, count: 3 } },
            };
            const override: CLIConfig = {};
            const result = mergeConfig(base, override);
            expect(result.model).toBe('gpt-4');
            expect(result.parallel).toBe(10);
            expect(result.persist).toBe(false);
            expect(result.showReportIntent).toBe(true);
        });

        it('should override showReportIntent', () => {
            const override: CLIConfig = { showReportIntent: true };
            const result = mergeConfig(DEFAULT_CONFIG, override);
            expect(result.showReportIntent).toBe(true);
        });

        it('should preserve showReportIntent default when not overridden', () => {
            const override: CLIConfig = { model: 'test' };
            const result = mergeConfig(DEFAULT_CONFIG, override);
            expect(result.showReportIntent).toBe(false);
        });

        it('should override toolCompactness', () => {
            const override: CLIConfig = { toolCompactness: 2 };
            const result = mergeConfig(DEFAULT_CONFIG, override);
            expect(result.toolCompactness).toBe(2);
        });

        it('should preserve toolCompactness default when not overridden', () => {
            const override: CLIConfig = { model: 'test' };
            const result = mergeConfig(DEFAULT_CONFIG, override);
            expect(result.toolCompactness).toBe(0);
        });

        it('should override chat.followUpSuggestions.enabled from file', () => {
            const override: CLIConfig = { chat: { followUpSuggestions: { enabled: false } } };
            const result = mergeConfig(DEFAULT_CONFIG, override);
            expect(result.chat.followUpSuggestions.enabled).toBe(false);
            expect(result.chat.followUpSuggestions.count).toBe(3); // default preserved
        });

        it('should override chat.followUpSuggestions.count from file', () => {
            const override: CLIConfig = { chat: { followUpSuggestions: { count: 5 } } };
            const result = mergeConfig(DEFAULT_CONFIG, override);
            expect(result.chat.followUpSuggestions.count).toBe(5);
            expect(result.chat.followUpSuggestions.enabled).toBe(true); // default preserved
        });

        it('should preserve chat defaults when chat section is absent', () => {
            const override: CLIConfig = { model: 'test' };
            const result = mergeConfig(DEFAULT_CONFIG, override);
            expect(result.chat.followUpSuggestions.enabled).toBe(true);
            expect(result.chat.followUpSuggestions.count).toBe(3);
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

        it('should report file source for chat.followUpSuggestions.enabled when set', () => {
            const configPath = path.join(tmpDir, 'chat.yaml');
            fs.writeFileSync(configPath, 'chat:\n  followUpSuggestions:\n    enabled: false\n');
            const result = getResolvedConfigWithSource(configPath);

            expect(result.sources['chat.followUpSuggestions.enabled']).toBe('file');
            expect(result.sources['chat.followUpSuggestions.count']).toBe('default');
        });

        it('should report default source for chat.followUpSuggestions.count when not set', () => {
            const configPath = path.join(tmpDir, 'chat-default.yaml');
            fs.writeFileSync(configPath, 'model: test\n');
            const result = getResolvedConfigWithSource(configPath);

            expect(result.sources['chat.followUpSuggestions.enabled']).toBe('default');
            expect(result.sources['chat.followUpSuggestions.count']).toBe('default');
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
                'showReportIntent: true',
                'toolCompactness: 1',
                'chat:',
                '  followUpSuggestions:',
                '    enabled: false',
                '    count: 2',
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

        it('should include toolCompactness in resolved with file source', () => {
            const configPath = path.join(tmpDir, 'toolcompactness.yaml');
            fs.writeFileSync(configPath, 'toolCompactness: 1\n');
            const result = getResolvedConfigWithSource(configPath);

            expect(result.resolved.toolCompactness).toBe(1);
            expect(result.sources['toolCompactness']).toBe('file');
        });

        it('should report default source for toolCompactness when absent', () => {
            const configPath = path.join(tmpDir, 'no-toolcompactness.yaml');
            fs.writeFileSync(configPath, 'model: test\n');
            const result = getResolvedConfigWithSource(configPath);

            expect(result.resolved.toolCompactness).toBe(0);
            expect(result.sources['toolCompactness']).toBe('default');
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
