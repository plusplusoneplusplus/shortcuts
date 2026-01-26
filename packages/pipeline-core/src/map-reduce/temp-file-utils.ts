/**
 * Temp File Utilities for Map-Reduce
 *
 * Provides cross-platform temp file management for passing large data
 * to AI processes without shell escaping issues.
 *
 * Key features:
 * - Cross-platform path handling (Windows/Unix)
 * - Automatic cleanup on success or failure
 * - Unique file naming to avoid collisions
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/** Directory name for map-reduce temp files */
const TEMP_DIR_NAME = 'vscode-shortcuts-mapreduce';

/**
 * Result of creating a temp file
 */
export interface TempFileResult {
    /** Absolute path to the temp file */
    filePath: string;
    /** Cleanup function to delete the file */
    cleanup: () => void;
}

/**
 * Ensure the temp directory exists
 * @returns The temp directory path, or undefined if creation failed
 */
export function ensureTempDir(): string | undefined {
    const tempDir = path.join(os.tmpdir(), TEMP_DIR_NAME);
    try {
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }
        return tempDir;
    } catch (error) {
        console.error('Failed to create temp directory:', error);
        return undefined;
    }
}

/**
 * Generate a unique temp file name
 * @param prefix Optional prefix for the filename
 * @param extension File extension (default: .json)
 * @returns Unique filename
 */
export function generateTempFileName(prefix: string = 'results', extension: string = '.json'): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    return `${prefix}_${timestamp}_${random}${extension}`;
}

/**
 * Write content to a temp file
 *
 * @param content The content to write
 * @param prefix Optional prefix for the filename
 * @param extension File extension (default: .json)
 * @returns TempFileResult with file path and cleanup function, or undefined on failure
 */
export function writeTempFile(
    content: string,
    prefix: string = 'results',
    extension: string = '.json'
): TempFileResult | undefined {
    const tempDir = ensureTempDir();
    if (!tempDir) {
        return undefined;
    }

    const fileName = generateTempFileName(prefix, extension);
    const filePath = path.join(tempDir, fileName);

    try {
        // Write with UTF-8 encoding - works on both Windows and Unix
        fs.writeFileSync(filePath, content, { encoding: 'utf8' });

        return {
            filePath,
            cleanup: () => cleanupTempFile(filePath)
        };
    } catch (error) {
        console.error('Failed to write temp file:', error);
        return undefined;
    }
}

/**
 * Clean up a temp file
 * @param filePath Path to the file to delete
 * @returns true if deleted successfully, false otherwise
 */
export function cleanupTempFile(filePath: string): boolean {
    try {
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
        return true;
    } catch (error) {
        console.error('Failed to cleanup temp file:', error);
        return false;
    }
}

/**
 * Clean up all temp files in the temp directory
 * Useful for cleanup on extension deactivation
 * @returns Number of files cleaned up
 */
export function cleanupAllTempFiles(): number {
    const tempDir = path.join(os.tmpdir(), TEMP_DIR_NAME);
    let count = 0;

    try {
        if (!fs.existsSync(tempDir)) {
            return 0;
        }

        const files = fs.readdirSync(tempDir);
        for (const file of files) {
            const filePath = path.join(tempDir, file);
            try {
                fs.unlinkSync(filePath);
                count++;
            } catch {
                // Ignore individual file deletion errors
            }
        }
    } catch (error) {
        console.error('Failed to cleanup temp directory:', error);
    }

    return count;
}

/**
 * Read content from a temp file
 * @param filePath Path to the file to read
 * @returns File content, or undefined on failure
 */
export function readTempFile(filePath: string): string | undefined {
    try {
        return fs.readFileSync(filePath, { encoding: 'utf8' });
    } catch (error) {
        console.error('Failed to read temp file:', error);
        return undefined;
    }
}

/**
 * Check if a path looks like a temp file created by this module
 * @param filePath Path to check
 * @returns true if it's a temp file path
 */
export function isTempFilePath(filePath: string): boolean {
    const tempDir = path.join(os.tmpdir(), TEMP_DIR_NAME);
    return filePath.startsWith(tempDir);
}

/**
 * Get the temp directory path (for testing)
 * @returns The temp directory path
 */
export function getTempDirPath(): string {
    return path.join(os.tmpdir(), TEMP_DIR_NAME);
}
