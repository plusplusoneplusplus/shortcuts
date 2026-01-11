/**
 * Copilot CLI Invoker
 * 
 * Core CLI invocation logic for the AI service.
 * Handles shell escaping, command building, output parsing, and CLI execution.
 */

import { exec, execSync } from 'child_process';
import * as vscode from 'vscode';
import { IAIProcessManager } from './types';
import { getExtensionLogger } from './ai-service-logger';
import { AIInvocationResult, AIModel, AIToolType, VALID_MODELS } from './types';

/** Timeout for copilot CLI execution in milliseconds */
const COPILOT_TIMEOUT_MS = 300000; // 5 minutes

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

    const logger = getExtensionLogger();
    
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
        
        logger.logProgramCheck(programName, true, programPath);
    } catch (error) {
        // Command failed - program not found
        const errorMsg = `'${programName}' is not installed or not found in PATH. Please install it first.`;
        result = {
            exists: false,
            error: errorMsg
        };
        
        logger.logProgramCheck(programName, false, undefined, errorMsg);
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
 * Get the configured AI tool from VS Code settings.
 * 
 * @returns The configured AI tool type, defaults to 'copilot-cli'
 */
export function getAIToolSetting(): AIToolType {
    const config = vscode.workspace.getConfiguration('workspaceShortcuts.aiService');
    const tool = config.get<string>('tool', 'copilot-cli');

    // Validate the tool setting
    if (tool === 'copilot-cli' || tool === 'clipboard') {
        return tool;
    }

    // Default to copilot-cli if invalid value
    return 'copilot-cli';
}

/**
 * Get the configured AI model from VS Code settings.
 * 
 * @returns The configured AI model, or undefined if using default
 */
export function getAIModelSetting(): AIModel | undefined {
    const config = vscode.workspace.getConfiguration('workspaceShortcuts.aiService');
    const model = config.get<string>('model', '');

    // Return undefined if empty (use default) or invalid
    if (!model || !VALID_MODELS.includes(model as AIModel)) {
        return undefined;
    }

    return model as AIModel;
}

/**
 * Get the configured working directory from VS Code settings.
 * Supports {workspaceFolder} variable expansion.
 * 
 * @param workspaceRoot - The workspace root path for variable expansion
 * @returns The configured working directory, or {workspaceFolder}/src if it exists, or workspace root
 */
export function getWorkingDirectory(workspaceRoot: string): string {
    const config = vscode.workspace.getConfiguration('workspaceShortcuts.aiService');
    const workingDir = config.get<string>('workingDirectory', '');

    if (!workingDir || workingDir.trim() === '') {
        // Default to {workspaceFolder}/src if src directory exists
        const fs = require('fs');
        const path = require('path');
        const srcPath = path.join(workspaceRoot, 'src');

        if (fs.existsSync(srcPath) && fs.statSync(srcPath).isDirectory()) {
            return srcPath;
        }

        return workspaceRoot;
    }

    // Expand {workspaceFolder} variable
    const expanded = workingDir.replace(/\{workspaceFolder\}/g, workspaceRoot);

    // Handle relative paths (if not absolute and not starting with {workspaceFolder})
    if (!expanded.startsWith('/') && !expanded.match(/^[A-Za-z]:/)) {
        return require('path').join(workspaceRoot, expanded);
    }

    return expanded;
}

/**
 * Get the configured prompt template from VS Code settings.
 * Falls back to default prompts if not configured.
 * 
 * @param promptType - The type of prompt to retrieve
 * @returns The configured or default prompt template
 */
export function getPromptTemplate(promptType: 'clarify' | 'goDeeper' | 'customDefault'): string {
    const config = vscode.workspace.getConfiguration('workspaceShortcuts.aiService.prompts');
    const prompt = config.get<string>(promptType);

    // Return configured prompt or fall back to default
    if (prompt && prompt.trim().length > 0) {
        return prompt.trim();
    }

    // Default prompts
    const defaults: Record<string, string> = {
        clarify: 'Please clarify',
        goDeeper: 'Please provide an in-depth explanation and analysis of',
        customDefault: 'Please explain'
    };

    return defaults[promptType];
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

/**
 * Build the Copilot CLI command with the given prompt and optional model.
 * 
 * @param prompt - The prompt to send to Copilot CLI
 * @param overrideModel - Optional model to use instead of the configured default
 * @returns The complete command string
 */
function buildCopilotCommand(prompt: string, overrideModel?: string): string {
    const escapedPrompt = escapeShellArg(prompt);
    // Use override model if provided, otherwise use configured model from settings
    const model = overrideModel || getAIModelSetting();

    const baseFlags = '--allow-all-tools --allow-all-paths --disable-builtin-mcps';

    if (model) {
        return `copilot ${baseFlags} --model ${model} -p ${escapedPrompt}`;
    }

    return `copilot ${baseFlags} -p ${escapedPrompt}`;
}

/**
 * Copy text to clipboard.
 * 
 * @param text - The text to copy
 */
export async function copyToClipboard(text: string): Promise<void> {
    await vscode.env.clipboard.writeText(text);
}

/**
 * Invoke the Copilot CLI with the prompt in a terminal.
 * This is the fallback method that doesn't capture output.
 * 
 * @param prompt - The prompt to send to Copilot CLI
 * @param workspaceRoot - Optional workspace root for working directory configuration
 * @param model - Optional model to use (overrides settings)
 * @returns True if the terminal was created successfully
 */
export async function invokeCopilotCLITerminal(prompt: string, workspaceRoot?: string, model?: string): Promise<boolean> {
    const logger = getExtensionLogger();
    
    // Check if copilot CLI is installed before attempting to run
    const programCheck = checkProgramExists('copilot');
    if (!programCheck.exists) {
        const errorMsg = 'Copilot CLI is not installed or not found in PATH. Please install it with: npm install -g @githubnext/github-copilot-cli';
        logger.logAIProcessLaunchFailure('Copilot CLI not installed', undefined, {
            programCheck: programCheck.error
        });
        vscode.window.showErrorMessage(errorMsg, 'Copy Install Command').then(selection => {
            if (selection === 'Copy Install Command') {
                vscode.env.clipboard.writeText('npm install -g @githubnext/github-copilot-cli');
            }
        });
        return false;
    }

    try {
        // Get the configured working directory if workspace root is provided
        const cwd = workspaceRoot ? getWorkingDirectory(workspaceRoot) : undefined;

        // Build the copilot command with escaped prompt and optional model
        const command = buildCopilotCommand(prompt, model);
        
        logger.logAIProcessLaunch(prompt, cwd || 'default', command);

        // Create a new terminal for the Copilot CLI
        const terminal = vscode.window.createTerminal({
            name: 'Copilot AI',
            hideFromUser: false,
            cwd: cwd
        });

        // Show the terminal and send the command
        terminal.show(true);
        terminal.sendText(command);

        logger.logOperationComplete('AI', 'launch terminal', undefined, {
            terminalName: 'Copilot AI',
            workingDirectory: cwd
        });

        return true;
    } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        logger.logAIProcessLaunchFailure('Failed to create terminal', err, {
            workspaceRoot
        });
        return false;
    }
}

/**
 * Invoke the Copilot CLI and capture its output.
 * Runs copilot as a child process in the configured working directory.
 *
 * @param prompt - The prompt to send to Copilot CLI
 * @param workspaceRoot - The workspace root directory (used for variable expansion)
 * @param processManager - Optional process manager for tracking
 * @param existingProcessId - Optional existing process ID to use
 * @param model - Optional model to use (overrides settings, e.g., from rule front matter)
 * @returns The invocation result with the AI response
 */
export async function invokeCopilotCLI(
    prompt: string,
    workspaceRoot: string,
    processManager?: IAIProcessManager,
    existingProcessId?: string,
    model?: string
): Promise<AIInvocationResult> {
    const logger = getExtensionLogger();
    let processId: string | undefined = existingProcessId;
    const startTime = Date.now();

    // Check if copilot CLI is installed before attempting to run
    const programCheck = checkProgramExists('copilot');
    if (!programCheck.exists) {
        const errorMsg = 'Copilot CLI is not installed or not found in PATH. Please install it with: npm install -g @githubnext/github-copilot-cli';
        logger.logAIProcessLaunchFailure('Copilot CLI not installed', undefined, {
            programCheck: programCheck.error,
            existingProcessId
        });
        vscode.window.showErrorMessage(errorMsg, 'Copy Install Command').then(selection => {
            if (selection === 'Copy Install Command') {
                vscode.env.clipboard.writeText('npm install -g @githubnext/github-copilot-cli');
            }
        });
        if (processManager && existingProcessId) {
            processManager.failProcess(existingProcessId, errorMsg);
        }
        return {
            success: false,
            error: errorMsg
        };
    }

    try {
        // Build the copilot command with escaped prompt and optional model
        const command = buildCopilotCommand(prompt, model);

        // Get the configured working directory
        const cwd = getWorkingDirectory(workspaceRoot);
        
        logger.logAIProcessLaunch(prompt, cwd, command);

        // Show progress notification
        return await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Getting AI response...',
            cancellable: true
        }, async (progress, token) => {
            return new Promise<AIInvocationResult>((resolve) => {
                const childProcess = exec(command, {
                    cwd: cwd,
                    timeout: COPILOT_TIMEOUT_MS,
                    maxBuffer: 1024 * 1024 * 10 // 10MB buffer
                }, (error, stdout, stderr) => {
                    const durationMs = Date.now() - startTime;
                    
                    if (processManager && processId && stdout) {
                        processManager.attachRawStdout(processId, stdout);
                    }

                    if (error) {
                        // Check if it's a timeout
                        if (error.killed) {
                            const errorMsg = 'Copilot CLI timed out after 5 minutes. The process was force killed.';
                            logger.logAIProcessLaunchFailure('Process timed out', error, {
                                processId,
                                durationMs,
                                timeoutMs: COPILOT_TIMEOUT_MS
                            });
                            if (processManager && processId) {
                                processManager.failProcess(processId, errorMsg);
                            }
                            resolve({
                                success: false,
                                error: errorMsg
                            });
                            return;
                        }

                        // Check if copilot is not installed
                        if (error.message.includes('command not found') ||
                            error.message.includes('not recognized')) {
                            const errorMsg = 'Copilot CLI is not installed. Please install it with: npm install -g @anthropic-ai/claude-code';
                            logger.logAIProcessLaunchFailure('Command not found at runtime', error, {
                                processId,
                                durationMs
                            });
                            if (processManager && processId) {
                                processManager.failProcess(processId, errorMsg);
                            }
                            resolve({
                                success: false,
                                error: errorMsg
                            });
                            return;
                        }

                        const errorMsg = `Copilot CLI error: ${error.message}`;
                        logger.logAIProcessLaunchFailure('CLI execution error', error, {
                            processId,
                            durationMs,
                            stderr: stderr ? stderr.substring(0, 500) : undefined
                        });
                        if (processManager && processId) {
                            processManager.failProcess(processId, errorMsg);
                        }
                        resolve({
                            success: false,
                            error: errorMsg
                        });
                        return;
                    }

                    // Parse the output
                    const response = parseCopilotOutput(stdout);

                    if (!response) {
                        const errorMsg = 'No response received from Copilot CLI';
                        logger.logAIProcessLaunchFailure('Empty response', undefined, {
                            processId,
                            durationMs,
                            stdoutLength: stdout?.length || 0
                        });
                        if (processManager && processId) {
                            processManager.failProcess(processId, errorMsg);
                        }
                        resolve({
                            success: false,
                            error: errorMsg
                        });
                        return;
                    }

                    // Mark as completed
                    if (processManager && processId) {
                        processManager.completeProcess(processId, response);
                    }
                    
                    logger.logAIProcessComplete(processId || 'unknown', durationMs, true);

                    resolve({
                        success: true,
                        response
                    });
                });

                // Register the process with the manager
                if (processManager) {
                    if (processId) {
                        processManager.attachChildProcess(processId, childProcess);
                    } else {
                        processId = processManager.registerProcess(prompt, childProcess);
                    }
                }

                // Handle cancellation
                token.onCancellationRequested(() => {
                    childProcess.kill();
                    const durationMs = Date.now() - startTime;
                    logger.logAIProcessCancelled(processId || 'unknown', 'User cancelled');
                    if (processManager && processId) {
                        processManager.updateProcess(processId, 'cancelled', undefined, 'Cancelled by user');
                    }
                    resolve({
                        success: false,
                        error: 'AI request was cancelled'
                    });
                });
            });
        });
    } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        const errorMsg = `Failed to run Copilot CLI: ${err.message}`;
        logger.logAIProcessLaunchFailure('Unexpected error', err, {
            processId,
            workspaceRoot
        });
        if (processManager && processId) {
            processManager.failProcess(processId, errorMsg);
        }
        return {
            success: false,
            error: errorMsg
        };
    }
}
