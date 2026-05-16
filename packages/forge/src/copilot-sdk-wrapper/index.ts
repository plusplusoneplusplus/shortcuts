/**
 * Copilot SDK Wrapper - Public API
 *
 * Pure SDK integration layer for the Copilot SDK.
 * Everything needed to talk to the Copilot SDK lives in this module.
 */

// Types
export {
    // MCP types
    MCPServerConfigBase,
    MCPLocalServerConfig,
    MCPRemoteServerConfig,
    MCPServerConfig,
    MCPControlOptions,
    // Attachment types
    Attachment,
    // Message types
    SendMessageOptions,
    McpOAuthEvent,
    // System message types
    SystemMessageConfig,
    TokenUsage,
    SDKInvocationResult,
    SDKAvailabilityResult,
    // Agent mode types
    AgentMode,
    DeliveryMode,
    // Permission helpers
    approveAllPermissions,
    denyAllPermissions,
    isPermissionApproved,
    // Read-only mode constants
    READ_ONLY_SYSTEM_MESSAGE,
    // Tool event types
    ToolEvent,
    // Tool result interceptor
    ToolResultInterceptor,
    // Dynamic model info types
    ModelInfo,
    ModelPolicy,
    ModelBilling,
} from './types';

// SDK types re-exported via types.ts from @github/copilot-sdk
export type {
    ReasoningEffort,
    PermissionRequest,
    PermissionRequestResult,
    PermissionHandler,
    Tool,
    ToolHandler,
    ToolInvocation,
    ToolResult,
    ToolResultObject,
    ToolResultType,
    ZodSchema,
} from './types';

// User input types (locally defined — not publicly exported by @github/copilot-sdk)
export type {
    UserInputRequest,
    UserInputResponse,
    UserInputHandler,
} from './types';

export { defineTool, approveAll } from './types';

// Model Registry
export {
    AIModel,
    VALID_MODELS,
    DEFAULT_MODEL_ID,
    ModelDefinition,
    MODEL_REGISTRY,
    getModelLabel,
    getModelDescription,
    getModelDefinition,
    getAllModels,
    getActiveModels,
    isValidModelId,
    getModelCount,
    getModelsByTier,
    getModelContextWindow,
    IModelListClient,
    fetchModelsFromClient,
} from './model-registry';

// Copilot SDK Service
export {
    CopilotSDKService,
    getCopilotSDKService,
    resetCopilotSDKService,
    tryConvertImageFileToDataUrl,
} from './copilot-sdk-service';

export type { BackgroundTasksInfo } from './copilot-sdk-service';

// Session Manager
export {
    SessionManager,
    IAbortableSession,
} from './session-manager';

// Model Metadata Store
export {
    modelMetadataStore,
} from './model-metadata-store';

export {
    resolveReasoningEffort,
    resolveReasoningSelection,
    ResolvedReasoningSelection,
    ResolveReasoningEffortOptions,
} from './model-reasoning';

// MCP Config Loader
export {
    MCPConfigFile,
    MCPConfigLoadResult,
    getHomeDirectory,
    getMcpConfigPath,
    loadDefaultMcpConfig,
    loadDefaultMcpConfigAsync,
    mergeMcpConfigs,
    clearMcpConfigCache,
    mcpConfigExists,
    getCachedMcpConfig,
    setHomeDirectoryOverride,
} from './mcp-config-loader';

// Trusted Folder Management
export {
    ensureFolderTrusted,
    isFolderTrusted,
    getCopilotConfigPath,
    setTrustedFolderHomeOverride,
    stripJsoncComments,
} from './trusted-folder';
