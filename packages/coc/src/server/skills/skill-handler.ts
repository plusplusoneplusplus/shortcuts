/**
 * Skill Management REST API Handler
 *
 * HTTP API routes for managing skills in a workspace's .github/skills/ directory.
 * Provides listing, scanning, installing, and deleting skills.
 *
 * Pure Node.js; uses pipeline-core skill utilities.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import type { ProcessStore, WorkspaceInfo } from '@plusplusoneplusplus/forge';
import {
    getBundledSkills,
    DEFAULT_SKILLS_SETTINGS,
    isWithinDirectory,
    normalizeExecutionPath,
    resolvePathForHostFilesystem,
    resolvePathInExecutionContext,
    resolveWorkspaceExecutionContext,
} from '@plusplusoneplusplus/forge';
import { sendJSON } from '../core/api-handler';
import { handleAPIError, notFound, badRequest, internalError } from '../errors';
import { resolveWorkspaceOrFail } from '../shared/handler-utils';
import { createSkillRouteHandlers } from './skill-route-handlers';
import { getRepoDataPath } from '../paths';
import { loadConfigFile } from '../../config';
import { expandHomePath } from '../executors/skill-config-resolver';
import type { Route } from '../types';
import {
    ENDEV_XDPU_SKILL_NAME,
    getEffectiveEnDevExtraSkillFolders,
    isEnDevWrapperSkillVisible,
} from '../endev/endev-detector';

// ============================================================================
// Helpers
// ============================================================================

/** Skill names that collide with sub-routes and must be rejected. */
const RESERVED_SKILL_NAMES = new Set(['bundled', 'scan', 'install', 'all']);

/** Remove duplicate skills by name, keeping the first occurrence. */
function dedupByName<T extends { name: string }>(skills: T[]): T[] {
    const seen = new Set<string>();
    return skills.filter(s => {
        if (seen.has(s.name)) return false;
        seen.add(s.name);
        return true;
    });
}

function getSkillsInstallPath(workspaceRoot: string): string {
    return resolvePathForHostFilesystem(workspaceRoot, DEFAULT_SKILLS_SETTINGS.installPath);
}

function getSkillsSourcePath(workspaceRoot: string): string {
    return resolvePathInExecutionContext(workspaceRoot, DEFAULT_SKILLS_SETTINGS.installPath);
}

function resolveExtraSkillFolderSourcePath(workspaceRoot: string, folder: string): string {
    if (path.isAbsolute(folder) || resolveWorkspaceExecutionContext(folder).kind === 'wsl') {
        return folder;
    }
    return resolvePathInExecutionContext(workspaceRoot, folder);
}

function resolveExtraSkillFolderInstallPath(workspaceRoot: string, folder: string): string {
    if (path.isAbsolute(folder) || resolveWorkspaceExecutionContext(folder).kind === 'wsl') {
        return resolvePathForHostFilesystem(folder);
    }
    return resolvePathForHostFilesystem(workspaceRoot, folder);
}

/**
 * Read configured global extra skill folders (`skills.globalExtraFolders`) from
 * the CLI config file. These are read-only skill sources applied across all
 * workspaces (CoC never installs/deletes into them). Never throws — a missing or
 * malformed config yields an empty list, and non-array/non-string shapes are
 * dropped. The config loader is injectable so callers/tests can supply a
 * hermetic config instead of reading the real `~/.coc/config.yaml`.
 */
export function readConfiguredGlobalExtraFolders(
    load: () => { skills?: { globalExtraFolders?: unknown } } | undefined = loadConfigFile,
): string[] {
    try {
        const folders = load()?.skills?.globalExtraFolders;
        return Array.isArray(folders)
            ? folders.filter((f): f is string => typeof f === 'string')
            : [];
    } catch {
        return [];
    }
}

/**
 * Resolve a configured global extra skill folder to its source + host install
 * paths. Global extra folders are read-only sources that must be absolute (or a
 * WSL path) after `~` expansion — there is no repo root to anchor a relative
 * value to — so relative and malformed entries return null and are skipped,
 * mirroring the runtime resolver's handling.
 */
