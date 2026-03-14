/**
 * Skill scanner for discovering skills from GitHub and local sources
 */

import * as path from 'path';
import { DiscoveredSkill, ParsedSource, ScanResult } from './types';
import { safeExists, safeReadDir, safeReadFile, safeStats, execAsync, httpGetJson } from '../utils';
import { getLogger, LogCategory } from '../logger';
import { parseGitHubApiResponse } from './github-api-utils';

/**
 * Skill file that identifies a valid skill directory
 */
const SKILL_FILE = 'SKILL.md';

/**
 * Cache for gh CLI availability check
 */
let ghCliAvailable: boolean | undefined;

/**
 * Reset gh CLI availability cache (for testing)
 */
export function _resetGhCliCache(): void {
    ghCliAvailable = undefined;
}

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
 * Scan a source for skills
 * @param source Parsed source information
 * @param installPath Target installation path (to check for existing skills)
 * @returns Scan result with discovered skills
 */
export async function scanForSkills(source: ParsedSource, installPath: string): Promise<ScanResult> {
    if (source.type === 'github' && source.github) {
        return scanGitHubSource(source.github, installPath);
    } else if (source.type === 'local' && source.localPath) {
        return scanLocalSource(source.localPath, installPath);
    }

    return {
        success: false,
        error: 'Invalid source configuration',
        skills: []
    };
}

/**
 * Scan a GitHub repository for skills
 * Uses gh CLI if available, falls back to native HTTP (cross-platform)
 */
async function scanGitHubSource(
    github: { owner: string; repo: string; branch: string; path: string },
    installPath: string
): Promise<ScanResult> {
    const logger = getLogger();
    const useGhCli = await isGhCliAvailable();

    const repoPath = github.path || '';
    const ghPath = repoPath ? `${github.owner}/${github.repo}:${repoPath}` : `${github.owner}/${github.repo}`;

    logger.info(LogCategory.GENERAL, `Scanning GitHub repository: ${ghPath} (branch: ${github.branch}, using ${useGhCli ? 'gh CLI' : 'native HTTP'})`);

    if (useGhCli) {
        return scanGitHubWithGhCli(github, installPath);
    } else {
        return scanGitHubWithHttp(github, installPath);
    }
}

/**
 * Scan GitHub repository using gh CLI (authenticated, higher rate limits)
 */
async function scanGitHubWithGhCli(
    github: { owner: string; repo: string; branch: string; path: string },
    installPath: string
): Promise<ScanResult> {
    const logger = getLogger();
    const skills: DiscoveredSkill[] = [];
    const repoPath = github.path || '';

    try {
        const listCmd = `gh api repos/${github.owner}/${github.repo}/contents/${repoPath}?ref=${github.branch}`;

        let directories: string[];
        let items: any[] = [];
        try {
            const { stdout } = await execAsync(listCmd);
            const parsed = parseGitHubApiResponse(stdout);

            if (!parsed) {
                throw new Error('Failed to parse GitHub API response');
            }

            items = Array.isArray(parsed) ? parsed : [parsed];
            directories = items
                .filter((item: any) => item.type === 'dir')
                .map((item: any) => item.name);
        } catch (error) {
            const checkSkillCmd = `gh api repos/${github.owner}/${github.repo}/contents/${repoPath}/${SKILL_FILE}?ref=${github.branch}`;
            try {
                const { stdout: skillCheck } = await execAsync(checkSkillCmd);
                const parsed = parseGitHubApiResponse(skillCheck);
                if (parsed && parsed.name === SKILL_FILE) {
                    const skillName = path.basename(repoPath) || github.repo;
                    const description = await getGitHubSkillDescriptionWithGhCli(github, repoPath);
                    skills.push({
                        name: skillName,
                        description,
                        path: repoPath,
                        alreadyExists: safeExists(path.join(installPath, skillName))
                    });
                    return { success: true, skills };
                }
            } catch {
                // Not a skill directory
            }

            const err = error instanceof Error ? error : new Error(String(error));
            logger.warn(LogCategory.GENERAL, 'Failed to list GitHub directory with gh CLI');
            return {
                success: false,
                error: `Failed to access GitHub repository: ${err.message}`,
                skills: []
            };
        }

        // Check if SKILL.md exists as a direct file in this listing (root-level skill)
        const hasRootSkillMd = items.some((item: any) => item.type === 'file' && item.name === SKILL_FILE);
        if (hasRootSkillMd) {
            const skillName = path.basename(repoPath) || github.repo;
            const description = await getGitHubSkillDescriptionWithGhCli(github, repoPath);
            skills.push({
                name: skillName,
                description,
                path: repoPath,
                alreadyExists: safeExists(path.join(installPath, skillName))
            });
            return { success: true, skills };
        }

        for (const dir of directories) {
            const skillPath = repoPath ? `${repoPath}/${dir}` : dir;
            const skillFileCheck = `gh api repos/${github.owner}/${github.repo}/contents/${skillPath}/${SKILL_FILE}?ref=${github.branch}`;

            try {
                const { stdout } = await execAsync(skillFileCheck);
                const parsed = parseGitHubApiResponse(stdout);
                if (parsed && parsed.name === SKILL_FILE) {
                    const description = await getGitHubSkillDescriptionWithGhCli(github, skillPath);
                    skills.push({
                        name: dir,
                        description,
                        path: skillPath,
                        alreadyExists: safeExists(path.join(installPath, dir))
                    });
                }
            } catch {
                // Not a skill directory, skip
            }
        }

        if (skills.length === 0) {
            return {
                success: false,
                error: 'No valid skills found at this location.',
                skills: []
            };
        }

        return { success: true, skills };

    } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        logger.error(LogCategory.GENERAL, 'Error scanning GitHub source with gh CLI', err);
        return {
            success: false,
            error: `Failed to scan GitHub repository: ${err.message}`,
            skills: []
        };
    }
}

