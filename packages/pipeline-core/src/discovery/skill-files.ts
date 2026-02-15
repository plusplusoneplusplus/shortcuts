import * as fs from 'fs';
import * as path from 'path';
import { getLogger } from '../logger';
import { DEFAULT_SKILLS_DIRECTORY } from '../config/defaults';
import type { SkillInfo } from './types';

/** Standard skill filename within a skill directory */
const SKILL_PROMPT_FILENAME = 'SKILL.md';

/** Frontmatter regex — same as skill-resolver.ts:207 */
const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---/;

/** Description extraction — same as skill-resolver.ts:215 */
const DESCRIPTION_REGEX = /^description:\s*["']?(.+?)["']?\s*$/m;

/**
 * Discover all skills under the skills directory.
 *
 * Merged from extension's getSkills() (skill-files-utils.ts:31-65) and
 * pipeline-core's listSkills() (skill-resolver.ts:169-195). Uses the
 * stricter validation from listSkills() which requires SKILL.md presence.
 *
 * @param rootDir        Workspace/project root (absolute path)
 * @param skillsLocation Custom skills folder, relative to rootDir or absolute.
 *                       Defaults to '.github/skills'.
 * @returns Array of discovered skills, sorted by name
 */
export async function findSkills(
    rootDir: string,
    skillsLocation?: string
): Promise<SkillInfo[]> {
    const location = skillsLocation ?? DEFAULT_SKILLS_DIRECTORY;
    const skillsDir = path.isAbsolute(location) ? location : path.join(rootDir, location);

    try {
        if (!fs.existsSync(skillsDir)) {
            return [];
        }

        const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
        const skills: SkillInfo[] = [];

        for (const entry of entries) {
            if (!entry.isDirectory()) {
                continue;
            }
            const skillMdPath = path.join(skillsDir, entry.name, SKILL_PROMPT_FILENAME);
            if (!fs.existsSync(skillMdPath)) {
                continue;
            }

            let description: string | undefined;
            try {
                const content = fs.readFileSync(skillMdPath, 'utf-8');
                const fmMatch = content.match(FRONTMATTER_REGEX);
                if (fmMatch) {
                    const descMatch = fmMatch[1].match(DESCRIPTION_REGEX);
                    if (descMatch) {
                        description = descMatch[1];
                    }
                }
            } catch {
                // Description extraction is best-effort
            }

            skills.push({
                absolutePath: path.join(skillsDir, entry.name),
                relativePath: path.relative(rootDir, path.join(skillsDir, entry.name)),
                name: entry.name,
                sourceFolder: location,
                description,
            });
        }

        skills.sort((a, b) => a.name.localeCompare(b.name));
        return skills;
    } catch (error) {
        getLogger().debug('Discovery', `Error reading skills directory ${skillsDir}: ${error}`);
        return [];
    }
}
