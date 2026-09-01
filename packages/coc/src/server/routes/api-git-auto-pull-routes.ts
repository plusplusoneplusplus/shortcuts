/**
 * Read-only view of a repo's server-side auto-pull schedule (AC-05). The
 * interval itself is still written through the per-repo preferences endpoint;
 * this route only reports what the server's `AutoPullManager` is doing with it,
 * so the client can render the next run and the last outcome without running a
 * timer of its own.
 *
 * Deliberately separate from the preferences endpoint: this payload mixes a
 * preference (`enabled`, `intervalMinutes`) with live scheduler state
 * (`nextRunAt`) and persisted run state (`lastRunAt`, `outcome`, `message`),
 * none of which belongs in the preferences document.
 */

import type { ProcessStore } from '@plusplusoneplusplus/forge';
import type { AutoPullManager } from '../git/auto-pull-manager';
import { resolveWorkspaceOrFail } from '../shared/handler-utils';
import type { Route } from '../types';
import { createRoute } from './route-utils';

export interface RegisterGitAutoPullRoutesOptions {
    routes: Route[];
    store: ProcessStore;
    autoPullManager: AutoPullManager;
}

export function registerGitAutoPullRoutes(options: RegisterGitAutoPullRoutesOptions): void {
    const { routes, store, autoPullManager } = options;

    // GET /api/workspaces/:id/git/auto-pull — schedule + last run for one repo
    routes.push(createRoute({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/auto-pull$/,
        handler: async ({ res, match }) => {
            const ws = await resolveWorkspaceOrFail(store, match, res);
            if (!ws) return;
            return autoPullManager.getStatus(ws.id);
        },
    }));
}
