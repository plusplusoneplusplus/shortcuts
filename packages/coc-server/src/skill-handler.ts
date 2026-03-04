/**
 * Skill Management REST API Handler
 *
 * HTTP API routes for managing skills in a workspace's .github/skills/ directory.
 * Provides listing, scanning, installing, and deleting skills.
 *
 * No VS Code dependencies — uses pipeline-core skill utilities.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as path from 'path';
import * as fs from 'fs';
import type { ProcessStore } from '@plusplusoneplusplus/pipeline-core';
import {
    detectSource,
    scanForSkills,
    installSkills,
    getBundledSkills,
    installBundledSkills,
    DEFAULT_SKILLS_SETTINGS,
} from '@plusplusoneplusplus/pipeline-core';
import { sendJSON, parseBody } from './api-handler';
import { handleAPIError, notFound, invalidJSON, badRequest, internalError } from './errors';
import type { Route } from './types';

// ============================================================================
// Helpers
// ============================================================================

function getSkillsInstallPath(workspaceRoot: string, installPath?: string): string {
    return path.join(workspaceRoot, installPath || DEFAULT_SKILLS_SETTINGS.installPath);
}

function listInstalledSkills(installPath: string): Array<{ name: string; description?: string }> {
    if (!fs.existsSync(installPath)) {
        return [];
    }

    const skills: Array<{ name: string; description?: string }> = [];

    try {
        const entries = fs.readdirSync(installPath, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            const skillMdPath = path.join(installPath, entry.name, 'SKILL.md');
            if (!fs.existsSync(skillMdPath)) continue;

            let description: string | undefined;
            try {
                const content = fs.readFileSync(skillMdPath, 'utf-8');
                description = extractDescriptionFromMarkdown(content);
            } catch {
                // ignore
            }

            skills.push({ name: entry.name, description });
        }
    } catch {
        // ignore
    }

    return skills;
}

const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---/;
const DESCRIPTION_REGEX = /^description:\s*["']?(.+?)["']?\s*$/m;

function extractDescriptionFromMarkdown(content: string): string | undefined {
    // Try YAML frontmatter first
    const fmMatch = content.match(FRONTMATTER_REGEX);
    if (fmMatch) {
        const descMatch = fmMatch[1].match(DESCRIPTION_REGEX);
        if (descMatch) {
            return descMatch[1];
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
// Route Registration
// ============================================================================

/**
 * Register skill management API routes on the given route table.
 */
export function registerSkillRoutes(routes: Route[], store: ProcessStore): void {

    // GET /api/workspaces/:id/skills — List installed skills
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/skills$/,
        handler: async (_req, res, match) => {
            const id = decodeURIComponent(match![1]);
            const workspaces = await store.getWorkspaces();
            const ws = workspaces.find(w => w.id === id);
            if (!ws) {
                return handleAPIError(res, notFound('Workspace'));
            }

            const installPath = getSkillsInstallPath(ws.rootPath);
            const skills = listInstalledSkills(installPath);
            sendJSON(res, 200, { skills });
        },
    });

    // GET /api/workspaces/:id/skills/bundled — List bundled skills
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/skills\/bundled$/,
        handler: async (_req, res, match) => {
            const id = decodeURIComponent(match![1]);
            const workspaces = await store.getWorkspaces();
            const ws = workspaces.find(w => w.id === id);
            if (!ws) {
                return handleAPIError(res, notFound('Workspace'));
            }

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
            const id = decodeURIComponent(match![1]);
            const workspaces = await store.getWorkspaces();
            const ws = workspaces.find(w => w.id === id);
            if (!ws) {
                return handleAPIError(res, notFound('Workspace'));
            }

            let body: any;
            try {
                body = await parseBody(req);
            } catch {
                return handleAPIError(res, invalidJSON());
            }

            if (!body.url || typeof body.url !== 'string') {
                return handleAPIError(res, badRequest('`url` is required'));
            }

            const sourceResult = detectSource(body.url, ws.rootPath);
            if (!sourceResult.success) {
                return sendJSON(res, 200, { success: false, error: sourceResult.error, skills: [] });
            }

            const installPath = getSkillsInstallPath(ws.rootPath);
            const scanResult = await scanForSkills(sourceResult.source, installPath);
            sendJSON(res, 200, scanResult);
        },
    });

    // POST /api/workspaces/:id/skills/install — Install skills
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/skills\/install$/,
        handler: async (req, res, match) => {
            const id = decodeURIComponent(match![1]);
            const workspaces = await store.getWorkspaces();
            const ws = workspaces.find(w => w.id === id);
            if (!ws) {
                return handleAPIError(res, notFound('Workspace'));
            }

            let body: any;
            try {
                body = await parseBody(req);
            } catch {
                return handleAPIError(res, invalidJSON());
            }

            const installPath = getSkillsInstallPath(ws.rootPath);
            const replace: boolean = body.replace === true;

            // Handle bundled skills
            if (body.source === 'bundled') {
                const allBundled = getBundledSkills(installPath);
                const selectedNames: string[] = Array.isArray(body.skills) ? body.skills : allBundled.map((s: any) => s.name);
                const toInstall = allBundled.filter((s: any) => selectedNames.includes(s.name));

                if (toInstall.length === 0) {
                    return sendJSON(res, 200, { installed: 0, skipped: 0, failed: 0, details: [] });
                }

                const result = await installBundledSkills(toInstall, installPath, async () => replace);
                sendJSON(res, 200, result);
                return;
            }

            // Handle GitHub/local source
            if (!body.url || typeof body.url !== 'string') {
                return handleAPIError(res, badRequest('`url` is required for non-bundled installs'));
            }

            const sourceResult = detectSource(body.url, ws.rootPath);
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
        },
    });

    // DELETE /api/workspaces/:id/skills/:name — Delete an installed skill
    routes.push({
        method: 'DELETE',
        pattern: /^\/api\/workspaces\/([^/]+)\/skills\/([^/]+)$/,
        handler: async (_req, res, match) => {
            const id = decodeURIComponent(match![1]);
            const skillName = decodeURIComponent(match![2]);

            // Reject route-collision names
            if (skillName === 'bundled' || skillName === 'scan' || skillName === 'install') {
                return handleAPIError(res, badRequest(`Invalid skill name: ${skillName}`));
            }

            const workspaces = await store.getWorkspaces();
            const ws = workspaces.find(w => w.id === id);
            if (!ws) {
                return handleAPIError(res, notFound('Workspace'));
            }

            const installPath = getSkillsInstallPath(ws.rootPath);
            const skillPath = path.join(installPath, skillName);

            // Validate skill path is within install path (security)
            const resolvedSkillPath = path.resolve(skillPath);
            const resolvedInstallPath = path.resolve(installPath);
            if (!resolvedSkillPath.startsWith(resolvedInstallPath + path.sep)) {
                return handleAPIError(res, badRequest('Invalid skill name'));
            }

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
        },
    });
}
