/**
 * Claude Skill Mirror
 *
 * Mirrors globally-installed bundled CoC skills from ~/.coc/skills to
 * ~/.claude/commands (or $CLAUDE_HOME/commands) so Claude Code can load
 * them as slash commands.
 *
 * Only mirrors bundled skills installed globally. Does not mirror:
 * - Workspace-local skills
 * - Per-repo skills
 * - User-provided skill directories
 *
 * Each skill's SKILL.md is written as <skill-name>.md in the commands
 * directory. A sidecar marker file (.coc-<name>.json) tracks CoC-managed
 * commands, distinguishing them from user-authored commands.
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
// Claude Home Resolution
// ============================================================================

/**
 * Resolve the Claude Code home directory.
 * Uses $CLAUDE_HOME if set, otherwise falls back to ~/.claude
 */
export function getClaudeHome(): string {
    return process.env.CLAUDE_HOME || path.join(os.homedir(), '.claude');
}

/**
 * Get the Claude Code global commands directory.
 */
export function getClaudeCommandsDir(): string {
    return path.join(getClaudeHome(), 'commands');
}

// ============================================================================
// Sidecar Marker File Management
// ============================================================================

/**
 * Get the sidecar marker file path for a given skill name.
 * The marker lives alongside the command .md file in the commands directory.
 */
export function getMarkerPath(commandsDir: string, skillName: string): string {
    return path.join(commandsDir, `.coc-${skillName}.json`);
}

/**
 * Write a CoC sidecar marker file for a mirrored command.
 */
function writeMarker(commandsDir: string, skillName: string, version?: string): void {
    const marker: CoCSkillMarker = {
        source: 'coc-bundled',
        name: skillName,
        version,
    };
    fs.writeFileSync(getMarkerPath(commandsDir, skillName), JSON.stringify(marker, null, 2), 'utf-8');
}

/**
 * Read a CoC sidecar marker file for a skill command.
 * Returns the marker object if valid, undefined otherwise.
 */
