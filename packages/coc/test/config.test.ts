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
    resolveLoggingConfig,
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
            expect(DEFAULT_CONFIG.toolCompactness).toBe(3);
            expect(DEFAULT_CONFIG.model).toBeUndefined();
            expect(DEFAULT_CONFIG.mcpConfig).toBeUndefined();
            expect(DEFAULT_CONFIG.timeout).toBeUndefined();
            expect(DEFAULT_CONFIG.chat).toEqual({
                followUpSuggestions: { enabled: true, count: 3 },
                askUser: { enabled: false },
            });
            expect(DEFAULT_CONFIG.terminal).toEqual({ enabled: true });
            expect(DEFAULT_CONFIG.scratchpad).toEqual({ enabled: true, layout: 'vertical' });
            expect(DEFAULT_CONFIG.workflows).toEqual({ enabled: false });
        });

        it('should default terminal feature to enabled', () => {
            expect(DEFAULT_CONFIG.terminal.enabled).toBe(true);
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

        it('should load store.backend: sqlite', () => {
            const configPath = path.join(tmpDir, 'store-sqlite.yaml');
            fs.writeFileSync(configPath, 'store:\n  backend: sqlite\n');
            const result = loadConfigFile(configPath);
            expect(result).toBeDefined();
            expect(result!.store?.backend).toBe('sqlite');
        });

        it('should load store.backend: file', () => {
            const configPath = path.join(tmpDir, 'store-file.yaml');
            fs.writeFileSync(configPath, 'store:\n  backend: file\n');
            const result = loadConfigFile(configPath);
            expect(result).toBeDefined();
            expect(result!.store?.backend).toBe('file');
        });

        it('should throw for unknown store.backend value', () => {
            const configPath = path.join(tmpDir, 'store-bad.yaml');
            fs.writeFileSync(configPath, 'store:\n  backend: postgres\n');
            expect(() => loadConfigFile(configPath)).toThrow('Invalid config file');
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
                chat: { followUpSuggestions: { enabled: true, count: 3 }, askUser: { enabled: true } },
                terminal: { enabled: false },
                notes: { enabled: false },
                myWork: { enabled: false },
                myLife: { enabled: false },
                scratchpad: { enabled: false, layout: 'vertical' },
                workflows: { enabled: false },
                pullRequests: { enabled: false },
                servers: { enabled: false },
                ralph: { enabled: false },
                store: { backend: 'file' },
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
            expect(result.toolCompactness).toBe(3);
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

        it('should merge serve.serverName from override', () => {
            const override: CLIConfig = { serve: { serverName: 'MBP' } };
            const result = mergeConfig(DEFAULT_CONFIG, override);
            expect(result.serve?.serverName).toBe('MBP');
            expect(result.serve?.port).toBe(4000); // default preserved
        });

        it('should leave serve.serverName undefined when not set', () => {
            const override: CLIConfig = { serve: { port: 9000 } };
            const result = mergeConfig(DEFAULT_CONFIG, override);
            expect(result.serve?.serverName).toBeUndefined();
        });

        it('should preserve terminal.enabled default when not overridden', () => {
            const result = mergeConfig(DEFAULT_CONFIG, { model: 'x' });
            expect(result.terminal.enabled).toBe(true);
        });

        it('should override terminal.enabled=true from file', () => {
            const result = mergeConfig(DEFAULT_CONFIG, { terminal: { enabled: true } });
            expect(result.terminal.enabled).toBe(true);
        });

        it('should override terminal.enabled=false from file', () => {
            const result = mergeConfig(DEFAULT_CONFIG, { terminal: { enabled: false } });
            expect(result.terminal.enabled).toBe(false);
        });

        it('should preserve notes.enabled default when not overridden', () => {
            const result = mergeConfig(DEFAULT_CONFIG, { model: 'x' });
            expect(result.notes.enabled).toBe(true);
        });

        it('should override notes.enabled from file', () => {
            const result = mergeConfig(DEFAULT_CONFIG, { notes: { enabled: true } });
            expect(result.notes.enabled).toBe(true);
        });

        it('should preserve scratchpad.enabled default when not overridden', () => {
            const result = mergeConfig(DEFAULT_CONFIG, { model: 'x' });
            expect(result.scratchpad.enabled).toBe(true);
        });

        it('should override scratchpad.enabled from file', () => {
            const result = mergeConfig(DEFAULT_CONFIG, { scratchpad: { enabled: true } });
            expect(result.scratchpad.enabled).toBe(true);
        });

        it('should preserve scratchpad.layout default when not overridden', () => {
            const result = mergeConfig(DEFAULT_CONFIG, { model: 'x' });
            expect(result.scratchpad.layout).toBe('vertical');
        });

        it('should override scratchpad.layout from file', () => {
            const result = mergeConfig(DEFAULT_CONFIG, { scratchpad: { layout: 'vertical' } });
            expect(result.scratchpad.layout).toBe('vertical');
        });

        it('should merge scratchpad fields independently', () => {
            const result = mergeConfig(DEFAULT_CONFIG, { scratchpad: { enabled: true } });
            expect(result.scratchpad.enabled).toBe(true);
            expect(result.scratchpad.layout).toBe('vertical');
        });

        it('should preserve workflows.enabled default when not overridden', () => {
            const result = mergeConfig(DEFAULT_CONFIG, { model: 'x' });
            expect(result.workflows.enabled).toBe(false);
        });

        it('should override workflows.enabled from file', () => {
            const result = mergeConfig(DEFAULT_CONFIG, { workflows: { enabled: true } });
            expect(result.workflows.enabled).toBe(true);
        });

        it('should preserve servers.enabled default when not overridden', () => {
            const result = mergeConfig(DEFAULT_CONFIG, { model: 'x' });
            expect(result.servers.enabled).toBe(false);
        });

        it('should override servers.enabled from file', () => {
            const result = mergeConfig(DEFAULT_CONFIG, { servers: { enabled: true } });
            expect(result.servers.enabled).toBe(true);
        });

        it('should override store.backend from file', () => {
            const result = mergeConfig(DEFAULT_CONFIG, { store: { backend: 'sqlite' } });
            expect(result.store.backend).toBe('sqlite');
        });

        it('should default store.backend to sqlite when omitted', () => {
            const result = mergeConfig(DEFAULT_CONFIG, { model: 'test' });
            expect(result.store.backend).toBe('sqlite');
        });

        it('should preserve store.backend default when store section is absent', () => {
            const result = mergeConfig(DEFAULT_CONFIG, {});
            expect(result.store.backend).toBe('sqlite');
        });

        it('should default loops.enabled to true', () => {
            const result = mergeConfig(DEFAULT_CONFIG, {});
            expect(result.loops.enabled).toBe(true);
        });

        it('should preserve loops.enabled default when not overridden', () => {
            const result = mergeConfig(DEFAULT_CONFIG, { model: 'x' });
            expect(result.loops.enabled).toBe(true);
        });

        it('should override loops.enabled from file', () => {
            const result = mergeConfig(DEFAULT_CONFIG, { loops: { enabled: true } });
            expect(result.loops.enabled).toBe(true);
        });

        it('should default excalidraw.enabled to false', () => {
            const result = mergeConfig(DEFAULT_CONFIG, {});
            expect(result.excalidraw.enabled).toBe(false);
        });

        it('should override excalidraw.enabled from file', () => {
            const result = mergeConfig(DEFAULT_CONFIG, { excalidraw: { enabled: true } });
            expect(result.excalidraw.enabled).toBe(true);
        });

        it('should default memory promotion AI normalization to disabled', () => {
            const result = mergeConfig(DEFAULT_CONFIG, {});
            expect(result.memoryPromotion.aiNormalization.enabled).toBe(false);
            expect(result.memoryPromotion.batchSize).toBe(50);
            expect(result.memoryPromotion.aiNormalization.timeoutMs).toBe(60000);
        });

        it('should merge memory promotion AI normalization independently', () => {
            const result = mergeConfig(DEFAULT_CONFIG, {
                memoryPromotion: {
                    aiNormalization: { enabled: true, model: 'gpt-test' },
                },
            });
            expect(result.memoryPromotion.aiNormalization.enabled).toBe(true);
            expect(result.memoryPromotion.aiNormalization.model).toBe('gpt-test');
            expect(result.memoryPromotion.aiNormalization.timeoutMs).toBe(60000);
            expect(result.memoryPromotion.batchSize).toBe(50);
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

        it('should include store.backend: sqlite by default', () => {
            const result = resolveConfig(path.join(tmpDir, 'nonexistent.yaml'));
            expect(result.store.backend).toBe('sqlite');
        });

        it('should resolve store.backend: sqlite from config file', () => {
            const configPath = path.join(tmpDir, 'config-sqlite.yaml');
            fs.writeFileSync(configPath, 'store:\n  backend: sqlite\n');
            const result = resolveConfig(configPath);
            expect(result.store.backend).toBe('sqlite');
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
            expect(result.sources['serve.serverName']).toBe('default');
        });

        it('should mark serve.serverName as file when set', () => {
            const configPath = path.join(tmpDir, 'sname.yaml');
            fs.writeFileSync(configPath, 'serve:\n  serverName: MBP\n');
            const result = getResolvedConfigWithSource(configPath);

            expect(result.sources['serve.serverName']).toBe('file');
            expect(result.resolved.serve?.serverName).toBe('MBP');
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

        it('should report file source for terminal.enabled when set', () => {
            const configPath = path.join(tmpDir, 'terminal.yaml');
            fs.writeFileSync(configPath, 'terminal:\n  enabled: true\n');
            const result = getResolvedConfigWithSource(configPath);
            expect(result.resolved.terminal.enabled).toBe(true);
            expect(result.sources['terminal.enabled']).toBe('file');
        });

        it('should report default source for terminal.enabled when not set', () => {
            const configPath = path.join(tmpDir, 'no-terminal.yaml');
            fs.writeFileSync(configPath, 'model: gpt-4\n');
            const result = getResolvedConfigWithSource(configPath);
            expect(result.resolved.terminal.enabled).toBe(true);
            expect(result.sources['terminal.enabled']).toBe('default');
        });

        it('should report file source for notes.enabled when set', () => {
            const configPath = path.join(tmpDir, 'notes.yaml');
            fs.writeFileSync(configPath, 'notes:\n  enabled: true\n');
            const result = getResolvedConfigWithSource(configPath);
            expect(result.resolved.notes.enabled).toBe(true);
            expect(result.sources['notes.enabled']).toBe('file');
        });

        it('should report default source for notes.enabled when not set', () => {
            const configPath = path.join(tmpDir, 'no-notes.yaml');
            fs.writeFileSync(configPath, 'model: gpt-4\n');
            const result = getResolvedConfigWithSource(configPath);
            expect(result.resolved.notes.enabled).toBe(true);
            expect(result.sources['notes.enabled']).toBe('default');
        });

        it('should report file source for workflows.enabled when set', () => {
            const configPath = path.join(tmpDir, 'workflows.yaml');
            fs.writeFileSync(configPath, 'workflows:\n  enabled: true\n');
            const result = getResolvedConfigWithSource(configPath);
            expect(result.resolved.workflows.enabled).toBe(true);
            expect(result.sources['workflows.enabled']).toBe('file');
        });

        it('should report default source for workflows.enabled when not set', () => {
            const configPath = path.join(tmpDir, 'no-workflows.yaml');
            fs.writeFileSync(configPath, 'model: gpt-4\n');
            const result = getResolvedConfigWithSource(configPath);
            expect(result.resolved.workflows.enabled).toBe(false);
            expect(result.sources['workflows.enabled']).toBe('default');
        });

        it('should report file source for servers.enabled when set', () => {
            const configPath = path.join(tmpDir, 'servers.yaml');
            fs.writeFileSync(configPath, 'servers:\n  enabled: true\n');
            const result = getResolvedConfigWithSource(configPath);
            expect(result.resolved.servers.enabled).toBe(true);
            expect(result.sources['servers.enabled']).toBe('file');
        });

        it('should report default source for servers.enabled when not set', () => {
            const configPath = path.join(tmpDir, 'no-servers.yaml');
            fs.writeFileSync(configPath, 'model: gpt-4\n');
            const result = getResolvedConfigWithSource(configPath);
            expect(result.resolved.servers.enabled).toBe(false);
            expect(result.sources['servers.enabled']).toBe('default');
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
                'taskCardDensity: dense',
                'groupSingleLineMessages: false',
                'chat:',
                '  followUpSuggestions:',
                '    enabled: false',
                '    count: 2',
                '  askUser:',
                '    enabled: false',
                'serve:',
                '  port: 9000',
                '  host: 127.0.0.1',
                '  dataDir: /tmp/coc',
                '  theme: light',
                '  serverName: MBP',
                'terminal:',
                '  enabled: true',
                'notes:',
                '  enabled: true',
                'myWork:',
                '  enabled: true',
                'myLife:',
                '  enabled: true',
                'scratchpad:',
                '  enabled: true',
                '  layout: vertical',
                'workflows:',
                '  enabled: true',
                'pullRequests:',
                '  enabled: true',
                '  suggestions: true',
                'servers:',
                '  enabled: true',
                'ralph:',
                '  enabled: true',
                '  finalCheck:',
                '    maxGapFixLoops: 5',
                'vimNavigation:',
                '  enabled: true',
                'loops:',
                '  enabled: true',
                'mcpOauth:',
                '  enabled: true',
                'excalidraw:',
                '  enabled: true',
                'containerDefaultAgent:',
                '  enabled: true',
                'codex:',
                '  enabled: true',
                'claude:',
                '  enabled: true',
                'defaultProvider: codex',
                'features:',
                '  autoMemoryPromotion: true',
                '  focusedDiff: true',
                'memoryPromotion:',
                '  batchSize: 25',
                '  timeoutMs: 80000',
                '  model: gpt-test',
                '  aiNormalization:',
                '    enabled: true',
                '    timeoutMs: 30000',
                '    model: gpt-normalize',
                'workItems:',
                '  hierarchy:',
                '    enabled: true',
            ].join('\n'));
            const result = getResolvedConfigWithSource(configPath);

            for (const key of CONFIG_SOURCE_KEYS) {
                expect(result.sources[key]).toBe('file');
            }
        });

        it('snapshots comprehensive resolved config and sources', () => {
            const configPath = path.join(tmpDir, 'comprehensive.yaml');
            fs.writeFileSync(configPath, [
                'model: gpt-4.1',
                'parallel: 12',
                'output: markdown',
                'approvePermissions: true',
                'mcpConfig: ${HOME}/mcp.json',
                'timeout: 450',
                'persist: false',
                'showReportIntent: true',
                'toolCompactness: 2',
                'taskCardDensity: compact',
                'groupSingleLineMessages: false',
                'chat:',
                '  followUpSuggestions:',
                '    enabled: false',
                '    count: 4',
                '  askUser:',
                '    enabled: true',
                'serve:',
                '  port: 8081',
                '  host: 127.0.0.1',
                '  dataDir: ${HOME}/.coc-test',
                '  theme: dark',
                '  serverName: local-dev',
                'queue:',
                '  historyLimit: 25',
                '  restartPolicy: requeue',
                '  restartPickupDelayMs: 250',
                'models:',
                '  enabled:',
                '    - gpt-4.1',
                '    - claude-sonnet',
                'logging:',
                '  level: debug',
                '  dir: ${HOME}/logs',
                '  pretty: false',
                '  stores:',
                '    coc-service:',
                '      level: info',
                '      file: true',
                'terminal:',
                '  enabled: false',
                'notes:',
                '  enabled: false',
                'myWork:',
                '  enabled: true',
                'myLife:',
                '  enabled: true',
                'scratchpad:',
                '  enabled: true',
                '  layout: horizontal',
                'workflows:',
                '  enabled: true',
                'pullRequests:',
                '  enabled: true',
                '  suggestions: true',
                'servers:',
                '  enabled: true',
                'ralph:',
                '  enabled: true',
                'vimNavigation:',
                '  enabled: true',
                'loops:',
                '  enabled: true',
                'features:',
                '  autoMemoryPromotion: true',
                '  focusedDiff: true',
                'memoryPromotion:',
                '  batchSize: 10',
                '  timeoutMs: 70000',
                '  model: gpt-memory',
                '  aiNormalization:',
                '    enabled: true',
                '    timeoutMs: 45000',
                '    model: gpt-normalizer',
                'store:',
                '  backend: file',
                'monitoring:',
                '  heapCheck:',
                '    enabled: false',
                '    intervalMs: 45000',
                '    warnThreshold: 65',
                '    criticalThreshold: 90',
                'skills:',
                '  autoUpdate: false',
                '  defaultSkills:',
                '    - rethink',
                '    - terse-replies',
            ].join('\n'));

            const result = getResolvedConfigWithSource(configPath);

            expect({
                resolved: result.resolved,
                sources: result.sources,
            }).toMatchInlineSnapshot(`
              {
                "resolved": {
                  "approvePermissions": true,
                  "chat": {
                    "askUser": {
                      "enabled": true,
                    },
                    "followUpSuggestions": {
                      "count": 4,
                      "enabled": false,
                    },
                  },
                  "claude": {
                    "enabled": false,
                  },
                  "codex": {
                    "enabled": false,
                  },
                  "containerDefaultAgent": {
                    "enabled": false,
                  },
                  "defaultProvider": "copilot",
                  "excalidraw": {
                    "enabled": false,
                  },
                  "features": {
                    "autoMemoryPromotion": true,
                    "focusedDiff": true,
                  },
                  "groupSingleLineMessages": false,
                  "logging": {
                    "dir": "\${HOME}/logs",
                    "level": "debug",
                    "pretty": false,
                    "stores": {
                      "coc-service": {
                        "file": true,
                        "level": "info",
                      },
                    },
                  },
                  "loops": {
                    "enabled": true,
                  },
                  "mcpConfig": "\${HOME}/mcp.json",
                  "mcpOauth": {
                    "enabled": false,
                  },
                  "memoryPromotion": {
                    "aiNormalization": {
                      "enabled": true,
                      "model": "gpt-normalizer",
                      "timeoutMs": 45000,
                    },
                    "batchSize": 10,
                    "model": "gpt-memory",
                    "timeoutMs": 70000,
                  },
                  "model": "gpt-4.1",
                  "models": {
                    "enabled": [
                      "gpt-4.1",
                      "claude-sonnet",
                    ],
                  },
                  "monitoring": {
                    "heapCheck": {
                      "criticalThreshold": 90,
                      "enabled": false,
                      "intervalMs": 45000,
                      "warnThreshold": 65,
                    },
                  },
                  "myLife": {
                    "enabled": true,
                  },
                  "myWork": {
                    "enabled": true,
                  },
                  "notes": {
                    "enabled": false,
                  },
                  "output": "markdown",
                  "parallel": 12,
                  "persist": false,
                  "pullRequests": {
                    "enabled": true,
                    "suggestions": true,
                  },
                  "queue": {
                    "historyLimit": 25,
                    "restartPickupDelayMs": 250,
                    "restartPolicy": "requeue",
                  },
                  "ralph": {
                    "enabled": true,
                    "finalCheck": {
                      "maxGapFixLoops": 3,
                    },
                  },
                  "scratchpad": {
                    "enabled": true,
                    "layout": "horizontal",
                  },
                  "serve": {
                    "dataDir": "\${HOME}/.coc-test",
                    "host": "127.0.0.1",
                    "port": 8081,
                    "serverName": "local-dev",
                    "theme": "dark",
                  },
                  "servers": {
                    "enabled": true,
                  },
                  "showReportIntent": true,
                  "skills": {
                    "autoUpdate": false,
                    "defaultSkills": [
                      "rethink",
                      "terse-replies",
                    ],
                  },
                  "store": {
                    "backend": "file",
                  },
                  "taskCardDensity": "compact",
                  "terminal": {
                    "enabled": false,
                  },
                  "timeout": 450,
                  "toolCompactness": 2,
                  "vimNavigation": {
                    "enabled": true,
                  },
                  "workItems": {
                    "hierarchy": {
                      "enabled": false,
                    },
                  },
                  "workflows": {
                    "enabled": true,
                  },
                },
                "sources": {
                  "approvePermissions": "file",
                  "chat.askUser.enabled": "file",
                  "chat.followUpSuggestions.count": "file",
                  "chat.followUpSuggestions.enabled": "file",
                  "claude.enabled": "default",
                  "codex.enabled": "default",
                  "containerDefaultAgent.enabled": "default",
                  "defaultProvider": "default",
                  "excalidraw.enabled": "default",
                  "features.autoMemoryPromotion": "file",
                  "features.focusedDiff": "file",
                  "groupSingleLineMessages": "file",
                  "loops.enabled": "file",
                  "mcpConfig": "file",
                  "mcpOauth.enabled": "default",
                  "memoryPromotion.aiNormalization.enabled": "file",
                  "memoryPromotion.aiNormalization.model": "file",
                  "memoryPromotion.aiNormalization.timeoutMs": "file",
                  "memoryPromotion.batchSize": "file",
                  "memoryPromotion.model": "file",
                  "memoryPromotion.timeoutMs": "file",
                  "model": "file",
                  "myLife.enabled": "file",
                  "myWork.enabled": "file",
                  "notes.enabled": "file",
                  "output": "file",
                  "parallel": "file",
                  "persist": "file",
                  "pullRequests.enabled": "file",
                  "pullRequests.suggestions": "file",
                  "ralph.enabled": "file",
                  "ralph.finalCheck.maxGapFixLoops": "default",
                  "scratchpad.enabled": "file",
                  "scratchpad.layout": "file",
                  "serve.dataDir": "file",
                  "serve.host": "file",
                  "serve.port": "file",
                  "serve.serverName": "file",
                  "serve.theme": "file",
                  "servers.enabled": "file",
                  "showReportIntent": "file",
                  "taskCardDensity": "file",
                  "terminal.enabled": "file",
                  "timeout": "file",
                  "toolCompactness": "file",
                  "vimNavigation.enabled": "file",
                  "workItems.hierarchy.enabled": "default",
                  "workflows.enabled": "file",
                },
              }
            `);
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

            expect(result.resolved.toolCompactness).toBe(3);
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

        it('should persist serve.serverName correctly', () => {
            const configPath = path.join(tmpDir, 'serve-name.yaml');
            const config: CLIConfig = {
                serve: { serverName: 'MBP' },
            };
            writeConfigFile(configPath, config);

            const loaded = loadConfigFile(configPath);
            expect(loaded).toBeDefined();
            expect(loaded!.serve?.serverName).toBe('MBP');
        });
    });

    // ========================================================================
    // resolveLoggingConfig
    // ========================================================================

    describe('resolveLoggingConfig', () => {
        it('defaults to info level and auto pretty when no overrides', () => {
            const result = resolveLoggingConfig({});
            expect(result.level).toBe('info');
            expect(result.pretty).toBe('auto');
            expect(result.dir).toBeUndefined();
            expect(result.stores).toEqual({});
        });

        it('CLI logLevel overrides file config level', () => {
            const result = resolveLoggingConfig(
                { logLevel: 'warn' },
                { level: 'debug' }
            );
            expect(result.level).toBe('warn');
        });

        it('file config level is used when CLI logLevel is absent', () => {
            const result = resolveLoggingConfig({}, { level: 'debug' });
            expect(result.level).toBe('debug');
        });

        it('verbose: true forces level to debug', () => {
            const result = resolveLoggingConfig({ verbose: true }, { level: 'warn' });
            expect(result.level).toBe('debug');
        });

        it('verbose: true overrides CLI logLevel', () => {
            const result = resolveLoggingConfig({ logLevel: 'error', verbose: true });
            expect(result.level).toBe('debug');
        });

        it('CLI logDir overrides file config dir', () => {
            const result = resolveLoggingConfig(
                { logDir: '/tmp/cli-logs' },
                { dir: '/tmp/file-logs' }
            );
            expect(result.dir).toBe('/tmp/cli-logs');
        });

        it('file config dir is used when CLI logDir is absent', () => {
            const result = resolveLoggingConfig({}, { dir: '/tmp/file-logs' });
            expect(result.dir).toBe('/tmp/file-logs');
        });

        it('file config pretty is used', () => {
            const result = resolveLoggingConfig({}, { pretty: true });
            expect(result.pretty).toBe(true);
        });

        it('file config pretty: false is used', () => {
            const result = resolveLoggingConfig({}, { pretty: false });
            expect(result.pretty).toBe(false);
        });

        it('file config stores are passed through', () => {
            const stores = { 'ai-service': { level: 'debug' as const, file: true } };
            const result = resolveLoggingConfig({}, { stores });
            expect(result.stores).toEqual(stores);
        });

        it('returns empty stores when not configured', () => {
            const result = resolveLoggingConfig({});
            expect(result.stores).toEqual({});
        });

        it('full config: CLI flags take precedence over file', () => {
            const result = resolveLoggingConfig(
                { logLevel: 'trace', logDir: '/cli/logs' },
                { level: 'info', dir: '/file/logs', pretty: false, stores: { 'coc-service': { level: 'warn' } } }
            );
            expect(result.level).toBe('trace');
            expect(result.dir).toBe('/cli/logs');
            expect(result.pretty).toBe(false);  // from file (not overrideable by CLI)
            expect(result.stores?.['coc-service']?.level).toBe('warn');
        });
    });

    // ========================================================================
    // Config file: logging section is parsed and passed through mergeConfig
    // ========================================================================

    describe('logging config file round-trip', () => {
        let tmpDir: string;

        beforeEach(() => {
            tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-logging-'));
        });

        afterEach(() => {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        });

        it('parses logging section from YAML config', () => {
            const configPath = path.join(tmpDir, 'config.yaml');
            fs.writeFileSync(configPath, [
                'logging:',
                '  level: debug',
                '  dir: ~/.coc/logs',
                '  pretty: auto',
                '  stores:',
                '    ai-service:',
                '      level: trace',
                '      file: true',
            ].join('\n'));

            const result = loadConfigFile(configPath);
            expect(result?.logging?.level).toBe('debug');
            expect(result?.logging?.dir).toBe('~/.coc/logs');
            expect(result?.logging?.pretty).toBe('auto');
            expect(result?.logging?.stores?.['ai-service']?.level).toBe('trace');
            expect(result?.logging?.stores?.['ai-service']?.file).toBe(true);
        });

        it('mergeConfig passes logging through to ResolvedCLIConfig', () => {
            const fileConfig: CLIConfig = {
                logging: { level: 'warn', stores: { 'coc-service': { level: 'info' } } },
            };
            const resolved = mergeConfig(DEFAULT_CONFIG, fileConfig);
            expect(resolved.logging?.level).toBe('warn');
            expect(resolved.logging?.stores?.['coc-service']?.level).toBe('info');
        });

        it('resolveConfig includes logging from file', () => {
            const configPath = path.join(tmpDir, 'config.yaml');
            fs.writeFileSync(configPath, 'logging:\n  level: error\n');
            const resolved = resolveConfig(configPath);
            expect(resolved.logging?.level).toBe('error');
        });
    });

    // ========================================================================
    // monitoring.heapCheck config
    // ========================================================================

    describe('monitoring.heapCheck config', () => {
        let tmpDir: string;

        beforeEach(() => {
            tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-config-monitoring-'));
        });

        afterEach(() => {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        });

        it('DEFAULT_CONFIG includes monitoring defaults', () => {
            expect(DEFAULT_CONFIG.monitoring).toEqual({
                heapCheck: {
                    enabled: true,
                    intervalMs: 30000,
                    warnThreshold: 70,
                    criticalThreshold: 85,
                },
            });
        });

        it('mergeConfig uses defaults when no override', () => {
            const resolved = mergeConfig(DEFAULT_CONFIG, {});
            expect(resolved.monitoring.heapCheck.enabled).toBe(true);
            expect(resolved.monitoring.heapCheck.intervalMs).toBe(30000);
        });

        it('mergeConfig overrides individual heapCheck fields', () => {
            const resolved = mergeConfig(DEFAULT_CONFIG, {
                monitoring: { heapCheck: { enabled: false, intervalMs: 60000 } },
            });
            expect(resolved.monitoring.heapCheck.enabled).toBe(false);
            expect(resolved.monitoring.heapCheck.intervalMs).toBe(60000);
            // Non-overridden fields keep defaults
            expect(resolved.monitoring.heapCheck.warnThreshold).toBe(70);
            expect(resolved.monitoring.heapCheck.criticalThreshold).toBe(85);
        });

        it('mergeConfig overrides thresholds', () => {
            const resolved = mergeConfig(DEFAULT_CONFIG, {
                monitoring: { heapCheck: { warnThreshold: 50, criticalThreshold: 75 } },
            });
            expect(resolved.monitoring.heapCheck.warnThreshold).toBe(50);
            expect(resolved.monitoring.heapCheck.criticalThreshold).toBe(75);
        });

        it('resolveConfig includes monitoring from file', () => {
            const configPath = path.join(tmpDir, 'config.yaml');
            fs.writeFileSync(configPath, [
                'monitoring:',
                '  heapCheck:',
                '    enabled: false',
                '    intervalMs: 60000',
            ].join('\n'));
            const resolved = resolveConfig(configPath);
            expect(resolved.monitoring.heapCheck.enabled).toBe(false);
            expect(resolved.monitoring.heapCheck.intervalMs).toBe(60000);
        });
    });
});
