/**
 * Provider for bundled skills that ship with pipeline-core
 */

import * as path from 'path';
import * as fs from 'fs';
import { BundledSkill, DiscoveredSkill, InstallResult, InstallDetail } from './types';
import { ensureDirectoryExists, safeExists } from '../utils';
import { getLogger, LogCategory } from '../logger';
import { copySkillDirectory } from './skill-copy';

/**
 * Registry of bundled skills
 * Each skill must have a corresponding directory in resources/bundled-skills/
 * Version is read from each skill's SKILL.md frontmatter at runtime.
 */
const BUNDLED_SKILLS_REGISTRY: BundledSkill[] = [
    {
        name: 'pipeline-generator',
        description: 'Generate optimized YAML pipeline or DAG workflow configurations from natural language requirements',
        relativePath: 'pipeline-generator',
    },
    {
        name: 'skill-for-skills',
        description: 'Create and update Agent Skills following the agentskills.io specification',
        relativePath: 'skill-for-skills',
    },
    {
        name: 'go-deep',
        description: 'Advanced research and verification methodologies using multi-phase approaches and parallel sub-agents',
        relativePath: 'go-deep',
    },
    {
        name: 'coc-chat',
        description: 'Access, search, analyze, and submit CoC conversation process records via REST API to a running CoC server',
        relativePath: 'coc-chat',
    },
    {
        name: 'rethink',
        description: 'Review a bug fix proposal and evaluate whether it is the cleanest solution, considering root cause alignment, simplicity, consistency, technical debt, side effects, and idiomatic alternatives',
        relativePath: 'rethink',
    },
    {
        name: 'code-refactoring',
        description: 'Automated code refactoring suggestion that drafts a refactoring plan for critical, high-value technical debt issues',
        relativePath: 'code-refactoring',
    },
    {
        name: 'kb-refresh',
        description: 'Distill recent CoC chat histories into knowledge-base skill improvements, proposing additions, updates, and removals',
        relativePath: 'kb-refresh',
    },
    {
        name: 'create-work-item',
        description: 'Interactively create a work item for this repository with title, description, status, and an AI-generated plan',
        relativePath: 'create-work-item',
    },
    {
        name: 'create-bug',
        description: 'Interactively create a bug report for this repository with title, description, priority, and an AI-generated plan',
        relativePath: 'create-bug',
    },
    {
        name: 'update-work-item',
        description: 'Interactively update an existing work item — patch common fields or create a new plan version, then reset status to planning',
        relativePath: 'update-work-item',
    },
    {
        name: 'fresh-written',
        description: 'Rewrite documents, plans, and notes as if authored fresh each iteration — produce only the final intended state, never patch deltas on top of the previous version',
        relativePath: 'fresh-written',
    },
    {
        name: 'terse-replies',
        description: 'Ultra-compressed reply mode that cuts token usage ~50% while keeping full technical accuracy. Triggers on "be brief", "be terse", "less tokens", "/terse", or explicit token-efficiency requests',
        relativePath: 'terse-replies',
    }
];

/**
 * Get the path to the bundled skills directory
 */
export function getBundledSkillsPath(): string {
    return path.join(__dirname, '../../resources/bundled-skills');
}

/**
 * Get all available bundled skills
 * @param installPath Target installation path to check for existing skills
 */
export function getBundledSkills(installPath: string): DiscoveredSkill[] {
    const bundledPath = getBundledSkillsPath();
    const skills: DiscoveredSkill[] = [];

    for (const bundled of BUNDLED_SKILLS_REGISTRY) {
        const skillPath = path.join(bundledPath, bundled.relativePath);
        const skillFile = path.join(skillPath, 'SKILL.md');

        if (safeExists(skillFile)) {
            skills.push({
                name: bundled.name,
                description: bundled.description,
                path: skillPath,
                alreadyExists: safeExists(path.join(installPath, bundled.name))
            });
        }
    }

    return skills;
}

/**
 * Install bundled skills to the target directory
 * @param skills Skills to install (from getBundledSkills)
 * @param installPath Target installation path
 * @param handleConflict Callback to handle skill conflicts (returns true to replace)
 */
export async function installBundledSkills(
    skills: DiscoveredSkill[],
    installPath: string,
    handleConflict: (skillName: string) => Promise<boolean>
): Promise<InstallResult> {
    const logger = getLogger();
    const result: InstallResult = {
        installed: 0,
        skipped: 0,
        failed: 0,
        details: []
    };

    ensureDirectoryExists(installPath);

    for (const skill of skills) {
        const targetPath = path.join(installPath, skill.name);
        let detail: InstallDetail;

        try {
            if (safeExists(targetPath)) {
                const shouldReplace = await handleConflict(skill.name);
                if (!shouldReplace) {
                    detail = {
                        name: skill.name,
                        success: true,
                        action: 'skipped',
                        reason: 'User declined to replace existing skill'
                    };
                    result.skipped++;
                    result.details.push(detail);
                    continue;
                }

                fs.rmSync(targetPath, { recursive: true, force: true });
            }

            await copySkillDirectory(skill.path, targetPath);

            detail = {
                name: skill.name,
                success: true,
                action: skill.alreadyExists ? 'replaced' : 'installed'
            };
            result.installed++;

        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            logger.error(LogCategory.GENERAL, `Failed to install bundled skill ${skill.name}`, err);
            detail = {
                name: skill.name,
                success: false,
                action: 'failed',
                reason: err.message
            };
            result.failed++;
        }

        result.details.push(detail);
    }

    return result;
}

