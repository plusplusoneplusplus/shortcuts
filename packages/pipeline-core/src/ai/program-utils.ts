/**
 * Program Utilities
 *
 * Pure Node.js utilities for checking program availability and parsing CLI output.
 * No VS Code dependencies.
 */

import { execSync } from 'child_process';
import { getLogger } from '../logger';

/** Cache for program existence checks to avoid repeated lookups */
const programExistsCache = new Map<string, { exists: boolean; path?: string; error?: string }>();

/**
 * Check if a program/command exists in the system PATH.
 * Results are cached to avoid repeated lookups.
 * 
 * Platform-specific implementation:
 * - Windows: Uses `where` command
 * - Unix/macOS: Uses `which` command
 * 
 * @param programName - The name of the program to check (e.g., 'copilot', 'git')
 * @param platform - Optional platform override for testing (defaults to process.platform)
 * @returns Object with exists boolean and optional path where program was found
 */
export function checkProgramExists(
    programName: string,
    platform?: NodeJS.Platform
): { exists: boolean; path?: string; error?: string } {
    // Create cache key that includes platform to handle cross-platform testing
    const cacheKey = `${programName}:${platform ?? process.platform}`;

    // Return cached result if available
    const cached = programExistsCache.get(cacheKey);
    if (cached !== undefined) {
        return cached;
    }

    const isWindows = (platform ?? process.platform) === 'win32';
    const checkCommand = isWindows ? `where ${programName}` : `which ${programName}`;

    let result: { exists: boolean; path?: string; error?: string };

    const logger = getLogger();
    
    try {
        const output = execSync(checkCommand, {
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
            timeout: 5000 // 5 second timeout for the check
        });

        // Parse the result - get the first line (path to the program)
        const programPath = output.trim().split('\n')[0].trim();

        result = {
            exists: true,
            path: programPath
        };
        
        logger.debug('ProgramCheck', `Program '${programName}' found at: ${programPath}`);
    } catch (error) {
        // Command failed - program not found
        const errorMsg = `'${programName}' is not installed or not found in PATH. Please install it first.`;
        result = {
            exists: false,
            error: errorMsg
        };
        
        logger.debug('ProgramCheck', `Program '${programName}' not found: ${errorMsg}`);
    }

    // Cache the result
    programExistsCache.set(cacheKey, result);
    return result;
}

/**
 * Clear the program existence cache.
 * Useful for testing or when the user installs a program and wants to retry.
 * 
 * @param programName - Optional program name to clear. If not provided, clears entire cache.
 */
export function clearProgramExistsCache(programName?: string): void {
    if (programName) {
        // Clear all entries for this program (all platforms)
        for (const key of programExistsCache.keys()) {
            if (key.startsWith(`${programName}:`)) {
                programExistsCache.delete(key);
            }
        }
    } else {
        programExistsCache.clear();
    }
}

/**
 * Parse the copilot CLI output to extract the response text.
 * Removes the status lines, tool operations, and usage statistics.
 * 
 * @param output - Raw output from copilot CLI
 * @returns The extracted response text
 */
export function parseCopilotOutput(output: string): string {
    const lines = output.split('\n');
    const resultLines: string[] = [];
    let inContent = false;

    for (const line of lines) {
        // Skip ANSI escape codes and clean the line
        const cleanLine = line.replace(/\x1b\[[0-9;]*m/g, '').trim();

        // Skip empty lines at the start
        if (!inContent && cleanLine === '') {
            continue;
        }

        // Skip copilot status/operation lines
        // ✓ = success, ✗ = failure, └ = tree branch (sub-info)
        if (cleanLine.startsWith('✓') ||
            cleanLine.startsWith('✗') ||
            cleanLine.startsWith('└') ||
            cleanLine.startsWith('├')) {
            continue;
        }

        // Skip error/info messages from copilot tools
        if (cleanLine.startsWith('Invalid session') ||
            cleanLine.includes('session ID') ||
            cleanLine.startsWith('Error:') ||
            cleanLine.startsWith('Warning:')) {
            continue;
        }

        // Skip lines that look like tool invocations or file operations
        if (cleanLine.match(/^(Read|Glob|Search|List|Edit|Write|Delete|Run)\s/i)) {
            continue;
        }

        // Stop at usage statistics
        if (cleanLine.startsWith('Total usage') ||
            cleanLine.startsWith('Total duration') ||
            cleanLine.startsWith('Total code changes') ||
            cleanLine.startsWith('Usage by model')) {
            break;
        }

        // Start capturing content
        inContent = true;
        resultLines.push(cleanLine);
    }

    // Trim trailing empty lines
    while (resultLines.length > 0 && resultLines[resultLines.length - 1] === '') {
        resultLines.pop();
    }

    return resultLines.join('\n').trim();
}
