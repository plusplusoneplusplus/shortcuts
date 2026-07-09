import { sendError, sendJSON } from '../core/api-handler';
import { parseBodyOrReject } from '../shared/handler-utils';
import type { SyncEngine } from '../sync/sync-engine';
import type { Route } from '../types';
import { applyRepoPreferencesLiveEffects } from './live-effects';
import { applyGlobalPreferencesPatch, applyRepoPreferencesPatch } from './merge-policy';
import {
    readGlobalPreferences,
    readPreferences,
    readRepoPreferences,
    writePreferences,
    writeRepoPreferences,
} from './repository';
import type { PerRepoPreferences, SkillUsageEntry } from './schema';
import { validateGlobalPreferences, validatePerRepoPreferences } from './schema';

/**
 * Register preferences API routes on the given route table.
 * Mutates the `routes` array in-place.
 *
 * @param routes - Shared route table
 * @param dataDir - Directory for preferences file (e.g. ~/.coc)
 * @param getSyncEngine - Optional getter for per-workspace sync engines; when
 *   provided, saving sync preferences immediately reconfigures the live engine
 *   without requiring a server restart.
 * @param onRepoPreferencesChanged - Optional callback for infrastructure backed
 *   by per-repo preferences, such as work-item provider polling.
 */
export function registerPreferencesRoutes(
    routes: Route[],
    dataDir: string,
    getSyncEngine?: (workspaceId: string) => SyncEngine | undefined,
    onRepoPreferencesChanged?: (workspaceId: string, preferences: PerRepoPreferences) => void | Promise<void>,
): void {
    // ------------------------------------------------------------------
    // GET /api/preferences — Read global preferences
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: '/api/preferences',
        handler: async (_req, res) => {
            sendJSON(res, 200, readGlobalPreferences(dataDir));
        },
    });

    // ------------------------------------------------------------------
    // PUT /api/preferences — Replace global preferences
    // ------------------------------------------------------------------
    routes.push({
        method: 'PUT',
        pattern: '/api/preferences',
        handler: async (req, res) => {
            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            const global = validateGlobalPreferences(body);
            const existing = readPreferences(dataDir);
            writePreferences(dataDir, { ...existing, global });
            sendJSON(res, 200, global);
        },
    });

    // ------------------------------------------------------------------
    // PATCH /api/preferences — Merge partial updates into global preferences
    // ------------------------------------------------------------------
    routes.push({
        method: 'PATCH',
        pattern: '/api/preferences',
        handler: async (req, res) => {
            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            const existing = readPreferences(dataDir);
            const { preferences: merged } = applyGlobalPreferencesPatch(existing.global, body);

            writePreferences(dataDir, { ...existing, global: merged });
            sendJSON(res, 200, merged);
        },
    });

    // ------------------------------------------------------------------
    // GET /api/workspaces/:id/preferences — Read per-repo preferences
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/preferences$/,
        handler: async (_req, res, match) => {
            const repoId = decodeURIComponent(match![1]);
            sendJSON(res, 200, readRepoPreferences(dataDir, repoId));
        },
    });

    // ------------------------------------------------------------------
    // PUT /api/workspaces/:id/preferences — Replace per-repo preferences
    // ------------------------------------------------------------------
    routes.push({
        method: 'PUT',
        pattern: /^\/api\/workspaces\/([^/]+)\/preferences$/,
        handler: async (req, res, match) => {
            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            const repoId = decodeURIComponent(match![1]);
            const repoPrefs = validatePerRepoPreferences(body);
            writeRepoPreferences(dataDir, repoId, repoPrefs);
            applyRepoPreferencesLiveEffects({
                kind: 'replace',
                workspaceId: repoId,
                preferences: repoPrefs,
                getSyncEngine,
                onRepoPreferencesChanged,
            });
            sendJSON(res, 200, repoPrefs);
        },
    });

    // ------------------------------------------------------------------
    // PATCH /api/workspaces/:id/preferences — Merge into per-repo preferences
    // ------------------------------------------------------------------
    routes.push({
        method: 'PATCH',
        pattern: /^\/api\/workspaces\/([^/]+)\/preferences$/,
        handler: async (req, res, match) => {
            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            const repoId = decodeURIComponent(match![1]);
            const existingRepo = readRepoPreferences(dataDir, repoId);
            const { preferences: merged, patch } = applyRepoPreferencesPatch(existingRepo, body);

            writeRepoPreferences(dataDir, repoId, merged);
            applyRepoPreferencesLiveEffects({
                kind: 'patch',
                workspaceId: repoId,
                preferences: merged,
                patch,
                getSyncEngine,
                onRepoPreferencesChanged,
            });

            sendJSON(res, 200, merged);
        },
    });

    // ------------------------------------------------------------------
    // GET /api/workspaces/:id/preferences/skill-usage — Read skill usage
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/preferences\/skill-usage$/,
        handler: async (req, res, match) => {
            const parsed = new URL(req.url ?? '/', 'http://localhost');
            const skillName = parsed.searchParams.get('skillName') ?? undefined;
            const since = parsed.searchParams.get('since') ?? undefined;

            if (since && Number.isNaN(Date.parse(since))) {
                return sendError(res, 400, '`since` must be an ISO date-time string');
            }

            const repoId = decodeURIComponent(match![1]);
            const usageMap = readRepoPreferences(dataDir, repoId).skillUsageMap ?? {};
            const usage: SkillUsageEntry[] = Object.entries(usageMap)
                .filter(([name]) => !skillName || name === skillName)
                .filter(([, timestamp]) => !since || timestamp >= since)
                .sort((a, b) => b[1].localeCompare(a[1]))
                .map(([name, timestamp]) => ({ skillName: name, timestamp }));

            sendJSON(res, 200, { usage });
        },
    });

    // ------------------------------------------------------------------
    // PATCH /api/workspaces/:id/preferences/skill-usage — Record a skill usage
    // ------------------------------------------------------------------
    routes.push({
        method: 'PATCH',
        pattern: /^\/api\/workspaces\/([^/]+)\/preferences\/skill-usage$/,
        handler: async (req, res, match) => {
            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            if (!body || typeof body.skillName !== 'string' || body.skillName.length === 0) {
                return sendError(res, 400, '`skillName` is required');
            }

            const repoId = decodeURIComponent(match![1]);
            const skillName: string = body.skillName;
            const existingRepo = readRepoPreferences(dataDir, repoId);
            const timestamp = new Date().toISOString();
            const usageMap = { ...(existingRepo.skillUsageMap ?? {}), [skillName]: timestamp };
            const merged: PerRepoPreferences = { ...existingRepo, skillUsageMap: usageMap };
            writeRepoPreferences(dataDir, repoId, merged);
            sendJSON(res, 200, { skillName, timestamp });
        },
    });

    // ------------------------------------------------------------------
    // GET /api/workspaces/:id/preferences/commit-skill-usage — Read commit-scoped skill usage
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/preferences\/commit-skill-usage$/,
        handler: async (req, res, match) => {
            const parsed = new URL(req.url ?? '/', 'http://localhost');
            const skillName = parsed.searchParams.get('skillName') ?? undefined;
            const since = parsed.searchParams.get('since') ?? undefined;

            if (since && Number.isNaN(Date.parse(since))) {
                return sendError(res, 400, '`since` must be an ISO date-time string');
            }

            const repoId = decodeURIComponent(match![1]);
            const usageMap = readRepoPreferences(dataDir, repoId).commitSkillUsageMap ?? {};
            const usage: SkillUsageEntry[] = Object.entries(usageMap)
                .filter(([name]) => !skillName || name === skillName)
                .filter(([, timestamp]) => !since || timestamp >= since)
                .sort((a, b) => b[1].localeCompare(a[1]))
                .map(([name, timestamp]) => ({ skillName: name, timestamp }));

            sendJSON(res, 200, { usage });
        },
    });

    // ------------------------------------------------------------------
    // PATCH /api/workspaces/:id/preferences/commit-skill-usage — Record a commit-scoped skill usage
    // ------------------------------------------------------------------
    routes.push({
        method: 'PATCH',
        pattern: /^\/api\/workspaces\/([^/]+)\/preferences\/commit-skill-usage$/,
        handler: async (req, res, match) => {
            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            if (!body || typeof body.skillName !== 'string' || body.skillName.length === 0) {
                return sendError(res, 400, '`skillName` is required');
            }

            const repoId = decodeURIComponent(match![1]);
            const skillName: string = body.skillName;
            const existingRepo = readRepoPreferences(dataDir, repoId);
            const timestamp = new Date().toISOString();
            const usageMap = { ...(existingRepo.commitSkillUsageMap ?? {}), [skillName]: timestamp };
            const merged: PerRepoPreferences = { ...existingRepo, commitSkillUsageMap: usageMap };
            writeRepoPreferences(dataDir, repoId, merged);
            sendJSON(res, 200, { skillName, timestamp });
        },
    });
}
