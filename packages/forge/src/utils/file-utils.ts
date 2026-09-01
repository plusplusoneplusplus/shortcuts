/**
 * File Utilities
 *
 * Centralized file I/O utilities with consistent error handling.
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
 * Provides explicit success/failure states with error information.
 */
export interface FileOperationResult<T> {
    success: boolean;
    data?: T;
    error?: Error;
    errorCode?: string;
}

export interface ReadFileOptions {
    /** Encoding to use (default: 'utf8') */
    encoding?: BufferEncoding;
}

export interface WriteFileOptions {
    /** Encoding to use (default: 'utf8') */
    encoding?: BufferEncoding;
    /** Create parent directories if they don't exist (default: true) */
    createDirs?: boolean;
}

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

export function safeIsDirectory(dirPath: string): boolean {
    try {
        const stats = fs.statSync(dirPath);
        return stats.isDirectory();
    } catch {
        return false;
    }
}

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
 * @param withFileTypes - If true, returns Dirent objects with file type info
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
 * @param createDirs - Create parent directories if they don't exist (default: true)
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

// ============================================================================
// Async variants (fs.promises)
// ============================================================================

/**
 * Async version of safeExists — checks if a file or directory exists.
 */
export async function safeExistsAsync(filePath: string): Promise<boolean> {
    try {
        await fs.promises.access(filePath);
        return true;
    } catch {
        return false;
    }
}

/**
 * Async version of safeStats — gets file stats.
 */
export async function safeStatsAsync(filePath: string): Promise<FileOperationResult<fs.Stats>> {
    try {
        const stats = await fs.promises.stat(filePath);
        return { success: true, data: stats };
    } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        const errorCode = extractErrorCode(err);
        return { success: false, error: err, errorCode };
    }
}

/**
 * Async version of safeReadDir — reads a directory and returns its entries.
 */
export async function safeReadDirAsync(
    dirPath: string
): Promise<FileOperationResult<string[]>>;
export async function safeReadDirAsync(
    dirPath: string,
    withFileTypes: true
): Promise<FileOperationResult<fs.Dirent[]>>;
export async function safeReadDirAsync(
    dirPath: string,
    withFileTypes: false
): Promise<FileOperationResult<string[]>>;
export async function safeReadDirAsync(
    dirPath: string,
    withFileTypes?: boolean
): Promise<FileOperationResult<string[] | fs.Dirent[]>> {
    try {
        if (withFileTypes) {
            const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
            return { success: true, data: entries };
        } else {
            const entries = await fs.promises.readdir(dirPath);
            return { success: true, data: entries };
        }
    } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        const errorCode = extractErrorCode(err);
        return { success: false, error: err, errorCode };
    }
}

/**
 * Async version of safeReadFile — reads a file and returns its contents.
 */
export async function safeReadFileAsync(
    filePath: string,
    options: ReadFileOptions = {}
): Promise<FileOperationResult<string>> {
    const { encoding = 'utf8' } = options;

    try {
        const data = await fs.promises.readFile(filePath, encoding);
        return { success: true, data };
    } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        const errorCode = extractErrorCode(err);
        return { success: false, error: err, errorCode };
    }
}

/**
 * Extracts error code from a Node.js error.
 * 
 * @returns The error code or 'UNKNOWN'
 */
function extractErrorCode(error: Error): string {
    // Node.js file system errors have a 'code' property
    const nodeError = error as NodeJS.ErrnoException;
    return nodeError.code || 'UNKNOWN';
}

/**
 * Gets a user-friendly error message for common file operation errors.
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
