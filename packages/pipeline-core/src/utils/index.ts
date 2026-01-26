/**
 * Utils Module - Public API
 * 
 * Exports all utility functions for file operations, HTTP requests,
 * text matching, and AI response parsing.
 */

// File utilities
export {
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
    getFileErrorMessage
} from './file-utils';

// Glob utilities
export {
    glob,
    getFilesWithExtension
} from './glob-utils';

// Exec utilities
export {
    execAsync
} from './exec-utils';

// HTTP utilities
export {
    HttpResponse,
    httpGet,
    httpDownload,
    httpGetJson
} from './http-utils';

// Text matching utilities
export {
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
    extractContext
} from './text-matching';

// AI response parser
export {
    extractJSON,
    parseAIResponse
} from './ai-response-parser';

// Terminal types
export {
    TerminalType,
    InteractiveSessionStatus,
    InteractiveSession,
    ExternalTerminalLaunchOptions,
    ExternalTerminalLaunchResult,
    WindowFocusResult
} from './terminal-types';

// Window focus service
export {
    WindowFocusService,
    getWindowFocusService,
    resetWindowFocusService
} from './window-focus-service';

// External terminal launcher
export {
    ExternalTerminalLauncher,
    getExternalTerminalLauncher,
    resetExternalTerminalLauncher
} from './external-terminal-launcher';

// Process monitor
export {
    Disposable,
    ProcessCheckResult,
    ProcessMonitorOptions,
    ProcessMonitor,
    getProcessMonitor,
    resetProcessMonitor,
    DEFAULT_POLL_INTERVAL_MS
} from './process-monitor';
