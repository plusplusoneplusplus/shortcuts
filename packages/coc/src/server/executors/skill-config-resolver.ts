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
/**
 * Options controlling default and globally-configured skill folder sources.
 * Sourced from the `skills` config namespace and plumbed in at the call site
 * (queue-executor-bridge). Kept optional so the resolver stays testable in
 * isolation and backward-compatible for callers that don't supply config.
 */
export interface SkillFolderOptions {
    /**
     * Configured global extra skill folders applied across all workspaces.
     * Read-only sources (never installed/deleted into). Absolute paths or
     * `~`-prefixed home paths; relative and malformed entries are skipped.
     */
    globalExtraFolders?: string[];
    /**
     * Auto-detect default skill folders (OneDrive/CloudStorage). Defaults to
     * true when undefined; pass `false` to skip all default auto-detection.
     */
    autoDetectDefaultFolders?: boolean;
}

/**
 * Expand a leading `~` (home directory) in a folder path. `~` alone maps to the
 * home directory; `~/x` and `~\x` map beneath it. Any other value is returned
 * unchanged so absolute paths pass through untouched.
 */
export function expandHomePath(folder: string, homedir: string): string {
    if (folder === '~') return homedir;
    if (folder.startsWith('~/') || folder.startsWith('~\\')) {
        return path.join(homedir, folder.slice(2));
    }
    return folder;
}

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
    options?: SkillFolderOptions,
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

    const homedir = os.homedir();

    // Check default OneDrive skill directories (Windows-style roots + macOS
    // CloudStorage), unless auto-detection is explicitly disabled.
    if (options?.autoDetectDefaultFolders !== false) {
        for (const oneDriveSkillsDir of await resolveDefaultOneDriveSkillDirs(homedir)) {
            await tryAddSkillDirectory(oneDriveSkillsDir, oneDriveSkillsDir);
        }
    }

    // Configured global extra skill folders (read-only, apply across all
    // workspaces). Ordered after auto-detected folders and before per-workspace
    // extra folders. Absolute or `~`-prefixed; relative/malformed entries skip.
    if (Array.isArray(options?.globalExtraFolders)) {
        for (const folder of options.globalExtraFolders) {
            if (typeof folder !== 'string' || folder.trim().length === 0) {
                continue;
            }
            try {
                const expanded = expandHomePath(folder, homedir);
                const isAbsoluteOrWsl = path.isAbsolute(expanded)
                    || resolveWorkspaceExecutionContext(expanded).kind === 'wsl';
                if (!isAbsoluteOrWsl) {
                    continue; // global folders must be absolute (no repo root to anchor to)
                }
                const hostPath = resolvePathForHostFilesystem(expanded);
                await tryAddSkillDirectory(expanded, hostPath);
            } catch {
                // Non-fatal: skip global extra folders when path translation fails
            }
        }
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

/**
 * A single directory in the agent's effective skill search order, annotated for
 * diagnostic display. Unlike {@link resolveSkillConfig} — which drops any
 * directory that does not exist — this enumeration keeps declared-but-missing
 * sources so the UI can explain what the agent will (and will not) use.
 */
export interface EffectiveSkillPathEntry {
    /** Where the path comes from; drives the UI source badge. */
    source: 'repo' | 'managed-global' | 'auto-detected' | 'configured' | 'repo-extra' | 'bundled';
    /** Whether the path applies globally or only to a specific workspace. */
    scope: 'global' | 'workspace';
    /** Availability of the path; drives the UI status badge. */
    status: 'available' | 'no-skills' | 'missing' | 'skipped';
    /** Absolute host-filesystem path (or the raw configured value when skipped). */
    path: string;
    /** Installed skill count found in the directory (present only when it exists). */
    skillCount?: number;
    /** Optional human-readable note (e.g. why a declared folder was skipped). */
    note?: string;
}

/** Inputs for {@link resolveEffectiveSkillPaths}. */
export interface ResolveEffectiveSkillPathsArgs {
    /** CoC data directory (`~/.coc`); managed global skills live at `<dataDir>/skills`. */
    dataDir?: string;
    /** Home directory used for OneDrive/CloudStorage detection. Defaults to `os.homedir()`. */
    homedir?: string;
    /** Active workspace root; when set, repo-local + per-repo extra folders are included (scope: workspace). */
    workspaceRootPath?: string;
    /** Per-repo extra skill folders for the active workspace (already resolved from workspace config). */
    extraSkillFolders?: string[];
    /** Configured global extra skill folders (`skills.globalExtraFolders`). */
    globalExtraFolders?: string[];
    /** Whether OneDrive/CloudStorage auto-detection is enabled. Defaults to true. */
    autoDetectDefaultFolders?: boolean;
}

/** Count installed skills (subdirectories containing SKILL.md) in a directory. */
async function countInstalledSkills(dir: string): Promise<number> {
    try {
        const entries = await fs.promises.readdir(dir, { withFileTypes: true });
        let count = 0;
        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            const hasSkillMd = await fs.promises
                .access(path.join(dir, entry.name, 'SKILL.md'))
                .then(() => true)
                .catch(() => false);
            if (hasSkillMd) count++;
        }
        return count;
    } catch {
        return 0;
    }
}

