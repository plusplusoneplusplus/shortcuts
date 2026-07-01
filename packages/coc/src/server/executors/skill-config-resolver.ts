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
import * as os from 'os';
import * as path from 'path';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import {
    DEFAULT_SKILLS_SETTINGS,
    getBundledSkillsPath,
    resolvePathForHostFilesystem,
    resolvePathInExecutionContext,
    resolveWorkspaceExecutionContext,
    translatePathForExecution,
} from '@plusplusoneplusplus/forge';
import { getEffectiveEnDevExtraSkillFolders } from '../endev/endev-detector';

/**
 * Enumerate default OneDrive/CloudStorage skill-folder candidates for a home
 * directory. Returns candidate `<root>/.github/skills` paths to probe; callers
 * are responsible for filtering to those that actually exist (existence is not
 * checked here so the result stays deterministic and cheap to test).
 *
 * Covers:
 *  - Windows-style OneDrive roots: `~/OneDrive`, `~/OneDrive - Microsoft`
 *  - macOS CloudStorage roots: `~/Library/CloudStorage/OneDrive-*`
 *    (dynamically named, e.g. `OneDrive-Personal`, `OneDrive-Microsoft`)
 */
export async function resolveDefaultOneDriveSkillDirs(homedir: string): Promise<string[]> {
    const candidates: string[] = [];

    // Windows-style fixed OneDrive roots.
    for (const variant of ['OneDrive', 'OneDrive - Microsoft']) {
        candidates.push(path.join(homedir, variant, '.github', 'skills'));
    }

    // macOS CloudStorage OneDrive roots (dynamically named under Library/CloudStorage).
    const cloudStorageDir = path.join(homedir, 'Library', 'CloudStorage');
    try {
        const entries = await fs.promises.readdir(cloudStorageDir, { withFileTypes: true });
        for (const entry of entries) {
            if ((entry.isDirectory() || entry.isSymbolicLink()) && entry.name.startsWith('OneDrive')) {
                candidates.push(path.join(cloudStorageDir, entry.name, '.github', 'skills'));
            }
        }
    } catch {
        // Non-fatal: no CloudStorage directory (non-macOS host or OneDrive not installed).
    }

    return candidates;
}

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
            if (ws) {
                const effectiveExtraSkillFolders = await getEffectiveEnDevExtraSkillFolders(dataDir, ws);
                if (effectiveExtraSkillFolders.length > 0) {
                    extraSkillFolders = effectiveExtraSkillFolders;
                }
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
    const sessionContext = resolveWorkspaceExecutionContext(root);

    async function tryAddSkillDirectory(sourcePath: string, hostPath: string): Promise<void> {
        try {
            if (!await fs.promises.access(hostPath).then(() => true).catch(() => false)) {
                return;
            }
        } catch {
            return;
        }

        try {
            dirs.push(sessionContext.kind === 'wsl'
                ? translatePathForExecution(sourcePath, sessionContext)
                : hostPath);
        } catch {
            // Non-fatal: skip skill folders that the active session namespace cannot access
        }
    }

    if (root) {
        try {
            const skillsDir = resolvePathInExecutionContext(root, DEFAULT_SKILLS_SETTINGS.installPath);
            const hostSkillsDir = resolvePathForHostFilesystem(root, DEFAULT_SKILLS_SETTINGS.installPath);
            await tryAddSkillDirectory(skillsDir, hostSkillsDir);
        } catch {
            // Non-fatal: skip repo-local skills when path translation fails (e.g. Linux path on Windows without WSL)
        }
    }

    if (dataDir) {
        const globalSkillsDir = path.join(dataDir, 'skills');
        await tryAddSkillDirectory(globalSkillsDir, globalSkillsDir);
    }

    // Check default OneDrive skill directories (Windows-style roots + macOS CloudStorage).
    const homedir = os.homedir();
    for (const oneDriveSkillsDir of await resolveDefaultOneDriveSkillDirs(homedir)) {
        await tryAddSkillDirectory(oneDriveSkillsDir, oneDriveSkillsDir);
    }

    if (extraSkillFolders) {
        for (const folder of extraSkillFolders) {
            try {
                const sourcePath = (path.isAbsolute(folder) || resolveWorkspaceExecutionContext(folder).kind === 'wsl')
                    ? folder
                    : (root ? resolvePathInExecutionContext(root, folder) : null);
                const hostPath = (path.isAbsolute(folder) || resolveWorkspaceExecutionContext(folder).kind === 'wsl')
                    ? resolvePathForHostFilesystem(folder)
                    : (root ? resolvePathForHostFilesystem(root, folder) : null);
                if (sourcePath && hostPath) {
                    await tryAddSkillDirectory(sourcePath, hostPath);
                }
            } catch {
                // Non-fatal: skip extra skill folders when path translation fails
            }
        }
    }

    // Bundled skills (lowest priority — shipped with forge)
    const bundledDir = getBundledSkillsPath();
    try {
        if (await fs.promises.access(bundledDir).then(() => true).catch(() => false)) {
            dirs.push(bundledDir);
        }
    } catch {
        // Non-fatal
    }

    return {
        skillDirectories: dirs.length > 0 ? dirs : undefined,
        disabledSkills,
    };
}
