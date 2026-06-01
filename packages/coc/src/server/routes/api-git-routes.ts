/**
 * Git REST API Routes — Aggregator
 *
 * Delegates to domain-focused route modules: commits, branch-range,
 * branch management, and working-tree endpoints.
 */

import type { ApiRouteContext } from './api-shared';
import { registerGitCommitRoutes } from './api-git-commit-routes';
import { registerGitBranchRangeRoutes } from './api-git-branch-range-routes';
import { registerGitBranchRoutes } from './api-git-branch-routes';
import { registerGitWorkingTreeRoutes } from './api-git-working-tree-routes';
import { registerGitCloneRoutes } from './api-git-clone-routes';

export function registerApiGitRoutes(ctx: ApiRouteContext): void {
    registerGitCloneRoutes(ctx);
    registerGitCommitRoutes(ctx);
    registerGitBranchRangeRoutes(ctx);
    registerGitBranchRoutes(ctx);
    registerGitWorkingTreeRoutes(ctx);
}