/**
 * Probe a declared skill directory on the host filesystem and classify it as
 * available/no-skills/missing with a skill count.
 */
async function describeSkillDir(
    hostPath: string,
    source: EffectiveSkillPathEntry['source'],
    scope: EffectiveSkillPathEntry['scope'],
): Promise<EffectiveSkillPathEntry> {
    const exists = await fs.promises.access(hostPath).then(() => true).catch(() => false);
    if (!exists) {
        return { source, scope, status: 'missing', path: hostPath };
    }
    const skillCount = await countInstalledSkills(hostPath);
    return {
        source,
        scope,
        status: skillCount > 0 ? 'available' : 'no-skills',
        path: hostPath,
        skillCount,
    };
}

/**
 * Enumerate the agent's effective skill search order as structured diagnostic
 * data, in priority order:
 *
 *   repo-local → managed global → auto-detected OneDrive/CloudStorage →
 *   configured global extra → per-repo extra → bundled
 *
 * Global-scoped sources are always included; workspace-scoped sources
 * (repo-local, per-repo extra) are included only when `workspaceRootPath` is
 * supplied — so the global Config tab can render global-only paths and repo
 * settings can render workspace-specific paths. Auto-detected OneDrive folders
 * are surfaced only when they actually exist, keeping the diagnostic view from
 * being flooded with missing default paths (AC #7).
 */
export async function resolveEffectiveSkillPaths(
    args: ResolveEffectiveSkillPathsArgs,
): Promise<EffectiveSkillPathEntry[]> {
    const homedir = args.homedir ?? os.homedir();
    const entries: EffectiveSkillPathEntry[] = [];

    // 1. Repo-local .github/skills (workspace-scoped).
    if (args.workspaceRootPath) {
        try {
            const hostPath = resolvePathForHostFilesystem(args.workspaceRootPath, DEFAULT_SKILLS_SETTINGS.installPath);
            entries.push(await describeSkillDir(hostPath, 'repo', 'workspace'));
        } catch {
            // Non-fatal: skip repo-local when path translation fails.
        }
    }

    // 2. Managed global ~/.coc/skills (global-scoped).
    if (args.dataDir) {
        const hostPath = path.join(args.dataDir, 'skills');
        entries.push(await describeSkillDir(hostPath, 'managed-global', 'global'));
    }

    // 3. Auto-detected OneDrive/CloudStorage — surface only those that exist.
    if (args.autoDetectDefaultFolders !== false) {
        for (const candidate of await resolveDefaultOneDriveSkillDirs(homedir)) {
            const exists = await fs.promises.access(candidate).then(() => true).catch(() => false);
            if (!exists) continue;
            const skillCount = await countInstalledSkills(candidate);
            entries.push({
                source: 'auto-detected',
                scope: 'global',
                status: skillCount > 0 ? 'available' : 'no-skills',
                path: candidate,
                skillCount,
            });
        }
    }

    // 4. Configured global extra folders (global-scoped, read-only).
    if (Array.isArray(args.globalExtraFolders)) {
        for (const folder of args.globalExtraFolders) {
            if (typeof folder !== 'string' || folder.trim().length === 0) continue;
            const expanded = expandHomePath(folder, homedir);
            const isAbsoluteOrWsl = path.isAbsolute(expanded)
                || resolveWorkspaceExecutionContext(expanded).kind === 'wsl';
            if (!isAbsoluteOrWsl) {
                entries.push({
                    source: 'configured',
                    scope: 'global',
                    status: 'skipped',
                    path: folder,
                    note: 'Global extra folders must be absolute paths',
                });
                continue;
            }
            try {
                const hostPath = resolvePathForHostFilesystem(expanded);
                entries.push(await describeSkillDir(hostPath, 'configured', 'global'));
            } catch {
                entries.push({ source: 'configured', scope: 'global', status: 'skipped', path: folder, note: 'Path could not be resolved' });
            }
        }
    }

    // 5. Per-repo extra folders (workspace-scoped).
    if (args.workspaceRootPath && Array.isArray(args.extraSkillFolders)) {
        for (const folder of args.extraSkillFolders) {
            if (typeof folder !== 'string' || folder.trim().length === 0) continue;
            try {
                const isAbsoluteOrWsl = path.isAbsolute(folder)
                    || resolveWorkspaceExecutionContext(folder).kind === 'wsl';
                const hostPath = isAbsoluteOrWsl
                    ? resolvePathForHostFilesystem(folder)
                    : resolvePathForHostFilesystem(args.workspaceRootPath, folder);
                entries.push(await describeSkillDir(hostPath, 'repo-extra', 'workspace'));
            } catch {
                entries.push({ source: 'repo-extra', scope: 'workspace', status: 'skipped', path: folder, note: 'Path could not be resolved' });
            }
        }
    }

    // 6. Bundled skills (global-scoped, lowest priority).
    try {
        const bundledDir = getBundledSkillsPath();
        entries.push(await describeSkillDir(bundledDir, 'bundled', 'global'));
    } catch {
        // Non-fatal
    }

    return entries;
}
