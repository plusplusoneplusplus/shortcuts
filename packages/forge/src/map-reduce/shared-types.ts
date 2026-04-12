/**
 * Shared map-reduce types used across jobs and the workflow compiler.
 *
 * Keeping these here avoids a hard dependency from the workflow module
 * directly on a specific job implementation file.
 */

/**
 * A generic item with string key-value pairs for template substitution.
 * Re-exported from ai/types for consumers that only need this type.
 */
export type { PromptItem } from '../ai/types';

/**
 * Output format for the reduce phase.
 * - 'list': Markdown formatted list
 * - 'table': Markdown table
 * - 'json': JSON array of results
 * - 'csv': CSV format
 * - 'ai': AI-powered synthesis of results
 * - 'text': Pure text concatenation (for non-structured AI responses)
 */
export type OutputFormat = 'list' | 'table' | 'json' | 'csv' | 'ai' | 'text';
