import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Represents a prompt file with its path and metadata
 */
export interface PromptFile {
    /** Absolute path to the prompt file */
    absolutePath: string;
    /** Path relative to the workspace root */
    relativePath: string;
    /** File name without extension */
    name: string;
    /** The folder this file was found in (from settings) */
    sourceFolder: string;
}

/**
 * Gets the configured prompt file locations from VS Code settings.
 * These are the folders where VS Code Copilot looks for .prompt.md files.
 *
 * @returns Array of folder paths that are enabled (value is true)
 */
export function getPromptFileLocations(): string[] {
    const config = vscode.workspace.getConfiguration('chat');
    const locations = config.get<Record<string, boolean>>('promptFilesLocations') || {};

    // Return only folders where the value is true (enabled)
    return Object.entries(locations)
        .filter(([_, enabled]) => enabled)
        .map(([folder]) => folder);
}

/**
 * Finds all .prompt.md files in the configured prompt file locations.
 *
 * @param workspaceRoot Optional workspace root path. If not provided, uses the first workspace folder.
 * @returns Array of PromptFile objects representing found prompt files
 */
export async function getPromptFiles(workspaceRoot?: string): Promise<PromptFile[]> {
    const root = workspaceRoot || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) {
        return [];
    }

    const locations = getPromptFileLocations();
    const promptFiles: PromptFile[] = [];

    for (const location of locations) {
        // Resolve the folder path (could be relative or absolute)
        const folderPath = path.isAbsolute(location)
            ? location
            : path.join(root, location);

        // Check if folder exists
        if (!fs.existsSync(folderPath)) {
            continue;
        }

        // Find all .prompt.md files in this folder (recursively)
        const files = await findPromptFilesInFolder(folderPath, root, location);
        promptFiles.push(...files);
    }

    return promptFiles;
}

/**
 * Recursively finds all .prompt.md files in a folder
 */
async function findPromptFilesInFolder(
    folderPath: string,
    workspaceRoot: string,
    sourceFolder: string
): Promise<PromptFile[]> {
    const promptFiles: PromptFile[] = [];

    try {
        const entries = fs.readdirSync(folderPath, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(folderPath, entry.name);

            if (entry.isDirectory()) {
                // Recursively search subdirectories
                const subFiles = await findPromptFilesInFolder(fullPath, workspaceRoot, sourceFolder);
                promptFiles.push(...subFiles);
            } else if (entry.isFile() && entry.name.endsWith('.prompt.md')) {
                promptFiles.push({
                    absolutePath: fullPath,
                    relativePath: path.relative(workspaceRoot, fullPath),
                    name: entry.name.replace('.prompt.md', ''),
                    sourceFolder
                });
            }
        }
    } catch (error) {
        // Folder might not be accessible, skip it
        console.error(`Error reading folder ${folderPath}:`, error);
    }

    return promptFiles;
}

/**
 * Gets prompt files as a flat list of file paths (convenience function)
 *
 * @param workspaceRoot Optional workspace root path
 * @returns Array of absolute file paths
 */
export async function getPromptFilePaths(workspaceRoot?: string): Promise<string[]> {
    const files = await getPromptFiles(workspaceRoot);
    return files.map(f => f.absolutePath);
}

/**
 * Gets prompt file names (without .prompt.md extension)
 *
 * @param workspaceRoot Optional workspace root path
 * @returns Array of prompt file names
 */
export async function getPromptFileNames(workspaceRoot?: string): Promise<string[]> {
    const files = await getPromptFiles(workspaceRoot);
    return files.map(f => f.name);
}
