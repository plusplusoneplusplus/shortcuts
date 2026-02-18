// coc-server: HTTP/WebSocket server for AI execution dashboard
// Foundational types, router, export/import schema, and repo utilities.

// Core types
export type {
    ExecutionServerOptions,
    ExecutionServer,
    Route,
    ServeCommandOptions,
    WikiServerOptions,
    ServerCloseOptions,
    BulkQueueRequest,
    BulkQueueResponse,
} from './types';

// Router functions and types
export {
    createRequestHandler,
    readJsonBody,
    sendJson,
    send404,
    send400,
    send500,
} from './router';
export type { RouterOptions } from './router';

// Export/import types and validation
export type {
    ExportMetadata,
    ExportOptions,
    ImportOptions,
    ImportResult,
    ImportMode,
    QueueSnapshot,
    CoCExportPayload,
    ValidationResult,
    UserPreferences,
    CLIConfig,
    DataWiper,
    QueuePersistence,
} from './export-import-types';
export {
    EXPORT_SCHEMA_VERSION,
    validateExportPayload,
} from './export-import-types';

// Repository utilities
export {
    extractRepoId,
    findGitRoot,
    normalizeRepoPath,
    getWorkingDirectory,
} from './repo-utils';
