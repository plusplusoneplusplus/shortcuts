/**
 * Global Skill Management REST API Handler
 *
 * HTTP API routes for managing skills in the global ~/.coc/skills/ directory.
 * Provides listing, scanning, installing, and deleting global skills.
 *
 * Pure Node.js; uses pipeline-core skill utilities.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as path from 'path';
import * as fs from 'fs';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import {
    getBundledSkills,
    isWithinDirectory,
} from '@plusplusoneplusplus/forge';
import { sendJSON } from '../core/api-handler';
import { parseBodyOrReject } from '../shared/handler-utils';
import { handleAPIError, notFound, badRequest } from '../errors';
import { loadConfigFile, writeConfigFile, getConfigFilePath, type CLIConfig } from '../../config';
import { sortSkillsByUsage, listInstalledSkills, getSkillDetail, skillCache, loadSkillsForWorkspace, filterVisibleSkillsForWorkspace } from './skill-handler';
import { createSkillRouteHandlers } from './skill-route-handlers';
import { resolveEffectiveSkillPaths } from '../executors/skill-config-resolver';
import { getEffectiveEnDevExtraSkillFolders } from '../endev/endev-detector';
import type { Route } from '../types';

// ============================================================================
// Helpers
// ============================================================================

/** Skill names that collide with global sub-routes and must be rejected. */
const RESERVED_GLOBAL_SKILL_NAMES = new Set(['bundled', 'scan', 'install', 'config', 'effective-paths']);

/** Remove duplicate skills by name, keeping the first occurrence. */
function dedupByName<T extends { name: string }>(skills: T[]): T[] {
    const seen = new Set<string>();
    return skills.filter(s => {
        if (seen.has(s.name)) return false;
        seen.add(s.name);
        return true;
    });
}

function getGlobalSkillsDir(dataDir: string): string {
    return path.join(dataDir, 'skills');
}

function readPreferences(dataDir: string): any {
    try {
        const prefsPath = path.join(dataDir, 'preferences.json');
        if (fs.existsSync(prefsPath)) {
            return JSON.parse(fs.readFileSync(prefsPath, 'utf-8'));
        }
    } catch {
        // ignore
    }
    return {};
}

function writePreferences(dataDir: string, prefs: any): void {
    try {
        const prefsPath = path.join(dataDir, 'preferences.json');
        fs.mkdirSync(path.dirname(prefsPath), { recursive: true });
        fs.writeFileSync(prefsPath, JSON.stringify(prefs, null, 2));
    } catch {
        // ignore
    }
}

/**
 * Injectable accessors for the CLI config file. Lets tests point the global
 * extra-folder / auto-detect config at a temp file instead of the real
 * `~/.coc/config.yaml`. Defaults to the real config functions.
 */
export interface GlobalSkillConfigAccess {
    loadConfigFile: (configPath?: string) => CLIConfig | undefined;
    writeConfigFile: (configPath: string, config: CLIConfig) => void;
    getConfigFilePath: () => string;
}

const DEFAULT_CONFIG_ACCESS: GlobalSkillConfigAccess = { loadConfigFile, writeConfigFile, getConfigFilePath };

/** Global folder-source settings surfaced by `/api/skills/config`. */
interface GlobalSkillFolderConfig {
    globalExtraFolders: string[];
    autoDetectDefaultFolders: boolean;
}

/**
 * Read `skills.globalExtraFolders` / `skills.autoDetectDefaultFolders` from the
 * CLI config file. Missing/invalid values fall back to safe defaults
 * (`[]` and `true`). Never throws — a malformed config yields defaults.
 */
function readGlobalSkillFolderConfig(access: GlobalSkillConfigAccess): GlobalSkillFolderConfig {
    try {
        const skills = access.loadConfigFile(access.getConfigFilePath())?.skills;
        const folders = skills?.globalExtraFolders;
        return {
            globalExtraFolders: Array.isArray(folders)
                ? folders.filter((f): f is string => typeof f === 'string')
                : [],
            autoDetectDefaultFolders: typeof skills?.autoDetectDefaultFolders === 'boolean'
                ? skills.autoDetectDefaultFolders
                : true,
        };
    } catch {
        return { globalExtraFolders: [], autoDetectDefaultFolders: true };
    }
}

/**
 * Persist global folder-source settings into the CLI config file's `skills`
 * namespace, preserving every other config field. Only the fields present in
 * `patch` are written.
 */
function persistGlobalSkillFolderConfig(
    access: GlobalSkillConfigAccess,
    patch: Partial<GlobalSkillFolderConfig>,
): void {
    const configPath = access.getConfigFilePath();
    let existing: CLIConfig;
    try {
        existing = access.loadConfigFile(configPath) ?? ({} as CLIConfig);
    } catch {
        existing = {} as CLIConfig;
    }
    const skills = { ...(existing.skills ?? {}) };
    if (patch.globalExtraFolders !== undefined) skills.globalExtraFolders = patch.globalExtraFolders;
    if (patch.autoDetectDefaultFolders !== undefined) skills.autoDetectDefaultFolders = patch.autoDetectDefaultFolders;
    existing.skills = skills;
    access.writeConfigFile(configPath, existing);
}

