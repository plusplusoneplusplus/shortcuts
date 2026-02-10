/**
 * Config Loader
 *
 * Loads and validates a YAML configuration file for the `deep-wiki generate` command.
 * Merges config-file values with CLI flags, resolving per-phase overrides.
 *
 * Resolution order (highest priority first):
 *   1. CLI flags (--model, --timeout, etc.)
 *   2. Phase-specific config (phases.analysis.model)
 *   3. Global config (model)
 *   4. Defaults (existing defaults in code)
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import type {
    DeepWikiConfigFile,
    GenerateCommandOptions,
    PhaseName,
    PhasesConfig,
    WebsiteTheme,
} from './types';

// ============================================================================
// Config Loading
// ============================================================================

/**
 * Load and parse a YAML configuration file.
 *
 * @param configPath - Absolute or relative path to the YAML config file
 * @returns Parsed config object
 * @throws If the file does not exist, cannot be read, or contains invalid YAML
 */
export function loadConfig(configPath: string): DeepWikiConfigFile {
    const absolutePath = path.resolve(configPath);

    if (!fs.existsSync(absolutePath)) {
        throw new Error(`Config file not found: ${absolutePath}`);
    }

    const content = fs.readFileSync(absolutePath, 'utf-8');

    let parsed: unknown;
    try {
        parsed = yaml.load(content);
    } catch (e) {
        throw new Error(`Invalid YAML in config file: ${(e as Error).message}`);
    }

    if (parsed === null || parsed === undefined || typeof parsed !== 'object') {
        throw new Error('Config file is empty or not a valid YAML object');
    }

    return validateConfig(parsed as Record<string, unknown>);
}

/**
 * Try to auto-discover a config file in the given directory.
 * Looks for `deep-wiki.config.yaml` or `deep-wiki.config.yml`.
 *
 * @param dir - Directory to search (typically the repo root)
 * @returns Absolute path to config file, or undefined if not found
 */
export function discoverConfigFile(dir: string): string | undefined {
    const candidates = ['deep-wiki.config.yaml', 'deep-wiki.config.yml'];
    for (const filename of candidates) {
        const candidate = path.join(dir, filename);
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }
    return undefined;
}

// ============================================================================
// Config Merging
// ============================================================================

/**
 * Sentinel value indicating a CLI flag was explicitly set.
 * Used to distinguish "user passed --model X" from "model was never set".
 */
interface CLIOverrides {
    /** Fields explicitly set via CLI flags (not defaults) */
    explicitFields: Set<string>;
}

/**
 * Merge a config file with CLI options.
 * CLI flags override config file values. Config file fills in unset fields.
 *
 * @param config - Parsed config file
 * @param cliOptions - Options from CLI flags
 * @param cliExplicit - Set of field names explicitly provided via CLI (not defaults)
 * @returns Merged GenerateCommandOptions
 */
export function mergeConfigWithCLI(
    config: DeepWikiConfigFile,
    cliOptions: GenerateCommandOptions,
    cliExplicit?: Set<string>
): GenerateCommandOptions {
    const explicit = cliExplicit || new Set<string>();

    // Helper: use CLI value if explicitly set, otherwise config value, otherwise existing CLI default
    function resolve<T>(field: string, cliVal: T, configVal: T | undefined): T {
        if (explicit.has(field)) {
            return cliVal;
        }
        return configVal !== undefined ? configVal : cliVal;
    }

    // Merge phases: config phases are the base, CLI phases (if any) override
    let mergedPhases: PhasesConfig | undefined;
    if (config.phases || cliOptions.phases) {
        mergedPhases = { ...config.phases };
        if (cliOptions.phases) {
            for (const [phase, overrides] of Object.entries(cliOptions.phases)) {
                const phaseName = phase as PhaseName;
                mergedPhases[phaseName] = {
                    ...mergedPhases[phaseName],
                    ...overrides,
                };
            }
        }
    }

    return {
        output: resolve('output', cliOptions.output, config.output),
        model: resolve('model', cliOptions.model, config.model),
        concurrency: resolve('concurrency', cliOptions.concurrency, config.concurrency),
        timeout: resolve('timeout', cliOptions.timeout, config.timeout),
        focus: resolve('focus', cliOptions.focus, config.focus),
        depth: resolve('depth', cliOptions.depth, config.depth),
        force: resolve('force', cliOptions.force, config.force),
        useCache: resolve('useCache', cliOptions.useCache, config.useCache),
        phase: resolve('phase', cliOptions.phase, config.phase),
        verbose: cliOptions.verbose, // always from CLI
        skipWebsite: resolve('skipWebsite', cliOptions.skipWebsite, config.skipWebsite),
        theme: resolve('theme', cliOptions.theme, config.theme as WebsiteTheme | undefined),
        title: resolve('title', cliOptions.title, config.title),
        seeds: resolve('seeds', cliOptions.seeds, config.seeds),
        noCluster: resolve('noCluster', cliOptions.noCluster, config.noCluster),
        strict: resolve('strict', cliOptions.strict, config.strict),
        config: cliOptions.config,
        phases: mergedPhases,
    };
}

