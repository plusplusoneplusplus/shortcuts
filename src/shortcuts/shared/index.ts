/**
 * Shared utilities module
 * 
 * This module contains shared utilities used by multiple features:
 * - markdown-comments
 * - git-diff-comments
 * 
 * Extracting common code here reduces duplication and ensures
 * consistent behavior across features.
 *
 * NOTE: Core utilities (file I/O, glob, exec, HTTP, text matching, AI response parsing)
 * are now provided by the pipeline-core package. This module re-exports those
 * and adds VS Code-specific utilities.
 */

// ============================================================================
// Re-export from pipeline-core package (core utilities)
// ============================================================================
export {
    // File utilities
    FileOperationResult,
    ReadFileOptions,
    WriteFileOptions,
    YAMLOptions,
    safeExists,
    safeIsDirectory,
    safeIsFile,
    safeReadFile,
    safeWriteFile,
    ensureDirectoryExists,
    safeReadDir,
    safeStats,
    readYAML,
    writeYAML,
    safeCopyFile,
    safeRename,
    safeRemove,
    getFileErrorMessage,
    // Glob utilities
    glob,
    getFilesWithExtension,
    // Exec utilities
    execAsync,
    // HTTP utilities
    HttpResponse,
    httpGet,
    httpDownload,
    httpGetJson,
    // Text matching utilities
    AnchorMatchConfig,
    DEFAULT_ANCHOR_MATCH_CONFIG,
    BaseMatchAnchor,
    hashText,
    levenshteinDistance,
    calculateSimilarity,
    normalizeText,
    splitIntoLines,
    getCharOffset,
    offsetToLineColumn,
    findAllOccurrences,
    scoreMatch,
    findFuzzyMatch,
    extractContext,
    // AI response parser
    extractJSON,
    parseAIResponse
} from '@plusplusoneplusplus/pipeline-core';

// ============================================================================
// VS Code-specific utilities (not in pipeline-core)
// ============================================================================

// HTML line splitting utilities
export * from './highlighted-html-lines';

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

// Prompt files utilities (for VS Code Copilot .prompt.md files)
export {
    getPromptFileLocations,
    getPromptFileNames,
    getPromptFilePaths,
    getPromptFiles
} from './prompt-files-utils';
export type { PromptFile } from './prompt-files-utils';

// Extension-wide logging framework (VS Code-specific, uses OutputChannel)
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

// Workspace utilities for path resolution (VS Code-specific)
export {
    getFirstWorkspaceFolder,
    getWorkspaceRoot,
    getWorkspaceRootOrFallback,
    getWorkspaceRootUri,
    hasWorkspace
} from './workspace-utils';

// Read-only document provider with content strategies (VS Code-specific)
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

// Note: Webview utilities are exported separately via './webview'
// to avoid bundling issues with webview-specific code in the extension bundle

