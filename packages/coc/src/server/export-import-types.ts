/**
 * Export/Import Types and Schema
 *
 * Defines the versioned JSON payload structure for CoC admin export/import,
 * including validation helpers.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import type { AIProcess, WorkspaceInfo, WikiInfo, QueuedTask, ProcessStore, TaskQueueManager } from '@plusplusoneplusplus/pipeline-core';
import type { UserPreferences } from './preferences-handler';
import type { CLIConfig } from '../config';
import type { DataWiper } from './data-wiper';
import type { QueuePersistence } from './queue-persistence';

// ============================================================================
// Constants
// ============================================================================

/** Current export schema version. Bump when the payload shape changes. */
export const EXPORT_SCHEMA_VERSION = 1;

// ============================================================================
// Types
// ============================================================================

/** Metadata summary embedded in every export payload. */
export interface ExportMetadata {
    processCount: number;
    workspaceCount: number;
    wikiCount: number;
    queueFileCount: number;
}

/** Per-repo queue snapshot included in an export. */
export interface QueueSnapshot {
    repoRootPath: string;
    repoId: string;
    pending: QueuedTask[];
    history: QueuedTask[];
    isPaused?: boolean;
}

/** Top-level export/import payload. */
export interface CoCExportPayload {
    version: number;
    /** ISO 8601 timestamp of when the export was created. */
    exportedAt: string;
    /** Server version from package.json (informational). */
    serverVersion?: string;
    metadata: ExportMetadata;
    processes: AIProcess[];
    workspaces: WorkspaceInfo[];
    wikis: WikiInfo[];
    queueHistory: QueueSnapshot[];
    preferences: UserPreferences;
    /** Optional snapshot of the server configuration at export time. */
    serverConfig?: CLIConfig;
}

/** Options passed to the data exporter. */
export interface ExportOptions {
    /** ProcessStore instance to read processes, workspaces, and wikis from. */
    store: ProcessStore;
    /** CoC data directory (e.g. ~/.coc). */
    dataDir: string;
    /** Server version string (informational, included in payload). */
    serverVersion?: string;
}

/** Import strategy: replace all data or merge with existing. */
export type ImportMode = 'replace' | 'merge';

/** Options passed to the data importer. */
export interface ImportOptions {
    /** ProcessStore instance to write processes, workspaces, and wikis to. */
    store: ProcessStore;
    /** CoC data directory (e.g. ~/.coc). */
    dataDir: string;
    /** Import strategy. */
    mode: ImportMode;
    /** DataWiper instance used to clear data in replace mode. */
    wiper: DataWiper;
    /** Optional: factory returning the TaskQueueManager (for queue reset in replace mode). */
    getQueueManager?: () => TaskQueueManager | undefined;
    /** Optional: factory returning the QueuePersistence (for queue restore after import). */
    getQueuePersistence?: () => QueuePersistence | undefined;
}

/** Result summary returned after an import operation. */
export interface ImportResult {
    importedProcesses: number;
    importedWorkspaces: number;
    importedWikis: number;
    importedQueueFiles: number;
    errors: string[];
}

// ============================================================================
// Validation
// ============================================================================

export interface ValidationResult {
    valid: boolean;
    error?: string;
}

/**
 * Validate that `raw` conforms to the {@link CoCExportPayload} shape.
 *
 * Checks version, required top-level fields, and basic structural constraints
 * (arrays are arrays, objects are objects). Extra unknown fields are allowed
 * for forward compatibility.
 */
export function validateExportPayload(raw: unknown): ValidationResult {
    if (raw === null || raw === undefined || typeof raw !== 'object') {
        return { valid: false, error: 'Payload must be a non-null object' };
    }

    const obj = raw as Record<string, unknown>;

    // version -----------------------------------------------------------
    if (obj.version === undefined) {
        return { valid: false, error: 'Missing required field: version' };
    }
    if (typeof obj.version !== 'number') {
        return { valid: false, error: 'Field "version" must be a number' };
    }
    if (obj.version !== EXPORT_SCHEMA_VERSION) {
        return {
            valid: false,
            error: `Unsupported schema version ${obj.version} (expected ${EXPORT_SCHEMA_VERSION})`,
        };
    }

    // exportedAt --------------------------------------------------------
    if (typeof obj.exportedAt !== 'string') {
        return { valid: false, error: 'Missing or invalid field: exportedAt (expected string)' };
    }

    // metadata ----------------------------------------------------------
    if (obj.metadata === null || obj.metadata === undefined || typeof obj.metadata !== 'object') {
        return { valid: false, error: 'Missing or invalid field: metadata (expected object)' };
    }
    const meta = obj.metadata as Record<string, unknown>;
    for (const key of ['processCount', 'workspaceCount', 'wikiCount', 'queueFileCount']) {
        if (typeof meta[key] !== 'number') {
            return { valid: false, error: `metadata.${key} must be a number` };
        }
    }

    // array fields ------------------------------------------------------
    for (const key of ['processes', 'workspaces', 'wikis', 'queueHistory']) {
        if (!Array.isArray(obj[key])) {
            return { valid: false, error: `Field "${key}" must be an array` };
        }
    }

    // preferences -------------------------------------------------------
    if (obj.preferences === null || obj.preferences === undefined || typeof obj.preferences !== 'object') {
        return { valid: false, error: 'Missing or invalid field: preferences (expected object)' };
    }

    return { valid: true };
}
