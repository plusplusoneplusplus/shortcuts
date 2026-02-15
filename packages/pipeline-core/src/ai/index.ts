/**
 * AI Module - Public API
 * 
 * Exports AI service components for interacting with the Copilot SDK.
 * SDK integration is delegated to the copilot-sdk-wrapper module.
 */

// Types
export {
    AIBackendType,
    AIInvocationResult,
    DEFAULT_PROMPTS,
    InteractiveToolType,
} from './types';

// Re-export everything from copilot-sdk-wrapper for backward compatibility
export {
    // Model registry
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
    // Session Pool
    SessionPool,
    IPoolableSession,
    SessionFactory,
    SessionPoolOptions,
    SessionPoolStats,
    // Copilot SDK Service
    CopilotSDKService,
    getCopilotSDKService,
    resetCopilotSDKService,
    // MCP Config Loader
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
    // Trusted Folder Management
    ensureFolderTrusted,
    isFolderTrusted,
    getCopilotConfigPath,
    setTrustedFolderHomeOverride,
} from '../copilot-sdk-wrapper';

// AI Command Types
export {
    AICommand,
    AICommandMode,
    AICommandsConfig,
    DEFAULT_AI_COMMANDS,
    SerializedAICommand,
    SerializedAIMenuConfig,
    serializeCommand,
    serializeCommands
} from './command-types';

// Prompt Builder (Pure)
export {
    PromptContext,
    substitutePromptVariables,
    buildPromptFromContext,
    usesTemplateVariables,
    getAvailableVariables
} from './prompt-builder';

// Program Utilities
export {
    checkProgramExists,
    clearProgramExistsCache,
    parseCopilotOutput
} from './program-utils';

// Process Types
export {
    AIToolType,
    AIProcessStatus,
    AIProcessType,
    GenericProcessMetadata,
    GenericGroupMetadata,
    TypedProcessOptions,
    ProcessGroupOptions,
    CompleteGroupOptions,
    CodeReviewProcessMetadata,
    DiscoveryProcessMetadata,
    CodeReviewGroupMetadata,
    AIProcess,
    SerializedAIProcess,
    TrackedProcessFields,
    serializeProcess,
    deserializeProcess,
    ProcessEventType,
    ProcessEvent,
    ProcessCounts
} from './process-types';

// CLI Utilities
export {
    PROMPT_LENGTH_THRESHOLD,
    PROBLEMATIC_CHARS_PATTERN,
    COPILOT_BASE_FLAGS,
    escapeShellArg,
    shouldUseFileDelivery,
    writePromptToTempFile,
    buildCliCommand,
    BuildCliCommandResult,
    BuildCliCommandOptions
} from './cli-utils';

// Default timeouts
export { DEFAULT_AI_TIMEOUT_MS } from './timeouts';