// ============================================================================
// Per-Phase Resolution
// ============================================================================

/**
 * Resolve the AI model for a specific phase.
 *
 * Resolution order:
 *   1. Phase-specific config (options.phases[phase].model)
 *   2. Global option (options.model)
 *   3. undefined (use SDK default)
 */
export function resolvePhaseModel(
    options: GenerateCommandOptions,
    phase: PhaseName
): string | undefined {
    return options.phases?.[phase]?.model ?? options.model;
}

/**
 * Resolve the timeout (in seconds) for a specific phase.
 *
 * Resolution order:
 *   1. Phase-specific config (options.phases[phase].timeout)
 *   2. Global option (options.timeout)
 *   3. undefined (use phase default)
 */
export function resolvePhaseTimeout(
    options: GenerateCommandOptions,
    phase: PhaseName
): number | undefined {
    return options.phases?.[phase]?.timeout ?? options.timeout;
}

/**
 * Resolve the concurrency for a specific phase.
 *
 * Resolution order:
 *   1. Phase-specific config (options.phases[phase].concurrency)
 *   2. Global option (options.concurrency)
 *   3. undefined (use phase default)
 */
export function resolvePhaseConcurrency(
    options: GenerateCommandOptions,
    phase: PhaseName
): number | undefined {
    return options.phases?.[phase]?.concurrency ?? options.concurrency;
}

/**
 * Resolve the depth for a specific phase.
 *
 * Resolution order:
 *   1. Phase-specific config (options.phases[phase].depth)
 *   2. Global option (options.depth)
 */
export function resolvePhaseDepth(
    options: GenerateCommandOptions,
    phase: PhaseName
): 'shallow' | 'normal' | 'deep' {
    return options.phases?.[phase]?.depth ?? options.depth;
}

// ============================================================================
// Validation
// ============================================================================

const VALID_DEPTHS = new Set(['shallow', 'normal', 'deep']);
const VALID_THEMES = new Set(['light', 'dark', 'auto']);
const VALID_PHASE_NAMES = new Set<string>(['discovery', 'consolidation', 'analysis', 'writing']);

/**
 * Validate a raw parsed config object and return a typed DeepWikiConfigFile.
 *
 * @param raw - Raw parsed YAML object
 * @returns Validated config
 * @throws If the config contains invalid values
 */
