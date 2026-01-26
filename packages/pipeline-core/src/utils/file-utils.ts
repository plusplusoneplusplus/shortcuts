/**
 * File Utilities
 *
 * Centralized file I/O utilities with consistent error handling.
 * Cross-platform compatible (Linux/Mac/Windows).
 * 
 * These utilities provide:
 * - Consistent error handling across all file operations
 * - Type-safe return values with explicit error states
 * - YAML file reading/writing with proper parsing
 * - Directory operations with recursive support
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

/**
 * Result type for file operations that may fail.
 * Provides explicit success/failure states with error information.
 */
export interface FileOperationResult<T> {
    success: boolean;
    data?: T;
    error?: Error;
    errorCode?: string;
}

/**
 * Options for file reading operations
 */
export interface ReadFileOptions {
    /** Encoding to use (default: 'utf8') */
    encoding?: BufferEncoding;
}

/**
 * Options for file writing operations
 */
export interface WriteFileOptions {
    /** Encoding to use (default: 'utf8') */
    encoding?: BufferEncoding;
    /** Create parent directories if they don't exist (default: true) */
    createDirs?: boolean;
}

/**
 * Options for YAML operations
 */
export interface YAMLOptions {
    /** Indentation level (default: 2) */
    indent?: number;
    /** Line width for wrapping (-1 for no wrap, default: -1) */
    lineWidth?: number;
    /** Disable YAML references (default: true) */
    noRefs?: boolean;
}

/**
 * Safely checks if a file or directory exists.
 * 
 * @param filePath - Path to check
 * @returns True if the path exists, false otherwise
 * 
 * @example
 * ```typescript
 * if (safeExists('/path/to/file.txt')) {
 *     // File exists
 * }
 * ```
 */
export function safeExists(filePath: string): boolean {
    try {
        return fs.existsSync(filePath);
    } catch {
        // If we can't even check existence, treat as non-existent
        return false;
    }
}

/**
 * Safely checks if a path is a directory.
 * 
 * @param dirPath - Path to check
 * @returns True if the path is a directory, false otherwise
 */
export function safeIsDirectory(dirPath: string): boolean {
    try {
        const stats = fs.statSync(dirPath);
        return stats.isDirectory();
    } catch {
        return false;
    }
}

/**
 * Safely checks if a path is a file.
 * 
 * @param filePath - Path to check
 * @returns True if the path is a file, false otherwise
 */
export function safeIsFile(filePath: string): boolean {
    try {
        const stats = fs.statSync(filePath);
        return stats.isFile();
    } catch {
        return false;
    }
}

/**
 * Safely reads a file and returns its contents.
 * 
 * @param filePath - Path to the file to read
 * @param options - Optional read options
 * @returns FileOperationResult with the file contents or error information
 * 
 * @example
 * ```typescript
 * const result = safeReadFile('/path/to/file.txt');
 * if (result.success) {
 *     console.log(result.data);
 * } else {
 *     console.error('Failed to read:', result.error?.message);
 * }
 * ```
 */
export function safeReadFile(
    filePath: string,
    options: ReadFileOptions = {}
): FileOperationResult<string> {
    const { encoding = 'utf8' } = options;

    try {
        const data = fs.readFileSync(filePath, encoding);
        return { success: true, data };
    } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        const errorCode = extractErrorCode(err);
        return { success: false, error: err, errorCode };
    }
}

/**
 * Safely writes content to a file.
 * 
 * @param filePath - Path to the file to write
 * @param content - Content to write
 * @param options - Optional write options
 * @returns FileOperationResult indicating success or failure
 * 
 * @example
 * ```typescript
 * const result = safeWriteFile('/path/to/file.txt', 'Hello, World!');
 * if (!result.success) {
 *     console.error('Failed to write:', result.error?.message);
 * }
 * ```
 */
