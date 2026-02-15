import { findSkills as coreFindSkills } from '@plusplusoneplusplus/pipeline-core';
import { getWorkspaceRoot } from './workspace-utils';

/**
 * Represents a skill with its path and metadata
 */
export interface Skill {
    /** Absolute path to the skill directory */
    absolutePath: string;
    /** Path relative to the workspace root */
    relativePath: string;
    /** Skill name (directory name) */
    name: string;
    /** The base folder where skills are stored */
    sourceFolder: string;
}

/**
 * Finds all skills in the .github/skills directory.
 * Each skill is a subdirectory in .github/skills/ that contains a SKILL.md file.
 *
 * @param workspaceRoot Optional workspace root path. If not provided, uses the first workspace folder.
 * @returns Array of Skill objects representing found skills
 */
export async function getSkills(workspaceRoot?: string): Promise<Skill[]> {
    const root = workspaceRoot || getWorkspaceRoot();
    if (!root) {
        return [];
    }

    // Delegate filesystem scanning to pipeline-core
    const coreResults = await coreFindSkills(root);

    // Map pipeline-core SkillInfo → extension Skill (drop description field)
    return coreResults.map(info => ({
        absolutePath: info.absolutePath,
        relativePath: info.relativePath,
        name: info.name,
        sourceFolder: info.sourceFolder,
    }));
}

/**
 * Gets skill paths as a flat list (convenience function)
 *
 * @param workspaceRoot Optional workspace root path
 * @returns Array of absolute paths to skill directories
 */
export async function getSkillPaths(workspaceRoot?: string): Promise<string[]> {
    const skills = await getSkills(workspaceRoot);
    return skills.map(s => s.absolutePath);
}

/**
 * Gets skill names
 *
 * @param workspaceRoot Optional workspace root path
 * @returns Array of skill names (directory names)
 */
export async function getSkillNames(workspaceRoot?: string): Promise<string[]> {
    const skills = await getSkills(workspaceRoot);
    return skills.map(s => s.name);
}