// ============================================================================
// Route Registration
// ============================================================================

/**
 * Register global skill management API routes on the given route table.
 */
export function registerGlobalSkillRoutes(
    routes: Route[],
    store: ProcessStore,
    dataDir: string,
    configAccess: GlobalSkillConfigAccess = DEFAULT_CONFIG_ACCESS,
): void {
    const globalDir = getGlobalSkillsDir(dataDir);

    // GET /api/skills — List all global skills
    routes.push({
        method: 'GET',
        pattern: /^\/api\/skills$/,
        handler: async (_req, res) => {
            let skills = listInstalledSkills(globalDir);

            // Sort by usage from preferences
            const prefs = readPreferences(dataDir);
            const usageMap = prefs?.globalSkillUsage;
            if (usageMap && typeof usageMap === 'object') {
                skills = sortSkillsByUsage(skills, usageMap);
            }

            sendJSON(res, 200, { skills });
        },
    });

    // GET /api/skills/bundled — List bundled skills with global install status
    routes.push({
        method: 'GET',
        pattern: /^\/api\/skills\/bundled$/,
        handler: async (_req, res) => {
            const bundledSkills = getBundledSkills(globalDir);
            sendJSON(res, 200, { skills: bundledSkills });
        },
    });

    // POST /api/skills/scan — Scan a GitHub URL for skills
    routes.push({
        method: 'POST',
        pattern: /^\/api\/skills\/scan$/,
        handler: async (req, res) => {
            const { handleScan } = createSkillRouteHandlers({ installPath: globalDir, sourceRoot: dataDir });
            await handleScan(req, res);
            skillCache.clear();
        },
    });

    // POST /api/skills/install — Install skills to global dir
    routes.push({
        method: 'POST',
        pattern: /^\/api\/skills\/install$/,
        handler: async (req, res) => {
            const { handleInstall } = createSkillRouteHandlers({
                installPath: globalDir,
                sourceRoot: dataDir,
                ensureInstallDir: true,
            });
            await handleInstall(req, res);
            skillCache.clear();
        },
    });

    // GET /api/skills/config — Get global disabled-skills list
    routes.push({
        method: 'GET',
        pattern: /^\/api\/skills\/config$/,
        handler: async (_req, res) => {
            const prefs = readPreferences(dataDir);
            const folderCfg = readGlobalSkillFolderConfig(configAccess);
            sendJSON(res, 200, {
                globalDisabledSkills: prefs?.globalDisabledSkills ?? [],
                globalSkillsDir: globalDir,
                globalExtraFolders: folderCfg.globalExtraFolders,
                autoDetectDefaultFolders: folderCfg.autoDetectDefaultFolders,
            });
        },
    });

    // PUT /api/skills/config — Update global disabled-skills list + folder sources
    routes.push({
        method: 'PUT',
        pattern: /^\/api\/skills\/config$/,
        handler: async (req, res) => {
            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            if (!Object.prototype.hasOwnProperty.call(body, 'globalDisabledSkills')) {
                return handleAPIError(res, badRequest('`globalDisabledSkills` is required'));
            }
            if (!Array.isArray(body.globalDisabledSkills) || body.globalDisabledSkills.some((s: unknown) => typeof s !== 'string')) {
                return handleAPIError(res, badRequest('`globalDisabledSkills` must be an array of strings'));
            }

            // Optional folder-source fields persisted to the config file's `skills` namespace.
            const folderPatch: Partial<GlobalSkillFolderConfig> = {};
            if (Object.prototype.hasOwnProperty.call(body, 'globalExtraFolders')) {
                if (!Array.isArray(body.globalExtraFolders) || body.globalExtraFolders.some((f: unknown) => typeof f !== 'string')) {
                    return handleAPIError(res, badRequest('`globalExtraFolders` must be an array of strings'));
                }
                folderPatch.globalExtraFolders = body.globalExtraFolders;
            }
            if (Object.prototype.hasOwnProperty.call(body, 'autoDetectDefaultFolders')) {
                if (typeof body.autoDetectDefaultFolders !== 'boolean') {
                    return handleAPIError(res, badRequest('`autoDetectDefaultFolders` must be a boolean'));
                }
                folderPatch.autoDetectDefaultFolders = body.autoDetectDefaultFolders;
            }

            const prefs = readPreferences(dataDir);
            prefs.globalDisabledSkills = body.globalDisabledSkills;
            writePreferences(dataDir, prefs);

            if (folderPatch.globalExtraFolders !== undefined || folderPatch.autoDetectDefaultFolders !== undefined) {
                persistGlobalSkillFolderConfig(configAccess, folderPatch);
            }

            const folderCfg = readGlobalSkillFolderConfig(configAccess);
            sendJSON(res, 200, {
                globalDisabledSkills: body.globalDisabledSkills,
                globalSkillsDir: globalDir,
                globalExtraFolders: folderCfg.globalExtraFolders,
                autoDetectDefaultFolders: folderCfg.autoDetectDefaultFolders,
            });
        },
    });

    // GET /api/skills/effective-paths — Structured effective skill search order (read-only diagnostic)
    //
    // Global-only by default; pass `?workspaceId=<id>` to include workspace-scoped
    // paths (repo-local + per-repo extra folders). Registered before /skills/:name
    // so it is not swallowed by the catch-all skill-detail route.
    routes.push({
        method: 'GET',
        pattern: /^\/api\/skills\/effective-paths$/,
        handler: async (req, res) => {
            const url = new URL(req.url ?? '', 'http://localhost');
            const requestedWorkspaceId = url.searchParams.get('workspaceId') ?? undefined;

            const folderCfg = readGlobalSkillFolderConfig(configAccess);

            let workspaceRootPath: string | undefined;
            let extraSkillFolders: string[] | undefined;
            let resolvedWorkspaceId: string | undefined;
            if (requestedWorkspaceId) {
                try {
                    const workspaces = await store.getWorkspaces();
                    const ws = workspaces.find(w => w.id === requestedWorkspaceId);
                    if (ws) {
                        resolvedWorkspaceId = ws.id;
                        workspaceRootPath = ws.rootPath;
                        extraSkillFolders = await getEffectiveEnDevExtraSkillFolders(dataDir, ws);
                    }
                } catch {
                    // Non-fatal: fall back to a global-only diagnostic.
                }
            }

            const paths = await resolveEffectiveSkillPaths({
                dataDir,
                workspaceRootPath,
                extraSkillFolders,
                globalExtraFolders: folderCfg.globalExtraFolders,
                autoDetectDefaultFolders: folderCfg.autoDetectDefaultFolders,
            });

            sendJSON(res, 200, { workspaceId: resolvedWorkspaceId, paths });
        },
    });

    // GET /api/skills/:name — Get detail for a global skill
    routes.push({
        method: 'GET',
        pattern: /^\/api\/skills\/([^/]+)$/,
        handler: async (_req, res, match) => {
            const skillName = decodeURIComponent(match![1]);

            // Reject route-collision names
            if (RESERVED_GLOBAL_SKILL_NAMES.has(skillName)) {
                return handleAPIError(res, badRequest(`Invalid skill name: ${skillName}`));
            }

            // Validate skill path is within global dir (security)
            if (!isWithinDirectory(path.join(globalDir, skillName), globalDir)) {
                return handleAPIError(res, badRequest('Invalid skill name'));
            }

            const skill = getSkillDetail(globalDir, skillName);
            if (!skill) {
                return handleAPIError(res, notFound('Skill'));
            }
            sendJSON(res, 200, { skill });
        },
    });

    // DELETE /api/skills/:name — Delete a global skill
    routes.push({
        method: 'DELETE',
        pattern: /^\/api\/skills\/([^/]+)$/,
        handler: async (_req, res, match) => {
            const skillName = decodeURIComponent(match![1]);

            // Reject route-collision names
            if (RESERVED_GLOBAL_SKILL_NAMES.has(skillName)) {
                return handleAPIError(res, badRequest(`Invalid skill name: ${skillName}`));
            }

            const { handleDelete } = createSkillRouteHandlers({ installPath: globalDir, sourceRoot: dataDir });
            await handleDelete(res, skillName);
            skillCache.clear();
        },
    });

    // GET /api/workspaces/:id/skills/all — Merged global + repo skills
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/skills\/all$/,
        handler: async (_req, res, match) => {
            const id = decodeURIComponent(match![1]);
            const workspaces = await store.getWorkspaces();
            const ws = workspaces.find(w => w.id === id);
            if (!ws) {
                return handleAPIError(res, notFound('Workspace'));
            }

            const { globalExtraFolders } = readGlobalSkillFolderConfig(configAccess);
            const allSkills = await loadSkillsForWorkspace(ws, dataDir, store, { globalExtraFolders });
            const visibleSkills = await filterVisibleSkillsForWorkspace(allSkills, ws, dataDir);
            const globalSkills = visibleSkills.filter(s => s.source === 'global');
            const repoSkills = visibleSkills.filter(s => s.source === 'repo');
            const merged = visibleSkills;

            sendJSON(res, 200, { global: globalSkills, repo: repoSkills, merged });
        },
    });
}
