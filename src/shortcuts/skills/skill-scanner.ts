/**
 * Skill scanner for discovering skills from GitHub and local sources
 */

import * as path from 'path';
import * as vscode from 'vscode';
import { DiscoveredSkill, ParsedSource, ScanResult } from './types';
import { safeExists, safeReadDir, safeReadFile, safeStats, getExtensionLogger, LogCategory, execAsync } from '../shared';

/**
 * Skill file that identifies a valid skill directory
 */
const SKILL_FILE = 'SKILL.md';

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
 * Scan a GitHub repository for skills using gh CLI
 */
async function scanGitHubSource(
    github: { owner: string; repo: string; branch: string; path: string },
    installPath: string
): Promise<ScanResult> {
    const logger = getExtensionLogger();
    const skills: DiscoveredSkill[] = [];

    try {
        // Use gh CLI to list directory contents
        const repoPath = github.path || '';
        const ghPath = repoPath ? `${github.owner}/${github.repo}:${repoPath}` : `${github.owner}/${github.repo}`;
        
        logger.info(LogCategory.EXTENSION, `Scanning GitHub repository: ${ghPath} (branch: ${github.branch})`);

        // List contents of the directory
        const listCmd = `gh api repos/${github.owner}/${github.repo}/contents/${repoPath}?ref=${github.branch} --jq '.[] | select(.type == "dir") | .name'`;
        
        let directories: string[];
        try {
            const { stdout } = await execAsync(listCmd);
            directories = stdout.trim().split('\n').filter(d => d.length > 0);
        } catch (error) {
            // If the path itself is a skill directory (contains SKILL.md), treat it as a single skill
            const checkSkillCmd = `gh api repos/${github.owner}/${github.repo}/contents/${repoPath}/${SKILL_FILE}?ref=${github.branch} --jq '.name' 2>/dev/null || echo ''`;
            try {
                const { stdout: skillCheck } = await execAsync(checkSkillCmd);
                if (skillCheck.trim() === SKILL_FILE) {
                    // The path itself is a skill
                    const skillName = path.basename(repoPath) || github.repo;
                    const description = await getGitHubSkillDescription(github, repoPath);
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
            logger.warn(LogCategory.EXTENSION, 'Failed to list GitHub directory', { error: err.message });
            return {
                success: false,
                error: `Failed to access GitHub repository. Make sure gh CLI is installed and authenticated. Error: ${err.message}`,
                skills: []
            };
        }

        // Check each directory for SKILL.md
        for (const dir of directories) {
            const skillPath = repoPath ? `${repoPath}/${dir}` : dir;
            const skillFileCheck = `gh api repos/${github.owner}/${github.repo}/contents/${skillPath}/${SKILL_FILE}?ref=${github.branch} --jq '.name' 2>/dev/null || echo ''`;
            
            try {
                const { stdout } = await execAsync(skillFileCheck);
                if (stdout.trim() === SKILL_FILE) {
                    const description = await getGitHubSkillDescription(github, skillPath);
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
        logger.error(LogCategory.EXTENSION, 'Error scanning GitHub source', err);
        return {
            success: false,
            error: `Failed to scan GitHub repository: ${err.message}`,
            skills: []
        };
    }
}

/**
 * Get skill description from GitHub SKILL.md
 */
async function getGitHubSkillDescription(
    github: { owner: string; repo: string; branch: string },
    skillPath: string
): Promise<string | undefined> {
    try {
        const cmd = `gh api repos/${github.owner}/${github.repo}/contents/${skillPath}/${SKILL_FILE}?ref=${github.branch} --jq '.content' | base64 -d | head -5`;
        const { stdout } = await execAsync(cmd);
        return extractDescriptionFromMarkdown(stdout);
    } catch {
        return undefined;
    }
}

/**
 * Scan a local directory for skills
 */
async function scanLocalSource(localPath: string, installPath: string): Promise<ScanResult> {
    const logger = getExtensionLogger();
    const skills: DiscoveredSkill[] = [];

    try {
        logger.info(LogCategory.EXTENSION, `Scanning local path: ${localPath}`);

        // Check if the path itself is a skill directory
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

        // List subdirectories
        const readResult = safeReadDir(localPath);
        if (!readResult.success || !readResult.data) {
            return {
                success: false,
                error: `Failed to read directory: ${localPath}`,
                skills: []
            };
        }

        // Check each subdirectory for SKILL.md
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
        logger.error(LogCategory.EXTENSION, 'Error scanning local source', err);
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
 * Looks for the first paragraph after the title, or the title itself
 */
function extractDescriptionFromMarkdown(content: string): string | undefined {
    const lines = content.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    
    if (lines.length === 0) {
        return undefined;
    }

    // Skip the title (# heading)
    let startIndex = 0;
    if (lines[0].startsWith('#')) {
        startIndex = 1;
    }

    // Get the first non-heading, non-empty line as description
    for (let i = startIndex; i < lines.length; i++) {
        const line = lines[i];
        if (!line.startsWith('#') && !line.startsWith('---') && !line.startsWith('```')) {
            // Truncate if too long
            if (line.length > 100) {
                return line.substring(0, 97) + '...';
            }
            return line;
        }
    }

    // If no description found, use the title without the # prefix
    if (lines[0].startsWith('#')) {
        return lines[0].replace(/^#+\s*/, '');
    }

    return undefined;
}
