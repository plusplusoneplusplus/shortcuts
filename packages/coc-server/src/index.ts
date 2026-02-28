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

// Shared router primitives (for building custom routers)
export {
    createRouter,
    serveStaticFile,
    readBody,
} from './shared/router';
export type {
    RouteHandler,
    Route as SharedRoute,
    StaticFileHandler,
    SharedRouterOptions,
} from './shared/router';

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
    ImageBlobEntry,
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

// Process API handlers
export {
    registerApiRoutes,
    sendJSON,
    sendError,
    parseBody,
    parseQueryParams,
    stripExcludedFields,
    execGitSync,
    detectRemoteUrl,
    normalizeRemoteUrl,
    discoverPipelines,
    browseDirectory,
} from './api-handler';
export type { QueueExecutorBridge } from './api-handler';

// Image utilities
export { parseDataUrl, saveImagesToTempFiles, cleanupTempDir } from './image-utils';

// WebSocket server
export {
    ProcessWebSocketServer,
    toProcessSummary,
    toCommentSummary,
} from './websocket';
export type {
    WSClient,
    ProcessSummary,
    MarkdownCommentSummary,
    QueueTaskSummary,
    QueueHistoryTaskSummary,
    QueueSnapshot as WSQueueSnapshot,
    ServerMessage,
    ClientMessage,
} from './websocket';

// SSE streaming
export { handleProcessStream } from './sse-handler';

// Task types (domain-specific payload types and guards)
export {
    type TaskType,
    type FollowPromptPayload,
    type ResolveCommentsPayload,
    type AIClarificationPayload,
    type ChatPayload,
    type TaskGenerationPayload,
    type RunPipelinePayload,
    type CustomTaskPayload,
    type TaskPayload,
    isFollowPromptPayload,
    isResolveCommentsPayload,
    isAIClarificationPayload,
    isChatPayload,
    isCustomTaskPayload,
    isTaskGenerationPayload,
    isRunPipelinePayload,
} from './task-types';

// Centralized error handling
export {
    APIError,
    handleAPIError,
    badRequest,
    notFound,
    forbidden,
    invalidJSON,
    missingFields,
    internalError,
} from './errors';
