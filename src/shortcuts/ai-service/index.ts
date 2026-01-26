/**
 * AI Service Module
 *
 * Standalone, reusable service for invoking AI tools (Copilot CLI, etc.)
 * This module provides generic AI invocation capabilities that can be used
 * by any feature in the extension.
 *
 * Core AI functionality (CopilotSDKService, SessionPool, CLI utilities) is now
 * provided by the pipeline-core package. This module re-exports those types
 * and adds VS Code-specific functionality.
 */

// ============================================================================
// Re-export from pipeline-core package (core AI functionality)
// ============================================================================
export {
    // AI Types
    AIInvocationResult,
    AIBackendType,
    AIModel,
    VALID_MODELS,
    DEFAULT_PROMPTS,
    InteractiveToolType,
    // Session Pool
    SessionPool,
    IPoolableSession,
    SessionFactory,
    SessionPoolOptions,
    SessionPoolStats,
    // CLI Utilities
    PROMPT_LENGTH_THRESHOLD,
    PROBLEMATIC_CHARS_PATTERN,
    COPILOT_BASE_FLAGS,
    escapeShellArg,
    shouldUseFileDelivery,
    writePromptToTempFile,
    buildCliCommand,
    BuildCliCommandResult,
    BuildCliCommandOptions,
    // Copilot SDK Service
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
} from '@anthropic-ai/pipeline-core';

// ============================================================================
// VS Code-specific types (not in pipeline-core)
// ============================================================================
export {
    AIProcess,
    AIProcessStatus,
    AIProcessType,
    AIToolType,
    // Generic metadata types (preferred for new features)
    GenericProcessMetadata,
    GenericGroupMetadata,
    TypedProcessOptions,
    ProcessGroupOptions,
    CompleteGroupOptions,
    // Interface for dependency injection
    IAIProcessManager,
    ProcessCounts,
    // Process monitoring types
    ProcessCheckResult,
    // Legacy types (kept for backward compatibility)
    CodeReviewGroupMetadata,
    CodeReviewProcessMetadata,
    deserializeProcess,
    DiscoveryProcessMetadata,
    ProcessEvent,
    ProcessEventType,
    SerializedAIProcess,
    serializeProcess,
    // Interactive session types
    ExternalTerminalLaunchOptions,
    ExternalTerminalLaunchResult,
    InteractiveSession,
    InteractiveSessionEvent,
    InteractiveSessionEventType,
    InteractiveSessionStatus,
    TerminalType
} from './types';

// Export CLI invoker functions (VS Code-specific, uses vscode.workspace.getConfiguration)
export {
    checkProgramExists,
    clearProgramExistsCache,
    copyToClipboard,
    getAIModelSetting,
    getAIToolSetting,
    getPromptTemplate,
    invokeCopilotCLI,
    invokeCopilotCLITerminal,
    parseCopilotOutput
} from './copilot-cli-invoker';

// Export process manager
export { AIProcessManager } from './ai-process-manager';

// Export mock process manager for testing
export { 
    MockAIProcessManager, 
    MockAIProcessManagerConfig,
    ProcessCall,
    createMockAIProcessManager 
} from './mock-ai-process-manager';

// Export tree data provider
export { AIProcessItem, AIProcessTreeDataProvider, AIProcessTreeItem } from './ai-process-tree-provider';

// Export interactive session tree items
export { InteractiveSessionItem, InteractiveSessionSectionItem } from './interactive-session-tree-item';

// Export document provider for read-only process viewing
export { AI_PROCESS_SCHEME, AIProcessDocumentProvider } from './ai-process-document-provider';

// Export AI command types and registry
export {
    AICommand,
    AICommandMode,
    AICommandsConfig,
    DEFAULT_AI_COMMANDS,
    serializeCommand,
    serializeCommands,
    SerializedAICommand,
    SerializedAIMenuConfig
} from './ai-command-types';

export { AICommandRegistry, getAICommandRegistry } from './ai-command-registry';

// Export prompt builder (VS Code-specific, uses context from editor)
export { buildPrompt, getAvailableVariables, PromptContext, usesTemplateVariables } from './prompt-builder';

// Export AI Service logger (backward compatibility - use shared/extension-logger for new code)
export { AILogLevel, AIServiceLogger, getAIServiceLogger, LogLevel, ExtensionLogger, getExtensionLogger, LogCategory } from './ai-service-logger';
export type { AILogEntry } from './ai-service-logger';

// Export external terminal launcher
export {
    ExternalTerminalLauncher,
    getExternalTerminalLauncher,
    resetExternalTerminalLauncher
} from './external-terminal-launcher';

// Export interactive session manager
export {
    getInteractiveSessionManager,
    InteractiveSessionManager,
    resetInteractiveSessionManager,
    StartSessionOptions
} from './interactive-session-manager';

// Export process monitor
export {
    DEFAULT_POLL_INTERVAL_MS,
    getProcessMonitor,
    ProcessMonitor,
    ProcessMonitorOptions,
    resetProcessMonitor
} from './process-monitor';

// Export window focus service (Windows-only functionality)
export {
    getWindowFocusService,
    resetWindowFocusService,
    WindowFocusResult,
    WindowFocusService
} from './window-focus-service';

// Export AI config helpers (VS Code-specific)
export {
    getAIBackendSetting,
    getSDKMaxSessionsSetting,
    getSDKSessionTimeoutSetting
} from './ai-config-helpers';

// Export AI invoker factory for unified SDK/CLI fallback handling
export {
    createAIInvoker,
    invokeAIWithFallback,
    AIInvokerFactoryOptions,
    AIInvokerResult,
    AIInvoker
} from './ai-invoker-factory';
