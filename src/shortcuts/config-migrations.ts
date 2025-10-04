/**
 * Configuration migration system for backward compatibility
 * 
 * This module handles migrating configuration files from older versions to the current format.
 * Each migration is a pure function that transforms config from version N to N+1.
 * 
 * Version History:
 * - v1: Original format with `shortcuts` array (pre-2.0)
 * - v2: Logical groups format without nested groups (2.0-2.4)
 * - v3: Logical groups with nested groups support (2.5+)
 */

import * as fs from 'fs';
import * as path from 'path';
import { LogicalGroup, ShortcutsConfig } from './types';

/**
 * Configuration version number
 * Increment this when making breaking changes to the config format
 */
export const CURRENT_CONFIG_VERSION = 3;

/**
 * Versioned configuration that includes version metadata
 */
export interface VersionedConfig extends ShortcutsConfig {
    /** Version number of the configuration format */
    version?: number;
}

/**
 * Migration function signature
 * Takes config at version N and returns config at version N+1
 */
export type MigrationFunction = (config: any, context: MigrationContext) => any;

/**
 * Context passed to migration functions
 */
export interface MigrationContext {
    /** Workspace root path for resolving relative paths */
    workspaceRoot: string;
    /** Whether to log migration steps */
    verbose?: boolean;
}

/**
 * Migration result with metadata
 */
export interface MigrationResult {
    /** Migrated configuration */
    config: VersionedConfig;
    /** Original version */
    fromVersion: number;
    /** Final version after migration */
    toVersion: number;
    /** Whether any migrations were applied */
    migrated: boolean;
    /** List of migrations that were applied */
    appliedMigrations: string[];
    /** Any warnings generated during migration */
    warnings: string[];
}

/**
 * Registry of all migration functions
 * Key is the source version, value is the migration function to the next version
 */
const MIGRATIONS: Map<number, MigrationFunction> = new Map();

/**
 * Register a migration from one version to the next
 * @param fromVersion Source version number
 * @param migration Migration function
 */
function registerMigration(fromVersion: number, migration: MigrationFunction): void {
    MIGRATIONS.set(fromVersion, migration);
}

// ============================================================================
// Migration v1 -> v2: Physical shortcuts to logical groups
// ============================================================================

/**
 * Migrate from v1 (physical shortcuts array) to v2 (logical groups)
 * 
 * Old format:
 * ```yaml
 * shortcuts:
 *   - path: src
 *     name: Source Code
 * ```
 * 
 * New format:
 * ```yaml
 * version: 2
 * logicalGroups:
 *   - name: Source Code
 *     items:
 *       - path: src
 *         name: Source Code
 *         type: folder
 * ```
 */
function migrateV1ToV2(config: any, context: MigrationContext): any {
    const warnings: string[] = [];

    if (context.verbose) {
        console.log('[Migration v1->v2] Converting physical shortcuts to logical groups');
    }

    // Initialize logical groups if not present
    if (!config.logicalGroups) {
        config.logicalGroups = [];
    }

    // Migrate old shortcuts array
    if (config.shortcuts && Array.isArray(config.shortcuts)) {
        for (const shortcut of config.shortcuts) {
            if (!shortcut || typeof shortcut !== 'object') {
                warnings.push('Skipped invalid shortcut entry');
                continue;
            }

            if (typeof shortcut.path !== 'string' || !shortcut.path.trim()) {
                warnings.push('Skipped shortcut with invalid path');
                continue;
            }

            // Resolve and validate path
            try {
                const resolvedPath = path.isAbsolute(shortcut.path)
                    ? shortcut.path
                    : path.resolve(context.workspaceRoot, shortcut.path);

                if (!fs.existsSync(resolvedPath)) {
                    warnings.push(`Skipped shortcut with non-existent path: ${shortcut.path}`);
                    continue;
                }

                const stat = fs.statSync(resolvedPath);
                const itemType = stat.isDirectory() ? 'folder' : 'file';

                if (!stat.isDirectory()) {
                    warnings.push(`Skipped non-directory shortcut: ${shortcut.path}`);
                    continue;
                }

                const groupName = shortcut.name || path.basename(resolvedPath);

                // Check if group already exists
                const existingGroup = config.logicalGroups.find((g: any) => g.name === groupName);
                if (existingGroup) {
                    warnings.push(`Group "${groupName}" already exists, skipped duplicate`);
                    continue;
                }

                // Create new logical group
                const newGroup: LogicalGroup = {
                    name: groupName,
                    items: [
                        {
                            path: shortcut.path,
                            name: path.basename(resolvedPath),
                            type: itemType
                        }
                    ]
                };

                config.logicalGroups.push(newGroup);
            } catch (error) {
                const err = error instanceof Error ? error : new Error('Unknown error');
                warnings.push(`Error migrating shortcut ${shortcut.path}: ${err.message}`);
            }
        }

        // Remove old shortcuts array
        delete config.shortcuts;
    }

    // Set version
    config.version = 2;

    // Store warnings in config for retrieval
    if (warnings.length > 0) {
        (config as any)._migrationWarnings = warnings;
    }

    return config;
}

