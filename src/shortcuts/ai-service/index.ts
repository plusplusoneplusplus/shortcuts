/**
 * AI Service Module
 *
 * Standalone, reusable service for invoking AI tools (Copilot CLI, etc.)
 * This module provides generic AI invocation capabilities that can be used
 * by any feature in the extension.
 */

// Export types
export {
    AIInvocationResult,
    AIModel,
    AIProcess,
    AIProcessStatus,
    AIProcessType,
    AIToolType,
    AIBackendType,
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
    DEFAULT_PROMPTS, deserializeProcess, DiscoveryProcessMetadata,
    ProcessEvent,
    ProcessEventType,
    SerializedAIProcess, serializeProcess, VALID_MODELS
} from './types';

// Export CLI invoker functions
export {
    checkProgramExists,
    clearProgramExistsCache,
    copyToClipboard,
    escapeShellArg,
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
    DEFAULT_AI_COMMANDS, serializeCommand,
    serializeCommands, SerializedAICommand,
    SerializedAIMenuConfig
} from './ai-command-types';

export { AICommandRegistry, getAICommandRegistry } from './ai-command-registry';

// Export prompt builder
export { buildPrompt, getAvailableVariables, PromptContext, usesTemplateVariables } from './prompt-builder';

// Export AI Service logger (backward compatibility - use shared/extension-logger for new code)
export { AILogLevel, AIServiceLogger, getAIServiceLogger, LogLevel, ExtensionLogger, getExtensionLogger, LogCategory } from './ai-service-logger';
export type { AILogEntry } from './ai-service-logger';

// Export interactive session types
export {
    ExternalTerminalLaunchOptions,
    ExternalTerminalLaunchResult,
    InteractiveSession,
    InteractiveSessionEvent,
    InteractiveSessionEventType,
    InteractiveSessionStatus,
    InteractiveToolType,
    TerminalType
} from './types';

// Export CLI utilities
export {
    buildCliCommand,
    COPILOT_BASE_FLAGS,
    PROMPT_LENGTH_THRESHOLD,
    PROBLEMATIC_CHARS_PATTERN,
    shouldUseFileDelivery,
    writePromptToTempFile,
    BuildCliCommandResult
} from './cli-utils';

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

// Export Copilot SDK service
export {
    CopilotSDKService,
    getCopilotSDKService,
    resetCopilotSDKService,
    getAIBackendSetting,
    getSDKMaxSessionsSetting,
    getSDKSessionTimeoutSetting,
    SendMessageOptions,
    SDKInvocationResult,
    SDKAvailabilityResult
} from './copilot-sdk-service';
