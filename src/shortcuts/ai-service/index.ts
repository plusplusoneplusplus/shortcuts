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
    DEFAULT_PROMPTS,
    ProcessEvent,
    ProcessEventType,
    VALID_MODELS
} from './types';

// Export CLI invoker functions
export {
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