registerMigration(1, migrateV1ToV2);

// ============================================================================
// Migration v2 -> v3: Add nested groups support
// ============================================================================

/**
 * Migrate from v2 to v3 (add nested groups support)
 * 
 * This is a non-breaking change - v2 configs are valid v3 configs.
 * We just update the version number and ensure the structure is compatible.
 * 
 * Changes:
 * - LogicalGroup now supports optional `groups` array for nesting
 * - LogicalGroupItem now supports 'command' and 'task' types
 */
function migrateV2ToV3(config: any, context: MigrationContext): any {
    if (context.verbose) {
        console.log('[Migration v2->v3] Updating to nested groups format');
    }

    // v2 configs are structurally compatible with v3
    // Just update the version number
    config.version = 3;

    // Ensure all groups have the items array (should already exist)
    if (config.logicalGroups && Array.isArray(config.logicalGroups)) {
        for (const group of config.logicalGroups) {
            if (!Array.isArray(group.items)) {
                group.items = [];
            }
        }
    }

    return config;
}

registerMigration(2, migrateV2ToV3);

// ============================================================================
// Migration Engine
// ============================================================================

/**
 * Detect the version of a configuration object
 * @param config Configuration object to check
 * @returns Detected version number
 */
export function detectConfigVersion(config: any): number {
    // Explicit version field (v2+)
    if (typeof config.version === 'number') {
        return config.version;
    }

    // Has old shortcuts array (v1)
    if (config.shortcuts && Array.isArray(config.shortcuts)) {
        return 1;
    }

    // Has logical groups without version (v2)
    if (config.logicalGroups && Array.isArray(config.logicalGroups)) {
        return 2;
    }

    // Empty or unknown config - treat as current version
    return CURRENT_CONFIG_VERSION;
}

/**
 * Migrate configuration from any version to the current version
 * @param config Configuration object to migrate
 * @param context Migration context
 * @returns Migration result with migrated config and metadata
 */
export function migrateConfig(config: any, context: MigrationContext): MigrationResult {
    const startVersion = detectConfigVersion(config);
    const appliedMigrations: string[] = [];
    const allWarnings: string[] = [];

    if (context.verbose) {
        console.log(`[Migration] Detected config version: ${startVersion}`);
        console.log(`[Migration] Target version: ${CURRENT_CONFIG_VERSION}`);
    }

    // Already at current version
    if (startVersion === CURRENT_CONFIG_VERSION) {
        return {
            config: config as VersionedConfig,
            fromVersion: startVersion,
            toVersion: CURRENT_CONFIG_VERSION,
            migrated: false,
            appliedMigrations: [],
            warnings: []
        };
    }

    // Apply migrations sequentially
    let currentConfig = config;
    let currentVersion = startVersion;

    while (currentVersion < CURRENT_CONFIG_VERSION) {
        const migration = MIGRATIONS.get(currentVersion);

        if (!migration) {
            throw new Error(
                `No migration path from version ${currentVersion} to ${currentVersion + 1}. ` +
                `This may indicate a corrupted configuration or unsupported version.`
            );
        }

        if (context.verbose) {
            console.log(`[Migration] Applying migration v${currentVersion} -> v${currentVersion + 1}`);
        }

        // Apply migration
        currentConfig = migration(currentConfig, context);
        appliedMigrations.push(`v${currentVersion}->v${currentVersion + 1}`);

        // Extract warnings if any
        if (currentConfig._migrationWarnings) {
            allWarnings.push(...currentConfig._migrationWarnings);
            delete currentConfig._migrationWarnings;
        }

        currentVersion++;
    }

    // Ensure final version is set
    currentConfig.version = CURRENT_CONFIG_VERSION;

    return {
        config: currentConfig as VersionedConfig,
        fromVersion: startVersion,
        toVersion: CURRENT_CONFIG_VERSION,
        migrated: true,
        appliedMigrations,
        warnings: allWarnings
    };
}

/**
 * Validate that a configuration can be migrated
 * @param config Configuration to validate
 * @returns True if migration is possible, false otherwise
 */
export function canMigrate(config: any): boolean {
    try {
        const version = detectConfigVersion(config);

        // Check if we have migrations for all steps
        for (let v = version; v < CURRENT_CONFIG_VERSION; v++) {
            if (!MIGRATIONS.has(v)) {
                return false;
            }
        }

        return true;
    } catch {
        return false;
    }
}

/**
 * Get list of all supported versions
 * @returns Array of version numbers that can be migrated from
 */
export function getSupportedVersions(): number[] {
    const versions = new Set<number>();

    // Add all source versions that have migrations
    for (const [version] of MIGRATIONS) {
        versions.add(version);
    }

    // Add current version
    versions.add(CURRENT_CONFIG_VERSION);

    return Array.from(versions).sort((a, b) => a - b);
}
