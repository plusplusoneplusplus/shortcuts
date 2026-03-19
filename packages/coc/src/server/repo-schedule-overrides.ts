/**
 * RepoScheduleOverrideStore
 *
 * Persists runtime status overrides for repo-sourced schedules (from .github/schedule/).
 * Since repo schedules are git-managed, only the status (active/paused) can be overridden
 * at runtime without touching the checked-in YAML.
 *
 * Storage: ~/.coc/repos/<workspaceId>/repo-schedule-overrides.json
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as fs from 'fs';
import { atomicWriteJson, getRepoDataPath } from '@plusplusoneplusplus/coc-server';
import type { ScheduleStatus } from './schedule-manager';

// ============================================================================
// Types
// ============================================================================

export interface RepoScheduleOverride {
    status: ScheduleStatus;
}

export interface RepoScheduleOverrides {
    [scheduleId: string]: RepoScheduleOverride;
}

// ============================================================================
// RepoScheduleOverrideStore
// ============================================================================

export class RepoScheduleOverrideStore {
    private readonly dataDir: string;

    constructor(dataDir: string) {
        this.dataDir = dataDir;
    }

    load(repoId: string): RepoScheduleOverrides {
        const filePath = getRepoDataPath(this.dataDir, repoId, 'repo-schedule-overrides.json');
        try {
            if (!fs.existsSync(filePath)) return {};
            const raw = fs.readFileSync(filePath, 'utf-8');
            return JSON.parse(raw) as RepoScheduleOverrides;
        } catch {
            return {};
        }
    }

    save(repoId: string, overrides: RepoScheduleOverrides): void {
        const filePath = getRepoDataPath(this.dataDir, repoId, 'repo-schedule-overrides.json');
        atomicWriteJson(filePath, overrides);
    }

    setStatus(repoId: string, scheduleId: string, status: ScheduleStatus): void {
        const overrides = this.load(repoId);
        overrides[scheduleId] = { status };
        this.save(repoId, overrides);
    }
}