export function safeWriteFile(
    filePath: string,
    content: string,
    options: WriteFileOptions = {}
): FileOperationResult<void> {
    const { encoding = 'utf8', createDirs = true } = options;

    try {
        // Ensure parent directory exists if requested
        if (createDirs) {
            const dirResult = ensureDirectoryExists(path.dirname(filePath));
            if (!dirResult.success) {
                return dirResult;
            }
        }

        fs.writeFileSync(filePath, content, encoding);
        return { success: true };
    } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        const errorCode = extractErrorCode(err);
        return { success: false, error: err, errorCode };
    }
}

/**
 * Ensures a directory exists, creating it recursively if necessary.
 * 
 * @param dirPath - Path to the directory
 * @returns FileOperationResult indicating success or failure
 * 
 * @example
 * ```typescript
 * const result = ensureDirectoryExists('/path/to/new/directory');
 * if (result.success) {
 *     // Directory now exists
 * }
 * ```
 */
export function ensureDirectoryExists(dirPath: string): FileOperationResult<void> {
    try {
        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
        }
        return { success: true };
    } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        const errorCode = extractErrorCode(err);
        return { success: false, error: err, errorCode };
    }
}

/**
 * Safely reads a directory and returns its entries.
 * 
 * @param dirPath - Path to the directory to read
 * @param withFileTypes - If true, returns Dirent objects with file type info
 * @returns FileOperationResult with directory entries or error information
 * 
 * @example
 * ```typescript
 * const result = safeReadDir('/path/to/directory');
 * if (result.success) {
 *     result.data?.forEach(entry => console.log(entry));
 * }
 * ```
 */
export function safeReadDir(
    dirPath: string
): FileOperationResult<string[]>;
export function safeReadDir(
    dirPath: string,
    withFileTypes: true
): FileOperationResult<fs.Dirent[]>;
export function safeReadDir(
    dirPath: string,
    withFileTypes: false
): FileOperationResult<string[]>;
export function safeReadDir(
    dirPath: string,
    withFileTypes?: boolean
): FileOperationResult<string[] | fs.Dirent[]> {
    try {
        if (withFileTypes) {
            const entries = fs.readdirSync(dirPath, { withFileTypes: true });
            return { success: true, data: entries };
        } else {
            const entries = fs.readdirSync(dirPath);
            return { success: true, data: entries };
        }
    } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        const errorCode = extractErrorCode(err);
        return { success: false, error: err, errorCode };
    }
}

/**
 * Safely gets file stats.
 * 
 * @param filePath - Path to the file
 * @returns FileOperationResult with fs.Stats or error information
 */
export function safeStats(filePath: string): FileOperationResult<fs.Stats> {
    try {
        const stats = fs.statSync(filePath);
        return { success: true, data: stats };
    } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        const errorCode = extractErrorCode(err);
        return { success: false, error: err, errorCode };
    }
}

/**
 * Reads and parses a YAML file.
 * 
 * @param filePath - Path to the YAML file
 * @returns FileOperationResult with parsed YAML content or error information
 * 
 * @example
 * ```typescript
 * interface Config {
 *     name: string;
 *     version: number;
 * }
 * 
 * const result = readYAML<Config>('/path/to/config.yaml');
 * if (result.success && result.data) {
 *     console.log(result.data.name);
 * }
 * ```
 */
export function readYAML<T = unknown>(filePath: string): FileOperationResult<T> {
    const readResult = safeReadFile(filePath);
    if (!readResult.success) {
        return { 
            success: false, 
            error: readResult.error, 
            errorCode: readResult.errorCode 
        };
    }

    try {
        const parsed = yaml.load(readResult.data!) as T;
        return { success: true, data: parsed };
    } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        // Enhance error message for YAML parse errors
        const yamlError = new Error(`YAML parse error in ${filePath}: ${err.message}`);
        return { success: false, error: yamlError, errorCode: 'YAML_PARSE_ERROR' };
    }
}

/**
 * Writes data to a YAML file.
 * 
 * @param filePath - Path to the YAML file
 * @param data - Data to serialize and write
 * @param options - Optional YAML serialization options
 * @returns FileOperationResult indicating success or failure
 * 
 * @example
 * ```typescript
 * const config = { name: 'MyApp', version: 1 };
 * const result = writeYAML('/path/to/config.yaml', config);
 * if (!result.success) {
 *     console.error('Failed to write YAML:', result.error?.message);
 * }
 * ```
 */
