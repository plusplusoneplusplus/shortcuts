/**
 * features/ — Feature-sliced modules for the CoC SPA.
 *
 * Each sub-folder co-locates the components, hooks, utils, and API helpers
 * that belong to one product domain (git, chat, tasks, work-items, …).
 *
 * This barrel will re-export public surfaces as features are migrated here
 * from repos/, views/, and hooks/.
 */

export * from './schedules';
export * from './terminal';
export * from './work-items';
export * from './workflow';
export * from './templates';
export * from './repo-settings';
export * from './skills';
