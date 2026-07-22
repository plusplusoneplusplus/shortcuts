/**
 * Automation Route Ownership Contract
 *
 * Loops and triggers are advertised as workspace-scoped REST surfaces
 * (`/api/workspaces/:id/loops`, `/api/workspaces/:id/triggers`), but their
 * records are keyed by a globally unique ID. Item-level routes must therefore
 * verify that a record actually belongs to the route workspace before reading
 * or mutating it — otherwise a known/stale ID can cross the multi-repo boundary.
 *
 * This module holds the shared logging contract used by both subsystems when a
 * scope mismatch is detected. The external response stays non-enumerating (a
 * plain 404), while the server logs a structured warning so real data
 * corruption is not silently hidden during debugging.
 */

import { getLogger, LogCategory } from '@plusplusoneplusplus/forge';

/** Entity kinds guarded by the automation workspace boundary. */
export type AutomationEntity = 'loop' | 'trigger';

/**
 * Log a structured warning when an automation record is requested through a
 * workspace route that does not own it. Never throws.
 */
export function logAutomationScopeMismatch(
    entity: AutomationEntity,
    recordId: string,
    routeWorkspaceId: string,
    recordWorkspaceId: string | undefined,
): void {
    try {
        getLogger().warn(
            LogCategory.AI,
            `[automation-scope] ${entity} ${recordId} requested through workspace ` +
                `${routeWorkspaceId} but belongs to ${recordWorkspaceId ?? 'unknown'} — returning 404`,
        );
    } catch {
        // Best-effort logging — never fail a REST response over a log line.
    }
}