/**
 * Scan GitHub repository using native HTTP (cross-platform, no external dependencies)
 */
async function scanGitHubWithHttp(
    github: { owner: string; repo: string; branch: string; path: string },
    installPath: string
): Promise<ScanResult> {
    const logger = getLogger();
    const skills: DiscoveredSkill[] = [];
    const repoPath = github.path || '';

    try {
        const apiUrl = `https://api.github.com/repos/${github.owner}/${github.repo}/contents/${repoPath}?ref=${github.branch}`;

        let response: any[];
        try {
            const parsed = await httpGetJson<any>(apiUrl);

            if (!Array.isArray(parsed)) {
                if (parsed.name === SKILL_FILE) {
                    const skillName = path.basename(repoPath) || github.repo;
                    const description = await getGitHubSkillDescriptionWithHttp(github, path.dirname(repoPath) || repoPath);
                    skills.push({
                        name: skillName,
                        description,
                        path: repoPath,
                        alreadyExists: safeExists(path.join(installPath, skillName))
                    });
                    return { success: true, skills };
                }
                response = [parsed];
            } else {
                response = parsed;
            }
        } catch (error) {
            const skillFileUrl = `https://api.github.com/repos/${github.owner}/${github.repo}/contents/${repoPath}/${SKILL_FILE}?ref=${github.branch}`;
            try {
                const parsed = await httpGetJson<any>(skillFileUrl);
                if (parsed.name === SKILL_FILE) {
                    const skillName = path.basename(repoPath) || github.repo;
                    const description = await getGitHubSkillDescriptionWithHttp(github, repoPath);
                    skills.push({
                        name: skillName,
                        description,
                        path: repoPath,
                        alreadyExists: safeExists(path.join(installPath, skillName))
                    });
                    return { success: true, skills };
                }
            } catch {
                // Not a skill directory
            }

            const err = error instanceof Error ? error : new Error(String(error));
            logger.warn(LogCategory.GENERAL, 'Failed to list GitHub directory with HTTP');
            return {
                success: false,
                error: `Failed to access GitHub repository. The repository may be private or the path may not exist. Error: ${err.message}`,
                skills: []
            };
        }

        // Check if SKILL.md exists as a direct file in this listing (root-level skill)
        const hasRootSkillMd = response.some((item: any) => item.type === 'file' && item.name === SKILL_FILE);
        if (hasRootSkillMd) {
            const skillName = path.basename(repoPath) || github.repo;
            const description = await getGitHubSkillDescriptionWithHttp(github, repoPath);
            skills.push({
                name: skillName,
                description,
                path: repoPath,
                alreadyExists: safeExists(path.join(installPath, skillName))
            });
            return { success: true, skills };
        }

        const directories = response.filter((item: any) => item.type === 'dir').map((item: any) => item.name);

        for (const dir of directories) {
            const skillPath = repoPath ? `${repoPath}/${dir}` : dir;
            const skillFileUrl = `https://api.github.com/repos/${github.owner}/${github.repo}/contents/${skillPath}/${SKILL_FILE}?ref=${github.branch}`;

            try {
                const parsed = await httpGetJson<any>(skillFileUrl);
                if (parsed.name === SKILL_FILE) {
                    const description = await getGitHubSkillDescriptionWithHttp(github, skillPath);
                    skills.push({
                        name: dir,
                        description,
                        path: skillPath,
                        alreadyExists: safeExists(path.join(installPath, dir))
                    });
                }
            } catch {
                // Not a skill directory, skip
            }
        }

        if (skills.length === 0) {
            return {
                success: false,
                error: 'No valid skills found at this location.',
                skills: []
            };
        }

        return { success: true, skills };

    } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        logger.error(LogCategory.GENERAL, 'Error scanning GitHub source with HTTP', err);
        return {
            success: false,
            error: `Failed to scan GitHub repository: ${err.message}`,
            skills: []
        };
    }
}