export function validateConfig(raw: Record<string, unknown>): DeepWikiConfigFile {
    const config: DeepWikiConfigFile = {};

    // String fields
    if (raw.repoPath !== undefined) {
        if (typeof raw.repoPath !== 'string') {
            throw new Error('Config error: "repoPath" must be a string');
        }
        config.repoPath = raw.repoPath;
    }

    if (raw.output !== undefined) {
        if (typeof raw.output !== 'string') {
            throw new Error('Config error: "output" must be a string');
        }
        config.output = raw.output;
    }

    if (raw.model !== undefined) {
        if (typeof raw.model !== 'string') {
            throw new Error('Config error: "model" must be a string');
        }
        config.model = raw.model;
    }

    if (raw.focus !== undefined) {
        if (typeof raw.focus !== 'string') {
            throw new Error('Config error: "focus" must be a string');
        }
        config.focus = raw.focus;
    }

    if (raw.seeds !== undefined) {
        if (typeof raw.seeds !== 'string') {
            throw new Error('Config error: "seeds" must be a string');
        }
        config.seeds = raw.seeds;
    }

    if (raw.title !== undefined) {
        if (typeof raw.title !== 'string') {
            throw new Error('Config error: "title" must be a string');
        }
        config.title = raw.title;
    }

    // Number fields
    if (raw.concurrency !== undefined) {
        if (typeof raw.concurrency !== 'number' || !Number.isFinite(raw.concurrency) || raw.concurrency < 1) {
            throw new Error('Config error: "concurrency" must be a positive number');
        }
        config.concurrency = raw.concurrency;
    }

    if (raw.timeout !== undefined) {
        if (typeof raw.timeout !== 'number' || !Number.isFinite(raw.timeout) || raw.timeout < 1) {
            throw new Error('Config error: "timeout" must be a positive number');
        }
        config.timeout = raw.timeout;
    }

    if (raw.phase !== undefined) {
        if (typeof raw.phase !== 'number' || !Number.isInteger(raw.phase) || raw.phase < 1 || raw.phase > 4) {
            throw new Error('Config error: "phase" must be an integer between 1 and 4');
        }
        config.phase = raw.phase;
    }

    // Boolean fields
    if (raw.useCache !== undefined) {
        if (typeof raw.useCache !== 'boolean') {
            throw new Error('Config error: "useCache" must be a boolean');
        }
        config.useCache = raw.useCache;
    }

    if (raw.force !== undefined) {
        if (typeof raw.force !== 'boolean') {
            throw new Error('Config error: "force" must be a boolean');
        }
        config.force = raw.force;
    }

    if (raw.noCluster !== undefined) {
        if (typeof raw.noCluster !== 'boolean') {
            throw new Error('Config error: "noCluster" must be a boolean');
        }
        config.noCluster = raw.noCluster;
    }

    if (raw.strict !== undefined) {
        if (typeof raw.strict !== 'boolean') {
            throw new Error('Config error: "strict" must be a boolean');
        }
        config.strict = raw.strict;
    }

    if (raw.skipWebsite !== undefined) {
        if (typeof raw.skipWebsite !== 'boolean') {
            throw new Error('Config error: "skipWebsite" must be a boolean');
        }
        config.skipWebsite = raw.skipWebsite;
    }

    // Enum fields
    if (raw.depth !== undefined) {
        if (typeof raw.depth !== 'string' || !VALID_DEPTHS.has(raw.depth)) {
            throw new Error(`Config error: "depth" must be one of: ${[...VALID_DEPTHS].join(', ')}`);
        }
        config.depth = raw.depth as 'shallow' | 'normal' | 'deep';
    }

    if (raw.theme !== undefined) {
        if (typeof raw.theme !== 'string' || !VALID_THEMES.has(raw.theme)) {
            throw new Error(`Config error: "theme" must be one of: ${[...VALID_THEMES].join(', ')}`);
        }
        config.theme = raw.theme as 'light' | 'dark' | 'auto';
    }

    // Phases map
    if (raw.phases !== undefined) {
        if (typeof raw.phases !== 'object' || raw.phases === null || Array.isArray(raw.phases)) {
            throw new Error('Config error: "phases" must be an object');
        }

        const phases: PhasesConfig = {};
        for (const [key, value] of Object.entries(raw.phases as Record<string, unknown>)) {
            if (!VALID_PHASE_NAMES.has(key)) {
                throw new Error(`Config error: unknown phase "${key}". Valid phases: ${[...VALID_PHASE_NAMES].join(', ')}`);
            }

            if (typeof value !== 'object' || value === null || Array.isArray(value)) {
                throw new Error(`Config error: phases.${key} must be an object`);
            }

            const phaseRaw = value as Record<string, unknown>;
            const phaseConfig: Record<string, unknown> = {};

            if (phaseRaw.model !== undefined) {
                if (typeof phaseRaw.model !== 'string') {
                    throw new Error(`Config error: phases.${key}.model must be a string`);
                }
                phaseConfig.model = phaseRaw.model;
            }

            if (phaseRaw.timeout !== undefined) {
                if (typeof phaseRaw.timeout !== 'number' || !Number.isFinite(phaseRaw.timeout) || phaseRaw.timeout < 1) {
                    throw new Error(`Config error: phases.${key}.timeout must be a positive number`);
                }
                phaseConfig.timeout = phaseRaw.timeout;
            }

            if (phaseRaw.concurrency !== undefined) {
                if (typeof phaseRaw.concurrency !== 'number' || !Number.isFinite(phaseRaw.concurrency) || phaseRaw.concurrency < 1) {
                    throw new Error(`Config error: phases.${key}.concurrency must be a positive number`);
                }
                phaseConfig.concurrency = phaseRaw.concurrency;
            }

            if (phaseRaw.depth !== undefined) {
                if (typeof phaseRaw.depth !== 'string' || !VALID_DEPTHS.has(phaseRaw.depth)) {
                    throw new Error(`Config error: phases.${key}.depth must be one of: ${[...VALID_DEPTHS].join(', ')}`);
                }
                phaseConfig.depth = phaseRaw.depth;
            }

            if (phaseRaw.skipAI !== undefined) {
                if (typeof phaseRaw.skipAI !== 'boolean') {
                    throw new Error(`Config error: phases.${key}.skipAI must be a boolean`);
                }
                phaseConfig.skipAI = phaseRaw.skipAI;
            }

            phases[key as PhaseName] = phaseConfig;
        }

        config.phases = phases;
    }

    return config;
}
