/**
 * Shared skill route handler factory.
 *
 * Provides createSkillRouteHandlers() to produce scan/install/delete handlers
 * parameterised by install path and source root. Used by both workspace-scoped
 * (skill-handler.ts) and global (global-skill-handler.ts) skill API handlers
 * to eliminate duplicated logic.
 */

import * as path from 'path';
import * as fs from 'fs';
import type * as http from 'http';
import {
    detectSource,
    scanForSkills,
    installSkills,
    getBundledSkills,
    installBundledSkills,
    isWithinDirectory,
} from '@plusplusoneplusplus/pipeline-core';
import { sendJSON } from './api-handler';
import { handleAPIError, notFound, badRequest, internalError } from './errors';
import { parseBodyOrReject } from './shared/handler-utils';

export interface SkillRouteHandlerOptions {
    /** Absolute path where skills are installed. */
    installPath: string;
    /** Workspace root (or dataDir) used as base when resolving local source paths. */
    sourceRoot: string;
    /** When true, ensures the install directory exists before installing. */
    ensureInstallDir?: boolean;
}

export interface SkillRouteHandlers {
    handleScan: (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void>;
    handleInstall: (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void>;
    handleDelete: (res: http.ServerResponse, skillName: string) => Promise<void>;
}

/**
 * Create scan/install/delete route handler functions for a given skill install path.
 * Workspace resolution and reserved-name checks remain in each caller's route wrapper.
 */
export function createSkillRouteHandlers(opts: SkillRouteHandlerOptions): SkillRouteHandlers {
    const { installPath, sourceRoot, ensureInstallDir = false } = opts;

    async function handleScan(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        const body = await parseBodyOrReject(req, res);
        if (body === null) return;

        if (!body.url || typeof body.url !== 'string') {
            return handleAPIError(res, badRequest('`url` is required'));
        }

        const sourceResult = detectSource(body.url, sourceRoot);
        if (!sourceResult.success) {
            return sendJSON(res, 200, { success: false, error: sourceResult.error, skills: [] });
        }

        const scanResult = await scanForSkills(sourceResult.source, installPath);
        sendJSON(res, 200, scanResult);
    }

    async function handleInstall(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        const body = await parseBodyOrReject(req, res);
        if (body === null) return;

        if (ensureInstallDir) {
            fs.mkdirSync(installPath, { recursive: true });
        }

        const replace = body.replace === true;

        if (body.source === 'bundled') {
            const allBundled = getBundledSkills(installPath);
            const selectedNames: string[] = Array.isArray(body.skills)
                ? body.skills
                : allBundled.map((s: any) => s.name);
            const toInstall = allBundled.filter((s: any) => selectedNames.includes(s.name));

            if (toInstall.length === 0) {
                return sendJSON(res, 200, { installed: 0, skipped: 0, failed: 0, details: [] });
            }

            const result = await installBundledSkills(toInstall, installPath, async () => replace);
            sendJSON(res, 200, result);
            return;
        }

        if (!body.url || typeof body.url !== 'string') {
            return handleAPIError(res, badRequest('`url` is required for non-bundled installs'));
        }

        const sourceResult = detectSource(body.url, sourceRoot);
        if (!sourceResult.success) {
            return handleAPIError(res, badRequest(sourceResult.error));
        }

        let skills = body.skillsToInstall;
        if (!Array.isArray(skills) || skills.length === 0) {
            const scanResult = await scanForSkills(sourceResult.source, installPath);
            if (!scanResult.success) {
                return handleAPIError(res, badRequest(scanResult.error || 'Scan failed'));
            }
            skills = scanResult.skills;
        }

        const result = await installSkills(skills, sourceResult.source, installPath, async () => replace);
        sendJSON(res, 200, result);
    }

    async function handleDelete(res: http.ServerResponse, skillName: string): Promise<void> {
        if (!isWithinDirectory(path.join(installPath, skillName), installPath)) {
            return handleAPIError(res, badRequest('Invalid skill name'));
        }

        const skillPath = path.join(installPath, skillName);
        const skillMdPath = path.join(skillPath, 'SKILL.md');
        if (!fs.existsSync(skillMdPath)) {
            return handleAPIError(res, notFound('Skill'));
        }

        try {
            fs.rmSync(skillPath, { recursive: true, force: true });
            res.writeHead(204);
            res.end();
        } catch (err: any) {
            return handleAPIError(res, internalError(`Failed to delete skill: ${err.message}`));
        }
    }

    return { handleScan, handleInstall, handleDelete };
}
