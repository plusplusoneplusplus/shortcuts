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
import { getErrorMessage } from './utils/error-utils';
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
        throw new Error(`Invalid YAML in config file: ${getErrorMessage(e)}`);
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

function fieldLabel(field: string, prefix?: string): string {
    return prefix ? `${prefix}${field}` : `"${field}"`;
}

function assignString(raw: Record<string, unknown>, field: string, target: Record<string, unknown>, prefix?: string): void {
    if (raw[field] !== undefined) {
        if (typeof raw[field] !== 'string') {
            throw new Error(`Config error: ${fieldLabel(field, prefix)} must be a string`);
        }
        target[field] = raw[field];
    }
}

function assignBoolean(raw: Record<string, unknown>, field: string, target: Record<string, unknown>, prefix?: string): void {
    if (raw[field] !== undefined) {
        if (typeof raw[field] !== 'boolean') {
            throw new Error(`Config error: ${fieldLabel(field, prefix)} must be a boolean`);
        }
        target[field] = raw[field];
    }
}

function assignPositiveNumber(raw: Record<string, unknown>, field: string, target: Record<string, unknown>, prefix?: string): void {
    if (raw[field] !== undefined) {
        if (typeof raw[field] !== 'number' || !Number.isFinite(raw[field] as number) || (raw[field] as number) < 1) {
            throw new Error(`Config error: ${fieldLabel(field, prefix)} must be a positive number`);
        }
        target[field] = raw[field];
    }
}

function assignEnum(raw: Record<string, unknown>, field: string, target: Record<string, unknown>, validValues: Set<string>, prefix?: string): void {
    if (raw[field] !== undefined) {
        if (typeof raw[field] !== 'string' || !validValues.has(raw[field] as string)) {
            throw new Error(`Config error: ${fieldLabel(field, prefix)} must be one of: ${[...validValues].join(', ')}`);
        }
        target[field] = raw[field];
    }
}

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
    assignString(raw, 'repoPath', config);
    assignString(raw, 'output', config);
    assignString(raw, 'model', config);
    assignString(raw, 'focus', config);
    assignString(raw, 'seeds', config);
    assignString(raw, 'title', config);

    // Number fields
    assignPositiveNumber(raw, 'concurrency', config);
    assignPositiveNumber(raw, 'timeout', config);

    // Phase (custom: integer check + range 1-4)
    if (raw.phase !== undefined) {
        if (typeof raw.phase !== 'number' || !Number.isInteger(raw.phase) || raw.phase < 1 || raw.phase > 4) {
            throw new Error('Config error: "phase" must be an integer between 1 and 4');
        }
        config.phase = raw.phase;
    }

    // Boolean fields
    assignBoolean(raw, 'useCache', config);
    assignBoolean(raw, 'force', config);
    assignBoolean(raw, 'noCluster', config);
    assignBoolean(raw, 'strict', config);
    assignBoolean(raw, 'skipWebsite', config);

    // Enum fields
    assignEnum(raw, 'depth', config, VALID_DEPTHS);
    assignEnum(raw, 'theme', config, VALID_THEMES);

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
            const phasePrefix = `phases.${key}.`;

            assignString(phaseRaw, 'model', phaseConfig, phasePrefix);
            assignPositiveNumber(phaseRaw, 'timeout', phaseConfig, phasePrefix);
            assignPositiveNumber(phaseRaw, 'concurrency', phaseConfig, phasePrefix);
            assignEnum(phaseRaw, 'depth', phaseConfig, VALID_DEPTHS, phasePrefix);
            assignBoolean(phaseRaw, 'skipAI', phaseConfig, phasePrefix);

            phases[key as PhaseName] = phaseConfig;
        }

        config.phases = phases;
    }

    return config;
}