/**
 * Get skill description from GitHub SKILL.md using gh CLI
 */
async function getGitHubSkillDescriptionWithGhCli(
    github: { owner: string; repo: string; branch: string },
    skillPath: string
): Promise<string | undefined> {
    try {
        const cmd = `gh api repos/${github.owner}/${github.repo}/contents/${skillPath}/${SKILL_FILE}?ref=${github.branch}`;
        const { stdout } = await execAsync(cmd);
        const parsed = parseGitHubApiResponse(stdout);

        if (parsed && parsed.content) {
            const content = Buffer.from(parsed.content, 'base64').toString('utf-8');
            return extractDescriptionFromMarkdown(content);
        }
        return undefined;
    } catch {
        return undefined;
    }
}

/**
 * Get skill description from GitHub SKILL.md using native HTTP
 */
async function getGitHubSkillDescriptionWithHttp(
    github: { owner: string; repo: string; branch: string },
    skillPath: string
): Promise<string | undefined> {
    try {
        const apiUrl = `https://api.github.com/repos/${github.owner}/${github.repo}/contents/${skillPath}/${SKILL_FILE}?ref=${github.branch}`;
        const parsed = await httpGetJson<any>(apiUrl);

        if (parsed.content) {
            const content = Buffer.from(parsed.content, 'base64').toString('utf-8');
            return extractDescriptionFromMarkdown(content);
        }
        return undefined;
    } catch {
        return undefined;
    }
}

/**
 * Scan a local directory for skills
 */
async function scanLocalSource(localPath: string, installPath: string): Promise<ScanResult> {
    const logger = getLogger();
    const skills: DiscoveredSkill[] = [];

    try {
        logger.info(LogCategory.GENERAL, `Scanning local path: ${localPath}`);

        const skillFilePath = path.join(localPath, SKILL_FILE);
        if (safeExists(skillFilePath)) {
            const skillName = path.basename(localPath);
            const description = getLocalSkillDescription(skillFilePath);
            skills.push({
                name: skillName,
                description,
                path: localPath,
                alreadyExists: safeExists(path.join(installPath, skillName))
            });
            return { success: true, skills };
        }

        const readResult = safeReadDir(localPath);
        if (!readResult.success || !readResult.data) {
            return {
                success: false,
                error: `Failed to read directory: ${localPath}`,
                skills: []
            };
        }

        for (const item of readResult.data) {
            const itemPath = path.join(localPath, item);
            const statsResult = safeStats(itemPath);

            if (!statsResult.success || !statsResult.data?.isDirectory()) {
                continue;
            }

            const itemSkillFile = path.join(itemPath, SKILL_FILE);
            if (safeExists(itemSkillFile)) {
                const description = getLocalSkillDescription(itemSkillFile);
                skills.push({
                    name: item,
                    description,
                    path: itemPath,
                    alreadyExists: safeExists(path.join(installPath, item))
                });
            }
        }

        if (skills.length === 0) {
            return {
                success: false,
                error: 'No valid skills found at this location.',
                skills: []
            };
        }

        return { success: true, skills };

    } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        logger.error(LogCategory.GENERAL, 'Error scanning local source', err);
        return {
            success: false,
            error: `Failed to scan local path: ${err.message}`,
            skills: []
        };
    }
}

/**
 * Get skill description from local SKILL.md file
 */
function getLocalSkillDescription(skillFilePath: string): string | undefined {
    const readResult = safeReadFile(skillFilePath);
    if (!readResult.success || !readResult.data) {
        return undefined;
    }
    return extractDescriptionFromMarkdown(readResult.data);
}

/**
 * Extract description from SKILL.md content
 */
export function extractDescriptionFromMarkdown(content: string): string | undefined {
    const lines = content.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    if (lines.length === 0) {
        return undefined;
    }

    let startIndex = 0;
    if (lines[0].startsWith('#')) {
        startIndex = 1;
    }

    for (let i = startIndex; i < lines.length; i++) {
        const line = lines[i];
        if (!line.startsWith('#') && !line.startsWith('---') && !line.startsWith('```')) {
            if (line.length > 100) {
                return line.substring(0, 97) + '...';
            }
            return line;
        }
    }

    if (lines[0].startsWith('#')) {
        return lines[0].replace(/^#+\s*/, '');
    }

    return undefined;
}
