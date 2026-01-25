/**
 * Skill installer for copying skills from sources to the workspace
 */

import * as path from 'path';
import * as vscode from 'vscode';
import { DiscoveredSkill, InstallDetail, InstallResult, ParsedSource } from './types';
import { ensureDirectoryExists, safeExists, safeReadDir, safeStats, safeCopyFile, safeWriteFile, getExtensionLogger, LogCategory, execAsync } from '../shared';

/**
 * Cache for gh CLI availability check
 */
let ghCliAvailable: boolean | undefined;

/**
 * Check if gh CLI is available
 */
async function isGhCliAvailable(): Promise<boolean> {
    if (ghCliAvailable !== undefined) {
        return ghCliAvailable;
    }

    try {
        await execAsync('gh --version');
        ghCliAvailable = true;
    } catch {
        ghCliAvailable = false;
    }

    return ghCliAvailable;
}

/**
 * Install selected skills to the target directory
 * @param skills Skills to install
 * @param source Source information
 * @param installPath Target installation path
 * @param handleConflict Callback to handle skill conflicts (returns true to replace)
 * @returns Installation result
 */
export async function installSkills(
    skills: DiscoveredSkill[],
    source: ParsedSource,
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

            // Install the skill
            if (source.type === 'github' && source.github) {
                await installFromGitHub(source.github, skill.path, targetPath);
            } else if (source.type === 'local' && source.localPath) {
                await installFromLocal(skill.path, targetPath);
            } else {
                throw new Error('Invalid source configuration');
            }

            detail = {
                name: skill.name,
                success: true,
                action: skill.alreadyExists ? 'replaced' : 'installed'
            };
            result.installed++;

        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            logger.error(LogCategory.EXTENSION, `Failed to install skill ${skill.name}`, err);
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
 * Install a skill from GitHub
 * Uses gh CLI if available, falls back to curl with GitHub API
 */
async function installFromGitHub(
    github: { owner: string; repo: string; branch: string },
    skillPath: string,
    targetPath: string
): Promise<void> {
    const useGhCli = await isGhCliAvailable();
    
    if (useGhCli) {
        await installFromGitHubWithGhCli(github, skillPath, targetPath);
    } else {
        await installFromGitHubWithCurl(github, skillPath, targetPath);
    }
}

/**
 * Install a skill from GitHub using gh CLI (authenticated, higher rate limits)
 */
async function installFromGitHubWithGhCli(
    github: { owner: string; repo: string; branch: string },
    skillPath: string,
    targetPath: string
): Promise<void> {
    const logger = getExtensionLogger();
    
    // Create target directory
    ensureDirectoryExists(targetPath);

    // Get list of files in the skill directory
    const listCmd = `gh api repos/${github.owner}/${github.repo}/contents/${skillPath}?ref=${github.branch} --jq '.[] | "\\(.name)|\\(.type)|\\(.download_url // "")"'`;
    
    const { stdout } = await execAsync(listCmd);
    const items = stdout.trim().split('\n').filter((l: string) => l.length > 0);

    for (const item of items) {
        const [name, type, downloadUrl] = item.split('|');
        const itemTargetPath = path.join(targetPath, name);

        if (type === 'dir') {
            // Recursively download directory
            const subPath = skillPath ? `${skillPath}/${name}` : name;
            await installFromGitHubWithGhCli(github, subPath, itemTargetPath);
        } else if (type === 'file' && downloadUrl) {
            // Download file using curl
            const downloadCmd = `curl -sL "${downloadUrl}" -o "${itemTargetPath}"`;
            await execAsync(downloadCmd);
            logger.debug(LogCategory.EXTENSION, `Downloaded: ${name}`);
        }
    }
}

/**
 * Install a skill from GitHub using curl (no authentication, lower rate limits)
 * This is the fallback when gh CLI is not available
 */
async function installFromGitHubWithCurl(
    github: { owner: string; repo: string; branch: string },
    skillPath: string,
    targetPath: string
): Promise<void> {
    const logger = getExtensionLogger();
    
    // Create target directory
    ensureDirectoryExists(targetPath);

    // Get list of files in the skill directory using GitHub API
    const apiUrl = `https://api.github.com/repos/${github.owner}/${github.repo}/contents/${skillPath}?ref=${github.branch}`;
    const { stdout } = await execAsync(`curl -sL "${apiUrl}"`);
    
    const parsed = JSON.parse(stdout);
    
    // Check for error response
    if (parsed.message) {
        throw new Error(parsed.message);
    }
    
    // Handle single file response
    const items = Array.isArray(parsed) ? parsed : [parsed];

    for (const item of items) {
        const itemTargetPath = path.join(targetPath, item.name);

        if (item.type === 'dir') {
            // Recursively download directory
            const subPath = skillPath ? `${skillPath}/${item.name}` : item.name;
            await installFromGitHubWithCurl(github, subPath, itemTargetPath);
        } else if (item.type === 'file') {
            if (item.download_url) {
                // Download file using curl
                const downloadCmd = `curl -sL "${item.download_url}" -o "${itemTargetPath}"`;
                await execAsync(downloadCmd);
                logger.debug(LogCategory.EXTENSION, `Downloaded: ${item.name}`);
            } else if (item.content) {
                // Content is embedded (base64 encoded)
                const content = Buffer.from(item.content, 'base64').toString('utf-8');
                safeWriteFile(itemTargetPath, content);
                logger.debug(LogCategory.EXTENSION, `Wrote: ${item.name}`);
            }
        }
    }
}

/**
 * Install a skill from local filesystem
 */
async function installFromLocal(sourcePath: string, targetPath: string): Promise<void> {
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
            await installFromLocal(itemSourcePath, itemTargetPath);
        } else if (statsResult.data.isFile()) {
            // Copy file
            const copyResult = safeCopyFile(itemSourcePath, itemTargetPath);
            if (!copyResult.success) {
                throw new Error(`Failed to copy file ${item}: ${copyResult.error}`);
            }
            logger.debug(LogCategory.EXTENSION, `Copied: ${item}`);
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
