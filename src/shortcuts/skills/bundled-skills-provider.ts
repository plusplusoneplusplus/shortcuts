/**
 * Provider for bundled skills that ship with the extension
 */

import * as path from 'path';
import * as vscode from 'vscode';
import { BundledSkill, DiscoveredSkill, InstallResult, InstallDetail } from './types';
import { ensureDirectoryExists, safeExists, safeReadDir, safeReadFile, safeStats, safeCopyFile, getExtensionLogger, LogCategory } from '../shared';

/**
 * Registry of bundled skills
 * Each skill must have a corresponding directory in resources/bundled-skills/
 */
const BUNDLED_SKILLS_REGISTRY: BundledSkill[] = [
    {
        name: 'pipeline-generator',
        description: 'Generate optimized YAML pipeline configurations from natural language requirements',
        relativePath: 'pipeline-generator'
    }
];

/**
 * Get the path to the bundled skills directory in the extension
 */
export function getBundledSkillsPath(context: vscode.ExtensionContext): string {
    return path.join(context.extensionPath, 'dist', 'resources', 'bundled-skills');
}

/**
 * Get all available bundled skills
 * @param context Extension context to locate bundled resources
 * @param installPath Target installation path to check for existing skills
 */
export function getBundledSkills(
    context: vscode.ExtensionContext,
    installPath: string
): DiscoveredSkill[] {
    const bundledPath = getBundledSkillsPath(context);
    const skills: DiscoveredSkill[] = [];

    for (const bundled of BUNDLED_SKILLS_REGISTRY) {
        const skillPath = path.join(bundledPath, bundled.relativePath);
        const skillFile = path.join(skillPath, 'SKILL.md');

        // Verify the skill exists in the extension
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
    const logger = getExtensionLogger();
    const result: InstallResult = {
        installed: 0,
        skipped: 0,
        failed: 0,
        details: []
    };

    // Ensure the install directory exists
    ensureDirectoryExists(installPath);

    for (const skill of skills) {
        const targetPath = path.join(installPath, skill.name);
        let detail: InstallDetail;

        try {
            // Check if skill already exists
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

                // Remove existing skill directory
                await removeDirectory(targetPath);
            }

            // Copy the bundled skill to the target
            await copyDirectory(skill.path, targetPath);

            detail = {
                name: skill.name,
                success: true,
                action: skill.alreadyExists ? 'replaced' : 'installed'
            };
            result.installed++;

        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            logger.error(LogCategory.EXTENSION, `Failed to install bundled skill ${skill.name}`, err);
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
    const logger = getExtensionLogger();
    
    // Create target directory
    ensureDirectoryExists(targetPath);

    // Read source directory
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
            // Recursively copy directory
            await copyDirectory(itemSourcePath, itemTargetPath);
        } else if (statsResult.data.isFile()) {
            // Copy file
            const copyResult = safeCopyFile(itemSourcePath, itemTargetPath);
            if (!copyResult.success) {
                throw new Error(`Failed to copy file ${item}: ${copyResult.error}`);
            }
            logger.debug(LogCategory.EXTENSION, `Copied bundled skill file: ${item}`);
        }
    }
}

/**
 * Remove a directory recursively
 */
async function removeDirectory(dirPath: string): Promise<void> {
    const readResult = safeReadDir(dirPath);
    if (!readResult.success || !readResult.data) {
        return;
    }

    const fs = require('fs');

    for (const item of readResult.data) {
        const itemPath = path.join(dirPath, item);
        const statsResult = safeStats(itemPath);

        if (!statsResult.success || !statsResult.data) {
            continue;
        }

        if (statsResult.data.isDirectory()) {
            await removeDirectory(itemPath);
        } else {
            fs.unlinkSync(itemPath);
        }
    }

    fs.rmdirSync(dirPath);
}
