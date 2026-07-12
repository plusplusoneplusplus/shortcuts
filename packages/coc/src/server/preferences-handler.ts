/**
 * Preferences REST API compatibility barrel.
 *
 * The implementation lives under `server/preferences/`:
 * - schema.ts owns Zod schemas, inferred types, constants, and validators.
 * - repository.ts owns disk persistence and repo-scoped path resolution.
 * - merge-policy.ts owns pure PATCH/import merge semantics.
 * - live-effects.ts owns live sync/work-item side effects.
 * - routes.ts owns HTTP route registration.
 */

export * from './preferences/schema';
export * from './preferences/repository';
export * from './preferences/merge-policy';
export * from './preferences/live-effects';
export { registerPreferencesRoutes } from './preferences/routes';
