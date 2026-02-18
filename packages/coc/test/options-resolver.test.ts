/**
 * Options Resolver Tests
 *
 * Tests for the CLI options resolver functions that merge
 * CLI flags with config file defaults.
 */

import { describe, it, expect } from 'vitest';
import {
    resolveRunOptions,
    resolveListOptions,
    resolveServeOptions,
    resolveWipeDataOptions,
} from '../src/commands/options-resolver';
import type { ResolvedCLIConfig } from '../src/config';
import { DEFAULT_CONFIG } from '../src/config';

// ============================================================================
// Helpers
// ============================================================================

function makeConfig(overrides: Partial<ResolvedCLIConfig> = {}): ResolvedCLIConfig {
    return { ...DEFAULT_CONFIG, ...overrides };
}

// ============================================================================
// resolveRunOptions
// ============================================================================

describe('resolveRunOptions', () => {
    it('should use config defaults when CLI opts are empty', () => {
        const config = makeConfig({ model: 'gpt-4', parallel: 10, output: 'json', timeout: 60 });
        const result = resolveRunOptions({ param: {} }, config);

        expect(result.model).toBe('gpt-4');
        expect(result.parallel).toBe(10);
        expect(result.output).toBe('json');
        expect(result.timeout).toBe(60);
        expect(result.verbose).toBe(false);
        expect(result.dryRun).toBe(false);
        expect(result.noColor).toBe(true); // !undefined => true
        expect(result.approvePermissions).toBe(false);
        expect(result.persist).toBe(true);
    });

    it('should prefer CLI opts over config values', () => {
        const config = makeConfig({ model: 'gpt-4', parallel: 5, output: 'table' });
        const opts = {
            model: 'claude-3',
            parallel: 20,
            output: 'csv',
            param: { key: 'val' },
            verbose: true,
            dryRun: true,
            timeout: 120,
            color: true,
            approvePermissions: true,
            persist: false,
        };

        const result = resolveRunOptions(opts, config);

        expect(result.model).toBe('claude-3');
        expect(result.parallel).toBe(20);
        expect(result.output).toBe('csv');
        expect(result.params).toEqual({ key: 'val' });
        expect(result.verbose).toBe(true);
        expect(result.dryRun).toBe(true);
        expect(result.timeout).toBe(120);
        expect(result.noColor).toBe(false);
        expect(result.approvePermissions).toBe(true);
        expect(result.persist).toBe(false);
    });

    it('should handle mixed sources (some from CLI, some from config)', () => {
        const config = makeConfig({ model: 'gpt-4', parallel: 8 });
        const opts = {
            model: 'claude-3',
            param: {},
        };

        const result = resolveRunOptions(opts, config);

        expect(result.model).toBe('claude-3');
        expect(result.parallel).toBe(8);
    });

    it('should handle --no-color (commander sets color: false)', () => {
        const config = makeConfig();
        const opts = { color: false, param: {} };

        const result = resolveRunOptions(opts, config);

        expect(result.noColor).toBe(true);
    });

    it('should handle color: true', () => {
        const config = makeConfig();
        const opts = { color: true, param: {} };

        const result = resolveRunOptions(opts, config);

        expect(result.noColor).toBe(false);
    });

    it('should use ?? for persist (allowing false)', () => {
        const config = makeConfig({ persist: true });
        const opts = { persist: false, param: {} };

        const result = resolveRunOptions(opts, config);

        expect(result.persist).toBe(false);
    });

    it('should fall back to config.persist when opts.persist is undefined', () => {
        const config = makeConfig({ persist: false });
        const opts = { param: {} };

        const result = resolveRunOptions(opts, config);

        expect(result.persist).toBe(false);
    });

    it('should resolve dataDir from config.serve', () => {
        const config = makeConfig();
        const opts = { param: {} };

        const result = resolveRunOptions(opts, config);

        expect(result.dataDir).toBe(config.serve?.dataDir);
    });

    it('should handle approvePermissions from config', () => {
        const config = makeConfig({ approvePermissions: true });
        const opts = { param: {} };

        const result = resolveRunOptions(opts, config);

        expect(result.approvePermissions).toBe(true);
    });

    it('should resolve optional string fields as undefined when absent', () => {
        const config = makeConfig();
        const opts = { param: {} };

        const result = resolveRunOptions(opts, config);

        expect(result.outputFile).toBeUndefined();
        expect(result.workspaceRoot).toBeUndefined();
    });

    it('should pass through outputFile and workspaceRoot from opts', () => {
        const config = makeConfig();
        const opts = {
            outputFile: '/tmp/out.json',
            workspaceRoot: '/home/user/project',
            param: {},
        };

        const result = resolveRunOptions(opts, config);

        expect(result.outputFile).toBe('/tmp/out.json');
        expect(result.workspaceRoot).toBe('/home/user/project');
    });

    it('should populate all required RunCommandOptions fields', () => {
        const config = makeConfig();
        const opts = { param: {} };

        const result = resolveRunOptions(opts, config);

        // Verify all fields exist (no undefined required fields)
        expect(result).toHaveProperty('output');
        expect(result).toHaveProperty('params');
        expect(result).toHaveProperty('verbose');
        expect(result).toHaveProperty('dryRun');
        expect(result).toHaveProperty('noColor');
        expect(result).toHaveProperty('approvePermissions');
        expect(result).toHaveProperty('persist');
    });
});

