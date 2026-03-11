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

/** Skill names that collide with sub-routes and must be rejected. */
const RESERVED_SKILL_NAMES = new Set(['bundled', 'scan', 'install', 'all']);

function getSkillsInstallPath(workspaceRoot: string, installPath?: string): string {
    return path.join(workspaceRoot, installPath || DEFAULT_SKILLS_SETTINGS.installPath);
}

/**
 * Returns true if `childName` resolved under `baseDir` stays within `baseDir`.
 * Used to prevent path-traversal attacks on skill names.
 */
export function isWithinDirectory(baseDir: string, childName: string): boolean {
    const resolvedChild = path.resolve(path.join(baseDir, childName));
    const resolvedBase = path.resolve(baseDir);
    return resolvedChild.startsWith(resolvedBase + path.sep);
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
    source?: 'global' | 'repo' | 'bundled';
}

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
        const descMatch = fm.match(DESCRIPTION_REGEX);
        if (descMatch) description = descMatch[1];
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

            const skill: SkillInfo = { name: entry.name };
            try {
                const content = fs.readFileSync(skillMdPath, 'utf-8');
                const parsed = parseSkillMd(content);
                skill.description = parsed.description;
                skill.version = parsed.version;
                skill.variables = parsed.variables;
                skill.output = parsed.output;
                skill.promptBody = parsed.promptBody;
            } catch {
                // ignore
            }

            skill.references = listDirectoryFiles(path.join(skillDir, 'references'));
            skill.scripts = listDirectoryFiles(path.join(skillDir, 'scripts'));

            skills.push(skill);
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

    const skill: SkillInfo = { name: skillName };
    try {
        const content = fs.readFileSync(skillMdPath, 'utf-8');
        const parsed = parseSkillMd(content);
        skill.description = parsed.description;
        skill.version = parsed.version;
        skill.variables = parsed.variables;
        skill.output = parsed.output;
        skill.promptBody = parsed.promptBody;
    } catch {
        // ignore
    }
    skill.references = listDirectoryFiles(path.join(skillDir, 'references'));
    skill.scripts = listDirectoryFiles(path.join(skillDir, 'scripts'));

    return skill;
}

export const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---/;
export const DESCRIPTION_REGEX = /^description:\s*["']?(.+?)["']?\s*$/m;

export function extractDescriptionFromMarkdown(content: string): string | undefined {
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
 * @param dataDir - Optional data directory for reading preferences (skill usage ordering).
 */
export function registerSkillRoutes(routes: Route[], store: ProcessStore, dataDir?: string): void {

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
            let skills = listInstalledSkills(installPath);

            // Sort skills by usage if preferences are available
            if (dataDir) {
                try {
                    const prefsPath = path.join(dataDir, 'preferences.json');
                    if (fs.existsSync(prefsPath)) {
                        const raw = JSON.parse(fs.readFileSync(prefsPath, 'utf-8'));
                        const usageMap = raw?.repos?.[id]?.skillUsageMap;
                        if (usageMap && typeof usageMap === 'object') {
                            skills = sortSkillsByUsage(skills, usageMap);
                        }
                    }
                } catch {
                    // ignore — fall back to unsorted
                }
            }

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
            const replace = body.replace === true;

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

    // GET /api/workspaces/:id/skills/:name — Get single skill detail
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/skills\/([^/]+)$/,
        handler: async (_req, res, match) => {
            const id = decodeURIComponent(match![1]);
            const skillName = decodeURIComponent(match![2]);

            // Reject route-collision names
            if (RESERVED_SKILL_NAMES.has(skillName)) {
                return handleAPIError(res, badRequest(`Invalid skill name: ${skillName}`));
            }

            const workspaces = await store.getWorkspaces();
            const ws = workspaces.find(w => w.id === id);
            if (!ws) {
                return handleAPIError(res, notFound('Workspace'));
            }

            const installPath = getSkillsInstallPath(ws.rootPath);

            // Validate skill path is within install path (security)
            if (!isWithinDirectory(installPath, skillName)) {
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
            const id = decodeURIComponent(match![1]);
            const skillName = decodeURIComponent(match![2]);

            // Reject route-collision names
            if (RESERVED_SKILL_NAMES.has(skillName)) {
                return handleAPIError(res, badRequest(`Invalid skill name: ${skillName}`));
            }

            const workspaces = await store.getWorkspaces();
            const ws = workspaces.find(w => w.id === id);
            if (!ws) {
                return handleAPIError(res, notFound('Workspace'));
            }

            const installPath = getSkillsInstallPath(ws.rootPath);
            if (!isWithinDirectory(installPath, skillName)) {
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
        },
    });
}
