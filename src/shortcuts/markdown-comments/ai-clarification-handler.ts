/**
 * AI Clarification Handler
 * 
 * Handles AI clarification requests from the review editor.
 * Routes requests to configured AI tools (Copilot CLI or clipboard).
 * Can capture Copilot CLI output and return it for adding as a comment.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as vscode from 'vscode';
import { AIToolType, ClarificationContext } from './types';

const execAsync = promisify(exec);

/** Maximum prompt size in characters */
const MAX_PROMPT_SIZE = 8000;

/** Timeout for copilot CLI execution in milliseconds */
const COPILOT_TIMEOUT_MS = 120000; // 2 minutes

/**
 * Result of AI clarification request
 */
export interface ClarificationResult {
    /** Whether the clarification was successful */
    success: boolean;
    /** The clarification text from the AI */
    clarification?: string;
    /** Error message if failed */
    error?: string;
}

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
    const config = vscode.workspace.getConfiguration('workspaceShortcuts.aiClarification');
    const tool = config.get<string>('tool', 'copilot-cli');

    // Validate the tool setting
    if (tool === 'copilot-cli' || tool === 'clipboard') {
        return tool;
    }

    // Default to copilot-cli if invalid value
    return 'copilot-cli';
}

/** Valid AI model options for Copilot CLI */
export const VALID_MODELS = [
    'claude-sonnet-4.5',
    'claude-haiku-4.5',
    'claude-opus-4.5',
    'gpt-5.1-codex-max',
    'gemini-3-pro-preview'
] as const;

export type AIModel = typeof VALID_MODELS[number];

/**
 * Get the configured AI model from VS Code settings.
 * 
 * @returns The configured AI model, or undefined if using default
 */
export function getAIModelSetting(): AIModel | undefined {
    const config = vscode.workspace.getConfiguration('workspaceShortcuts.aiClarification');
    const model = config.get<string>('model', '');

    // Return undefined if empty (use default) or invalid
    if (!model || !VALID_MODELS.includes(model as AIModel)) {
        return undefined;
    }

    return model as AIModel;
}

/**
 * Default prompt templates for each instruction type.
 * These are used as fallbacks if settings are not configured.
 */
export const DEFAULT_PROMPTS = {
    clarify: 'Please clarify',
    goDeeper: 'Please provide an in-depth explanation and analysis of',
    customDefault: 'Please explain'
} as const;

/**
 * Get the configured prompt template from VS Code settings.
 * Falls back to default prompts if not configured.
 * 
 * @param promptType - The type of prompt to retrieve
 * @returns The configured or default prompt template
 */
export function getPromptTemplate(promptType: 'clarify' | 'goDeeper' | 'customDefault'): string {
    const config = vscode.workspace.getConfiguration('workspaceShortcuts.aiClarification.prompts');
    const prompt = config.get<string>(promptType);

    // Return configured prompt or fall back to default
    if (prompt && prompt.trim().length > 0) {
        return prompt.trim();
    }

    return DEFAULT_PROMPTS[promptType];
}

/**
 * Build prompt instructions based on the instruction type.
 * Uses configurable prompt templates from VS Code settings.
 * 
 * @param context - The clarification context from the webview
 * @returns The instruction-specific prompt prefix
 */
function getInstructionPrefix(context: ClarificationContext): string {
    switch (context.instructionType) {
        case 'clarify':
            return getPromptTemplate('clarify');
        case 'go-deeper':
            return getPromptTemplate('goDeeper');
        case 'custom':
            // For custom instructions, the user's instruction is the prefix
            // Fall back to the configurable default if no custom instruction provided
            return context.customInstruction || getPromptTemplate('customDefault');
        default:
            return getPromptTemplate('clarify');
    }
}

/**
 * Build a clarification prompt from the context.
 * Uses different prompt templates based on the instruction type.
 * The AI tool can read the file directly for additional context.
 * 
 * @param context - The clarification context from the webview
 * @returns The formatted prompt string
 */
export function buildClarificationPrompt(context: ClarificationContext): string {
    const selectedText = context.selectedText.trim();
    const instructionPrefix = getInstructionPrefix(context);

    // For custom instructions, format slightly differently
    if (context.instructionType === 'custom') {
        return `${instructionPrefix}: "${selectedText}" in the file ${context.filePath}`;
    }

    return `${instructionPrefix} "${selectedText}" in the file ${context.filePath}`;
}

/**
 * Validate and truncate prompt if necessary.
 * With the simplified prompt format, truncation is rarely needed.
 * 
 * @param context - The clarification context
 * @returns Object containing the prompt and whether truncation occurred
 */
export function validateAndTruncatePrompt(context: ClarificationContext): { prompt: string; truncated: boolean } {
    const prompt = buildClarificationPrompt(context);

    if (prompt.length <= MAX_PROMPT_SIZE) {
        return { prompt, truncated: false };
    }

    // If selected text is too long, truncate it and rebuild the prompt
    const maxSelectedLength = MAX_PROMPT_SIZE - 200; // Leave more room for instruction text
    const truncatedText = context.selectedText.substring(0, maxSelectedLength) + '...';
    const truncatedContext: ClarificationContext = {
        ...context,
        selectedText: truncatedText
    };
    const truncatedPrompt = buildClarificationPrompt(truncatedContext);

    return { prompt: truncatedPrompt, truncated: true };
}

/**
 * Copy the clarification prompt to clipboard.
 * 
 * @param prompt - The prompt to copy
 */
