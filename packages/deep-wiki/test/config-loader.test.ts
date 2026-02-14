/**
 * Config Loader Tests
 *
 * Tests for YAML config file loading, schema validation, merge logic,
 * and per-phase resolution functions.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
    loadConfig,
    discoverConfigFile,
    mergeConfigWithCLI,
    validateConfig,
    resolvePhaseModel,
    resolvePhaseTimeout,
    resolvePhaseConcurrency,
    resolvePhaseDepth,
} from '../src/config-loader';
import type { GenerateCommandOptions } from '../src/types';

// ============================================================================
// Helpers
// ============================================================================

let tmpDir: string;

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepwiki-config-test-'));
});

afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeConfigFile(filename: string, content: string): string {
    const filePath = path.join(tmpDir, filename);
    fs.writeFileSync(filePath, content, 'utf-8');
    return filePath;
}

function makeDefaultCLI(overrides?: Partial<GenerateCommandOptions>): GenerateCommandOptions {
    return {
        output: './wiki',
        depth: 'normal',
        force: false,
        useCache: false,
        verbose: false,
        ...overrides,
    };
}

// ============================================================================
// loadConfig
// ============================================================================

describe('loadConfig', () => {
    it('should load a valid YAML config file', () => {
        const configPath = writeConfigFile('config.yaml', `
output: ./my-wiki
model: gpt-4
concurrency: 5
timeout: 300
depth: deep
useCache: true
force: false
focus: src/
seeds: auto
noCluster: false
strict: true
skipWebsite: false
theme: dark
title: My Project Wiki
phase: 2
`);
        const config = loadConfig(configPath);

        expect(config.output).toBe('./my-wiki');
        expect(config.model).toBe('gpt-4');
        expect(config.concurrency).toBe(5);
        expect(config.timeout).toBe(300);
        expect(config.depth).toBe('deep');
        expect(config.useCache).toBe(true);
        expect(config.force).toBe(false);
        expect(config.focus).toBe('src/');
        expect(config.seeds).toBe('auto');
        expect(config.noCluster).toBe(false);
        expect(config.strict).toBe(true);
        expect(config.skipWebsite).toBe(false);
        expect(config.theme).toBe('dark');
        expect(config.title).toBe('My Project Wiki');
        expect(config.phase).toBe(2);
    });

    it('should load endPhase from config file', () => {
        const configPath = writeConfigFile('config.yaml', `
endPhase: 3
phase: 2
`);
        const config = loadConfig(configPath);
        expect(config.endPhase).toBe(3);
        expect(config.phase).toBe(2);
    });

    it('should load largeRepoThreshold from config file', () => {
        const configPath = writeConfigFile('config.yaml', `
largeRepoThreshold: 5000
`);
        const config = loadConfig(configPath);
        expect(config.largeRepoThreshold).toBe(5000);
    });

    it('should load repoPath from config file', () => {
        const configPath = writeConfigFile('config.yaml', `
repoPath: /home/user/my-project
model: gpt-4
`);
        const config = loadConfig(configPath);
        expect(config.repoPath).toBe('/home/user/my-project');
    });

    it('should load relative repoPath from config file', () => {
        const configPath = writeConfigFile('config.yaml', `
repoPath: ../my-project
`);
        const config = loadConfig(configPath);
        expect(config.repoPath).toBe('../my-project');
    });

    it('should load config with per-phase overrides', () => {
        const configPath = writeConfigFile('config.yaml', `
model: gpt-4
phases:
  discovery:
    model: claude-sonnet
    timeout: 600
  consolidation:
    model: gpt-4
    skipAI: false
  analysis:
    model: claude-opus
    concurrency: 3
    timeout: 900
    depth: deep
  writing:
    model: gpt-4
    concurrency: 5
    depth: deep
`);
        const config = loadConfig(configPath);

        expect(config.model).toBe('gpt-4');
        expect(config.phases).toBeDefined();
        expect(config.phases!.discovery!.model).toBe('claude-sonnet');
        expect(config.phases!.discovery!.timeout).toBe(600);
        expect(config.phases!.consolidation!.model).toBe('gpt-4');
        expect(config.phases!.consolidation!.skipAI).toBe(false);
        expect(config.phases!.analysis!.model).toBe('claude-opus');
        expect(config.phases!.analysis!.concurrency).toBe(3);
        expect(config.phases!.analysis!.timeout).toBe(900);
        expect(config.phases!.analysis!.depth).toBe('deep');
        expect(config.phases!.writing!.model).toBe('gpt-4');
        expect(config.phases!.writing!.concurrency).toBe(5);
        expect(config.phases!.writing!.depth).toBe('deep');
    });

    it('should load a minimal config with only some fields', () => {
        const configPath = writeConfigFile('config.yaml', `
model: gpt-4
`);
        const config = loadConfig(configPath);

        expect(config.model).toBe('gpt-4');
        expect(config.output).toBeUndefined();
        expect(config.phases).toBeUndefined();
    });

    it('should load config with repoPath', () => {
        const configPath = writeConfigFile('config.yaml', `
repoPath: ./my-project
output: ./wiki
`);
        const config = loadConfig(configPath);

        expect(config.repoPath).toBe('./my-project');
    });

    it('should throw for non-existent file', () => {
        expect(() => loadConfig('/nonexistent/path/config.yaml'))
            .toThrow('Config file not found');
    });

    it('should throw for invalid YAML syntax', () => {
        const configPath = writeConfigFile('bad.yaml', `
model: gpt-4
  invalid: yaml
    broken: indentation
`);
        expect(() => loadConfig(configPath)).toThrow('Invalid YAML');
    });

    it('should throw for empty file', () => {
        const configPath = writeConfigFile('empty.yaml', '');
        expect(() => loadConfig(configPath)).toThrow('empty or not a valid YAML object');
    });

    it('should throw for file containing only a scalar value', () => {
        const configPath = writeConfigFile('scalar.yaml', 'just a string');
        expect(() => loadConfig(configPath)).toThrow('empty or not a valid YAML object');
    });

    it('should handle null YAML content', () => {
        const configPath = writeConfigFile('null.yaml', 'null');
        expect(() => loadConfig(configPath)).toThrow('empty or not a valid YAML object');
    });
});

// ============================================================================
// discoverConfigFile
// ============================================================================

describe('discoverConfigFile', () => {
    it('should find deep-wiki.config.yaml', () => {
        fs.writeFileSync(path.join(tmpDir, 'deep-wiki.config.yaml'), 'model: gpt-4', 'utf-8');
        const result = discoverConfigFile(tmpDir);
        expect(result).toBe(path.join(tmpDir, 'deep-wiki.config.yaml'));
    });

    it('should find deep-wiki.config.yml', () => {
        fs.writeFileSync(path.join(tmpDir, 'deep-wiki.config.yml'), 'model: gpt-4', 'utf-8');
        const result = discoverConfigFile(tmpDir);
        expect(result).toBe(path.join(tmpDir, 'deep-wiki.config.yml'));
    });

    it('should prefer .yaml over .yml', () => {
        fs.writeFileSync(path.join(tmpDir, 'deep-wiki.config.yaml'), 'model: gpt-4', 'utf-8');
        fs.writeFileSync(path.join(tmpDir, 'deep-wiki.config.yml'), 'model: gpt-3', 'utf-8');
        const result = discoverConfigFile(tmpDir);
        expect(result).toBe(path.join(tmpDir, 'deep-wiki.config.yaml'));
    });

    it('should return undefined if no config file found', () => {
        const result = discoverConfigFile(tmpDir);
        expect(result).toBeUndefined();
    });
});

// ============================================================================
// validateConfig
// ============================================================================

describe('validateConfig', () => {
    it('should accept an empty object', () => {
        const config = validateConfig({});
        expect(config).toEqual({});
    });

    it('should validate string fields', () => {
        expect(() => validateConfig({ output: 123 })).toThrow('"output" must be a string');
        expect(() => validateConfig({ model: true })).toThrow('"model" must be a string');
        expect(() => validateConfig({ focus: [] })).toThrow('"focus" must be a string');
        expect(() => validateConfig({ seeds: 42 })).toThrow('"seeds" must be a string');
        expect(() => validateConfig({ title: {} })).toThrow('"title" must be a string');
        expect(() => validateConfig({ repoPath: 123 })).toThrow('"repoPath" must be a string');
    });

    it('should validate number fields', () => {
        expect(() => validateConfig({ concurrency: 'high' })).toThrow('"concurrency" must be a positive number');
        expect(() => validateConfig({ concurrency: 0 })).toThrow('"concurrency" must be a positive number');
        expect(() => validateConfig({ concurrency: -1 })).toThrow('"concurrency" must be a positive number');
        expect(() => validateConfig({ concurrency: NaN })).toThrow('"concurrency" must be a positive number');
        expect(() => validateConfig({ timeout: 'fast' })).toThrow('"timeout" must be a positive number');
        expect(() => validateConfig({ timeout: 0 })).toThrow('"timeout" must be a positive number');
        expect(() => validateConfig({ largeRepoThreshold: 'big' })).toThrow('"largeRepoThreshold" must be a positive number');
        expect(() => validateConfig({ largeRepoThreshold: 0 })).toThrow('"largeRepoThreshold" must be a positive number');
        expect(() => validateConfig({ largeRepoThreshold: -1 })).toThrow('"largeRepoThreshold" must be a positive number');
    });

    it('should accept valid largeRepoThreshold', () => {
        const config = validateConfig({ largeRepoThreshold: 5000 });
        expect(config.largeRepoThreshold).toBe(5000);
    });

    it('should validate phase number', () => {
        expect(() => validateConfig({ phase: 0 })).toThrow('"phase" must be an integer between 1 and 4');
        expect(() => validateConfig({ phase: 5 })).toThrow('"phase" must be an integer between 1 and 4');
        expect(() => validateConfig({ phase: 1.5 })).toThrow('"phase" must be an integer between 1 and 4');
        expect(() => validateConfig({ phase: 'one' })).toThrow('"phase" must be an integer between 1 and 4');

        // Valid values
        expect(validateConfig({ phase: 1 }).phase).toBe(1);
        expect(validateConfig({ phase: 4 }).phase).toBe(4);
    });

    it('should validate endPhase number', () => {
        expect(() => validateConfig({ endPhase: 0 })).toThrow('"endPhase" must be an integer between 1 and 5');
        expect(() => validateConfig({ endPhase: 6 })).toThrow('"endPhase" must be an integer between 1 and 5');
        expect(() => validateConfig({ endPhase: 1.5 })).toThrow('"endPhase" must be an integer between 1 and 5');
        expect(() => validateConfig({ endPhase: 'three' })).toThrow('"endPhase" must be an integer between 1 and 5');

        // Valid values
        expect(validateConfig({ endPhase: 1 }).endPhase).toBe(1);
        expect(validateConfig({ endPhase: 3 }).endPhase).toBe(3);
        expect(validateConfig({ endPhase: 5 }).endPhase).toBe(5);
    });

    it('should validate boolean fields', () => {
        expect(() => validateConfig({ useCache: 'yes' })).toThrow('"useCache" must be a boolean');
        expect(() => validateConfig({ force: 1 })).toThrow('"force" must be a boolean');
        expect(() => validateConfig({ noCluster: 'true' })).toThrow('"noCluster" must be a boolean');
        expect(() => validateConfig({ strict: 0 })).toThrow('"strict" must be a boolean');
        expect(() => validateConfig({ skipWebsite: 'false' })).toThrow('"skipWebsite" must be a boolean');
    });

    it('should validate depth enum', () => {
        expect(() => validateConfig({ depth: 'medium' })).toThrow('"depth" must be one of');
        expect(validateConfig({ depth: 'shallow' }).depth).toBe('shallow');
        expect(validateConfig({ depth: 'normal' }).depth).toBe('normal');
        expect(validateConfig({ depth: 'deep' }).depth).toBe('deep');
    });

    it('should validate theme enum', () => {
        expect(() => validateConfig({ theme: 'blue' })).toThrow('"theme" must be one of');
        expect(validateConfig({ theme: 'light' }).theme).toBe('light');
        expect(validateConfig({ theme: 'dark' }).theme).toBe('dark');
        expect(validateConfig({ theme: 'auto' }).theme).toBe('auto');
    });

    it('should validate phases structure', () => {
        expect(() => validateConfig({ phases: 'invalid' })).toThrow('"phases" must be an object');
        expect(() => validateConfig({ phases: [] })).toThrow('"phases" must be an object');
    });

    it('should reject unknown phase names', () => {
        expect(() => validateConfig({ phases: { unknown: { model: 'gpt-4' } } }))
            .toThrow('unknown phase "unknown"');
    });

    it('should validate phase config fields', () => {
        expect(() => validateConfig({ phases: { analysis: 'bad' } }))
            .toThrow('phases.analysis must be an object');
        expect(() => validateConfig({ phases: { analysis: { model: 123 } } }))
            .toThrow('phases.analysis.model must be a string');
        expect(() => validateConfig({ phases: { analysis: { timeout: -1 } } }))
            .toThrow('phases.analysis.timeout must be a positive number');
        expect(() => validateConfig({ phases: { analysis: { concurrency: 0 } } }))
            .toThrow('phases.analysis.concurrency must be a positive number');
        expect(() => validateConfig({ phases: { analysis: { depth: 'extreme' } } }))
            .toThrow('phases.analysis.depth must be one of');
        expect(() => validateConfig({ phases: { consolidation: { skipAI: 'yes' } } }))
            .toThrow('phases.consolidation.skipAI must be a boolean');
    });

    it('should accept valid phase config', () => {
        const config = validateConfig({
            phases: {
                discovery: { model: 'claude-sonnet', timeout: 600 },
                analysis: { concurrency: 3, depth: 'deep' },
                consolidation: { skipAI: true },
                writing: { model: 'gpt-4' },
            },
        });

        expect(config.phases!.discovery!.model).toBe('claude-sonnet');
        expect(config.phases!.discovery!.timeout).toBe(600);
        expect(config.phases!.analysis!.concurrency).toBe(3);
        expect(config.phases!.analysis!.depth).toBe('deep');
        expect(config.phases!.consolidation!.skipAI).toBe(true);
        expect(config.phases!.writing!.model).toBe('gpt-4');
    });

    it('should ignore unknown top-level fields (forward compat)', () => {
        // Unknown top-level fields should not throw — they are simply ignored
        const config = validateConfig({ futureFeature: 'value', model: 'gpt-4' });
        expect(config.model).toBe('gpt-4');
    });
});

// ============================================================================
// mergeConfigWithCLI
// ============================================================================

describe('mergeConfigWithCLI', () => {
    it('should use CLI values when explicitly set', () => {
        const config = { model: 'config-model', output: './config-output' };
        const cli = makeDefaultCLI({ model: 'cli-model', output: './cli-output' });
        const explicit = new Set(['model', 'output']);

        const merged = mergeConfigWithCLI(config, cli, explicit);
        expect(merged.model).toBe('cli-model');
        expect(merged.output).toBe('./cli-output');
    });

    it('should use config values when CLI is not explicit', () => {
        const config = { model: 'config-model', output: './config-output', timeout: 600 };
        const cli = makeDefaultCLI({ output: './wiki' }); // default, not explicit
        const explicit = new Set<string>(); // nothing explicitly set

        const merged = mergeConfigWithCLI(config, cli, explicit);
        expect(merged.model).toBe('config-model');
        expect(merged.output).toBe('./config-output');
        expect(merged.timeout).toBe(600);
    });

    it('should fall back to CLI defaults when neither config nor explicit CLI', () => {
        const config = {}; // empty config
        const cli = makeDefaultCLI();

        const merged = mergeConfigWithCLI(config, cli);
        expect(merged.output).toBe('./wiki');
        expect(merged.depth).toBe('normal');
        expect(merged.force).toBe(false);
    });

    it('should merge phases from config and CLI', () => {
        const config = {
            phases: {
                discovery: { model: 'config-discovery' },
                analysis: { model: 'config-analysis', timeout: 900 },
            },
        };
        const cli = makeDefaultCLI({
            phases: {
                analysis: { model: 'cli-analysis' }, // Override analysis model
            },
        });

        const merged = mergeConfigWithCLI(config, cli);
        expect(merged.phases!.discovery!.model).toBe('config-discovery');
        expect(merged.phases!.analysis!.model).toBe('cli-analysis'); // CLI overrides
        expect(merged.phases!.analysis!.timeout).toBe(900); // Config preserved
    });

    it('should handle config-only phases', () => {
        const config = {
            phases: {
                writing: { model: 'gpt-4', depth: 'deep' as const },
            },
        };
        const cli = makeDefaultCLI();

        const merged = mergeConfigWithCLI(config, cli);
        expect(merged.phases!.writing!.model).toBe('gpt-4');
        expect(merged.phases!.writing!.depth).toBe('deep');
    });

    it('should handle CLI-only phases', () => {
        const config = {};
        const cli = makeDefaultCLI({
            phases: {
                discovery: { model: 'cli-model' },
            },
        });

        const merged = mergeConfigWithCLI(config, cli);
        expect(merged.phases!.discovery!.model).toBe('cli-model');
    });

    it('should always use CLI verbose value', () => {
        const config = {}; // config cannot set verbose
        const cli = makeDefaultCLI({ verbose: true });

        const merged = mergeConfigWithCLI(config, cli);
        expect(merged.verbose).toBe(true);
    });

    it('should preserve config path from CLI', () => {
        const config = {};
        const cli = makeDefaultCLI({ config: '/path/to/config.yaml' });

        const merged = mergeConfigWithCLI(config, cli);
        expect(merged.config).toBe('/path/to/config.yaml');
    });

    it('should handle full config + partial CLI override', () => {
        const config = {
            output: './config-wiki',
            model: 'gpt-4',
            concurrency: 10,
            timeout: 600,
            depth: 'deep' as const,
            focus: 'src/',
            title: 'Config Title',
            theme: 'dark' as const,
        };
        const cli = makeDefaultCLI({ model: 'claude-opus' });
        const explicit = new Set(['model']);

        const merged = mergeConfigWithCLI(config, cli, explicit);
        expect(merged.model).toBe('claude-opus'); // CLI override
        expect(merged.output).toBe('./config-wiki'); // from config
        expect(merged.concurrency).toBe(10); // from config
        expect(merged.timeout).toBe(600); // from config
        expect(merged.depth).toBe('deep'); // from config
        expect(merged.focus).toBe('src/'); // from config
        expect(merged.title).toBe('Config Title'); // from config
        expect(merged.theme).toBe('dark'); // from config
    });

    it('should handle boolean fields correctly', () => {
        const config = { force: true, useCache: true, strict: false, noCluster: true };
        const cli = makeDefaultCLI();

        const merged = mergeConfigWithCLI(config, cli);
        expect(merged.force).toBe(true);
        expect(merged.useCache).toBe(true);
        expect(merged.strict).toBe(false);
        expect(merged.noCluster).toBe(true);
    });

    it('should merge largeRepoThreshold from config when CLI does not set it', () => {
        const config = { largeRepoThreshold: 5000 };
        const cli = makeDefaultCLI();

        const merged = mergeConfigWithCLI(config, cli);
        expect(merged.largeRepoThreshold).toBe(5000);
    });

    it('should let explicit CLI largeRepoThreshold override config', () => {
        const config = { largeRepoThreshold: 5000 };
        const cli = makeDefaultCLI({ largeRepoThreshold: 1000 });
        const explicit = new Set(['largeRepoThreshold']);

        const merged = mergeConfigWithCLI(config, cli, explicit);
        expect(merged.largeRepoThreshold).toBe(1000);
    });

    it('should let explicit CLI booleans override config booleans', () => {
        const config = { force: true, useCache: true };
        const cli = makeDefaultCLI({ force: false, useCache: false });
        const explicit = new Set(['force', 'useCache']);

        const merged = mergeConfigWithCLI(config, cli, explicit);
        expect(merged.force).toBe(false);
        expect(merged.useCache).toBe(false);
    });

    it('should merge endPhase from config when CLI does not set it', () => {
        const config = { endPhase: 3 };
        const cli = makeDefaultCLI();

        const merged = mergeConfigWithCLI(config, cli);
        expect(merged.endPhase).toBe(3);
    });

    it('should let explicit CLI endPhase override config endPhase', () => {
        const config = { endPhase: 3 };
        const cli = makeDefaultCLI({ endPhase: 4 });
        const explicit = new Set(['endPhase']);

        const merged = mergeConfigWithCLI(config, cli, explicit);
        expect(merged.endPhase).toBe(4);
    });

    it('should handle no explicit set (empty set)', () => {
        const config = { model: 'config-model' };
        const cli = makeDefaultCLI({ model: 'cli-default' });

        // No explicit set — config should win
        const merged = mergeConfigWithCLI(config, cli, new Set());
        expect(merged.model).toBe('config-model');
    });

    it('should handle undefined cliExplicit parameter', () => {
        const config = { model: 'config-model' };
        const cli = makeDefaultCLI({ model: 'cli-default' });

        // No cliExplicit parameter — config should win
        const merged = mergeConfigWithCLI(config, cli);
        expect(merged.model).toBe('config-model');
    });

    it('should include repoPath from config in merged result', () => {
        const config = { repoPath: '/path/to/repo' };
        const cli = makeDefaultCLI();

        const merged = mergeConfigWithCLI(config, cli);
        expect(merged.repoPath).toBe('/path/to/repo');
    });

    it('should set repoPath to undefined when not in config', () => {
        const config = { model: 'gpt-4' };
        const cli = makeDefaultCLI();

        const merged = mergeConfigWithCLI(config, cli);
        expect(merged.repoPath).toBeUndefined();
    });
});

// ============================================================================
// resolvePhaseModel
// ============================================================================

describe('resolvePhaseModel', () => {
    it('should return phase-specific model when set', () => {
        const options = makeDefaultCLI({
            model: 'global-model',
            phases: { analysis: { model: 'analysis-model' } },
        });
        expect(resolvePhaseModel(options, 'analysis')).toBe('analysis-model');
    });

    it('should fall back to global model when phase model not set', () => {
        const options = makeDefaultCLI({ model: 'global-model' });
        expect(resolvePhaseModel(options, 'analysis')).toBe('global-model');
    });

    it('should return undefined when neither phase nor global model set', () => {
        const options = makeDefaultCLI();
        expect(resolvePhaseModel(options, 'discovery')).toBeUndefined();
    });

    it('should resolve correctly for each phase', () => {
        const options = makeDefaultCLI({
            model: 'default',
            phases: {
                discovery: { model: 'disc-model' },
                consolidation: { model: 'cons-model' },
                analysis: { model: 'ana-model' },
                writing: { model: 'wrt-model' },
            },
        });

        expect(resolvePhaseModel(options, 'discovery')).toBe('disc-model');
        expect(resolvePhaseModel(options, 'consolidation')).toBe('cons-model');
        expect(resolvePhaseModel(options, 'analysis')).toBe('ana-model');
        expect(resolvePhaseModel(options, 'writing')).toBe('wrt-model');
    });

    it('should handle phases object with unrelated phase set', () => {
        const options = makeDefaultCLI({
            model: 'global',
            phases: { writing: { model: 'writer' } },
        });
        // analysis not configured — falls back to global
        expect(resolvePhaseModel(options, 'analysis')).toBe('global');
    });
});

// ============================================================================
// resolvePhaseTimeout
// ============================================================================

describe('resolvePhaseTimeout', () => {
    it('should return phase-specific timeout when set', () => {
        const options = makeDefaultCLI({
            timeout: 300,
            phases: { discovery: { timeout: 600 } },
        });
        expect(resolvePhaseTimeout(options, 'discovery')).toBe(600);
    });

    it('should fall back to global timeout', () => {
        const options = makeDefaultCLI({ timeout: 300 });
        expect(resolvePhaseTimeout(options, 'analysis')).toBe(300);
    });

    it('should return undefined when no timeout set', () => {
        const options = makeDefaultCLI();
        expect(resolvePhaseTimeout(options, 'writing')).toBeUndefined();
    });
});

// ============================================================================
// resolvePhaseConcurrency
// ============================================================================

describe('resolvePhaseConcurrency', () => {
    it('should return phase-specific concurrency when set', () => {
        const options = makeDefaultCLI({
            concurrency: 5,
            phases: { analysis: { concurrency: 3 } },
        });
        expect(resolvePhaseConcurrency(options, 'analysis')).toBe(3);
    });

    it('should fall back to global concurrency', () => {
        const options = makeDefaultCLI({ concurrency: 5 });
        expect(resolvePhaseConcurrency(options, 'writing')).toBe(5);
    });

    it('should return undefined when no concurrency set', () => {
        const options = makeDefaultCLI();
        expect(resolvePhaseConcurrency(options, 'discovery')).toBeUndefined();
    });
});

// ============================================================================
// resolvePhaseDepth
// ============================================================================

describe('resolvePhaseDepth', () => {
    it('should return phase-specific depth when set', () => {
        const options = makeDefaultCLI({
            depth: 'normal',
            phases: { analysis: { depth: 'deep' } },
        });
        expect(resolvePhaseDepth(options, 'analysis')).toBe('deep');
    });

    it('should fall back to global depth', () => {
        const options = makeDefaultCLI({ depth: 'shallow' });
        expect(resolvePhaseDepth(options, 'writing')).toBe('shallow');
    });

    it('should use global depth when phase not configured', () => {
        const options = makeDefaultCLI({ depth: 'deep' });
        expect(resolvePhaseDepth(options, 'discovery')).toBe('deep');
    });
});

// ============================================================================
// Integration: loadConfig → mergeConfigWithCLI → resolvePhase*
// ============================================================================

describe('Integration: config file → merge → resolve', () => {
    it('should work end-to-end with a YAML config file', () => {
        const configPath = writeConfigFile('config.yaml', `
model: gpt-4
output: ./my-wiki
concurrency: 5
timeout: 300
depth: normal

phases:
  discovery:
    model: claude-sonnet
    timeout: 600
  analysis:
    model: claude-opus
    concurrency: 3
    timeout: 900
    depth: deep
  writing:
    model: gpt-4
    concurrency: 5
    depth: deep
`);
        // Load config
        const config = loadConfig(configPath);

        // Merge with CLI (no explicit overrides)
        const cli = makeDefaultCLI();
        const merged = mergeConfigWithCLI(config, cli);

        // Verify resolution
        expect(resolvePhaseModel(merged, 'discovery')).toBe('claude-sonnet');
        expect(resolvePhaseModel(merged, 'consolidation')).toBe('gpt-4'); // falls back to global
        expect(resolvePhaseModel(merged, 'analysis')).toBe('claude-opus');
        expect(resolvePhaseModel(merged, 'writing')).toBe('gpt-4');

        expect(resolvePhaseTimeout(merged, 'discovery')).toBe(600);
        expect(resolvePhaseTimeout(merged, 'consolidation')).toBe(300); // falls back to global
        expect(resolvePhaseTimeout(merged, 'analysis')).toBe(900);
        expect(resolvePhaseTimeout(merged, 'writing')).toBe(300); // falls back to global

        expect(resolvePhaseConcurrency(merged, 'analysis')).toBe(3);
        expect(resolvePhaseConcurrency(merged, 'writing')).toBe(5);

        expect(resolvePhaseDepth(merged, 'analysis')).toBe('deep');
        expect(resolvePhaseDepth(merged, 'writing')).toBe('deep');
        expect(resolvePhaseDepth(merged, 'discovery')).toBe('normal'); // falls back to global
    });

    it('should let CLI override config model', () => {
        const configPath = writeConfigFile('config.yaml', `
model: config-model
phases:
  analysis:
    model: config-analysis-model
`);
        const config = loadConfig(configPath);

        // CLI explicitly sets model
        const cli = makeDefaultCLI({ model: 'cli-model' });
        const explicit = new Set(['model']);
        const merged = mergeConfigWithCLI(config, cli, explicit);

        // Global model is from CLI
        expect(merged.model).toBe('cli-model');
        // Phase-specific model is still from config
        expect(resolvePhaseModel(merged, 'analysis')).toBe('config-analysis-model');
        // Phases without override get the CLI global model
        expect(resolvePhaseModel(merged, 'writing')).toBe('cli-model');
    });

    it('should handle config-only (no CLI overrides)', () => {
        const configPath = writeConfigFile('config.yaml', `
model: my-model
output: ./output
concurrency: 8
`);
        const config = loadConfig(configPath);
        const merged = mergeConfigWithCLI(config, makeDefaultCLI());

        expect(merged.model).toBe('my-model');
        expect(merged.output).toBe('./output');
        expect(merged.concurrency).toBe(8);
    });

    it('should handle CLI-only (empty config)', () => {
        const configPath = writeConfigFile('config.yaml', `{}`);
        const config = loadConfig(configPath);
        const cli = makeDefaultCLI({ model: 'cli-model', concurrency: 10 });
        const explicit = new Set(['model', 'concurrency']);
        const merged = mergeConfigWithCLI(config, cli, explicit);

        expect(merged.model).toBe('cli-model');
        expect(merged.concurrency).toBe(10);
    });
});
