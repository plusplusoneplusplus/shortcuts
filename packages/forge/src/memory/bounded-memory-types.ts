/**
 * Type definitions for the bounded memory system.
 *
 * Defines the entry delimiter, store options, mutation results,
 * usage statistics, and threat pattern identifiers.
 */

/** Entry delimiter matching Hermes: newline + section sign U+00A7 + newline. */
export const ENTRY_DELIMITER = '\n§\n';

/** Default character limit matching Hermes memory_char_limit. */
export const DEFAULT_CHAR_LIMIT = 2200;

export interface BoundedMemoryStoreOptions {
    /** Absolute path to the memory file (e.g. ~/.coc/repos/<id>/MEMORY.md) */
    filePath: string;
    /** Maximum total characters (serialized entries + delimiters). Default: 2200 */
    charLimit?: number;
}

export interface MemoryUsage {
    /** Current character count of serialized entries */
    current: number;
    /** Maximum allowed characters */
    limit: number;
    /** Usage as percentage (0-100) */
    percent: number;
    /** Number of entries */
    entryCount: number;
}

export interface MemoryMutationResult {
    success: boolean;
    /** Human-readable message for tool response */
    message: string;
    /** Current entries after mutation (or before, on failure) */
    entries: string[];
    /** Entries appended by append-only promotion calls. */
    appendedEntries?: string[];
    /** Current usage stats */
    usage: MemoryUsage;
    /** On ambiguous match: preview strings of matching entries */
    matches?: string[];
}

export type ThreatPatternId =
    | 'prompt_injection'
    | 'role_hijack'
    | 'deception_hide'
    | 'sys_prompt_override'
    | 'disregard_rules'
    | 'bypass_restrictions'
    | 'exfil_curl'
    | 'exfil_wget'
    | 'read_secrets'
    | 'ssh_backdoor'
    | 'ssh_access'
    | 'hermes_env';

export interface MemoryScanResult {
    blocked: boolean;
    /** null if not blocked */
    reason: string | null;
    /** The matched pattern ID */
    patternId: ThreatPatternId | 'invisible_unicode' | null;
}
