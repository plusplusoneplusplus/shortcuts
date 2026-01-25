/**
 * Shared utilities module
 * 
 * This module contains shared utilities used by multiple features:
 * - markdown-comments
 * - git-diff-comments
 * 
 * Extracting common code here reduces duplication and ensures
 * consistent behavior across features.
 */

// HTML line splitting utilities
export * from './highlighted-html-lines';

// Text matching utilities for anchor systems
export * from './text-matching';

// Base tree provider for comments
export { CommentsTreeProviderBase } from './comments-tree-provider-base';

// Base AI clarification handler
export {
    getCommentType,
    getResponseLabel,
    handleAIClarificationBase,
    MAX_PROMPT_SIZE,
    toClarificationResult,
    validateAndTruncatePromptBase
} from './ai-clarification-handler-base';
export type { BaseClarificationContext, BaseClarificationResult } from './ai-clarification-handler-base';

// Base prompt generator
export { DEFAULT_BASE_PROMPT_OPTIONS, PromptGeneratorBase } from './prompt-generator-base';
export type { BasePromptGenerationOptions } from './prompt-generator-base';

// Glob utilities for file pattern matching
export { getFilesWithExtension, glob } from './glob-utils';

// Prompt files utilities (for VS Code Copilot .prompt.md files)
export {
    getPromptFileLocations,
    getPromptFileNames,
    getPromptFilePaths,
    getPromptFiles
} from './prompt-files-utils';
export type { PromptFile } from './prompt-files-utils';

// Extension-wide logging framework
export {
    AILogLevel, // Backward compatibility alias
    AIServiceLogger, // Backward compatibility alias
    ExtensionLogger,
    getAIServiceLogger, // Backward compatibility alias
    getExtensionLogger,
    LogCategory,
    LogLevel
} from './extension-logger';
export type { LogEntry, LoggerConfig } from './extension-logger';

// Workspace utilities for path resolution
export {
    getFirstWorkspaceFolder,
    getWorkspaceRoot,
    getWorkspaceRootOrFallback,
    getWorkspaceRootUri,
    hasWorkspace
} from './workspace-utils';

// File I/O utilities with consistent error handling
export {
    ensureDirectoryExists,
    getFileErrorMessage,
    readYAML,
    safeCopyFile,
    safeExists,
    safeIsDirectory,
    safeIsFile,
    safeReadDir,
    safeReadFile,
    safeRemove,
    safeRename,
    safeStats,
    safeWriteFile,
    writeYAML
} from './file-utils';
export type {
    FileOperationResult,
    ReadFileOptions,
    WriteFileOptions,
    YAMLOptions
} from './file-utils';

// Read-only document provider with content strategies
export {
    ContentStrategy,
    createSchemeUri,
    DynamicContentStrategy,
    DynamicContentStrategyOptions,
    FileContentStrategy,
    FileContentStrategyOptions,
    GitContentStrategy,
    GitContentStrategyOptions,
    MemoryContentStrategy,
    MemoryContentStrategyOptions,
    ReadOnlyDocumentProvider,
    registerSchemes,
    SchemeConfig
} from './readonly-document-provider';

// Shell command execution utilities
export { execAsync } from './exec-utils';

// Cross-platform HTTP utilities (uses native Node.js, no external dependencies)
export { httpDownload, httpGet, httpGetJson } from './http-utils';
export type { HttpResponse } from './http-utils';

// Note: Webview utilities are exported separately via './webview'
// to avoid bundling issues with webview-specific code in the extension bundle

