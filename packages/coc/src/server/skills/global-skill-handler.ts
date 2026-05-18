/**
 * Global Skill Management REST API Handler
 *
 * HTTP API routes for managing skills in the global ~/.coc/skills/ directory.
 * Provides listing, scanning, installing, and deleting global skills.
 *
 * No VS Code dependencies — uses pipeline-core skill utilities.
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
import { sortSkillsByUsage, listInstalledSkills, getSkillDetail, skillCache, loadSkillsForWorkspace, filterVisibleSkillsForWorkspace } from './skill-handler';
import { createSkillRouteHandlers } from './skill-route-handlers';
import type { Route } from '../types';

// ============================================================================
// Helpers
// ============================================================================

/** Skill names that collide with global sub-routes and must be rejected. */
const RESERVED_GLOBAL_SKILL_NAMES = new Set(['bundled', 'scan', 'install', 'config']);

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

// ============================================================================
// Route Registration
// ============================================================================

/**
 * Register global skill management API routes on the given route table.
 */
export function registerGlobalSkillRoutes(routes: Route[], store: ProcessStore, dataDir: string): void {
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
            sendJSON(res, 200, {
                globalDisabledSkills: prefs?.globalDisabledSkills ?? [],
                globalSkillsDir: globalDir,
            });
        },
    });

    // PUT /api/skills/config — Update global disabled-skills list
    routes.push({
        method: 'PUT',
        pattern: /^\/api\/skills\/config$/,
        handler: async (req, res) => {
            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            if (!Object.prototype.hasOwnProperty.call(body, 'globalDisabledSkills')) {
                return handleAPIError(res, badRequest('`globalDisabledSkills` is required'));
            }
            if (!Array.isArray(body.globalDisabledSkills)) {
                return handleAPIError(res, badRequest('`globalDisabledSkills` must be an array of strings'));
            }

            const prefs = readPreferences(dataDir);
            prefs.globalDisabledSkills = body.globalDisabledSkills;
            writePreferences(dataDir, prefs);

            sendJSON(res, 200, {
                globalDisabledSkills: body.globalDisabledSkills,
                globalSkillsDir: globalDir,
            });
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

            const allSkills = await loadSkillsForWorkspace(ws, dataDir, store);
            const visibleSkills = await filterVisibleSkillsForWorkspace(allSkills, ws, dataDir);
            const globalSkills = visibleSkills.filter(s => s.source === 'global');
            const repoSkills = visibleSkills.filter(s => s.source === 'repo');
            const merged = visibleSkills;

            sendJSON(res, 200, { global: globalSkills, repo: repoSkills, merged });
        },
    });
}
