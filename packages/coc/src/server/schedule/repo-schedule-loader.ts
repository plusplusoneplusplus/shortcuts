/**
 * RepoScheduleLoader
 *
 * Scans <workspaceRoot>/.github/schedules/*.yaml (and *.yml) and parses each
 * file into a ScheduleEntry with source: 'repo'.
 *
 * IDs are prefixed with 'repo:' + filename stem (without extension) so they
 * never collide with user-managed schedule IDs (which start with 'sch_').
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import type { ScheduleEntry, ScheduleStatus, ScheduleOnFailure } from './schedule-manager';
import type { TargetType, ChatMode } from '../tasks/task-types';
import { normalizeChatMode } from '../tasks/task-types';
import type { RepoScheduleOverrides } from './repo-schedule-overrides';
import { getServerLogger } from '../logging/server-logger';

// ============================================================================
// Public API
// ============================================================================

/**
 * Returns the absolute path to the .github/schedules/ directory for a workspace.
 */
export function getRepoScheduleDir(workspaceRoot: string): string {
    return path.join(workspaceRoot, '.github', 'schedules');
}

/**
 * Build a stable schedule ID from a YAML filename.
 * e.g. "daily-cleanup.yaml" → "repo:daily-cleanup"
 */
export function idFromScheduleFilename(filename: string): string {
    return 'repo:' + path.basename(filename, path.extname(filename));
}

/**
 * Load all repo-defined schedules from <workspaceRoot>/.github/schedules/.
 * Applies runtime status overrides (pause/resume state) on top of the file defaults.
 * Returns an empty array if the directory does not exist. Directory scan
 * failures reject so callers can keep their previous in-memory schedules.
 */
export async function loadRepoSchedulesAsync(
    workspaceRoot: string,
    overrides: RepoScheduleOverrides = {},
): Promise<ScheduleEntry[]> {
    const scheduleDir = getRepoScheduleDir(workspaceRoot);

    let files: string[];
    try {
        files = (await fs.promises.readdir(scheduleDir))
            .filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw err;
    }

    const result: ScheduleEntry[] = [];

    for (const file of files.sort()) {
        const filePath = path.join(scheduleDir, file);
        try {
            const raw = await fs.promises.readFile(filePath, 'utf-8');
            const parsed = yaml.load(raw) as Record<string, unknown>;
            if (!parsed || typeof parsed !== 'object') continue;
            // name and cron are required
            if (!parsed['name'] || !parsed['cron']) continue;

            const id = idFromScheduleFilename(file);
            const override = overrides[id];
            // Repo schedules always default to paused; only a local override can activate.
            const baseStatus: ScheduleStatus = 'paused';
            const status: ScheduleStatus = override?.status ?? baseStatus;

            const entry: ScheduleEntry = {
                id,
                name: String(parsed['name']),
                target: parsed['target'] ? String(parsed['target']) : '',
                cron: String(parsed['cron']),
                params:
                    parsed['params'] && typeof parsed['params'] === 'object' && !Array.isArray(parsed['params'])
                        ? (parsed['params'] as Record<string, string>)
                        : {},
                onFailure: (parsed['onFailure'] as ScheduleOnFailure | undefined) ?? 'notify',
                status,
                createdAt: new Date().toISOString(),
                targetType: (parsed['targetType'] as TargetType | undefined) ?? 'prompt',
                outputFolder: parsed['outputFolder'] ? String(parsed['outputFolder']) : undefined,
                model: parsed['model'] ? String(parsed['model']) : undefined,
                mode: normalizeChatMode(parsed['mode']) ?? 'autopilot',
                source: 'repo',
            };
            result.push(entry);
        } catch (err) {
            getServerLogger().warn(
                { err, filePath },
                '[RepoScheduleLoader] Failed to parse repo schedule YAML',
            );
        }
    }

    return result;
}
