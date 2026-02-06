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
import { DEFAULT_AI_TIMEOUT_MS } from '../shared/ai-timeouts';
import { AIBackendType, AIModelConfig, DEFAULT_MODEL_ID, ModelDefinition, getAllModels, isValidModelId } from './types';

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
    return config.get<number>('sessionTimeout', DEFAULT_AI_TIMEOUT_MS);
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
 * @returns Request timeout in milliseconds (default: 1800000 = 30 minutes)
 */
export function getSDKRequestTimeoutSetting(): number {
    const config = vscode.workspace.getConfiguration('workspaceShortcuts.aiService.sdk');
    return config.get<number>('requestTimeout', DEFAULT_AI_TIMEOUT_MS);
}

/**
 * Get available AI models with display labels for UI.
 * Returns models sorted with the default/recommended model first.
 * Labels and descriptions are derived from the central model registry.
 *
 * @returns Array of AIModelConfig objects with display information
 */
export function getAvailableModels(): AIModelConfig[] {
    return getAllModels().map((model: ModelDefinition, index: number) => ({
        id: model.id,
        label: model.label,
        description: model.description || undefined,
        isDefault: index === 0 // First model is default
    }));
}

/**
 * Get the default Follow Prompt execution mode from settings.
 *
 * @returns Default execution mode ('interactive' or 'background')
 */
export function getFollowPromptDefaultMode(): 'interactive' | 'background' {
    const config = vscode.workspace.getConfiguration('workspaceShortcuts.followPrompt');
    const mode = config.get<string>('defaultMode', 'interactive');
    if (mode === 'background' || mode === 'queued') return 'background'; // backward-compat
    return 'interactive';
}

/**
 * Get the default Follow Prompt AI model from settings.
 *
 * @returns Default model ID or undefined to use first available
 */
export function getFollowPromptDefaultModel(): string {
    const config = vscode.workspace.getConfiguration('workspaceShortcuts.followPrompt');
    return config.get<string>('defaultModel', DEFAULT_MODEL_ID);
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

// ============================================================================
// Persistent Model Selection
// ============================================================================

/** Storage key for last-used AI model */
const LAST_USED_MODEL_KEY = 'workspaceShortcuts.aiTask.lastUsedModel';

/**
 * Get the last-used AI model from workspace state, with fallback chain:
 * 1. Workspace state (persisted selection)
 * 2. Configuration setting (workspaceShortcuts.followPrompt.defaultModel)
 * 3. Default model from registry
 *
 * @param context VS Code extension context for workspace state access
 * @returns The model ID to use as default
 */
export function getLastUsedAIModel(context: vscode.ExtensionContext): string {
    const savedModel = context.workspaceState.get<string>(LAST_USED_MODEL_KEY);

    if (savedModel) {
        // Migrate deprecated GPT-5.1 Codex selection to GPT-5.2 for AI task creation.
        const migratedModel = savedModel === 'gpt-5.1-codex'
            ? 'gpt-5.2'
            : savedModel;

        if (isValidModelId(migratedModel)) {
            if (migratedModel !== savedModel) {
                void context.workspaceState.update(LAST_USED_MODEL_KEY, migratedModel);
            }
            return migratedModel;
        }
        // Model no longer available, fall through to defaults
    }

    // Fall back to config setting or hardcoded default
    return getFollowPromptDefaultModel();
}

/**
 * Save the selected AI model to workspace state for persistence.
 *
 * @param context VS Code extension context for workspace state access
 * @param model The model ID to save
 */
export function saveLastUsedAIModel(context: vscode.ExtensionContext, model: string): void {
    context.workspaceState.update(LAST_USED_MODEL_KEY, model);
}
