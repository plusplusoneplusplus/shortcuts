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
    getBundledSkills,
    DEFAULT_SKILLS_SETTINGS,
    isWithinDirectory,
} from '@plusplusoneplusplus/pipeline-core';
import { sendJSON } from './api-handler';
import { handleAPIError, notFound, badRequest } from './errors';
import { resolveWorkspaceOrFail } from './shared/handler-utils';
import { createSkillRouteHandlers } from './skill-route-handlers';
import type { Route } from './types';

// ============================================================================
// Helpers
// ============================================================================

/** Skill names that collide with sub-routes and must be rejected. */
const RESERVED_SKILL_NAMES = new Set(['bundled', 'scan', 'install', 'all']);

function getSkillsInstallPath(workspaceRoot: string): string {
    return path.join(workspaceRoot, DEFAULT_SKILLS_SETTINGS.installPath);
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
                applyParsedSkill(skill, parsed);
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
        applyParsedSkill(skill, parsed);
    } catch {
        // ignore
    }
    skill.references = listDirectoryFiles(path.join(skillDir, 'references'));
    skill.scripts = listDirectoryFiles(path.join(skillDir, 'scripts'));

    return skill;
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
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;
            const id = ws.id;

            const installPath = getSkillsInstallPath(ws.rootPath);
            let skills = listInstalledSkills(installPath);
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
        },
    });
}
