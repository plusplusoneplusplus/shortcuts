/**
 * Provider for bundled skills that ship with pipeline-core
 */

import * as path from 'path';
import * as fs from 'fs';
import { BundledSkill, DiscoveredSkill, InstallResult, InstallDetail } from './types';
import { ensureDirectoryExists, safeExists, safeReadDir, safeStats, safeCopyFile } from '../utils';
import { getLogger, LogCategory } from '../logger';

/**
 * Registry of bundled skills
 * Each skill must have a corresponding directory in resources/bundled-skills/
 */
const BUNDLED_SKILLS_REGISTRY: BundledSkill[] = [
    {
        name: 'pipeline-generator',
        description: 'Generate optimized YAML pipeline or DAG workflow configurations from natural language requirements',
        relativePath: 'pipeline-generator'
    },
    {
        name: 'skill-for-skills',
        description: 'Create and update Agent Skills following the agentskills.io specification',
        relativePath: 'skill-for-skills'
    },
    {
        name: 'go-deep',
        description: 'Advanced research and verification methodologies using multi-phase approaches and parallel sub-agents',
        relativePath: 'go-deep'
    }
];

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
    const logger = getLogger();
    const result: InstallResult = {
        installed: 0,
        skipped: 0,
        failed: 0,
        details: []
    };

    ensureDirectoryExists(installPath);

    for (const skill of skills) {
        const targetPath = path.join(installPath, skill.name);
        let detail: InstallDetail;

        try {
            if (safeExists(targetPath)) {
                const shouldReplace = await handleConflict(skill.name);
                if (!shouldReplace) {
                    detail = {
                        name: skill.name,
                        success: true,
                        action: 'skipped',
                        reason: 'User declined to replace existing skill'
                    };
                    result.skipped++;
                    result.details.push(detail);
                    continue;
                }

                fs.rmSync(targetPath, { recursive: true, force: true });
            }

            await copyDirectory(skill.path, targetPath);

            detail = {
                name: skill.name,
                success: true,
                action: skill.alreadyExists ? 'replaced' : 'installed'
            };
            result.installed++;

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

/**
 * Copy a directory recursively
 */
async function copyDirectory(sourcePath: string, targetPath: string): Promise<void> {
    const logger = getLogger();

    ensureDirectoryExists(targetPath);

    const readResult = safeReadDir(sourcePath);
    if (!readResult.success || !readResult.data) {
        throw new Error(`Failed to read source directory: ${sourcePath}`);
    }

    for (const item of readResult.data) {
        const itemSourcePath = path.join(sourcePath, item);
        const itemTargetPath = path.join(targetPath, item);
        const statsResult = safeStats(itemSourcePath);

        if (!statsResult.success || !statsResult.data) {
            continue;
        }

        if (statsResult.data.isDirectory()) {
            await copyDirectory(itemSourcePath, itemTargetPath);
        } else if (statsResult.data.isFile()) {
            const copyResult = safeCopyFile(itemSourcePath, itemTargetPath);
            if (!copyResult.success) {
                throw new Error(`Failed to copy file ${item}: ${copyResult.error}`);
            }
            logger.debug(LogCategory.GENERAL, `Copied bundled skill file: ${item}`);
        }
    }
}
