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
    AIToolType,
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

// Export tree data provider
export { AIProcessItem, AIProcessTreeDataProvider } from './ai-process-tree-provider';

// Export document provider for read-only process viewing
export { AI_PROCESS_SCHEME, AIProcessDocumentProvider } from './ai-process-document-provider';

// Export AI command types and registry
export {
    AICommand,
    AICommandsConfig,
    DEFAULT_AI_COMMANDS, serializeCommand,
    serializeCommands, SerializedAICommand
} from './ai-command-types';

export { AICommandRegistry, getAICommandRegistry } from './ai-command-registry';

// Export prompt builder
export { buildPrompt, getAvailableVariables, PromptContext, usesTemplateVariables } from './prompt-builder';