function readMarker(commandsDir: string, skillName: string): CoCSkillMarker | undefined {
    try {
        const markerPath = getMarkerPath(commandsDir, skillName);
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
// Atomic Write Operation
// ============================================================================

/**
 * Copy a skill's SKILL.md to the target command .md path atomically,
 * then write the sidecar marker.
 * Uses a temp file + rename for atomicity.
 */
function copyCommandFileAtomic(
    sourceSkillMd: string,
    targetMdPath: string,
    commandsDir: string,
    skillName: string,
    version?: string,
): void {
    const tempPath = `${targetMdPath}.tmp.${Date.now()}`;

    try {
        fs.copyFileSync(sourceSkillMd, tempPath);
        fs.renameSync(tempPath, targetMdPath);
        writeMarker(commandsDir, skillName, version);
    } catch (error) {
        try {
            if (fs.existsSync(tempPath)) {
                fs.unlinkSync(tempPath);
            }
        } catch {
            // Ignore cleanup errors
        }
        throw error;
    }
}

// ============================================================================
// Version Comparison
// ============================================================================

/**
 * Determine if the source SKILL.md is newer than the installed command file.
 * Returns true if source is newer, false otherwise.
 */
function shouldReplaceByVersion(sourceSkillMd: string, targetMdPath: string): boolean {
    const sourceVersion = parseSkillVersionFromFile(sourceSkillMd);
    if (!sourceVersion) {
        return false;
    }

    const targetVersion = parseSkillVersionFromFile(targetMdPath);
    if (!targetVersion) {
        return false;
    }

    const comparison = compareVersions(sourceVersion, targetVersion);
    if (comparison === undefined) {
        return false;
    }

    return comparison > 0;
}

// ============================================================================
// Main Mirror Function
// ============================================================================

/**
 * Mirror a bundled skill from CoC global skills to the Claude Code commands directory.
 *
 * The skill's SKILL.md is written to ~/.claude/commands/<skill-name>.md so
 * Claude Code can discover and invoke it as a /<skill-name> slash command.
 * A sidecar marker (.coc-<name>.json) is written alongside it so CoC can
 * distinguish its own commands from user-authored ones.
 *
 * @param cocSkillsDir  CoC global skills directory (e.g. ~/.coc/skills)
 * @param skillName     Name of the skill to mirror
 * @param replace       If true, replace existing user-managed commands
 * @returns Mirror result with status
 */
export async function mirrorBundledSkillToClaude(
    cocSkillsDir: string,
    skillName: string,
    replace: boolean = false,
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
                error: 'Source skill does not exist',
            };
        }

        // Never mirror .system
        if (skillName === '.system') {
            return {
                skillName,
                status: 'skipped-existing-user-managed',
                error: 'Cannot mirror .system skill',
            };
        }

        // Get target command file path
        const commandsDir = getClaudeCommandsDir();
        const targetMdPath = path.join(commandsDir, `${skillName}.md`);

        // Ensure Claude commands directory exists
        fs.mkdirSync(commandsDir, { recursive: true });

        // Parse source version
        const sourceVersion = parseSkillVersionFromFile(sourceSkillMd);

        // Check if target command file exists
        if (!fs.existsSync(targetMdPath)) {
            // New command — copy it
            copyCommandFileAtomic(sourceSkillMd, targetMdPath, commandsDir, skillName, sourceVersion);
            logger.info(LogCategory.GENERAL, `Mirrored bundled skill to Claude: ${skillName}`);
            return { skillName, status: 'copied' };
        }

        // Target exists — check for CoC sidecar marker
        const marker = readMarker(commandsDir, skillName);
        if (!marker) {
            // No marker → user-managed command
            if (replace) {
                copyCommandFileAtomic(sourceSkillMd, targetMdPath, commandsDir, skillName, sourceVersion);
                logger.info(LogCategory.GENERAL, `Replaced user-managed Claude command: ${skillName}`);
                return { skillName, status: 'copied' };
            }
            return {
                skillName,
                status: 'skipped-existing-user-managed',
                error: 'Target command is user-managed (no CoC marker)',
            };
        }

        // CoC-managed command — check version
        if (shouldReplaceByVersion(sourceSkillMd, targetMdPath)) {
            copyCommandFileAtomic(sourceSkillMd, targetMdPath, commandsDir, skillName, sourceVersion);
            logger.info(LogCategory.GENERAL, `Updated Claude command to newer version: ${skillName}`);
            return { skillName, status: 'updated' };
        }

        // Versions equal?
        const targetVersion = parseSkillVersionFromFile(targetMdPath);
        if (sourceVersion && targetVersion && sourceVersion === targetVersion) {
            return {
                skillName,
                status: 'skipped-same-version',
                error: `Version ${targetVersion} already installed`,
            };
        }

        // Target is newer or versions cannot be compared
        return {
            skillName,
            status: 'skipped-newer-target',
            error: 'Target has newer or incomparable version',
        };

    } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        logger.error(LogCategory.GENERAL, `Failed to mirror skill to Claude: ${skillName}`, err);
        return {
            skillName,
            status: 'failed',
            error: err.message,
        };
    }
}

/**
 * Mirror multiple bundled skills to Claude Code.
 *
 * @param cocSkillsDir  CoC global skills directory
 * @param skillNames    Names of skills to mirror
 * @param replace       If true, replace existing user-managed commands
 * @returns Array of mirror results
 */
export async function mirrorBundledSkillsToClaude(
    cocSkillsDir: string,
    skillNames: string[],
    replace: boolean = false,
): Promise<MirrorResult[]> {
    const results: MirrorResult[] = [];
    for (const skillName of skillNames) {
        const result = await mirrorBundledSkillToClaude(cocSkillsDir, skillName, replace);
        results.push(result);
    }
    return results;
}

/**
 * Sync all installed bundled skills from CoC to Claude Code on server startup.
 * Called during server initialization when the Claude provider is enabled.
 *
 * @param cocSkillsDir  CoC global skills directory (e.g. ~/.coc/skills)
 * @returns Sync results
 */
export async function syncInstalledSkillsToClaude(cocSkillsDir: string): Promise<{
    synced: string[];
    errors: Array<{ name: string; error: string }>;
}> {
    const logger = getLogger();
    const result = { synced: [], errors: [] } as {
        synced: string[];
        errors: Array<{ name: string; error: string }>;
    };

    try {
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

        const mirrorResults = await mirrorBundledSkillsToClaude(cocSkillsDir, skillNames, false);

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
        logger.error(LogCategory.GENERAL, 'Failed to sync skills to Claude', err);
    }

    return result;
}
