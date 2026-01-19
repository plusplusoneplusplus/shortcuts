/**
 * Workspace Utilities
 *
 * Centralized utilities for workspace path resolution.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as vscode from 'vscode';

/**
 * Gets the root path of the first workspace folder.
 * Returns undefined if no workspace is open.
 *
 * @returns The workspace root path, or undefined if no workspace is open
 */
export function getWorkspaceRoot(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

/**
 * Gets the root path of the first workspace folder, with a fallback value.
 *
 * @param fallback The fallback value to return if no workspace is open
 * @returns The workspace root path, or the fallback value
 */
export function getWorkspaceRootOrFallback(fallback: string): string {
    return getWorkspaceRoot() ?? fallback;
}

/**
 * Gets the URI of the first workspace folder.
 * Returns undefined if no workspace is open.
 *
 * @returns The workspace root URI, or undefined if no workspace is open
 */
export function getWorkspaceRootUri(): vscode.Uri | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri;
}

/**
 * Gets the first workspace folder object.
 * Returns undefined if no workspace is open.
 *
 * @returns The first workspace folder, or undefined if no workspace is open
 */
export function getFirstWorkspaceFolder(): vscode.WorkspaceFolder | undefined {
    return vscode.workspace.workspaceFolders?.[0];
}

/**
 * Checks if a workspace is currently open.
 *
 * @returns True if a workspace is open, false otherwise
 */
export function hasWorkspace(): boolean {
    return vscode.workspace.workspaceFolders !== undefined &&
        vscode.workspace.workspaceFolders.length > 0;
}
