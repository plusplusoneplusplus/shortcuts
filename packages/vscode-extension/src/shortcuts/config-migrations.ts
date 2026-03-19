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
 * - v4: Auto-detected git roots as base paths (2.6+)
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { BasePath, LogicalGroup, ShortcutsConfig } from './types';

/**
 * Configuration version number
 * Increment this when making breaking changes to the config format
 */
export const CURRENT_CONFIG_VERSION = 4;

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
// Migration v3 -> v4: Auto-detect git roots and convert to base paths
// ============================================================================

/**
 * Find the git root directory for a given path
 * @param filePath Path to find git root for
 * @returns Git root path or undefined if not in a git repository
 */
function findGitRoot(filePath: string): string | undefined {
    try {
        // Resolve to real path to handle symlinks (e.g., /var -> /private/var on macOS)
        const realPath = fs.realpathSync(filePath);
        const directory = fs.statSync(realPath).isDirectory() ? realPath : path.dirname(realPath);
        const gitRoot = execSync('git rev-parse --show-toplevel', {
            cwd: directory,
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'ignore'] // Suppress stderr
        }).trim();
        return gitRoot;
    } catch (error) {
        // Not in a git repository or git not available
        return undefined;
    }
}

/**
 * Resolve a path (relative, absolute, or alias-based) to absolute path
 * @param itemPath Path to resolve
 * @param workspaceRoot Workspace root for relative paths
 * @param basePaths Existing base paths for alias resolution
 * @returns Absolute path
 */
function resolveItemPath(itemPath: string, workspaceRoot: string, basePaths: BasePath[]): string {
    // Check if path uses an alias
    if (itemPath.startsWith('@')) {
        const aliasEnd = itemPath.indexOf('/');
        const alias = aliasEnd > 0 ? itemPath.substring(0, aliasEnd) : itemPath;
        const basePath = basePaths.find(bp => bp.alias === alias);

        if (basePath) {
            const remainingPath = aliasEnd > 0 ? itemPath.substring(aliasEnd + 1) : '';
            const baseResolved = path.isAbsolute(basePath.path)
                ? basePath.path
                : path.resolve(workspaceRoot, basePath.path);
            return remainingPath ? path.join(baseResolved, remainingPath) : baseResolved;
        }
    }

    // Absolute path
    if (path.isAbsolute(itemPath)) {
        return itemPath;
    }

    // Relative path
    return path.resolve(workspaceRoot, itemPath);
}

/**
 * Generate a unique alias name for a git root
 * @param gitRoot Git root path
 * @param existingAliases Already used aliases
 * @returns Unique alias name
 */
function generateGitAlias(gitRoot: string, existingAliases: Set<string>): string {
    const repoName = path.basename(gitRoot);
    let alias = `@${repoName}`;
    let counter = 1;

    while (existingAliases.has(alias)) {
        alias = `@${repoName}${counter}`;
        counter++;
    }

    existingAliases.add(alias);
    return alias;
}

/**
 * Convert absolute path to use git root alias if applicable
 * @param absolutePath Absolute path to convert
 * @param gitRootMap Map of git roots to their aliases
 * @returns Path with alias or original path
 */
function convertToAliasPath(absolutePath: string, gitRootMap: Map<string, string>): string {
    // Find the longest matching git root (most specific)
    let longestMatch: string | undefined;
    let longestMatchLength = 0;

    for (const [gitRoot] of gitRootMap) {
        if (absolutePath.startsWith(gitRoot + path.sep) || absolutePath === gitRoot) {
            if (gitRoot.length > longestMatchLength) {
                longestMatch = gitRoot;
                longestMatchLength = gitRoot.length;
            }
        }
    }

    if (longestMatch) {
        const alias = gitRootMap.get(longestMatch)!;
        const relativePath = path.relative(longestMatch, absolutePath);
        return relativePath ? `${alias}/${relativePath.replace(/\\/g, '/')}` : alias;
    }

    return absolutePath;
}

/**
 * Process items in a group recursively to collect git roots and convert paths
 * @param group Group to process
 * @param workspaceRoot Workspace root
 * @param existingBasePaths Existing base paths
 * @param gitRootMap Map to collect git roots
 * @param warnings Array to collect warnings
 */
function processGroupItems(
    group: LogicalGroup,
    workspaceRoot: string,
    existingBasePaths: BasePath[],
    gitRootMap: Map<string, string>,
    existingAliases: Set<string>,
    warnings: string[]
): void {
    // Process items
    for (const item of group.items) {
        if (!item.path || item.type === 'command' || item.type === 'task') {
            continue;
        }

        try {
            // Resolve the item path to absolute
            const absolutePath = resolveItemPath(item.path, workspaceRoot, existingBasePaths);

            if (!fs.existsSync(absolutePath)) {
                warnings.push(`Path does not exist: ${item.path}`);
                continue;
            }

            // Resolve to real path to handle symlinks
            const realPath = fs.realpathSync(absolutePath);

            // Find git root for this path
            const gitRoot = findGitRoot(realPath);

            if (gitRoot && !gitRootMap.has(gitRoot)) {
                // Check if this git root is already covered by existing base paths
                const realGitRoot = fs.realpathSync(gitRoot);
                const alreadyExists = existingBasePaths.some(bp => {
                    try {
                        const realBasePath = fs.realpathSync(resolveItemPath(bp.path, workspaceRoot, []));
                        return realBasePath === realGitRoot;
                    } catch {
                        return false;
                    }
                });

                if (!alreadyExists) {
                    // New git root found - generate alias
                    const alias = generateGitAlias(gitRoot, existingAliases);
                    gitRootMap.set(gitRoot, alias);
                }
            }
        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            warnings.push(`Error processing path ${item.path}: ${err.message}`);
        }
    }

    // Process nested groups recursively
    if (group.groups && Array.isArray(group.groups)) {
        for (const nestedGroup of group.groups) {
            processGroupItems(nestedGroup, workspaceRoot, existingBasePaths, gitRootMap, existingAliases, warnings);
        }
    }
}

