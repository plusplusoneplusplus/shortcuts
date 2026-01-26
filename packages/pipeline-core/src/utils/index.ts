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
