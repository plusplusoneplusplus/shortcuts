import * as path from 'path';
import { getLogger, LogCategory } from '../logger';
import { ensureDirectoryExists, safeExists } from '../utils';
import type { BundledSkill } from './types';
import type { AutoInstallResult } from './bundled-skills-provider';
import { copySkillDirectory } from './skill-copy';

const MY_WORK_SKILLS_REGISTRY: BundledSkill[] = [
    {
        name: 'swe-1on1-notes',
        description: 'Synthesizes SWE manager 1:1 notes into themes, follow-ups, commitments, risks, coaching signals, and next-meeting prep.',
        relativePath: 'swe-1on1-notes',
    },
];

export function getMyWorkSkillsPath(): string {
    return path.join(__dirname, '../../resources/my-work-skills');
}

export async function autoInstallMyWorkSkills(installPath: string): Promise<AutoInstallResult> {
    const logger = getLogger();
    const result: AutoInstallResult = { installed: [], skipped: [], errors: [] };

    ensureDirectoryExists(installPath);

    const bundledPath = getMyWorkSkillsPath();

    for (const entry of MY_WORK_SKILLS_REGISTRY) {
        const skillSrc = path.join(bundledPath, entry.relativePath);
        const skillFile = path.join(skillSrc, 'SKILL.md');
        if (!safeExists(skillFile)) {
            result.skipped.push(entry.name);
            continue;
        }

        const targetPath = path.join(installPath, entry.name);
        if (safeExists(targetPath)) {
            result.skipped.push(entry.name);
            continue;
        }

        try {
            await copySkillDirectory(skillSrc, targetPath);
            result.installed.push(entry.name);
            logger.info(LogCategory.GENERAL, `Auto-installed My Work skill "${entry.name}"`);
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            logger.error(LogCategory.GENERAL, `Failed to auto-install My Work skill "${entry.name}"`, err);
            result.errors.push({ name: entry.name, error: err.message });
        }
    }

    return result;
}

export function getMyWorkSkillsRegistry(): readonly BundledSkill[] {
    return MY_WORK_SKILLS_REGISTRY;
}
