/**
 * Copilot CLI Invoker
 * 
 * Core CLI invocation logic for the AI service.
 * Handles shell escaping, command building, output parsing, and CLI execution.
 */

import { exec } from 'child_process';
import * as vscode from 'vscode';
import { AIProcessManager } from './ai-process-manager';
import { AIInvocationResult, AIModel, AIToolType, VALID_MODELS } from './types';

/** Timeout for copilot CLI execution in milliseconds */
const COPILOT_TIMEOUT_MS = 1200000; // 20 minutes

/**
 * Escape a string for safe use in shell commands.
 * Uses single quotes which preserve content literally, except for single quotes
 * which need special handling.
 * 
 * Single-quoted strings in shell:
 * - Preserve all characters literally (including newlines, tabs, etc.)
 * - Cannot contain single quotes, so we break out and escape them
 * 
 * @param str - The string to escape
 * @returns The escaped string safe for shell use
 */
export function escapeShellArg(str: string): string {
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
 * @returns The complete command string
 */
function buildCopilotCommand(prompt: string): string {
    const escapedPrompt = escapeShellArg(prompt);
    const model = getAIModelSetting();

    if (model) {
        return `copilot --allow-all-tools --model ${model} -p ${escapedPrompt}`;
    }

    return `copilot --allow-all-tools -p ${escapedPrompt}`;
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
 * @returns True if the terminal was created successfully
 */
export async function invokeCopilotCLITerminal(prompt: string, workspaceRoot?: string): Promise<boolean> {
    try {
        // Get the configured working directory if workspace root is provided
        const cwd = workspaceRoot ? getWorkingDirectory(workspaceRoot) : undefined;

        // Create a new terminal for the Copilot CLI
        const terminal = vscode.window.createTerminal({
            name: 'Copilot AI',
            hideFromUser: false,
            cwd: cwd
        });

        // Build the copilot command with escaped prompt and optional model
        const command = buildCopilotCommand(prompt);

        // Show the terminal and send the command
        terminal.show(true);
        terminal.sendText(command);

        return true;
    } catch (error) {
        console.error('[AI Service] Failed to invoke Copilot CLI:', error);
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
 * @returns The invocation result with the AI response
 */
export async function invokeCopilotCLI(
    prompt: string,
    workspaceRoot: string,
    processManager?: AIProcessManager
): Promise<AIInvocationResult> {
    let processId: string | undefined;

    try {
        // Build the copilot command with escaped prompt and optional model
        const command = buildCopilotCommand(prompt);

        // Get the configured working directory
        const cwd = getWorkingDirectory(workspaceRoot);

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
                    if (error) {
                        // Check if it's a timeout
                        if (error.killed) {
                            const errorMsg = 'Copilot CLI timed out after 20 minutes. The process was force killed.';
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

                    resolve({
                        success: true,
                        response
                    });
                });

                // Register the process with the manager
                if (processManager) {
                    processId = processManager.registerProcess(prompt, childProcess);
                }

                // Handle cancellation
                token.onCancellationRequested(() => {
                    childProcess.kill();
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
        console.error('[AI Service] Failed to invoke Copilot CLI:', error);
        const errorMsg = `Failed to run Copilot CLI: ${error}`;
        if (processManager && processId) {
            processManager.failProcess(processId, errorMsg);
        }
        return {
            success: false,
            error: errorMsg
        };
    }
}

