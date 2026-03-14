/**
 * Skill installer for copying skills from sources to the workspace
 */

import * as path from 'path';
import * as fs from 'fs';
import { DiscoveredSkill, InstallDetail, InstallResult, ParsedSource } from './types';
import { ensureDirectoryExists, safeExists, safeReadDir, safeStats, safeCopyFile, safeWriteFile, execAsync, httpGetJson, httpDownload } from '../utils';
import { getLogger, LogCategory } from '../logger';
import { parseGitHubApiResponse } from './github-api-utils';

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

                await removeDirectory(targetPath);
            }

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
            logger.error(LogCategory.GENERAL, `Failed to install skill ${skill.name}`, err);
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
        await installFromGitHubWithHttp(github, skillPath, targetPath);
    }
}

/**
 * Install a skill from GitHub using gh CLI
 */
async function installFromGitHubWithGhCli(
    github: { owner: string; repo: string; branch: string },
    skillPath: string,
    targetPath: string
): Promise<void> {
    const logger = getLogger();

    ensureDirectoryExists(targetPath);

    const listCmd = `gh api repos/${github.owner}/${github.repo}/contents/${skillPath}?ref=${github.branch}`;

    const { stdout } = await execAsync(listCmd);
    const parsed = parseGitHubApiResponse(stdout);

    if (!parsed) {
        throw new Error('Failed to parse GitHub API response');
    }

    const items = Array.isArray(parsed) ? parsed : [parsed];

    for (const item of items) {
        const itemTargetPath = path.join(targetPath, item.name);

        if (item.type === 'dir') {
            const subPath = skillPath ? `${skillPath}/${item.name}` : item.name;
            await installFromGitHubWithGhCli(github, subPath, itemTargetPath);
        } else if (item.type === 'file') {
            if (item.download_url) {
                const content = await httpDownload(item.download_url);
                safeWriteFile(itemTargetPath, content);
                logger.debug(LogCategory.GENERAL, `Downloaded: ${item.name}`);
            } else if (item.content) {
                const content = Buffer.from(item.content, 'base64').toString('utf-8');
                safeWriteFile(itemTargetPath, content);
                logger.debug(LogCategory.GENERAL, `Wrote: ${item.name}`);
            }
        }
    }
}

/**
 * Install a skill from GitHub using native HTTP
 */
async function installFromGitHubWithHttp(
    github: { owner: string; repo: string; branch: string },
    skillPath: string,
    targetPath: string
): Promise<void> {
    const logger = getLogger();

    ensureDirectoryExists(targetPath);

    const apiUrl = `https://api.github.com/repos/${github.owner}/${github.repo}/contents/${skillPath}?ref=${github.branch}`;
    const parsed = await httpGetJson(apiUrl);

    const items = Array.isArray(parsed) ? parsed : [parsed];

    for (const item of items) {
        const itemTargetPath = path.join(targetPath, item.name);

        if (item.type === 'dir') {
            const subPath = skillPath ? `${skillPath}/${item.name}` : item.name;
            await installFromGitHubWithHttp(github, subPath, itemTargetPath);
        } else if (item.type === 'file') {
            if (item.download_url) {
                const content = await httpDownload(item.download_url);
                safeWriteFile(itemTargetPath, content);
                logger.debug(LogCategory.GENERAL, `Downloaded: ${item.name}`);
            } else if (item.content) {
                const content = Buffer.from(item.content, 'base64').toString('utf-8');
                safeWriteFile(itemTargetPath, content);
                logger.debug(LogCategory.GENERAL, `Wrote: ${item.name}`);
            }
        }
    }
}

/**
 * Install a skill from local filesystem
 */
async function installFromLocal(sourcePath: string, targetPath: string): Promise<void> {
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
            await installFromLocal(itemSourcePath, itemTargetPath);
        } else if (statsResult.data.isFile()) {
            const copyResult = safeCopyFile(itemSourcePath, itemTargetPath);
            if (!copyResult.success) {
                throw new Error(`Failed to copy file ${item}: ${copyResult.error}`);
            }
            logger.debug(LogCategory.GENERAL, `Copied: ${item}`);
        }
    }
}

/**
 * Remove a directory recursively
 */
async function removeDirectory(dirPath: string): Promise<void> {
    fs.rmSync(dirPath, { recursive: true, force: true });
}
