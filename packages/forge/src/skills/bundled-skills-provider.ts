/**
 * Provider for bundled skills that ship with pipeline-core
 */

import * as path from 'path';
import * as fs from 'fs';
import { BundledSkill, DiscoveredSkill, InstallResult, InstallDetail } from './types';
import { ensureDirectoryExists, safeExists } from '../utils';
import { getLogger, LogCategory } from '../logger';
import { copySkillDirectory } from './skill-copy';
import { BUNDLED_SKILLS_REGISTRY } from './bundled-skills-registry';
import { parseVersionFromFrontmatter } from './skill-version-parser';
import { compareVersions } from '../utils/version-compare';

/**
 * Get the path to the bundled skills directory
 */
export function getBundledSkillsPath(): string {
    return path.join(__dirname, '../../resources/bundled-skills');
}

/**
 * Get all available bundled skills
 * @param installPath Target installation path to check for existing skills
 */
export function getBundledSkills(installPath: string): DiscoveredSkill[] {
    const bundledPath = getBundledSkillsPath();
    const skills: DiscoveredSkill[] = [];

    for (const bundled of BUNDLED_SKILLS_REGISTRY) {
        const skillPath = path.join(bundledPath, bundled.relativePath);
        const skillFile = path.join(skillPath, 'SKILL.md');

        if (safeExists(skillFile)) {
            skills.push({
                name: bundled.name,
                description: bundled.description,
                path: skillPath,
                alreadyExists: safeExists(path.join(installPath, bundled.name))
            });
        }
    }

    return skills;
}

export type InstallConflictStrategy = 'skip' | 'overwrite' | 'version-check';

export interface InstallOptions {
    conflictStrategy: InstallConflictStrategy;
    filter?: (skill: DiscoveredSkill) => boolean;
    handleConflict?: (skillName: string) => Promise<boolean>;
    onInstalled?: (skill: DiscoveredSkill, action: 'installed' | 'replaced') => void;
}

/**
 * Shared installation loop for bundled skill operations.
 */
export async function performSkillInstallation(
    skills: DiscoveredSkill[],
    installPath: string,
    options: InstallOptions,
): Promise<InstallResult> {
    const logger = getLogger();
    const result: InstallResult = {
        installed: 0,
        skipped: 0,
        failed: 0,
        details: []
    };

    ensureDirectoryExists(installPath);

    const selectedSkills = options.filter ? skills.filter(options.filter) : skills;

    for (const skill of selectedSkills) {
        const targetPath = path.join(installPath, skill.name);
        let detail: InstallDetail;

        try {
            const targetExists = safeExists(targetPath);
            let action: 'installed' | 'replaced' = targetExists ? 'replaced' : 'installed';

            if (targetExists) {
                const resolution = await resolveExistingSkill(skill, targetPath, options);
                if (!resolution.shouldReplace) {
                    detail = {
                        name: skill.name,
                        success: true,
                        action: 'skipped',
                        reason: resolution.reason
                    };
                    result.skipped++;
                    result.details.push(detail);
                    continue;
                }

                fs.rmSync(targetPath, { recursive: true, force: true });
                action = 'replaced';
            }

            await copySkillDirectory(skill.path, targetPath);

            detail = {
                name: skill.name,
                success: true,
                action
            };
            result.installed++;
            options.onInstalled?.(skill, action);

        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            logger.error(LogCategory.GENERAL, `Failed to install bundled skill ${skill.name}`, err);
            detail = {
                name: skill.name,
                success: false,
                action: 'failed',
                reason: err.message
            };
            result.failed++;
        }

        result.details.push(detail);
    }

    return result;
}

async function resolveExistingSkill(
    skill: DiscoveredSkill,
    targetPath: string,
    options: InstallOptions,
): Promise<{ shouldReplace: boolean; reason?: string }> {
    if (options.handleConflict) {
        const shouldReplace = await options.handleConflict(skill.name);
        return shouldReplace
            ? { shouldReplace: true }
            : { shouldReplace: false, reason: 'User declined to replace existing skill' };
    }

    switch (options.conflictStrategy) {
        case 'overwrite':
            return { shouldReplace: true };
        case 'version-check':
            return shouldReplaceForNewerVersion(skill.path, targetPath);
        case 'skip':
            return { shouldReplace: false, reason: 'Skill already exists' };
    }
}

function shouldReplaceForNewerVersion(
    sourcePath: string,
    targetPath: string,
): { shouldReplace: boolean; reason?: string } {
    const sourceVersion = parseSkillVersionFromFile(path.join(sourcePath, 'SKILL.md'));
    if (!sourceVersion) {
        return { shouldReplace: false, reason: 'Bundled skill has no parseable version' };
    }

    const installedVersion = parseSkillVersionFromFile(path.join(targetPath, 'SKILL.md'));
    if (!installedVersion) {
        return { shouldReplace: false, reason: 'Installed skill has no parseable version' };
    }

    const comparison = compareVersions(sourceVersion, installedVersion);
    if (comparison === undefined) {
        return { shouldReplace: false, reason: 'Skill version could not be compared' };
    }

    if (comparison <= 0) {
        return { shouldReplace: false, reason: 'Installed skill is up to date' };
    }

    return { shouldReplace: true };
}

