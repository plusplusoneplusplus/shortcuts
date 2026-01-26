/**
 * AI Module - Public API
 * 
 * Exports AI service components for interacting with the Copilot SDK.
 */

// Types
export {
    AIBackendType,
    AIModel,
    VALID_MODELS,
    AIInvocationResult,
    DEFAULT_PROMPTS,
    InteractiveToolType
} from './types';

// Session Pool
export {
    SessionPool,
    IPoolableSession,
    SessionFactory,
    SessionPoolOptions,
    SessionPoolStats
} from './session-pool';

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

// Copilot SDK Service
export {
    CopilotSDKService,
    getCopilotSDKService,
    resetCopilotSDKService,
    MCPServerConfig,
    MCPControlOptions,
    SendMessageOptions,
    SDKInvocationResult,
    SDKAvailabilityResult,
    PermissionRequest,
    PermissionRequestResult,
    PermissionHandler,
    SessionPoolConfig,
    DEFAULT_SESSION_POOL_CONFIG,
    approveAllPermissions,
    denyAllPermissions
} from './copilot-sdk-service';