/**
 * Convert item paths in a group to use aliases
 * @param group Group to convert
 * @param workspaceRoot Workspace root
 * @param existingBasePaths Existing base paths
 * @param gitRootMap Map of git roots to aliases
 */
function convertGroupPaths(
    group: LogicalGroup,
    workspaceRoot: string,
    existingBasePaths: BasePath[],
    gitRootMap: Map<string, string>
): void {
    // Convert item paths
    for (const item of group.items) {
        if (!item.path || item.type === 'command' || item.type === 'task') {
            continue;
        }

        try {
            const absolutePath = resolveItemPath(item.path, workspaceRoot, existingBasePaths);

            // Resolve to real path to handle symlinks
            const realPath = fs.existsSync(absolutePath) ? fs.realpathSync(absolutePath) : absolutePath;
            const aliasPath = convertToAliasPath(realPath, gitRootMap);

            if (aliasPath !== realPath) {
                item.path = aliasPath;
            }
        } catch (error) {
            // Keep original path if conversion fails
        }
    }

    // Convert nested groups recursively
    if (group.groups && Array.isArray(group.groups)) {
        for (const nestedGroup of group.groups) {
            convertGroupPaths(nestedGroup, workspaceRoot, existingBasePaths, gitRootMap);
        }
    }
}

/**
 * Migrate from v3 to v4 (auto-detect git roots and convert to base paths)
 * 
 * This migration:
 * 1. Scans all file/folder paths in logical groups
 * 2. Detects git repositories for each path
 * 3. Creates base path aliases for detected git roots
 * 4. Converts absolute paths to use the new aliases
 * 
 * Example:
 * ```yaml
 * # Before (v3)
 * version: 3
 * logicalGroups:
 *   - name: Frontend
 *     items:
 *       - path: /Users/name/projects/myapp/src
 *         name: Source
 *         type: folder
 * 
 * # After (v4)
 * version: 4
 * basePaths:
 *   - alias: "@myapp"
 *     path: /Users/name/projects/myapp
 * logicalGroups:
 *   - name: Frontend
 *     items:
 *       - path: "@myapp/src"
 *         name: Source
 *         type: folder
 * ```
 */
function migrateV3ToV4(config: any, context: MigrationContext): any {
    const warnings: string[] = [];

    if (context.verbose) {
        console.log('[Migration v3->v4] Auto-detecting git roots and converting to base paths');
    }

    // Collect existing base paths and aliases
    const existingBasePaths: BasePath[] = config.basePaths || [];
    const existingAliases = new Set<string>(existingBasePaths.map(bp => bp.alias));

    // Map to store detected git roots and their aliases
    const gitRootMap = new Map<string, string>();

    // First pass: collect all git roots
    if (config.logicalGroups && Array.isArray(config.logicalGroups)) {
        for (const group of config.logicalGroups) {
            processGroupItems(group, context.workspaceRoot, existingBasePaths, gitRootMap, existingAliases, warnings);
        }
    }

    if (context.verbose && gitRootMap.size > 0) {
        console.log(`[Migration v3->v4] Detected ${gitRootMap.size} git root(s)`);
        for (const [gitRoot, alias] of gitRootMap) {
            console.log(`  ${alias} -> ${gitRoot}`);
        }
    }

    // Second pass: convert paths to use aliases
    if (config.logicalGroups && Array.isArray(config.logicalGroups)) {
        for (const group of config.logicalGroups) {
            convertGroupPaths(group, context.workspaceRoot, existingBasePaths, gitRootMap);
        }
    }

    // Add detected git roots to base paths
    if (gitRootMap.size > 0) {
        if (!config.basePaths) {
            config.basePaths = [];
        }

        // Add new git roots at the beginning
        const newBasePaths: BasePath[] = [];
        for (const [gitRoot, alias] of gitRootMap) {
            newBasePaths.push({
                alias,
                path: gitRoot,
                type: 'git',
                description: `Git repository: ${path.basename(gitRoot)}`
            });
        }

        // Prepend new base paths (git roots first)
        config.basePaths = [...newBasePaths, ...config.basePaths];
    }

    // Set version
    config.version = 4;

    // Store warnings
    if (warnings.length > 0) {
        (config as any)._migrationWarnings = warnings;
    }

    return config;
}

registerMigration(3, migrateV3ToV4);

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