function resolveGlobalExtraSkillFolderPaths(
    folder: string,
): { sourcePath: string; installPath: string } | null {
    if (typeof folder !== 'string' || folder.trim().length === 0) {
        return null;
    }
    const expanded = expandHomePath(folder, os.homedir());
    const isAbsoluteOrWsl = path.isAbsolute(expanded)
        || resolveWorkspaceExecutionContext(expanded).kind === 'wsl';
    if (!isAbsoluteOrWsl) {
        return null;
    }
    try {
        return { sourcePath: expanded, installPath: resolvePathForHostFilesystem(expanded) };
    } catch {
        return null;
    }
}

/**
 * Sort skills by most-recently-used first, then alphabetically.
 * Skills with a usage timestamp are sorted most-recent-first;
 * unused skills follow in A→Z order.
 */
export function sortSkillsByUsage(
    skills: SkillInfo[],
    usageMap: Record<string, string>,
): SkillInfo[] {
    return [...skills].sort((a, b) => {
        const ta = usageMap[a.name];
        const tb = usageMap[b.name];
        if (ta && tb) return tb.localeCompare(ta);
        if (ta) return -1;
        if (tb) return 1;
        return a.name.localeCompare(b.name);
    });
}

/** Enriched skill info returned by the list/detail endpoints */
export interface SkillInfo {
    name: string;
    description?: string;
    version?: string;
    variables?: string[];
    output?: string[];
    promptBody?: string;
    references?: string[];
    scripts?: string[];
    relativePath?: string;
    source?: 'global' | 'repo' | 'bundled' | 'linked-repo' | 'extra-folder' | 'global-extra-folder';
    /** Workspace ID of the repo this skill was loaded from (only set when source = 'linked-repo'). */
    sourceRepoId?: string;
    /** Absolute path of the directory containing this skill. */
    folderPath?: string;
    /** Human-readable label for the folder: 'global' | 'repo' | path-or-repo-name. */
    folderLabel?: string;
}

// ============================================================================
// Cache
// ============================================================================

interface SkillCacheEntry {
    skills: SkillInfo[];
    refreshing: boolean;
    lastUpdated: number;
}

/** How long (ms) a cached skill list is considered fresh before a background refresh is triggered. */
export const SKILL_CACHE_TTL_MS = 60_000;

/** Per-workspace skill list cache. Keyed by workspace id. Exported for testing and global invalidation. */
export const skillCache = new Map<string, SkillCacheEntry>();

// ============================================================================
// Parsing helpers
// ============================================================================

export const VERSION_REGEX = /^version:\s*["']?(.+?)["']?\s*$/m;
export const VARIABLES_REGEX = /^variables:\s*\[([^\]]+)\]/m;
export const OUTPUT_REGEX = /^output:\s*\[([^\]]+)\]/m;

