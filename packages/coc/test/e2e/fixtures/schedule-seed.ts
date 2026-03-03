/**
 * Schedule Seed Utilities for E2E Tests
 *
 * Helpers to create schedules via the REST API.
 */

import { request } from './seed';

export interface ScheduleOverrides {
    name?: string;
    target?: string;
    targetType?: 'script' | 'pipeline';
    cron?: string;
    params?: Record<string, unknown>;
    onFailure?: 'notify' | 'stop';
    workspaceId?: string;
}

/**
 * Create a schedule via POST /api/workspaces/:id/schedules.
 * Returns the created schedule object.
 */
export async function seedSchedule(
    baseURL: string,
    overrides: ScheduleOverrides = {},
): Promise<Record<string, unknown>> {
    const workspaceId = overrides.workspaceId ?? 'default';
    const payload: Record<string, unknown> = {
        name: overrides.name ?? 'Test Schedule',
        target: overrides.target ?? `node -e "process.stdout.write('abc')"`,
        targetType: overrides.targetType ?? 'script',
        cron: overrides.cron ?? '0 * * * *',
        onFailure: overrides.onFailure ?? 'notify',
    };
    if (overrides.params !== undefined) {
        payload.params = overrides.params;
    }
    const res = await request(`${baseURL}/api/workspaces/${workspaceId}/schedules`, {
        method: 'POST',
        body: JSON.stringify(payload),
    });
    if (res.status !== 201 && res.status !== 200) {
        throw new Error(`seedSchedule failed: HTTP ${res.status} – ${res.body}`);
    }
    const json = JSON.parse(res.body);
    return (json.schedule ?? json) as Record<string, unknown>;
}
