/**
 * CLI Utilities
 *
 * Shared utility functions for building and executing CLI commands
 * across the AI service module.
 */

import { InteractiveToolType } from './types';

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
 * Build the CLI command string for the specified tool.
 *
 * This is the shared command builder used by both interactive (terminal)
 * and non-interactive (child process) modes.
 *
 * @param tool - The CLI tool to use ('copilot' or 'claude')
 * @param options - Optional command options
 * @param options.prompt - Initial prompt to send
 * @param options.model - Model to use (e.g., 'gpt-4')
 * @param options.platform - Platform override for shell escaping (defaults to process.platform)
 * @returns The complete command string
 */
export function buildCliCommand(
    tool: InteractiveToolType,
    options?: {
        prompt?: string;
        model?: string;
        platform?: NodeJS.Platform;
    }
): string {
    const baseCommand = tool === 'copilot' ? 'copilot' : 'claude';
    const { prompt, model, platform } = options ?? {};
    const modelFlag = model ? ` --model ${model}` : '';

    if (!prompt) {
        return `${baseCommand} ${COPILOT_BASE_FLAGS}${modelFlag}`;
    }

    // Escape the prompt for shell use
    const escapedPrompt = escapeShellArg(prompt, platform);

    return `${baseCommand} ${COPILOT_BASE_FLAGS}${modelFlag} -p ${escapedPrompt}`;
}
