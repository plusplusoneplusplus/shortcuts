/**
 * Tasks REST API Handler — aggregator module.
 * Re-exports from the split sub-modules for backward compatibility.
 */
export { registerTaskRoutes } from './tasks-read-handler';
export { registerTaskWriteRoutes } from './tasks-write-handler';