/**
 * Parse the version of a bundled skill from its SKILL.md frontmatter.
 *
 * Reads the SKILL.md file in `resources/bundled-skills/<skillName>/` and
 * extracts the `metadata.version` field from the YAML frontmatter.
 *
 * @returns The version string, or undefined if not found or unparseable.
 */
export function parseBundledSkillVersion(skillName: string): string | undefined {
    const skillMdPath = path.join(getBundledSkillsPath(), skillName, 'SKILL.md');
    return parseSkillVersionFromFile(skillMdPath);
}

/**
 * Parse the version from a SKILL.md file's frontmatter.
 *
 * Supports both top-level `version:` and nested `metadata:\n  version:`.
 */
export function parseSkillVersionFromFile(skillMdPath: string): string | undefined {
    try {
        if (!fs.existsSync(skillMdPath)) return undefined;
        const content = fs.readFileSync(skillMdPath, 'utf-8');
        return parseSkillVersionFromContent(content);
    } catch {
        return undefined;
    }
}

/**
 * Parse the version from SKILL.md content string.
 *
 * Supports both top-level `version:` and nested `metadata:\n  version:`.
 */
export function parseSkillVersionFromContent(content: string): string | undefined {
    const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!fmMatch) return undefined;

    const frontmatter = fmMatch[1];

    // Try top-level version: first
    const topLevel = frontmatter.match(/^version:\s*["']?(.+?)["']?\s*$/m);
    if (topLevel) return topLevel[1];

    // Try nested metadata.version — version may appear anywhere within the metadata block
    const metadataBlock = frontmatter.match(/^metadata:\s*\r?\n((?:[ \t]+[^\r\n]+\r?\n?)*)/m);
    if (metadataBlock) {
        const versionInBlock = metadataBlock[1].match(/^[ \t]+version:\s*["']?(.+?)["']?\s*$/m);
        if (versionInBlock) return versionInBlock[1];
    }

    return undefined;
}

/**
 * Get a read-only copy of the bundled skills registry.
 */
export function getBundledSkillsRegistry(): readonly BundledSkill[] {
    return BUNDLED_SKILLS_REGISTRY;
}

// ============================================================================
// Auto-install default skills
// ============================================================================

/** Result of an auto-install default skills run */
export interface AutoInstallResult {
    installed: string[];
    skipped: string[];
    errors: Array<{ name: string; error: string }>;
}

/**
 * Install whitelisted bundled skills into `installPath` if they are not
 * already present.  Existing installations are never overwritten — the
 * function is fully idempotent.
 *
 * Skills whose name does not appear in `BUNDLED_SKILLS_REGISTRY` or whose
 * source directory / SKILL.md is missing are silently skipped (not an error).
 *
 * @param installPath  Target directory (e.g. `~/.coc/skills`)
 * @param skillNames   Whitelist of skill names to ensure are installed
 */
export async function autoInstallDefaultSkills(
    installPath: string,
    skillNames: string[],
): Promise<AutoInstallResult> {
    const logger = getLogger();
    const result: AutoInstallResult = { installed: [], skipped: [], errors: [] };

    if (skillNames.length === 0) {
        return result;
    }

    ensureDirectoryExists(installPath);

    const bundledPath = getBundledSkillsPath();

    for (const name of skillNames) {
        const entry = BUNDLED_SKILLS_REGISTRY.find(s => s.name === name);
        if (!entry) {
            result.skipped.push(name);
            continue;
        }

        const skillSrc = path.join(bundledPath, entry.relativePath);
        const skillFile = path.join(skillSrc, 'SKILL.md');
        if (!safeExists(skillFile)) {
            result.skipped.push(name);
            continue;
        }

        const targetPath = path.join(installPath, name);
        if (safeExists(targetPath)) {
            result.skipped.push(name);
            continue;
        }

        try {
            await copySkillDirectory(skillSrc, targetPath);
            result.installed.push(name);
            logger.info(LogCategory.GENERAL, `Auto-installed default skill "${name}"`);
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            logger.error(LogCategory.GENERAL, `Failed to auto-install default skill "${name}"`, err);
            result.errors.push({ name, error: err.message });
        }
    }

    return result;
}
