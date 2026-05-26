/**
 * Skills command group for CoC CLI.
 *
 * Provides skill management subcommands:
 *   coc skills list [--workspace <path>] [--global] [--all]
 *   coc skills install-bundled [<name>...] [--workspace <path>] [--global] [--replace]
 *   coc skills install <source> [--workspace <path>] [--global] [--replace] [--select <name,...>]
 *   coc skills delete <name> [--workspace <path>] [--global]
 *
 * <source> can be a GitHub URL (https://github.com/user/repo) or a local path
 * (absolute, relative, or home-directory path) containing skills.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import {
    detectSource,
    scanForSkills,
    installSkills,
    getBundledSkills,
    installBundledSkills,
    DEFAULT_SKILLS_SETTINGS,
    isWithinDirectory,
    setLogger,
    resolveClawHubToGitHub,
    parseBundledSkillVersion,
    parseSkillVersionFromFile,
    autoUpdateBundledSkills,
    compareVersions,
} from '@plusplusoneplusplus/forge';
import { listInstalledSkills } from '../server/skills/skill-handler';
import { createCLIPinoLogger, pinoAdapterForPipelineCore } from '../pino-setup';

// Wire a basic Pino-backed logger for pipeline-core operations in skills commands
setLogger(pinoAdapterForPipelineCore(createCLIPinoLogger({ level: 'info', pretty: 'auto', stores: {} }).ai));

// ============================================================================
// Helpers
// ============================================================================

function getGlobalSkillsDir(): string {
    // COC_DATA_DIR env var is used in tests to override the default data directory
    const dataDir = process.env.COC_DATA_DIR || path.join(os.homedir(), '.coc');
    return path.join(dataDir, 'skills');
}

function getDataDir(): string {
    return process.env.COC_DATA_DIR || path.join(os.homedir(), '.coc');
}

function getInstallPath(workspaceRoot: string, installPathOverride?: string): string {
    return path.join(workspaceRoot, installPathOverride || DEFAULT_SKILLS_SETTINGS.installPath);
}

// ============================================================================
// Command Handlers
// ============================================================================

export interface SkillListOptions {
    workspace?: string;
    global?: boolean;
    all?: boolean;
}

export async function executeSkillList(options: SkillListOptions): Promise<number> {
    // --all: show both global and repo skills
    if (options.all) {
        const globalDir = getGlobalSkillsDir();
        const globalSkills = listInstalledSkills(globalDir);
        const workspaceRoot = path.resolve(options.workspace || process.cwd());
        const repoInstallPath = getInstallPath(workspaceRoot);
        const repoSkills = listInstalledSkills(repoInstallPath);

        if (globalSkills.length === 0 && repoSkills.length === 0) {
            console.log('No skills installed.');
            return 0;
        }

        const allSkills = [
            ...globalSkills.map(s => ({ ...s, source: 'global' })),
            ...repoSkills.map(s => ({ ...s, source: 'repo' })),
        ];
        const maxNameLen = Math.max(...allSkills.map(s => s.name.length), 4);
        const maxSourceLen = 6; // 'global'
        console.log(`All installed skills:\n`);
        for (const skill of allSkills) {
            const padded = skill.name.padEnd(maxNameLen + 2);
            const src = skill.source.padEnd(maxSourceLen + 2);
            const status = skill.source === 'global'
                ? getVersionStatus(globalDir, skill.name) + '  '
                : '';
            console.log(`  ${padded}${src}${status}${skill.description || ''}`);
        }
        console.log(`\n${allSkills.length} skill(s) total (${globalSkills.length} global, ${repoSkills.length} repo).`);
        return 0;
    }

    // --global: show only global skills
    if (options.global) {
        const globalDir = getGlobalSkillsDir();
        const skills = listInstalledSkills(globalDir);
        if (skills.length === 0) {
            console.log('No global skills installed in', globalDir);
            return 0;
        }
        console.log(`Global skills in ${globalDir}/\n`);
        const maxNameLen = Math.max(...skills.map(s => s.name.length), 4);
        for (const skill of skills) {
            const padded = skill.name.padEnd(maxNameLen + 2);
            const status = getVersionStatus(globalDir, skill.name);
            console.log(`  ${padded}${status}  ${skill.description || ''}`);
        }
        console.log(`\n${skills.length} global skill(s) installed.`);
        return 0;
    }

    // Default: repo-local skills
    const workspaceRoot = path.resolve(options.workspace || process.cwd());
    const installPath = getInstallPath(workspaceRoot);
    const skills = listInstalledSkills(installPath);

    if (skills.length === 0) {
        console.log('No skills installed in', installPath);
        return 0;
    }

    console.log(`Installed skills in ${path.relative(workspaceRoot, installPath)}/\n`);
    const maxNameLen = Math.max(...skills.map(s => s.name.length), 4);
    for (const skill of skills) {
        const padded = skill.name.padEnd(maxNameLen + 2);
        console.log(`  ${padded}${skill.description || ''}`);
    }
    console.log(`\n${skills.length} skill(s) installed.`);
    return 0;
}

export interface SkillInstallBundledOptions {
    workspace?: string;
    replace?: boolean;
    global?: boolean;
}

export async function executeSkillInstallBundled(
    names: string[],
    options: SkillInstallBundledOptions
): Promise<number> {
    const installPath = options.global
        ? getGlobalSkillsDir()
        : getInstallPath(path.resolve(options.workspace || process.cwd()));

    // Ensure directory exists for global installs
    if (options.global) {
        fs.mkdirSync(installPath, { recursive: true });
    }

    const allBundled = getBundledSkills(installPath);

    if (allBundled.length === 0) {
        console.error('No bundled skills found.');
        return 1;
    }

    const toInstall = names.length > 0
        ? allBundled.filter(s => names.includes(s.name))
        : allBundled;

    if (toInstall.length === 0) {
        console.error('No matching bundled skills found. Available:', allBundled.map(s => s.name).join(', '));
        return 1;
    }

    const result = await installBundledSkills(toInstall, installPath, async () => options.replace ?? false);

    for (const detail of result.details) {
        if (detail.action === 'skipped') {
            console.log(`  Skipped:   ${detail.name} (already exists, use --replace to overwrite)`);
        } else if (detail.action === 'installed' || detail.action === 'replaced') {
            console.log(`✔ Installed: ${detail.name}`);
        } else {
            console.error(`✗ Failed:    ${detail.name}: ${detail.reason ?? 'unknown error'}`);
        }
    }

    return result.failed > 0 ? 1 : 0;
}

export interface SkillInstallOptions {
    workspace?: string;
    replace?: boolean;
    select?: string;
    global?: boolean;
}

export async function executeSkillInstall(
    source: string,
    options: SkillInstallOptions
): Promise<number> {
    const workspaceRoot = path.resolve(options.workspace || process.cwd());
    const installPath = options.global
        ? getGlobalSkillsDir()
        : getInstallPath(workspaceRoot);

    // Ensure directory exists for global installs
    if (options.global) {
        fs.mkdirSync(installPath, { recursive: true });
    }

    const sourceResult = detectSource(source, workspaceRoot);
    if (!sourceResult.success) {
        console.error('Error:', sourceResult.error);
        return 1;
    }

    // Resolve ClawHub sources to GitHub before scanning
    let resolvedSource = sourceResult.source;
    if (resolvedSource.type === 'clawhub') {
        console.log('Resolving ClawHub → GitHub…');
        const resolved = await resolveClawHubToGitHub(resolvedSource);
        if (!resolved.success) {
            console.error('Error:', resolved.error);
            return 1;
        }
        resolvedSource = resolved.source;
    }

    const isLocal = resolvedSource.type === 'local';
    console.log(isLocal ? `Scanning local path: ${source}…` : `Scanning ${source}…`);
    const scanResult = await scanForSkills(resolvedSource, installPath);
    if (!scanResult.success || scanResult.skills.length === 0) {
        console.error(scanResult.error || 'No skills found at this path.');
        return 1;
    }

    console.log(`Found ${scanResult.skills.length} skill(s): ${scanResult.skills.map(s => s.name).join(', ')}\n`);

    let skillsToInstall = scanResult.skills;
    if (options.select) {
        const selected = options.select.split(',').map(s => s.trim());
        skillsToInstall = scanResult.skills.filter(s => selected.includes(s.name));
        if (skillsToInstall.length === 0) {
            console.error('No matching skills for --select:', options.select);
            return 1;
        }
    }

    const result = await installSkills(skillsToInstall, resolvedSource, installPath, async () => options.replace ?? false);

    for (const detail of result.details) {
        if (detail.action === 'skipped') {
            console.log(`  Skipped: ${detail.name} (already exists, use --replace to overwrite)`);
        } else if (detail.action === 'installed' || detail.action === 'replaced') {
            console.log(`✔ Installed: ${detail.name}`);
        } else {
            console.error(`✗ Failed: ${detail.name}: ${detail.reason ?? 'unknown error'}`);
        }
    }

    return result.failed > 0 ? 1 : 0;
}

export interface SkillDeleteOptions {
    workspace?: string;
    global?: boolean;
}

export async function executeSkillDelete(
    name: string,
    options: SkillDeleteOptions
): Promise<number> {
    const installPath = options.global
        ? getGlobalSkillsDir()
        : getInstallPath(path.resolve(options.workspace || process.cwd()));
    const skillPath = path.join(installPath, name);

    // Security: ensure skill path is within install path
    if (!isWithinDirectory(skillPath, installPath)) {
        console.error('Invalid skill name:', name);
        return 1;
    }

    const skillMdPath = path.join(skillPath, 'SKILL.md');
    if (!fs.existsSync(skillMdPath)) {
        console.error(`Skill not found: ${name}`);
        return 1;
    }

    try {
        fs.rmSync(skillPath, { recursive: true, force: true });
        console.log(`✔ Deleted skill: ${name}`);
        return 0;
    } catch (err: any) {
        console.error(`Failed to delete skill: ${err.message}`);
        return 1;
    }
}

// ============================================================================
// Version Status Helpers
// ============================================================================

/**
 * Get a version status indicator for a globally-installed skill.
 * ✓ = up-to-date, ↑ = update available, ? = unknown
 */
