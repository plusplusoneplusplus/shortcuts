/**
 * Provides cross-platform temp file management for passing large data
 * to AI processes without shell escaping issues.
 *
 * Key features:
 * - Cross-platform path handling (Windows/Unix)
 * - Automatic cleanup on success or failure
 * - Unique file naming to avoid collisions
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getAIServiceLogger } from '../ai-logger';

/** Directory name for map-reduce temp files */
const TEMP_DIR_NAME = 'vscode-shortcuts-mapreduce';

export interface TempFileResult {
    /** Absolute path to the temp file */
    filePath: string;
    /** Cleanup function to delete the file */
    cleanup: () => void;
}

/**
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
        getAIServiceLogger().error({ err: error instanceof Error ? error : undefined }, 'Failed to create temp directory');
        return undefined;
    }
}

/**
 * @param extension File extension (default: .json)
 */
export function generateTempFileName(prefix: string = 'results', extension: string = '.json'): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    return `${prefix}_${timestamp}_${random}${extension}`;
}

/**
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
        getAIServiceLogger().error({ err: error instanceof Error ? error : undefined }, 'Failed to write temp file');
        return undefined;
    }
}

export function cleanupTempFile(filePath: string): boolean {
    try {
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
        return true;
    } catch (error) {
        getAIServiceLogger().error({ err: error instanceof Error ? error : undefined }, 'Failed to cleanup temp file');
        return false;
    }
}

/**
 * Useful for cleanup on extension deactivation.
 *
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
        getAIServiceLogger().error({ err: error instanceof Error ? error : undefined }, 'Failed to cleanup temp directory');
    }

    return count;
}

/**
 * @returns File content, or undefined on failure
 */
export function readTempFile(filePath: string): string | undefined {
    try {
        return fs.readFileSync(filePath, { encoding: 'utf8' });
    } catch (error) {
        getAIServiceLogger().error({ err: error instanceof Error ? error : undefined }, 'Failed to read temp file');
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
