/**
 * Codex Skill Mirror
 *
 * Mirrors globally-installed bundled CoC skills from ~/.coc/skills to
 * ~/.codex/skills (or $CODEX_HOME/skills) so Codex can load them.
 *
 * Only mirrors bundled skills installed globally. Does not mirror:
 * - Workspace-local skills
 * - Per-repo skills
 * - User-provided skill directories
 *
 * Uses a marker file (.coc-skill.json) to track CoC-managed mirrored skills.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseSkillVersionFromFile, compareVersions, getLogger, LogCategory } from '@plusplusoneplusplus/forge';

// ============================================================================
// Types
// ============================================================================

export type MirrorStatus =
    | 'copied'
    | 'updated'
    | 'skipped-existing-user-managed'
    | 'skipped-same-version'
    | 'skipped-newer-target'
    | 'failed';

export interface MirrorResult {
    skillName: string;
    status: MirrorStatus;
    error?: string;
}

interface CoCSkillMarker {
    source: 'coc-bundled';
    name: string;
    version?: string;
}

// ============================================================================
// Codex Home Resolution
// ============================================================================

/**
 * Resolve the Codex home directory.
 * Uses $CODEX_HOME if set, otherwise falls back to ~/.codex
 */
export function getCodexHome(): string {
    return process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
}

/**
 * Get the Codex skills directory.
 */
export function getCodexSkillsDir(): string {
    return path.join(getCodexHome(), 'skills');
}

// ============================================================================
// Marker File Management
// ============================================================================

const MARKER_FILENAME = '.coc-skill.json';

/**
 * Write a CoC marker file into the mirrored skill directory.
 */
function writeMarker(skillPath: string, skillName: string, version?: string): void {
    const marker: CoCSkillMarker = {
        source: 'coc-bundled',
        name: skillName,
        version,
    };
    const markerPath = path.join(skillPath, MARKER_FILENAME);
    fs.writeFileSync(markerPath, JSON.stringify(marker, null, 2), 'utf-8');
}

/**
 * Read a CoC marker file from a skill directory.
 * Returns the marker object if valid, undefined otherwise.
 */
function readMarker(skillPath: string): CoCSkillMarker | undefined {
    try {
        const markerPath = path.join(skillPath, MARKER_FILENAME);
        if (!fs.existsSync(markerPath)) return undefined;
        const content = fs.readFileSync(markerPath, 'utf-8');
        const marker = JSON.parse(content);
        if (marker.source === 'coc-bundled' && marker.name) {
            return marker;
        }
        return undefined;
    } catch {
        return undefined;
    }
}

// ============================================================================
// Version Comparison
// ============================================================================

/**
 * Determine if we should replace the target skill with the source.
 * Returns true if source is newer, false otherwise.
 */
function shouldReplaceByVersion(
    sourcePath: string,
    targetPath: string,
    marker: CoCSkillMarker
): boolean {
    const sourceVersion = parseSkillVersionFromFile(path.join(sourcePath, 'SKILL.md'));
    if (!sourceVersion) {
        // No source version - skip to be safe
        return false;
    }

    const targetVersion = parseSkillVersionFromFile(path.join(targetPath, 'SKILL.md'));
    if (!targetVersion) {
        // Target has no version but has CoC marker - safer to skip unless we know it's older
        return false;
    }

    const comparison = compareVersions(sourceVersion, targetVersion);
    if (comparison === undefined) {
        // Cannot compare - skip to be safe
        return false;
    }

    // Replace only if source is newer
    return comparison > 0;
}

// ============================================================================
// Atomic Copy Operations
// ============================================================================

/**
 * Copy a skill directory to the target path atomically.
 * Uses a temporary directory + rename for atomicity.
 */
async function copySkillDirectoryAtomic(
    sourcePath: string,
    targetPath: string,
    skillName: string,
    version?: string
): Promise<void> {
    const targetParent = path.dirname(targetPath);
    const tempPath = path.join(targetParent, `.${skillName}.tmp.${Date.now()}`);

    try {
        // Copy to temporary location
        await copyDirectory(sourcePath, tempPath);

        // Write marker
        writeMarker(tempPath, skillName, version);

        // Remove existing target if present
        if (fs.existsSync(targetPath)) {
            fs.rmSync(targetPath, { recursive: true, force: true });
        }

        // Atomic rename
        fs.renameSync(tempPath, targetPath);
    } catch (error) {
        // Clean up temp directory on error
        try {
            if (fs.existsSync(tempPath)) {
                fs.rmSync(tempPath, { recursive: true, force: true });
            }
        } catch {
            // Ignore cleanup errors
        }
        throw error;
    }
}

/**
 * Recursively copy a directory, preserving nested structure.
 */
