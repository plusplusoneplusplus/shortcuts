/**
 * Deep-Wiki Config Loader (subset)
 *
 * Minimal subset of deep-wiki/src/config-loader.ts needed by
 * dw-admin-handlers.ts. Only `discoverConfigFile` and `validateConfig`
 * are included.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as fs from 'fs';
import * as path from 'path';
import type { PhaseName, PhasesConfig } from './dw-types';

// ============================================================================
// Config Discovery
// ============================================================================

/**
 * Discover the config file in the given directory.
 * Looks for deep-wiki.config.yaml or deep-wiki.config.yml.
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
 * Validate a raw parsed config object.
 * Returns the validated config (same shape as DeepWikiConfigFile).
 */
export function validateConfig(raw: Record<string, unknown>): Record<string, unknown> {
    const config: Record<string, unknown> = {};

    assignString(raw, 'repoPath', config);
    assignString(raw, 'output', config);
    assignString(raw, 'model', config);
    assignString(raw, 'focus', config);
    assignString(raw, 'seeds', config);
    assignString(raw, 'title', config);

    assignPositiveNumber(raw, 'concurrency', config);
    assignPositiveNumber(raw, 'timeout', config);
    assignPositiveNumber(raw, 'largeRepoThreshold', config);

    if (raw.phase !== undefined) {
        if (typeof raw.phase !== 'number' || !Number.isInteger(raw.phase) || raw.phase < 1 || raw.phase > 4) {
            throw new Error('Config error: "phase" must be an integer between 1 and 4');
        }
        config.phase = raw.phase;
    }

    if (raw.endPhase !== undefined) {
        if (typeof raw.endPhase !== 'number' || !Number.isInteger(raw.endPhase) || raw.endPhase < 1 || raw.endPhase > 5) {
            throw new Error('Config error: "endPhase" must be an integer between 1 and 5');
        }
        config.endPhase = raw.endPhase;
    }

    assignBoolean(raw, 'useCache', config);
    assignBoolean(raw, 'force', config);
    assignBoolean(raw, 'noCluster', config);
    assignBoolean(raw, 'strict', config);
    assignBoolean(raw, 'skipWebsite', config);

    assignEnum(raw, 'depth', config, VALID_DEPTHS);
    assignEnum(raw, 'theme', config, VALID_THEMES);

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
