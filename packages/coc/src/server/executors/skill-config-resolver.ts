/**
 * Skill Config Resolver
 *
 * Standalone function that resolves per-workspace skill configuration:
 * disabled skills (from workspace config + global preferences) and
 * skill directory paths (repo-local, global ~/.coc/skills, and extra).
 *
 * Extracted from CLITaskExecutor to keep the bridge as a thin facade.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { DEFAULT_SKILLS_SETTINGS } from '@plusplusoneplusplus/forge';

export async function resolveSkillConfig(
    store: ProcessStore,
    dataDir: string | undefined,
    workspaceId: string | undefined,
    workingDirectory: string | undefined,
): Promise<{ skillDirectories?: string[]; disabledSkills?: string[] }> {
    let disabledSkills: string[] | undefined;
    let extraSkillFolders: string[] | undefined;

    if (workspaceId) {
        try {
            const workspaces = await store.getWorkspaces();
            const ws = workspaces.find(w => w.id === workspaceId);
            if (ws?.disabledSkills && ws.disabledSkills.length > 0) {
                disabledSkills = [...ws.disabledSkills];
            }
            if (ws?.extraSkillFolders && ws.extraSkillFolders.length > 0) {
                extraSkillFolders = [...ws.extraSkillFolders];
            }
        } catch {
            // Non-fatal: continue without workspace config
        }
    }

    if (dataDir) {
        try {
            const prefsPath = path.join(dataDir, 'preferences.json');
            const prefsExists = await fs.promises.access(prefsPath).then(() => true).catch(() => false);
            if (prefsExists) {
                const prefs = JSON.parse(await fs.promises.readFile(prefsPath, 'utf-8'));
                const globalDisabled: string[] = prefs?.globalDisabledSkills;
                if (Array.isArray(globalDisabled) && globalDisabled.length > 0) {
                    disabledSkills = [...new Set([...(disabledSkills ?? []), ...globalDisabled])];
                }
            }
        } catch {
            // Non-fatal
        }
    }

    const dirs: string[] = [];
    const root = workingDirectory;

    if (root) {
        const skillsDir = path.join(root, DEFAULT_SKILLS_SETTINGS.installPath);
        try {
            if (await fs.promises.access(skillsDir).then(() => true).catch(() => false)) {
                dirs.push(skillsDir);
            }
        } catch {
            // Non-fatal
        }
    }

    if (dataDir) {
        const globalSkillsDir = path.join(dataDir, 'skills');
        try {
            if (await fs.promises.access(globalSkillsDir).then(() => true).catch(() => false)) {
                dirs.push(globalSkillsDir);
            }
        } catch {
            // Non-fatal
        }
    }

    if (extraSkillFolders) {
        for (const folder of extraSkillFolders) {
            const resolved = path.isAbsolute(folder)
                ? folder
                : (root ? path.resolve(root, folder) : null);
            if (resolved) {
                try {
                    if (await fs.promises.access(resolved).then(() => true).catch(() => false)) {
                        dirs.push(resolved);
                    }
                } catch {
                    // Non-fatal
                }
            }
        }
    }

    return {
        skillDirectories: dirs.length > 0 ? dirs : undefined,
        disabledSkills,
    };
}