export function writeYAML<T>(
    filePath: string,
    data: T,
    options: YAMLOptions = {}
): FileOperationResult<void> {
    const { indent = 2, lineWidth = -1, noRefs = true } = options;

    try {
        const yamlContent = yaml.dump(data, { indent, lineWidth, noRefs });
        return safeWriteFile(filePath, yamlContent);
    } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        const yamlError = new Error(`YAML serialization error: ${err.message}`);
        return { success: false, error: yamlError, errorCode: 'YAML_DUMP_ERROR' };
    }
}

/**
 * Safely copies a file from source to destination.
 * 
 * @param srcPath - Source file path
 * @param destPath - Destination file path
 * @param createDirs - Create parent directories if they don't exist (default: true)
 * @returns FileOperationResult indicating success or failure
 */
export function safeCopyFile(
    srcPath: string,
    destPath: string,
    createDirs: boolean = true
): FileOperationResult<void> {
    try {
        if (createDirs) {
            const dirResult = ensureDirectoryExists(path.dirname(destPath));
            if (!dirResult.success) {
                return dirResult;
            }
        }

        fs.copyFileSync(srcPath, destPath);
        return { success: true };
    } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        const errorCode = extractErrorCode(err);
        return { success: false, error: err, errorCode };
    }
}

/**
 * Safely renames/moves a file or directory.
 * 
 * @param oldPath - Current path
 * @param newPath - New path
 * @returns FileOperationResult indicating success or failure
 */
export function safeRename(
    oldPath: string,
    newPath: string
): FileOperationResult<void> {
    try {
        fs.renameSync(oldPath, newPath);
        return { success: true };
    } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        const errorCode = extractErrorCode(err);
        return { success: false, error: err, errorCode };
    }
}

/**
 * Safely removes a file or directory.
 * 
 * @param targetPath - Path to remove
 * @param options - Options for removal
 * @returns FileOperationResult indicating success or failure
 */
export function safeRemove(
    targetPath: string,
    options: { recursive?: boolean; force?: boolean } = {}
): FileOperationResult<void> {
    const { recursive = false, force = false } = options;

    try {
        fs.rmSync(targetPath, { recursive, force });
        return { success: true };
    } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        const errorCode = extractErrorCode(err);
        return { success: false, error: err, errorCode };
    }
}

/**
 * Extracts error code from a Node.js error.
 * 
 * @param error - The error to extract code from
 * @returns The error code or 'UNKNOWN'
 */
function extractErrorCode(error: Error): string {
    // Node.js file system errors have a 'code' property
    const nodeError = error as NodeJS.ErrnoException;
    return nodeError.code || 'UNKNOWN';
}

/**
 * Gets a user-friendly error message for common file operation errors.
 * 
 * @param errorCode - The error code from a file operation
 * @param context - Optional context about what operation was being performed
 * @returns A user-friendly error message
 */
export function getFileErrorMessage(errorCode: string, context?: string): string {
    const prefix = context ? `${context}: ` : '';
    
    switch (errorCode) {
        case 'ENOENT':
            return `${prefix}File or directory not found`;
        case 'EACCES':
        case 'EPERM':
            return `${prefix}Permission denied`;
        case 'EEXIST':
            return `${prefix}File or directory already exists`;
        case 'ENOTDIR':
            return `${prefix}Not a directory`;
        case 'EISDIR':
            return `${prefix}Is a directory`;
        case 'ENOSPC':
            return `${prefix}No space left on device`;
        case 'EMFILE':
        case 'ENFILE':
            return `${prefix}Too many open files`;
        case 'EBUSY':
            return `${prefix}Resource busy or locked`;
        case 'YAML_PARSE_ERROR':
            return `${prefix}Invalid YAML syntax`;
        case 'YAML_DUMP_ERROR':
            return `${prefix}Failed to serialize data to YAML`;
        default:
            return `${prefix}File operation failed`;
    }
}
