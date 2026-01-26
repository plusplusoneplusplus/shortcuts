/**
 * CLI Utilities
 *
 * Shared utility functions for building and executing CLI commands
 * across the AI service module.
 */

import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { InteractiveToolType } from './types';

/** Threshold for prompt length before switching to file-based delivery */
export const PROMPT_LENGTH_THRESHOLD = 500;

/**
 * Pattern matching characters that are problematic for shell escaping.
 * Alphanumeric, spaces, and basic punctuation (. , : ; - _ @) are safe.
 *
 * Problematic characters include:
 * - Quotes: ' " `
 * - Shell variables/expansion: $ ! %
 * - Escape characters: \
 * - Redirection/pipes: < > |
 * - Command separators: &
 * - Grouping: ( ) { } [ ]
 * - Comments/special: # * ? ~
 * - Whitespace: \n \r \t (newlines and tabs)
 */
export const PROBLEMATIC_CHARS_PATTERN = /['"$!%`\\<>|&(){}\[\]#*?~\n\r\t]/;

/** Base flags for copilot CLI commands */
export const COPILOT_BASE_FLAGS = '--allow-all-tools --allow-all-paths --disable-builtin-mcps';

/**
 * Escape a string for safe use in shell commands.
 *
 * Platform-specific escaping:
 * - Windows (cmd.exe): Uses double quotes, escapes internal double quotes by doubling them ("")
 * - Unix/macOS: Uses single quotes, escapes internal single quotes with '\''
 *
 * Windows-specific considerations:
 * - Newlines (\n, \r\n) break cmd.exe commands, so they are converted to literal '\n' strings
 * - Exclamation marks (!) are escaped with caret (^!) to prevent delayed expansion issues
 * - Percent signs (%) are escaped by doubling (%%)
 * - Carriage returns (\r) are removed
 *
 * @param str - The string to escape
 * @param platform - Optional platform override for testing (defaults to process.platform)
 * @returns The escaped string safe for shell use
 */
export function escapeShellArg(str: string, platform?: NodeJS.Platform): string {
    const isWindows = (platform ?? process.platform) === 'win32';

    if (isWindows) {
        // Windows cmd.exe escaping:
        // - Use double quotes to wrap the argument
        // - Escape internal double quotes by doubling them ("")
        // - Escape percent signs by doubling them (%%)
        // - Escape exclamation marks with caret (^!) for delayed expansion safety
        // - Convert newlines to literal '\n' strings since cmd.exe can't handle actual newlines
        // - Remove carriage returns (\r) as they cause issues
        const escaped = str
            .replace(/\r\n/g, '\\n')  // Convert Windows line endings to literal \n first
            .replace(/\r/g, '')       // Remove any remaining carriage returns
            .replace(/\n/g, '\\n')    // Convert Unix newlines to literal \n
            .replace(/%/g, '%%')      // Escape percent signs (environment variable expansion)
            .replace(/!/g, '^!')      // Escape exclamation marks (delayed expansion)
            .replace(/"/g, '""');     // Escape double quotes by doubling

        return `"${escaped}"`;
    } else {
        // Unix/macOS shell escaping:
        // In single quotes, the only character that needs escaping is the single quote itself.
        // We handle it by ending the single-quoted string, adding an escaped single quote,
        // and starting a new single-quoted string: ' -> '\''
        //
        // Newlines, tabs, backslashes, etc. are preserved literally in single quotes,
        // which is exactly what we want for passing to copilot CLI.
        const escaped = str.replace(/'/g, "'\\''");

        // Wrap in single quotes for shell safety
        return `'${escaped}'`;
    }
}

/**
 * Determine if a prompt should use file-based delivery instead of direct shell argument.
 *
 * Uses direct prompt when:
 * - Prompt is short (under PROMPT_LENGTH_THRESHOLD)
 * - AND contains only safe characters (alphanumeric, spaces, basic punctuation)
 *
 * Uses file-based delivery when:
 * - Prompt is long (over PROMPT_LENGTH_THRESHOLD)
 * - OR contains any shell-problematic characters
 *
 * @param prompt - The prompt to evaluate
 * @returns true if file-based delivery should be used, false for direct prompt
 */
export function shouldUseFileDelivery(prompt: string): boolean {
    if (prompt.length > PROMPT_LENGTH_THRESHOLD) {
        return true;
    }
    return PROBLEMATIC_CHARS_PATTERN.test(prompt);
}

/**
 * Write prompt content to a temporary file.
 * The OS handles cleanup via the temp directory lifecycle.
 *
 * File naming includes timestamp and random suffix to avoid collisions.
 * Uses UTF-8 encoding for proper Unicode support.
 *
 * @param prompt - The prompt content to write
 * @returns The absolute path to the created temp file
 */
export function writePromptToTempFile(prompt: string): string {
    const tmpDir = os.tmpdir();
    const timestamp = Date.now();
    const randomSuffix = Math.random().toString(36).slice(2, 8);
    const filename = `copilot-prompt-${timestamp}-${randomSuffix}.txt`;
    const filepath = path.join(tmpDir, filename);
    fs.writeFileSync(filepath, prompt, 'utf-8');
    return filepath;
}

/**
 * Result of building a CLI command, including metadata about the delivery method used.
 */
export interface BuildCliCommandResult {
    /** The complete command string to execute */
    command: string;
    /** The delivery method used for the prompt */
    deliveryMethod: 'direct' | 'file' | 'resume';
    /** Path to the temp file if file-based delivery was used */
    tempFilePath?: string;
}

/**
 * Options for building a CLI command
 */
export interface BuildCliCommandOptions {
    /** Initial prompt to send */
    prompt?: string;
    /** Model to use (e.g., 'gpt-4') */
    model?: string;
    /** Platform override for shell escaping (defaults to process.platform) */
    platform?: NodeJS.Platform;
    /** Session ID to resume (for session resume functionality) */
    resumeSessionId?: string;
}

/**
 * Build the CLI command string for the specified tool.
 *
 * This is the shared command builder used by both interactive (terminal)
 * and non-interactive (child process) modes.
 *
 * Uses smart prompt delivery:
 * - Direct: For short, simple prompts without shell-problematic characters
 * - File-based: For long prompts or those containing special characters
 * - Resume: For resuming an existing session with --resume flag
 *
 * @param tool - The CLI tool to use ('copilot' or 'claude')
 * @param options - Optional command options
 * @returns Object containing the command string and delivery metadata
 */
export function buildCliCommand(
    tool: InteractiveToolType,
    options?: BuildCliCommandOptions
): BuildCliCommandResult {
    const baseCommand = tool === 'copilot' ? 'copilot' : 'claude';
    const { prompt, model, platform, resumeSessionId } = options ?? {};
    const modelFlag = model ? ` --model ${model}` : '';

    // Session resume mode: use --resume flag
    if (resumeSessionId) {
        return {
            command: `${baseCommand} ${COPILOT_BASE_FLAGS}${modelFlag} --resume=${resumeSessionId}`,
            deliveryMethod: 'resume'
        };
    }

    if (!prompt) {
        return {
            command: `${baseCommand} ${COPILOT_BASE_FLAGS}${modelFlag}`,
            deliveryMethod: 'direct'
        };
    }

    // Determine delivery method based on prompt characteristics
    if (shouldUseFileDelivery(prompt)) {
        // File-based delivery: write prompt to temp file
        const tempFilePath = writePromptToTempFile(prompt);

        // Build a simple redirection prompt - the CLI tool will read the file
        // File paths only need escaping for spaces, which is handled by quotes
        const redirectPrompt = `Follow the instructions in ${tempFilePath}`;
        const escapedRedirect = escapeShellArg(redirectPrompt, platform);

        return {
            command: `${baseCommand} ${COPILOT_BASE_FLAGS}${modelFlag} -i ${escapedRedirect}`,
            deliveryMethod: 'file',
            tempFilePath
        };
    }

    // Direct delivery: escape and pass prompt directly
    const escapedPrompt = escapeShellArg(prompt, platform);

    return {
        command: `${baseCommand} ${COPILOT_BASE_FLAGS}${modelFlag} -i ${escapedPrompt}`,
        deliveryMethod: 'direct'
    };
}
