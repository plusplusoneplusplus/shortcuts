/**
 * Workspace Identity
 *
 * Generates a deterministic identifier for the current VS Code workspace.
 * Used by the server client to associate AI processes with a workspace.
 */

import * as crypto from 'crypto';
import * as vscode from 'vscode';

export interface WorkspaceInfo {
    /** SHA-256 hash of rootPath (first 16 hex chars) */
    id: string;
    /** Workspace folder name */
    name: string;
    /** Absolute path to workspace root */
    rootPath: string;
}

/**
 * Get deterministic workspace identity from the first workspace folder.
 * Returns undefined when no workspace is open.
 */
export function getWorkspaceInfo(): WorkspaceInfo | undefined {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) { return undefined; }
    const folder = folders[0];
    const rootPath = folder.uri.fsPath;
    const id = crypto.createHash('sha256').update(rootPath).digest('hex').substring(0, 16);
    return { id, name: folder.name, rootPath };
}

/**
 * Compute workspace ID from a given path (for testing without vscode dependency).
 */
export function computeWorkspaceId(fsPath: string): string {
    return crypto.createHash('sha256').update(fsPath).digest('hex').substring(0, 16);
}
