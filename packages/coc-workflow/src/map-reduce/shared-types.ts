/**
 * Shared legacy pipeline compatibility types used by the workflow compiler.
 */

export type { PromptItem } from '../ai/types';

/**
 * Output format for the reduce phase.
 */
export type OutputFormat = 'list' | 'table' | 'json' | 'csv' | 'ai' | 'text';