export async function copyToClipboard(prompt: string): Promise<void> {
    await vscode.env.clipboard.writeText(prompt);
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
 * Invoke the Copilot CLI with the clarification prompt in a terminal.
 * This is the fallback method that doesn't capture output.
 * 
 * @param prompt - The prompt to send to Copilot CLI
 * @returns True if the terminal was created successfully
 */
export async function invokeCopilotCLITerminal(prompt: string): Promise<boolean> {
    try {
        // Create a new terminal for the Copilot CLI
        const terminal = vscode.window.createTerminal({
            name: 'Copilot AI Clarification',
            hideFromUser: false
        });

        // Build the copilot command with escaped prompt and optional model
        const command = buildCopilotCommand(prompt);

        // Show the terminal and send the command
        terminal.show(true);
        terminal.sendText(command);

        return true;
    } catch (error) {
        console.error('[AI Clarification] Failed to invoke Copilot CLI:', error);
        return false;
    }
}

/**
 * Parse the copilot CLI output to extract the clarification text.
 * Removes the status lines, tool operations, and usage statistics.
 * 
 * @param output - Raw output from copilot CLI
 * @returns The extracted clarification text
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
 * Invoke the Copilot CLI and capture its output.
 * Runs copilot as a child process in the workspace directory.
 * 
 * @param prompt - The prompt to send to Copilot CLI
 * @param workspaceRoot - The workspace root directory
 * @returns The clarification result with the AI response
 */
export async function invokeCopilotCLI(prompt: string, workspaceRoot: string): Promise<ClarificationResult> {
    try {
        // Build the copilot command with escaped prompt and optional model
        const command = buildCopilotCommand(prompt);

        // Show progress notification
        return await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Getting AI clarification...',
            cancellable: true
        }, async (progress, token) => {
            return new Promise<ClarificationResult>((resolve) => {
                const childProcess = exec(command, {
                    cwd: workspaceRoot,
                    timeout: COPILOT_TIMEOUT_MS,
                    maxBuffer: 1024 * 1024 * 10 // 10MB buffer
                }, (error, stdout, stderr) => {
                    if (error) {
                        // Check if it's a timeout
                        if (error.killed) {
                            resolve({
                                success: false,
                                error: 'Copilot CLI timed out. The request took too long.'
                            });
                            return;
                        }

                        // Check if copilot is not installed
                        if (error.message.includes('command not found') ||
                            error.message.includes('not recognized')) {
                            resolve({
                                success: false,
                                error: 'Copilot CLI is not installed. Please install it with: npm install -g @anthropic-ai/claude-code'
                            });
                            return;
                        }

                        resolve({
                            success: false,
                            error: `Copilot CLI error: ${error.message}`
                        });
                        return;
                    }

                    // Parse the output
                    const clarification = parseCopilotOutput(stdout);

                    if (!clarification) {
                        resolve({
                            success: false,
                            error: 'No clarification received from Copilot CLI'
                        });
                        return;
                    }

                    resolve({
                        success: true,
                        clarification
                    });
                });

                // Handle cancellation
                token.onCancellationRequested(() => {
                    childProcess.kill();
                    resolve({
                        success: false,
                        error: 'Clarification request was cancelled'
                    });
                });
            });
        });
    } catch (error) {
        console.error('[AI Clarification] Failed to invoke Copilot CLI:', error);
        return {
            success: false,
            error: `Failed to run Copilot CLI: ${error}`
        };
    }
}

/**
 * Handle an AI clarification request.
 * Routes to the configured AI tool (Copilot CLI or clipboard).
 * Falls back to clipboard if Copilot CLI fails.
 * 
 * @param context - The clarification context from the webview
 * @param workspaceRoot - The workspace root directory (needed for copilot CLI)
 * @returns The clarification result if successful
 */
export async function handleAIClarification(
    context: ClarificationContext,
    workspaceRoot: string
): Promise<ClarificationResult> {
    // Validate and build the prompt
    const { prompt, truncated } = validateAndTruncatePrompt(context);

    // Show truncation warning if necessary
    if (truncated) {
        vscode.window.showWarningMessage('AI clarification prompt was truncated to fit size limits.');
    }

    // Get the configured AI tool
    const tool = getAIToolSetting();

    if (tool === 'copilot-cli') {
        // Try to invoke Copilot CLI and capture output
        const result = await invokeCopilotCLI(prompt, workspaceRoot);

        if (!result.success) {
            // Fall back to clipboard
            await copyToClipboard(prompt);
            vscode.window.showWarningMessage(
                `${result.error || 'Failed to get AI clarification'}. Prompt copied to clipboard.`,
                'Open Terminal'
            ).then(selection => {
                if (selection === 'Open Terminal') {
                    vscode.commands.executeCommand('workbench.action.terminal.new');
                }
            });
            return result;
        }

        return result;
    } else {
        // Copy to clipboard
        await copyToClipboard(prompt);
        vscode.window.showInformationMessage(
            'AI clarification prompt copied to clipboard!',
            'Open Copilot Chat'
        ).then(selection => {
            if (selection === 'Open Copilot Chat') {
                // Try to open Copilot chat if available
                vscode.commands.executeCommand('github.copilot.chat.focus').then(
                    () => { /* success */ },
                    () => { /* Copilot chat not available, ignore */ }
                );
            }
        });

        return {
            success: false,
            error: 'Using clipboard mode - no automatic clarification'
        };
    }
}

