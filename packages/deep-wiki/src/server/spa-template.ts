/**
 * SPA Template — Backward compatibility barrel
 *
 * The SPA template has been refactored into the spa/ directory.
 * This file re-exports the public API for backward compatibility.
 */
export { generateSpaHtml } from './spa';
export type { SpaTemplateOptions } from './spa';

