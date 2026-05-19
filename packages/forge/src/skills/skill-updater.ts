/**
 * Skill Auto-Updater
 *
 * Compares bundled skill versions against globally-installed copies
 * and updates stale installations when the bundled version is higher.
 */

import * as path from 'path';
import {
    getBundledSkillsPath,
    getBundledSkillsRegistry,
    parseSkillVersionFromFile,
} from './bundled-skills-provider';
import { compareVersions } from '../utils/version-compare';
import { safeExists } from '../utils';
import { getLogger, LogCategory } from '../logger';

// Re-use the private copyDirectory helper from bundled-skills-provider
// by importing fs directly — the copy logic is simple enough to inline.
import * as fs from 'fs';

/** Information about a skill that was updated */
export interface SkillUpdateInfo {
    name: string;
    previousVersion: string;
    newVersion: string;
}

/** Information about a skill that was skipped */
export interface SkillSkipInfo {
    name: string;
    reason: 'not-installed' | 'no-bundled-version' | 'up-to-date' | 'installed-newer';
    bundledVersion?: string;
    installedVersion?: string;
}

/** Information about a skill update that failed */
export interface SkillErrorInfo {
    name: string;
    error: string;
}

/** Result of an auto-update run */
export interface AutoUpdateResult {
    updated: SkillUpdateInfo[];
    skipped: SkillSkipInfo[];
    errors: SkillErrorInfo[];
}

export interface AutoUpdateOptions {
    /** When true, report what would be updated without making changes */
    dryRun?: boolean;
}

/**
 * Auto-update globally-installed bundled skills when the bundled version is newer.
 *
 * For each skill in the bundled registry:
 * - If not installed in globalSkillsDir → skip (don't force-install)
 * - If the bundled side has no parseable version → skip
 * - If the installed SKILL.md has no parseable version, treat it as "0.0.0"
 *   so installs that pre-date the frontmatter-version convention can still
 *   be brought current.
 * - If bundled version > installed version → copy bundled → installed
 * - Otherwise → skip (up-to-date or installed is newer)
 */
export async function autoUpdateBundledSkills(
    globalSkillsDir: string,
    options: AutoUpdateOptions = {},
): Promise<AutoUpdateResult> {
    const logger = getLogger();
    const result: AutoUpdateResult = { updated: [], skipped: [], errors: [] };
    const bundledPath = getBundledSkillsPath();
    const registry = getBundledSkillsRegistry();

    for (const skill of registry) {
        const installedDir = path.join(globalSkillsDir, skill.name);
        const installedSkillMd = path.join(installedDir, 'SKILL.md');

        // Skip skills that are not installed globally
        if (!safeExists(installedDir) || !safeExists(installedSkillMd)) {
            result.skipped.push({ name: skill.name, reason: 'not-installed' });
            continue;
        }

        // Parse bundled version from SKILL.md
        const bundledSkillMd = path.join(bundledPath, skill.relativePath, 'SKILL.md');
        const bundledVersion = parseSkillVersionFromFile(bundledSkillMd);
        if (!bundledVersion) {
            result.skipped.push({ name: skill.name, reason: 'no-bundled-version' });
            continue;
        }

        // Parse installed version from SKILL.md. An unversioned installed
        // SKILL.md is treated as an implicit "0.0.0" so installs that pre-date
        // the frontmatter-version convention can still receive updates.
        const installedVersion = parseSkillVersionFromFile(installedSkillMd);
        const effectiveInstalledVersion = installedVersion ?? '0.0.0';

        // Compare versions
        const cmp = compareVersions(bundledVersion, effectiveInstalledVersion);
        if (cmp === undefined) {
            result.skipped.push({
                name: skill.name,
                reason: 'no-bundled-version',
                bundledVersion,
                installedVersion,
            });
            continue;
        }

        if (cmp <= 0) {
            const reason = cmp === 0 ? 'up-to-date' as const : 'installed-newer' as const;
            result.skipped.push({
                name: skill.name,
                reason,
                bundledVersion,
                installedVersion,
            });
            continue;
        }

        // bundled > installed → update
        if (options.dryRun) {
            result.updated.push({
                name: skill.name,
                previousVersion: effectiveInstalledVersion,
                newVersion: bundledVersion,
            });
            continue;
        }

        try {
            const sourcePath = path.join(bundledPath, skill.relativePath);
            // Remove old install and copy fresh
            fs.rmSync(installedDir, { recursive: true, force: true });
            copyDirectorySync(sourcePath, installedDir);

            result.updated.push({
                name: skill.name,
                previousVersion: effectiveInstalledVersion,
                newVersion: bundledVersion,
            });
            logger.info(
                LogCategory.GENERAL,
                `Auto-updated skill "${skill.name}" from ${effectiveInstalledVersion} → ${bundledVersion}`,
            );
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            result.errors.push({ name: skill.name, error: message });
            logger.error(
                LogCategory.GENERAL,
                `Failed to auto-update skill "${skill.name}": ${message}`,
            );
        }
    }

    return result;
}

/** Recursive synchronous directory copy */
function copyDirectorySync(src: string, dest: string): void {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) {
            copyDirectorySync(srcPath, destPath);
        } else if (entry.isFile()) {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}
