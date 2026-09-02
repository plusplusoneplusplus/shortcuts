/**
 * Thin composition entry point for administrative HTTP routes. Route logic
 * lives in per-domain modules; this file wires them together and preserves the
 * original public export surface for backward compatibility.
 *
 * Domains:
 *   - config    → admin-config-routes.ts
 *   - data      → admin-data-routes.ts (wipe / export / import)
 *   - prompts   → admin-prompt-routes.ts (+ admin-prompt-catalog.ts)
 *   - system    → admin-system-routes.ts (version / restart)
 *   - storage   → admin-storage-routes.ts (status / migration / directory import)
 *   - providers → admin-provider-routes.ts
 */

import type { Route } from '../types';
import { registerConfigRoutes } from './admin-config-routes';
import { registerDataRoutes } from './admin-data-routes';
import { registerProviderRoutes } from './admin-provider-routes';
import { registerPromptRoutes } from './admin-prompt-routes';
import type { AdminRouteOptions } from './admin-route-types';
import { registerStorageRoutes } from './admin-storage-routes';
import { registerSystemRoutes } from './admin-system-routes';

// ============================================================================
// Backward-compatible re-exports
// ============================================================================

export type { AdminConfigFunctions, AdminRouteOptions } from './admin-route-types';
export type { BuiltInPrompt } from './admin-prompt-catalog';
export { getBuiltInPrompts, getPromptsWithOverrides, validatePromptOverride } from './admin-prompt-catalog';
export {
    directoryImportTokenManager,
    generateImportToken,
    generateMigrateToken,
    generateWipeToken,
    importTokenManager,
    migrateTokenManager,
    resetDirectoryImportToken,
    resetImportToken,
    resetMigrateToken,
    resetWipeToken,
    TOKEN_EXPIRY_MS,
    TokenManager,
    validateImportToken,
    validateMigrateToken,
    validateWipeToken,
    wipeTokenManager,
} from './token-manager';

// ============================================================================
// Route Registration
// ============================================================================

/**
 * Mutates the `routes` array in-place by composing per-domain route modules.
 */
export function registerAdminRoutes(routes: Route[], options: AdminRouteOptions): void {
    registerConfigRoutes(routes, options);
    registerDataRoutes(routes, options);
    registerPromptRoutes(routes, options);
    registerSystemRoutes(routes, options);
    registerStorageRoutes(routes, options);
    registerProviderRoutes(routes, options);
}
