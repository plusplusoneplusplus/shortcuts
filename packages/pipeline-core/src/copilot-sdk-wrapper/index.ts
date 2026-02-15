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
    // Message types
    SendMessageOptions,
    TokenUsage,
    SDKInvocationResult,
    SDKAvailabilityResult,
    // Permission types
    PermissionRequest,
    PermissionRequestResult,
    PermissionHandler,
    // Session pool config
    SessionPoolConfig,
    DEFAULT_SESSION_POOL_CONFIG,
    // Permission helpers
    approveAllPermissions,
    denyAllPermissions,
} from './types';

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
} from './model-registry';

// Session Pool
export {
    SessionPool,
    IPoolableSession,
    SessionFactory,
    SessionPoolOptions,
    SessionPoolStats,
} from './session-pool';

// Copilot SDK Service
export {
    CopilotSDKService,
    getCopilotSDKService,
    resetCopilotSDKService,
} from './copilot-sdk-service';

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
} from './trusted-folder';
