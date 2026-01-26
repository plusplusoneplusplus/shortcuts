import * as fs from 'fs';
import * as path from 'path';
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
 * Default location for skills
 */
const DEFAULT_SKILLS_LOCATION = '.github/skills';

/**
 * Finds all skills in the .github/skills directory.
 * Each skill is a subdirectory in .github/skills/.
 *
 * @param workspaceRoot Optional workspace root path. If not provided, uses the first workspace folder.
 * @returns Array of Skill objects representing found skills
 */
export async function getSkills(workspaceRoot?: string): Promise<Skill[]> {
    const root = workspaceRoot || getWorkspaceRoot();
    if (!root) {
        return [];
    }

    const skillsPath = path.join(root, DEFAULT_SKILLS_LOCATION);

    // Check if skills folder exists
    if (!fs.existsSync(skillsPath)) {
        return [];
    }

    const skills: Skill[] = [];

    try {
        const entries = fs.readdirSync(skillsPath, { withFileTypes: true });

        for (const entry of entries) {
            if (entry.isDirectory()) {
                const skillDir = path.join(skillsPath, entry.name);
                skills.push({
                    absolutePath: skillDir,
                    relativePath: path.relative(root, skillDir),
                    name: entry.name,
                    sourceFolder: DEFAULT_SKILLS_LOCATION
                });
            }
        }
    } catch (error) {
        console.error(`Error reading skills folder ${skillsPath}:`, error);
    }

    return skills;
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