/**
 * Install bundled skills to the target directory
 * @param skills Skills to install (from getBundledSkills)
 * @param installPath Target installation path
 * @param handleConflict Callback to handle skill conflicts (returns true to replace)
 */
export async function installBundledSkills(
    skills: DiscoveredSkill[],
    installPath: string,
    handleConflict: (skillName: string) => Promise<boolean>
): Promise<InstallResult> {
    return performSkillInstallation(skills, installPath, {
        conflictStrategy: 'overwrite',
        handleConflict,
    });
}

/**
 * Parse the version of a bundled skill from its SKILL.md frontmatter.
 *
 * Reads the SKILL.md file in `resources/bundled-skills/<skillName>/` and
 * extracts the `metadata.version` field from the YAML frontmatter.
 *
 * @returns The version string, or undefined if not found or unparseable.
 */
export function parseBundledSkillVersion(skillName: string): string | undefined {
    const skillMdPath = path.join(getBundledSkillsPath(), skillName, 'SKILL.md');
    return parseSkillVersionFromFile(skillMdPath);
}

/**
 * Parse the version from a SKILL.md file's frontmatter.
 *
 * Supports both top-level `version:` and nested `metadata:\n  version:`.
 */
export function parseSkillVersionFromFile(skillMdPath: string): string | undefined {
    try {
        if (!fs.existsSync(skillMdPath)) return undefined;
        const content = fs.readFileSync(skillMdPath, 'utf-8');
        return parseSkillVersionFromContent(content);
    } catch {
        return undefined;
    }
}

/**
 * Parse the version from SKILL.md content string.
 *
 * Supports both top-level `version:` and nested `metadata:\n  version:`.
 */
export function parseSkillVersionFromContent(content: string): string | undefined {
    return parseVersionFromFrontmatter(content);
}

/**
 * Get a read-only copy of the bundled skills registry.
 */
export function getBundledSkillsRegistry(): readonly BundledSkill[] {
    return BUNDLED_SKILLS_REGISTRY;
}

// ============================================================================
// Auto-install default skills
// ============================================================================

/** Result of an auto-install default skills run */
export interface AutoInstallResult {
    installed: string[];
    skipped: string[];
    errors: Array<{ name: string; error: string }>;
}

/**
 * Install whitelisted bundled skills into `installPath`, replacing an existing
 * installation only when the bundled skill has a newer parseable version.
 *
 * Skills whose name does not appear in `BUNDLED_SKILLS_REGISTRY` or whose
 * source directory / SKILL.md is missing are silently skipped (not an error).
 *
 * @param installPath  Target directory (e.g. `~/.coc/skills`)
 * @param skillNames   Whitelist of skill names to ensure are installed
 */
export async function autoInstallDefaultSkills(
    installPath: string,
    skillNames: string[],
): Promise<AutoInstallResult> {
    const result: AutoInstallResult = { installed: [], skipped: [], errors: [] };

    if (skillNames.length === 0) {
        return result;
    }

    const bundledPath = getBundledSkillsPath();
    const skillsToInstall: DiscoveredSkill[] = [];

    for (const name of skillNames) {
        const entry = BUNDLED_SKILLS_REGISTRY.find(s => s.name === name);
        if (!entry) {
            result.skipped.push(name);
            continue;
        }

        const skillSrc = path.join(bundledPath, entry.relativePath);
        const skillFile = path.join(skillSrc, 'SKILL.md');
        if (!safeExists(skillFile)) {
            result.skipped.push(name);
            continue;
        }

        skillsToInstall.push({
            name: entry.name,
            description: entry.description,
            path: skillSrc,
            alreadyExists: safeExists(path.join(installPath, name)),
        });
    }

    const installResult = await performSkillInstallation(skillsToInstall, installPath, {
        conflictStrategy: 'version-check',
        onInstalled: (skill) => {
            getLogger().info(LogCategory.GENERAL, `Auto-installed default skill "${skill.name}"`);
        }
    });

    for (const detail of installResult.details) {
        if (detail.success && (detail.action === 'installed' || detail.action === 'replaced')) {
            result.installed.push(detail.name);
        } else if (detail.success && detail.action === 'skipped') {
            result.skipped.push(detail.name);
        } else {
            result.errors.push({ name: detail.name, error: detail.reason ?? 'Unknown installation error' });
        }
    }

    return result;
}
