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
    // Shared AI execution types (relocated from map-reduce)
    type PromptItem,
    type AIInvoker,
    type AIInvokerOptions,
    type AIInvokerResult,
    type SessionMetadata,
    type ProcessTracker,
    type JobProgress,
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
    // Attachment types
    Attachment,
    // Message types
    SendMessageOptions,
    SystemMessageConfig,
    TokenUsage,
    SDKInvocationResult,
    SDKAvailabilityResult,
    // Agent mode type
    AgentMode,
    // Permission types
    PermissionRequest,
    PermissionRequestResult,
    PermissionHandler,
    // Permission helpers
    approveAllPermissions,
    denyAllPermissions,
    // Read-only mode constants
    READ_ONLY_MARKER,
    READ_ONLY_SYSTEM_MESSAGE,
    // Tool event types
    ToolEvent,
    // SDK tool types
    Tool,
    ToolHandler,
    ToolInvocation,
    defineTool,
    // Copilot SDK Service
    CopilotSDKService,
    getCopilotSDKService,
    resetCopilotSDKService,
    SendFollowUpOptions,
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
    ConversationTurn,
    SerializedConversationTurn,
    TimelineItem,
    SerializedTimelineItem,
    ToolCallStatus,
    ToolCallPermissionRequest,
    ToolCallPermissionResult,
    ToolCall,
    SerializedToolCall,
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

// Timeline Utilities
export { mergeConsecutiveContentItems } from './timeline-utils';

// Default timeouts
export { DEFAULT_AI_TIMEOUT_MS } from './timeouts';