function getVersionStatus(globalDir: string, skillName: string): string {
    const installedSkillMd = path.join(globalDir, skillName, 'SKILL.md');
    const installedVersion = parseSkillVersionFromFile(installedSkillMd);
    const bundledVersion = parseBundledSkillVersion(skillName);

    if (!bundledVersion) {
        // Not a bundled skill or bundled has no version
        return '?';
    }
    if (!installedVersion) {
        return '?';
    }

    const cmp = compareVersions(bundledVersion, installedVersion);
    if (cmp === undefined) return '?';
    if (cmp > 0) return `↑ ${bundledVersion} available`;
    return '✓';
}

// ============================================================================
// Check Updates Command
// ============================================================================

export async function executeSkillCheckUpdates(): Promise<number> {
    const globalDir = getGlobalSkillsDir();
    const result = await autoUpdateBundledSkills(globalDir, { dryRun: true });

    if (result.updated.length === 0) {
        console.log('All globally-installed bundled skills are up to date.');
        return 0;
    }

    console.log('Updates available:\n');
    const maxNameLen = Math.max(...result.updated.map(u => u.name.length), 4);
    for (const u of result.updated) {
        const padded = u.name.padEnd(maxNameLen + 2);
        console.log(`  ↑ ${padded}${u.previousVersion} → ${u.newVersion}`);
    }
    console.log(`\n${result.updated.length} skill(s) can be updated.`);
    console.log('Run "coc skills install-bundled --global --replace" to update.');
    return 1;
}