async function copyDirectory(source: string, dest: string): Promise<void> {
    fs.mkdirSync(dest, { recursive: true });

    const entries = fs.readdirSync(source, { withFileTypes: true });
    for (const entry of entries) {
        const srcPath = path.join(source, entry.name);
        const destPath = path.join(dest, entry.name);

        if (entry.isDirectory()) {
            await copyDirectory(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

// ============================================================================
// Main Mirror Function
// ============================================================================

/**
 * Mirror a bundled skill from CoC global skills to Codex skills directory.
 *
 * @param cocSkillsDir  CoC global skills directory (e.g. ~/.coc/skills)
 * @param skillName     Name of the skill to mirror
 * @param replace       If true, replace existing user-managed skills
 * @returns Mirror result with status
 */
export async function mirrorBundledSkillToCodex(
    cocSkillsDir: string,
    skillName: string,
    replace: boolean = false
): Promise<MirrorResult> {
    const logger = getLogger();

    try {
        // Validate source skill exists
        const sourcePath = path.join(cocSkillsDir, skillName);
        const sourceSkillMd = path.join(sourcePath, 'SKILL.md');
        if (!fs.existsSync(sourceSkillMd)) {
            return {
                skillName,
                status: 'failed',
                error: 'Source skill does not exist'
            };
        }

        // Get target path
        const codexSkillsDir = getCodexSkillsDir();
        const targetPath = path.join(codexSkillsDir, skillName);

        // Ensure Codex skills directory exists
        fs.mkdirSync(codexSkillsDir, { recursive: true });

        // Never touch .system directory
        if (skillName === '.system') {
            return {
                skillName,
                status: 'skipped-existing-user-managed',
                error: 'Cannot mirror .system directory'
            };
        }

        // Parse source version
        const sourceVersion = parseSkillVersionFromFile(sourceSkillMd);

        // Check if target exists
        const targetExists = fs.existsSync(targetPath);
        if (!targetExists) {
            // New skill - just copy it
            await copySkillDirectoryAtomic(sourcePath, targetPath, skillName, sourceVersion);
            logger.info(LogCategory.GENERAL, `Mirrored bundled skill to Codex: ${skillName}`);
            return { skillName, status: 'copied' };
        }

        // Target exists - check for CoC marker
        const marker = readMarker(targetPath);
        if (!marker) {
            // Existing skill without CoC marker - user-managed
            if (replace) {
                await copySkillDirectoryAtomic(sourcePath, targetPath, skillName, sourceVersion);
                logger.info(LogCategory.GENERAL, `Replaced user-managed Codex skill: ${skillName}`);
                return { skillName, status: 'copied' };
            }
            return {
                skillName,
                status: 'skipped-existing-user-managed',
                error: 'Target skill is user-managed (no CoC marker)'
            };
        }

        // CoC-managed skill - check version
        if (shouldReplaceByVersion(sourcePath, targetPath, marker)) {
            await copySkillDirectoryAtomic(sourcePath, targetPath, skillName, sourceVersion);
            logger.info(LogCategory.GENERAL, `Updated Codex skill to newer version: ${skillName}`);
            return { skillName, status: 'updated' };
        }

        // Check if versions are equal
        const targetVersion = parseSkillVersionFromFile(path.join(targetPath, 'SKILL.md'));
        if (sourceVersion && targetVersion && sourceVersion === targetVersion) {
            return {
                skillName,
                status: 'skipped-same-version',
                error: `Version ${targetVersion} already installed`
            };
        }

        // Target is newer or versions cannot be compared
        return {
            skillName,
            status: 'skipped-newer-target',
            error: 'Target has newer or incomparable version'
        };

    } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        logger.error(LogCategory.GENERAL, `Failed to mirror skill to Codex: ${skillName}`, err);
        return {
            skillName,
            status: 'failed',
            error: err.message
        };
    }
}

/**
 * Mirror multiple bundled skills to Codex.
 *
 * @param cocSkillsDir  CoC global skills directory
 * @param skillNames    Names of skills to mirror
 * @param replace       If true, replace existing user-managed skills
 * @returns Array of mirror results
 */
export async function mirrorBundledSkillsToCodex(
    cocSkillsDir: string,
    skillNames: string[],
    replace: boolean = false
): Promise<MirrorResult[]> {
    const results: MirrorResult[] = [];
    for (const skillName of skillNames) {
        const result = await mirrorBundledSkillToCodex(cocSkillsDir, skillName, replace);
        results.push(result);
    }
    return results;
}

/**
 * Sync all installed bundled skills from CoC to Codex on server startup.
 * Called during server initialization when Codex is enabled.
 *
 * @param cocSkillsDir  CoC global skills directory (e.g. ~/.coc/skills)
 * @returns Sync results
 */
export async function syncInstalledSkillsToCodex(cocSkillsDir: string): Promise<{
    synced: string[];
    errors: Array<{ name: string; error: string }>;
}> {
    const logger = getLogger();
    const result = { synced: [], errors: [] } as { synced: string[]; errors: Array<{ name: string; error: string }> };

    try {
        // Get all installed skills in CoC directory
        if (!fs.existsSync(cocSkillsDir)) {
            return result;
        }

        const entries = fs.readdirSync(cocSkillsDir, { withFileTypes: true });
        const skillNames = entries
            .filter(e => e.isDirectory() && e.name !== '.system')
            .map(e => e.name);

        if (skillNames.length === 0) {
            return result;
        }

        // Mirror each skill
        const mirrorResults = await mirrorBundledSkillsToCodex(cocSkillsDir, skillNames, false);

        for (const mr of mirrorResults) {
            if (mr.status === 'copied' || mr.status === 'updated') {
                result.synced.push(mr.skillName);
            } else if (mr.status === 'failed') {
                result.errors.push({ name: mr.skillName, error: mr.error ?? 'unknown error' });
            }
            // silently skip other statuses (skipped-same-version, skipped-existing-user-managed, etc.)
        }
    } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        logger.error(LogCategory.GENERAL, 'Failed to sync skills to Codex', err);
    }

    return result;
}
