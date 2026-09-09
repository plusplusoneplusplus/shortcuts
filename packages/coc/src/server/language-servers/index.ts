export type {
    JsonValue,
    LanguageServerDefinition,
    LanguageServerDefinitionError,
    LanguageServerDefinitionValidation,
} from './types';
export { validateLanguageServerDefinition, validateLanguageServerDefinitions } from './definition-schema';
export { bestMatchingPattern, fileExtension, matchesPattern, normalizeRelativePath, patternSpecificity } from './file-match';
export {
    definitionMatchesFile,
    resolveLanguageId,
    resolveServerRoot,
    selectDefinitionForFile,
} from './selection';
export { TYPESCRIPT_PRESET, builtInLanguageServerDefinitions, mergeWithBuiltIns } from './presets';
export type {
    LanguageServerConfig,
    LanguageServerConfigChangedEvent,
    LanguageServerConfigReadResult,
    LanguageServerConfigReadStatus,
    LanguageServerConfigWarning,
    LanguageServerConfigWriteResult,
} from './repository';
export {
    LANGUAGE_SERVERS_FILE_NAME,
    getLanguageServerConfigPath,
    onLanguageServerConfigChanged,
    readLanguageServerConfig,
    readLanguageServerConfigWithStatus,
    resolveLanguageServerDefinitions,
    writeLanguageServerConfig,
} from './repository';
export type { PreparedDefinition, PrepareDefinitionDeps } from './adapters';
export { prepareDefinitionForRoot } from './adapters';
export type { TypeScriptRuntime, TypeScriptRuntimeDeps, TypeScriptRuntimeOrigin } from './typescript-adapter';
export {
    MIN_WORKSPACE_TYPESCRIPT_VERSION,
    applyTypeScriptRuntime,
    resolveTypeScriptRuntime,
} from './typescript-adapter';
export { registerLanguageServerRoutes } from './routes';
export type {
    JsonRpcErrorBody,
    JsonRpcId,
    JsonRpcMessage,
    JsonRpcNotification,
    JsonRpcRequest,
    JsonRpcResponse,
    JsonRpcValue,
    LspFramingErrorReason,
    LspMessageReaderOptions,
} from './jsonrpc';
export {
    JSON_RPC_ERROR_CODES,
    LspFramingError,
    LspMessageReader,
    encodeMessage,
    isNotification,
    isRequest,
    isResponse,
} from './jsonrpc';
export type {
    LanguageServerConnectionOptions,
    LanguageServerRequestFailure,
    SendRequestOptions,
    ServerNotificationHandler,
    ServerRequestHandler,
} from './connection';
export { LanguageServerConnection, LanguageServerRequestError } from './connection';
export type { ClientRequestOptions, DynamicRegistration, WorkspaceFolder } from './client-requests';
export {
    DEFAULT_CLIENT_CAPABILITIES,
    LanguageServerClientRequests,
    resolveConfigurationSection,
} from './client-requests';
export type {
    LanguageServerSessionOptions,
    LanguageServerSessionState,
    LanguageServerStatus,
} from './session';
export { LanguageServerSession } from './session';
export type {
    AcquireRequest,
    AcquireResult,
    LanguageServerHandle,
    LanguageServerManagerOptions,
    LanguageServerUnavailableReason,
    SessionClosedEvent,
} from './manager';
export { LanguageServerManager } from './manager';
export {
    disposeLanguageServersForWorkspace,
    getActiveLanguageServerManager,
    setActiveLanguageServerManager,
} from './active';
export type { DocumentResolution, ResolvedDocument, UriMappingFailure } from './uri-mapping';
export {
    BROWSER_URI_SCHEME,
    browserDocumentUri,
    isInsideRoot,
    parseBrowserDocumentUri,
    resolveWorkspaceDocument,
    toBrowserUri,
    toServerUri,
    translateUris,
} from './uri-mapping';
export type {
    LanguageServerClientMessage,
    LanguageServerServerMessage,
    WorkspaceLookup,
} from './ws-bridge';
export { LanguageServerWebSocketServer } from './ws-bridge';
