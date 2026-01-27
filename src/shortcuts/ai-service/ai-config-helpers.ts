/**
 * AI Service Configuration Helpers
 *
 * VS Code-specific configuration helpers for the AI service.
 * These functions read settings from VS Code's workspace configuration.
 *
 * This module is intentionally separate from copilot-sdk-service.ts to keep
 * the SDK service free of VS Code dependencies, making it easier to test
 * and potentially reuse outside of VS Code.
 */

import * as vscode from 'vscode';
import { AIBackendType, AIModelConfig, VALID_MODELS } from './types';

/**
 * Get the configured AI backend from VS Code settings.
 *
 * @returns The configured backend type
 */
export function getAIBackendSetting(): AIBackendType {
    const config = vscode.workspace.getConfiguration('workspaceShortcuts.aiService');
    const backend = config.get<string>('backend', 'copilot-cli');

    // Validate the backend setting
    if (backend === 'copilot-sdk' || backend === 'copilot-cli' || backend === 'clipboard') {
        return backend;
    }

    // Default to copilot-cli if invalid value
    return 'copilot-cli';
}

/**
 * Get the SDK max sessions setting.
 *
 * @returns Maximum number of concurrent SDK sessions
 */
export function getSDKMaxSessionsSetting(): number {
    const config = vscode.workspace.getConfiguration('workspaceShortcuts.aiService.sdk');
    return config.get<number>('maxSessions', 5);
}

/**
 * Get the SDK session timeout setting.
 *
 * @returns Session timeout in milliseconds
 */
export function getSDKSessionTimeoutSetting(): number {
    const config = vscode.workspace.getConfiguration('workspaceShortcuts.aiService.sdk');
    return config.get<number>('sessionTimeout', 600000);
}

/**
 * Get the SDK load MCP config setting.
 *
 * @returns Whether to automatically load MCP config from ~/.copilot/mcp-config.json
 */
export function getSDKLoadMcpConfigSetting(): boolean {
    const config = vscode.workspace.getConfiguration('workspaceShortcuts.aiService.sdk');
    return config.get<boolean>('loadMcpConfig', true);
}

/**
 * Get the SDK request timeout setting.
 *
 * @returns Request timeout in milliseconds (default: 600000 = 10 minutes)
 */
export function getSDKRequestTimeoutSetting(): number {
    const config = vscode.workspace.getConfiguration('workspaceShortcuts.aiService.sdk');
    return config.get<number>('requestTimeout', 600000);
}

/**
 * Model display name mapping for user-friendly labels
 */
const MODEL_DISPLAY_NAMES: Record<string, { label: string; description?: string }> = {
    'claude-sonnet-4.5': { label: 'Claude Sonnet 4.5', description: '(Recommended)' },
    'claude-haiku-4.5': { label: 'Claude Haiku 4.5', description: '(Fast)' },
    'claude-opus-4.5': { label: 'Claude Opus 4.5', description: '(Premium)' },
    'gpt-5.1-codex-max': { label: 'GPT-5.1 Codex Max' },
    'gemini-3-pro-preview': { label: 'Gemini 3 Pro', description: '(Preview)' }
};

/**
 * Get available AI models with display labels for UI.
 * Returns models sorted with the default/recommended model first.
 *
 * @returns Array of AIModelConfig objects with display information
 */
export function getAvailableModels(): AIModelConfig[] {
    return VALID_MODELS.map((modelId, index) => {
        const displayInfo = MODEL_DISPLAY_NAMES[modelId] || { label: modelId };
        return {
            id: modelId,
            label: displayInfo.label,
            description: displayInfo.description,
            isDefault: index === 0 // First model is default
        };
    });
}

/**
 * Get the default Follow Prompt execution mode from settings.
 *
 * @returns Default execution mode ('interactive' or 'background')
 */
export function getFollowPromptDefaultMode(): 'interactive' | 'background' {
    const config = vscode.workspace.getConfiguration('workspaceShortcuts.followPrompt');
    const mode = config.get<string>('defaultMode', 'interactive');
    return mode === 'background' ? 'background' : 'interactive';
}

/**
 * Get the default Follow Prompt AI model from settings.
 *
 * @returns Default model ID or undefined to use first available
 */
export function getFollowPromptDefaultModel(): string {
    const config = vscode.workspace.getConfiguration('workspaceShortcuts.followPrompt');
    return config.get<string>('defaultModel', 'claude-sonnet-4.5');
}

/**
 * Check if Follow Prompt should remember last selection.
 *
 * @returns Whether to remember last used mode and model
 */
export function getFollowPromptRememberSelection(): boolean {
    const config = vscode.workspace.getConfiguration('workspaceShortcuts.followPrompt');
    return config.get<boolean>('rememberLastSelection', true);
}
