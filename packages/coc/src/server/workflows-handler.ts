/**
 * Workflows REST API Handler — thin aggregator with re-exports.
 *
 * The implementation has been split into:
 * - workflow-constants.ts  (templates, schema, AI helpers)
 * - workflow-utils.ts      (shared utility functions)
 * - workflows-read-handler.ts  (read-only routes)
 * - workflows-write-handler.ts (mutation routes)
 */

export { registerWorkflowRoutes } from './workflows-read-handler';
export { registerWorkflowWriteRoutes } from './workflows-write-handler';
export { extractYamlFromResponse } from './workflow-constants';