import * as vscode from 'vscode';
import { findPromptFiles as coreFindPromptFiles } from '@plusplusoneplusplus/pipeline-core';
import { getWorkspaceRoot } from './workspace-utils';

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
 * Default prompt file location when no settings are configured
 */
const DEFAULT_PROMPT_LOCATION = '.github/prompts';

/**
 * Gets the configured prompt file locations from VS Code settings.
 * These are the folders where VS Code Copilot looks for .prompt.md files.
 * If no locations are configured, defaults to .github/prompts in the workspace.
 *
 * @param configOverride Optional configuration override for testing
 * @returns Array of folder paths that are enabled (value is true)
 */
export function getPromptFileLocations(configOverride?: Record<string, boolean>): string[] {
    const locations = configOverride !== undefined
        ? configOverride
        : (vscode.workspace.getConfiguration('chat').get<Record<string, boolean>>('promptFilesLocations') || {});

    // Return only folders where the value is true (enabled)
    const enabledLocations = Object.entries(locations)
        .filter(([_, enabled]) => enabled)
        .map(([folder]) => folder);

    // If no locations are configured, use default
    if (enabledLocations.length === 0) {
        return [DEFAULT_PROMPT_LOCATION];
    }

    return enabledLocations;
}

/**
 * Finds all .prompt.md files in the configured prompt file locations.
 *
 * @param workspaceRoot Optional workspace root path. If not provided, uses the first workspace folder.
 * @param configOverride Optional configuration override for testing
 * @returns Array of PromptFile objects representing found prompt files
 */
export async function getPromptFiles(workspaceRoot?: string, configOverride?: Record<string, boolean>): Promise<PromptFile[]> {
    const root = workspaceRoot || getWorkspaceRoot();
    if (!root) {
        return [];
    }

    const locations = getPromptFileLocations(configOverride);

    // Delegate filesystem scanning to pipeline-core
    const coreResults = await coreFindPromptFiles(root, locations);

    // Map pipeline-core PromptFileInfo → extension PromptFile (1:1 fields)
    return coreResults.map(info => ({
        absolutePath: info.absolutePath,
        relativePath: info.relativePath,
        name: info.name,
        sourceFolder: info.sourceFolder,
    }));
}

/**
 * Gets prompt files as a flat list of file paths (convenience function)
 *
 * @param workspaceRoot Optional workspace root path
 * @param configOverride Optional configuration override for testing
 * @returns Array of absolute file paths
 */
export async function getPromptFilePaths(workspaceRoot?: string, configOverride?: Record<string, boolean>): Promise<string[]> {
    const files = await getPromptFiles(workspaceRoot, configOverride);
    return files.map(f => f.absolutePath);
}

/**
 * Gets prompt file names (without .prompt.md extension)
 *
 * @param workspaceRoot Optional workspace root path
 * @param configOverride Optional configuration override for testing
 * @returns Array of prompt file names
 */
export async function getPromptFileNames(workspaceRoot?: string, configOverride?: Record<string, boolean>): Promise<string[]> {
    const files = await getPromptFiles(workspaceRoot, configOverride);
    return files.map(f => f.name);
}