// ============================================================================
// resolveListOptions
// ============================================================================

describe('resolveListOptions', () => {
    it('should use config output format when opts.output is absent', () => {
        const config = makeConfig({ output: 'json' });
        const result = resolveListOptions({}, config);

        expect(result.format).toBe('json');
    });

    it('should prefer CLI output over config', () => {
        const config = makeConfig({ output: 'json' });
        const result = resolveListOptions({ output: 'csv' }, config);

        expect(result.format).toBe('csv');
    });

    it('should handle markdown format', () => {
        const config = makeConfig();
        const result = resolveListOptions({ output: 'markdown' }, config);

        expect(result.format).toBe('markdown');
    });

    it('should default to table when nothing specified', () => {
        const config = makeConfig();
        const result = resolveListOptions({}, config);

        expect(result.format).toBe('table');
    });
});

// ============================================================================
// resolveServeOptions
// ============================================================================

describe('resolveServeOptions', () => {
    it('should use config serve defaults when opts are empty', () => {
        const config = makeConfig();
        const result = resolveServeOptions({}, config);

        expect(result.port).toBe(4000);
        expect(result.host).toBe('localhost');
        expect(result.dataDir).toBe('~/.coc');
        expect(result.theme).toBe('auto');
    });

    it('should prefer CLI opts over config serve values', () => {
        const config = makeConfig();
        const opts = {
            port: 8080,
            host: '0.0.0.0',
            dataDir: '/custom/data',
            theme: 'dark',
        };

        const result = resolveServeOptions(opts, config);

        expect(result.port).toBe(8080);
        expect(result.host).toBe('0.0.0.0');
        expect(result.dataDir).toBe('/custom/data');
        expect(result.theme).toBe('dark');
    });

    it('should handle --no-open (commander sets open: false)', () => {
        const config = makeConfig();
        const result = resolveServeOptions({ open: false }, config);

        expect(result.open).toBe(false);
    });

    it('should pass through open: true', () => {
        const config = makeConfig();
        const result = resolveServeOptions({ open: true }, config);

        expect(result.open).toBe(true);
    });

    it('should handle open: undefined (no flag provided)', () => {
        const config = makeConfig();
        const result = resolveServeOptions({}, config);

        expect(result.open).toBeUndefined();
    });

    it('should handle --no-color (commander sets color: false)', () => {
        const config = makeConfig();
        const result = resolveServeOptions({ color: false }, config);

        expect(result.noColor).toBe(true);
    });

    it('should set noColor false when color is not disabled', () => {
        const config = makeConfig();
        const result = resolveServeOptions({ color: true }, config);

        expect(result.noColor).toBe(false);
    });

    it('should handle --no-drain (commander sets drain: false)', () => {
        const config = makeConfig();
        const result = resolveServeOptions({ drain: false }, config);

        expect(result.noDrain).toBe(true);
    });

    it('should set noDrain false when drain is not disabled', () => {
        const config = makeConfig();
        const result = resolveServeOptions({}, config);

        expect(result.noDrain).toBe(false);
    });

    it('should pass through drainTimeout', () => {
        const config = makeConfig();
        const result = resolveServeOptions({ drainTimeout: 30 }, config);

        expect(result.drainTimeout).toBe(30);
    });

    it('should use ?? for port (allowing 0)', () => {
        const config = makeConfig();
        const result = resolveServeOptions({ port: 0 }, config);

        expect(result.port).toBe(0);
    });

    it('should fall back to config when no serve config exists', () => {
        const config: ResolvedCLIConfig = {
            parallel: 5,
            output: 'table',
            approvePermissions: false,
            persist: true,
        };
        const result = resolveServeOptions({}, config);

        expect(result.port).toBeUndefined();
        expect(result.host).toBeUndefined();
        expect(result.dataDir).toBeUndefined();
        expect(result.theme).toBeUndefined();
    });
});

// ============================================================================
// resolveWipeDataOptions
// ============================================================================

describe('resolveWipeDataOptions', () => {
    it('should resolve all boolean flags', () => {
        const config = makeConfig();
        const opts = {
            confirm: true,
            includeWikis: true,
            dryRun: true,
        };

        const result = resolveWipeDataOptions(opts, config);

        expect(result.confirm).toBe(true);
        expect(result.includeWikis).toBe(true);
        expect(result.dryRun).toBe(true);
    });

    it('should default boolean flags to false', () => {
        const config = makeConfig();
        const result = resolveWipeDataOptions({}, config);

        expect(result.confirm).toBe(false);
        expect(result.includeWikis).toBe(false);
        expect(result.dryRun).toBe(false);
    });

    it('should resolve dataDir from opts or config', () => {
        const config = makeConfig();
        const result = resolveWipeDataOptions({ dataDir: '/custom' }, config);

        expect(result.dataDir).toBe('/custom');
    });

    it('should fall back to config.serve.dataDir for dataDir', () => {
        const config = makeConfig();
        const result = resolveWipeDataOptions({}, config);

        expect(result.dataDir).toBe(config.serve?.dataDir);
    });

    it('should handle --no-color', () => {
        const config = makeConfig();
        const result = resolveWipeDataOptions({ color: false }, config);

        expect(result.noColor).toBe(true);
    });

    it('should set noColor false when color not disabled', () => {
        const config = makeConfig();
        const result = resolveWipeDataOptions({ color: true }, config);

        expect(result.noColor).toBe(false);
    });
});