export function parseSkillMd(content: string): {
    description?: string;
    version?: string;
    variables?: string[];
    output?: string[];
    promptBody?: string;
} {
    let description: string | undefined;
    let version: string | undefined;
    let variables: string[] | undefined;
    let output: string[] | undefined;
    let promptBody: string | undefined;

    const fmMatch = content.match(FRONTMATTER_REGEX);
    if (fmMatch) {
        const fm = fmMatch[1];
        description = parseYamlDescription(fm);
        const verMatch = fm.match(VERSION_REGEX);
        if (verMatch) version = verMatch[1];
        const varMatch = fm.match(VARIABLES_REGEX);
        if (varMatch) {
            variables = varMatch[1].split(',').map(v => v.trim().replace(/["']/g, '')).filter(v => v.length > 0);
        }
        const outMatch = fm.match(OUTPUT_REGEX);
        if (outMatch) {
            output = outMatch[1].split(',').map(v => v.trim().replace(/["']/g, '')).filter(v => v.length > 0);
        }
        // Prompt body = everything after frontmatter
        promptBody = content.slice(fmMatch[0].length).trim() || undefined;
    } else {
        description = extractDescriptionFromMarkdown(content);
        promptBody = content.trim() || undefined;
    }

    return { description, version, variables, output, promptBody };
}

export function listDirectoryFiles(dirPath: string): string[] {
    if (!fs.existsSync(dirPath)) return [];
    try {
        return fs.readdirSync(dirPath).filter(f => {
            try { return fs.statSync(path.join(dirPath, f)).isFile(); } catch { return false; }
        }).sort();
    } catch { return []; }
}

function applyParsedSkill(skill: SkillInfo, parsed: ReturnType<typeof parseSkillMd>): void {
    skill.description = parsed.description;
    skill.version = parsed.version;
    skill.variables = parsed.variables;
    skill.output = parsed.output;
    skill.promptBody = parsed.promptBody;
}

function buildSkillFromDir(skillDir: string, skillName: string): SkillInfo {
    const skill: SkillInfo = { name: skillName };
    const skillMdPath = path.join(skillDir, 'SKILL.md');
    try {
        const content = fs.readFileSync(skillMdPath, 'utf-8');
        const parsed = parseSkillMd(content);
        applyParsedSkill(skill, parsed);
    } catch {
        // ignore
    }
    skill.references = listDirectoryFiles(path.join(skillDir, 'references'));
    skill.scripts    = listDirectoryFiles(path.join(skillDir, 'scripts'));
    return skill;
}

export function listInstalledSkills(installPath: string): SkillInfo[] {
    if (!fs.existsSync(installPath)) {
        return [];
    }

    const skills: SkillInfo[] = [];

    try {
        const entries = fs.readdirSync(installPath, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            const skillDir = path.join(installPath, entry.name);
            const skillMdPath = path.join(skillDir, 'SKILL.md');
            if (!fs.existsSync(skillMdPath)) continue;

            skills.push(buildSkillFromDir(skillDir, entry.name));
        }
    } catch {
        // ignore
    }

    return skills;
}

export function getSkillDetail(installPath: string, skillName: string): SkillInfo | null {
    const skillDir = path.join(installPath, skillName);
    const skillMdPath = path.join(skillDir, 'SKILL.md');
    if (!fs.existsSync(skillMdPath)) return null;

    return buildSkillFromDir(skillDir, skillName);
}

export const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---/;
export const DESCRIPTION_REGEX = /^description:\s*["']?(.+?)["']?\s*$/m;

/**
 * Parse the `description` field from YAML frontmatter, handling both
 * single-line values and YAML block scalars (`|` and `>`).
 */
export function parseYamlDescription(frontmatter: string): string | undefined {
    // Try block scalar (| or >) first
    const blockMatch = frontmatter.match(/^description:\s*([|>])[-+]?\s*$/m);
    if (blockMatch) {
        const style = blockMatch[1]; // '|' or '>'
        const startIdx = blockMatch.index! + blockMatch[0].length;
        const rest = frontmatter.slice(startIdx).replace(/^\r?\n/, '');
        const lines = rest.split(/\r?\n/);
        const descLines: string[] = [];
        for (const line of lines) {
            if (/^\s+\S/.test(line)) {
                descLines.push(line.replace(/^\s+/, ''));
            } else if (line.trim() === '' && descLines.length > 0) {
                descLines.push('');
            } else {
                break;
            }
        }
        while (descLines.length > 0 && descLines[descLines.length - 1] === '') {
            descLines.pop();
        }
        if (descLines.length === 0) return undefined;
        return style === '|' ? descLines.join('\n') : descLines.join(' ');
    }

    // Fall back to single-line match
    const singleMatch = frontmatter.match(DESCRIPTION_REGEX);
    return singleMatch ? singleMatch[1] : undefined;
}

export function extractDescriptionFromMarkdown(content: string): string | undefined {
    // Try YAML frontmatter first
    const fmMatch = content.match(FRONTMATTER_REGEX);
    if (fmMatch) {
        const desc = parseYamlDescription(fmMatch[1]);
        if (desc) {
            return desc;
        }
    }

    // Fallback: first non-heading, non-fence, non-delimiter line after optional heading
    const lines = content.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length === 0) return undefined;

    let startIndex = 0;
    if (lines[0].startsWith('#')) startIndex = 1;

    for (let i = startIndex; i < lines.length; i++) {
        const line = lines[i];
        if (!line.startsWith('#') && !line.startsWith('---') && !line.startsWith('```')) {
            return line.length > 100 ? line.substring(0, 97) + '...' : line;
        }
    }

    return undefined;
}

// ============================================================================
// Skill loading helper (used by GET handler and background refresh)
// ============================================================================

export async function filterVisibleSkillsForWorkspace(
    skills: SkillInfo[],
    ws: WorkspaceInfo,
    dataDir: string | undefined,
): Promise<SkillInfo[]> {
    if (!skills.some(skill => skill.name === ENDEV_XDPU_SKILL_NAME)) {
        return skills;
    }
    const showEnDevWrapper = await isEnDevWrapperSkillVisible(dataDir, ws);
    return showEnDevWrapper
        ? skills
        : skills.filter(skill => skill.name !== ENDEV_XDPU_SKILL_NAME);
}

/** Options for {@link loadSkillsForWorkspace}. */
export interface LoadSkillsOptions {
    /**
     * Configured global extra skill folders (`skills.globalExtraFolders`),
     * already read from config. Read-only sources listed across all workspaces.
     */
    globalExtraFolders?: string[];
}

export async function loadSkillsForWorkspace(
    ws: WorkspaceInfo,
    dataDir: string | undefined,
    store: ProcessStore,
    options?: LoadSkillsOptions,
): Promise<SkillInfo[]> {
    const id = ws.id;
    const installPath = getSkillsInstallPath(ws.rootPath);
    const sourceInstallPath = getSkillsSourcePath(ws.rootPath);
    const localSkills = listInstalledSkills(installPath);
    for (const skill of localSkills) {
        skill.source = 'repo';
        skill.folderPath = sourceInstallPath;
    }
    const localNames = new Set(localSkills.map(s => s.name));

    const globalSkills: SkillInfo[] = [];
    if (dataDir) {
        const globalSkillsPath = path.join(dataDir, 'skills');
        const globals = listInstalledSkills(globalSkillsPath);
        for (const skill of globals) {
            if (localNames.has(skill.name)) continue;
            skill.source = 'global';
            skill.folderPath = globalSkillsPath;
            globalSkills.push(skill);
        }
    }
    const globalNames = new Set(globalSkills.map(s => s.name));

    // Configured global extra folders (read-only, apply across all workspaces).
    // Ordered after managed-global skills and before per-workspace extra folders
    // to match the runtime resolver's priority. A skill already provided by the
    // repo, the managed global dir, or an earlier global extra folder wins.
    const globalExtraSkills: SkillInfo[] = [];
    const globalExtraNames = new Set<string>();
    for (const folder of options?.globalExtraFolders ?? []) {
        const resolved = resolveGlobalExtraSkillFolderPaths(folder);
        if (!resolved) continue;
        for (const skill of listInstalledSkills(resolved.installPath)) {
            if (localNames.has(skill.name) || globalNames.has(skill.name) || globalExtraNames.has(skill.name)) {
                continue;
            }
            skill.source = 'global-extra-folder';
            skill.folderPath = resolved.sourcePath;
            globalExtraSkills.push(skill);
            globalExtraNames.add(skill.name);
        }
    }

    let allWorkspaces: WorkspaceInfo[] | null = null;
    const extraSkillFolders = await getEffectiveEnDevExtraSkillFolders(dataDir, ws);
    const extraSkills: SkillInfo[] = [];
    for (const folder of extraSkillFolders) {
        const folderSourcePath = resolveExtraSkillFolderSourcePath(ws.rootPath, folder);
        const folderInstallPath = resolveExtraSkillFolderInstallPath(ws.rootPath, folder);
        const folderSkills = listInstalledSkills(folderInstallPath);
        let sourceRepoId: string | undefined;
        if (allWorkspaces === null) {
            try { allWorkspaces = await store.getWorkspaces(); } catch { allWorkspaces = []; }
        }
        for (const otherWs of allWorkspaces) {
            if (
                otherWs.id !== id
                && normalizeExecutionPath(getSkillsSourcePath(otherWs.rootPath)) === normalizeExecutionPath(folderSourcePath)
            ) {
                sourceRepoId = otherWs.id;
                break;
            }
        }
        for (const skill of folderSkills) {
            if (localNames.has(skill.name) || globalNames.has(skill.name) || globalExtraNames.has(skill.name)) continue;
            skill.folderPath = folderSourcePath;
            if (sourceRepoId) {
                skill.source = 'linked-repo';
                skill.sourceRepoId = sourceRepoId;
            } else {
                skill.source = 'extra-folder';
            }
            extraSkills.push(skill);
        }
    }

    let skills = dedupByName([...localSkills, ...globalSkills, ...globalExtraSkills, ...extraSkills]);
    if (dataDir) {
        try {
            const repoPrefsPath = getRepoDataPath(dataDir, id, 'preferences.json');
            if (fs.existsSync(repoPrefsPath)) {
                const raw = JSON.parse(fs.readFileSync(repoPrefsPath, 'utf-8'));
                const usageMap = raw?.skillUsageMap;
                if (usageMap && typeof usageMap === 'object') {
                    skills = sortSkillsByUsage(skills, usageMap);
                }
            }
        } catch {
            // ignore — fall back to unsorted
        }
    }

    return skills;
}

// ============================================================================
// Route Registration
// ============================================================================

/**
 * Register skill management API routes on the given route table.
 * @param dataDir - Optional data directory for reading preferences (skill usage ordering).
 * @param readGlobalExtraFolders - Reader for configured global extra skill
 *   folders (`skills.globalExtraFolders`); defaults to reading the CLI config
 *   file. Injectable so tests can supply hermetic folders instead of the real
 *   `~/.coc/config.yaml`.
 */
export function registerSkillRoutes(
    routes: Route[],
    store: ProcessStore,
    dataDir?: string,
    readGlobalExtraFolders: () => string[] = readConfiguredGlobalExtraFolders,
): void {

    // GET /api/workspaces/:id/skills — List installed skills (including global and extra folders)
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/skills$/,
        handler: async (_req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;
            const wsId = ws.id;
            const globalExtraFolders = readGlobalExtraFolders();

            const cached = skillCache.get(wsId);
            if (cached) {
                // Cache hit: serve immediately, trigger async background refresh if stale
                const skills = await filterVisibleSkillsForWorkspace(cached.skills, ws, dataDir);
                sendJSON(res, 200, { skills });
                const stale = Date.now() - cached.lastUpdated > SKILL_CACHE_TTL_MS;
                if (stale && !cached.refreshing) {
                    cached.refreshing = true;
                    loadSkillsForWorkspace(ws, dataDir, store, { globalExtraFolders })
                        .then(skills => skillCache.set(wsId, { skills, refreshing: false, lastUpdated: Date.now() }))
                        .catch(() => { cached.refreshing = false; });
                }
                return;
            }

            // Cache miss: load synchronously, populate cache, then respond
            const rawSkills = await loadSkillsForWorkspace(ws, dataDir, store, { globalExtraFolders });
            skillCache.set(wsId, { skills: rawSkills, refreshing: false, lastUpdated: Date.now() });
            const skills = await filterVisibleSkillsForWorkspace(rawSkills, ws, dataDir);
            sendJSON(res, 200, { skills });
        },
    });

    // GET /api/workspaces/:id/skills/bundled — List bundled skills
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/skills\/bundled$/,
        handler: async (_req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const installPath = getSkillsInstallPath(ws.rootPath);
            const bundledSkills = getBundledSkills(installPath);
            sendJSON(res, 200, { skills: bundledSkills });
        },
    });

    // POST /api/workspaces/:id/skills/scan — Scan a GitHub URL for skills
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/skills\/scan$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const installPath = getSkillsInstallPath(ws.rootPath);
            const { handleScan } = createSkillRouteHandlers({ installPath, sourceRoot: ws.rootPath });
            await handleScan(req, res);
            skillCache.delete(ws.id);
        },
    });

    // GET /api/workspaces/:id/skills-path — Resolve skills folder path and skill count for a workspace
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/skills-path$/,
        handler: async (_req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const skillsPath = getSkillsInstallPath(ws.rootPath);
            const accessible = fs.existsSync(skillsPath);
            const skillCount = accessible ? listInstalledSkills(skillsPath).length : 0;
            sendJSON(res, 200, { path: skillsPath, skillCount, accessible });
        },
    });

    // POST /api/workspaces/:id/skills/install — Install skills
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/skills\/install$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const installPath = getSkillsInstallPath(ws.rootPath);
            const { handleInstall } = createSkillRouteHandlers({ installPath, sourceRoot: ws.rootPath });
            await handleInstall(req, res);
            skillCache.delete(ws.id);
        },
    });

    // GET /api/workspaces/:id/skills/:name/file?path=<rel> — Read a single file
    // inside a skill's folder (works for repo, global, linked-repo, extra-folder).
    // The relative path is resolved against the skill's folder and must remain
    // within it; the file size is capped at 1 MiB and returned as utf-8 text.
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/skills\/([^/]+)\/file$/,
        handler: async (req, res, match) => {
            const skillName = decodeURIComponent(match![2]);
            if (RESERVED_SKILL_NAMES.has(skillName)) {
                return handleAPIError(res, badRequest(`Invalid skill name: ${skillName}`));
            }
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const url = new URL(req.url ?? '', 'http://localhost');
            const relPath = url.searchParams.get('path');
            if (!relPath) {
                return handleAPIError(res, badRequest('`path` query parameter is required'));
            }

            const skills = await loadSkillsForWorkspace(ws, dataDir, store, { globalExtraFolders: readGlobalExtraFolders() });
            const skill = skills.find(s => s.name === skillName);
            if (!skill || !skill.folderPath) {
                return handleAPIError(res, notFound('Skill'));
            }

            const skillDir = path.join(skill.folderPath, skillName);
            const absFilePath = path.resolve(skillDir, relPath);
            if (!isWithinDirectory(absFilePath, skillDir)) {
                return handleAPIError(res, badRequest('Invalid file path'));
            }

            try {
                if (!fs.existsSync(absFilePath)) {
                    return handleAPIError(res, notFound('File'));
                }
                const stat = fs.statSync(absFilePath);
                if (!stat.isFile()) {
                    return handleAPIError(res, badRequest('Not a file'));
                }
                if (stat.size > 1024 * 1024) {
                    return handleAPIError(res, badRequest('File too large (max 1 MiB)'));
                }
                const content = fs.readFileSync(absFilePath, 'utf-8');
                sendJSON(res, 200, { path: relPath, content, size: stat.size });
            } catch (err: any) {
                return handleAPIError(res, internalError(`Failed to read file: ${err.message}`));
            }
        },
    });

    // GET /api/workspaces/:id/skills/:name — Get single skill detail
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/skills\/([^/]+)$/,
        handler: async (_req, res, match) => {
            const skillName = decodeURIComponent(match![2]);

            // Reject route-collision names
            if (RESERVED_SKILL_NAMES.has(skillName)) {
                return handleAPIError(res, badRequest(`Invalid skill name: ${skillName}`));
            }

            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;
            const installPath = getSkillsInstallPath(ws.rootPath);

            // Validate skill path is within install path (security)
            if (!isWithinDirectory(path.join(installPath, skillName), installPath)) {
                return handleAPIError(res, badRequest('Invalid skill name'));
            }
            const skill = getSkillDetail(installPath, skillName);
            if (!skill) {
                return handleAPIError(res, notFound('Skill'));
            }
            skill.relativePath = path.join(DEFAULT_SKILLS_SETTINGS.installPath, skillName);
            sendJSON(res, 200, { skill });
        },
    });

    // DELETE /api/workspaces/:id/skills/:name — Delete an installed skill
    routes.push({
        method: 'DELETE',
        pattern: /^\/api\/workspaces\/([^/]+)\/skills\/([^/]+)$/,
        handler: async (_req, res, match) => {
            const skillName = decodeURIComponent(match![2]);

            // Reject route-collision names
            if (RESERVED_SKILL_NAMES.has(skillName)) {
                return handleAPIError(res, badRequest(`Invalid skill name: ${skillName}`));
            }

            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const installPath = getSkillsInstallPath(ws.rootPath);
            const { handleDelete } = createSkillRouteHandlers({ installPath, sourceRoot: ws.rootPath });
            await handleDelete(res, skillName);
            skillCache.delete(ws.id);
        },
    });
}
