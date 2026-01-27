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
import { AIBackendType } from './types';

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
