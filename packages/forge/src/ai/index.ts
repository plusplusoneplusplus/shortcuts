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

// Explicit allow-list of copilot-sdk-wrapper symbols re-exported at the ai/ boundary.
// Only the symbols listed here are part of the ai module's public surface.
// Internal SDK implementation details stay inside copilot-sdk-wrapper/.
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
    getModelContextWindow,
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
    SystemMessageConfig,
    TokenUsage,
    SDKInvocationResult,
    SDKAvailabilityResult,
    // Agent mode type
    AgentMode,
    DeliveryMode,
    // Permission types
    PermissionRequest,
    PermissionRequestResult,
    PermissionHandler,
    // Permission helpers
    approveAllPermissions,
    denyAllPermissions,
    isPermissionApproved,
    // Read-only mode constants
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
    resetCopilotSDKService,
    // Background Tasks Info
    BackgroundTasksInfo,
    // ISDKService interface and provider-agnostic types
    ISDKService,
    IModelInfo,
    IAvailabilityResult,
    IInvocationResult,
    // SDK Service Registry
    SDKServiceRegistry,
    sdkServiceRegistry,
    COPILOT_PROVIDER,
    SDK_PROVIDER_COPILOT,
    // Model Metadata Store
    modelMetadataStore,
    resolveReasoningEffort,
    resolveReasoningSelection,
    ResolvedReasoningSelection,
    ResolveReasoningEffortOptions,
    ModelInfo,
    // MCP Config Loader
    MCPConfigFile,
    MCPConfigLoadResult,
    VSCodeMCPConfigFile,
    getHomeDirectory,
    getMcpConfigPath,
    getWorkspaceMcpConfigPath,
    loadDefaultMcpConfig,
    loadDefaultMcpConfigAsync,
    loadWorkspaceMcpConfig,
    loadEffectiveMcpConfig,
    mergeMcpConfigs,
    mergeMcpConfigSources,
    clearMcpConfigCache,
    invalidateCachedConfig,
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
    SessionCategory,
    GenericProcessMetadata,
    GenericGroupMetadata,
    TypedProcessOptions,
    ProcessGroupOptions,
    CompleteGroupOptions,
    CodeReviewProcessMetadata,
    DiscoveryProcessMetadata,
    CodeReviewGroupMetadata,
    AIProcess,
    PendingMessage,
    PendingFileAttachmentMeta,
    SerializedAIProcess,
    TrackedProcessFields,
    ConversationTurn,
    SerializedConversationTurn,
    TurnSource,
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

// Token Usage Stats
export { TokenUsageStatsEntry, TokenUsageStatsResponse, aggregateTokenUsageStats } from './token-usage-stats';
export {
    COPILOT_MODEL_PRICING,
    COPILOT_PRICING_SOURCE,
    CopilotModelPricing,
} from './copilot-pricing-data';
export {
    CopilotTokenCostBreakdown,
    estimateCopilotTokenCost,
    getCopilotModelPricing,
    normalizeCopilotModelId,
} from './copilot-token-cost';
