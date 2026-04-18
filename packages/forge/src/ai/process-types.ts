/**
 * AI Process Types — backward-compatible re-export barrel.
 *
 * All symbols are now defined in focused files:
 *   - process-legacy-types.ts  — legacy metadata types (required for SQLite deserialization)
 *   - process-interfaces.ts    — core domain interfaces and type aliases
 *   - process-serialization.ts — serializeProcess / deserializeProcess helpers
 *
 * This file re-exports everything so existing `import … from './process-types'`
 * statements continue to work without modification.
 */

export * from './process-legacy-types';
export * from './process-interfaces';
export * from './process-serialization';