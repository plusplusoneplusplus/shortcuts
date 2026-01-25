/**
 * Prompt File Resolver
 *
 * Resolves and loads prompt files for YAML pipelines.
 * Supports relative paths, search order for bare filenames, and frontmatter stripping.
 *
 * Path Resolution Strategy (same as CSV resolution):
 * - Relative paths: resolved from pipeline package directory
 * - Absolute paths: used as-is
 * - Bare filenames: searched in order (pipeline dir, prompts/ subfolder, shared prompts)
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * Error thrown for prompt file resolution issues
 */
export class PromptResolverError extends Error {
    constructor(
        message: string,
        public readonly searchedPaths?: string[]
    ) {
        super(message);
        this.name = 'PromptResolverError';
    }
}

/**
 * Result of prompt file resolution
 */
export interface PromptResolutionResult {
    /** The resolved prompt content (frontmatter stripped) */
    content: string;
    /** The absolute path where the prompt was found */
    resolvedPath: string;
    /** Whether frontmatter was stripped */
    hadFrontmatter: boolean;
}

/**
 * Frontmatter regex pattern
 * Matches YAML frontmatter at the start of a file:
 * ---
 * key: value
 * ---
 */
const FRONTMATTER_REGEX = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;

/**
 * Check if a path contains path separators (indicating it's not a bare filename)
 */
function hasPathSeparators(filePath: string): boolean {
    return filePath.includes('/') || filePath.includes('\\');
}

/**
 * Get search paths for a bare filename (no path separators)
 * 
 * Search order:
 * 1. Pipeline package directory - {pipelineDir}/filename
 * 2. prompts/ subfolder - {pipelineDir}/prompts/filename
 * 3. Shared prompts folder - {pipelinesRoot}/prompts/filename
 * 
 * @param filename Bare filename without path separators
 * @param pipelineDirectory Pipeline package directory (where pipeline.yaml lives)
 * @returns Array of paths to search, in order
 */
export function getSearchPaths(filename: string, pipelineDirectory: string): string[] {
    const paths: string[] = [];

    // 1. Pipeline package directory
    paths.push(path.join(pipelineDirectory, filename));

    // 2. prompts/ subfolder within pipeline package
    paths.push(path.join(pipelineDirectory, 'prompts', filename));

    // 3. Shared prompts folder (sibling to pipeline package)
    // pipelinesRoot is the parent of pipelineDirectory
    const pipelinesRoot = path.dirname(pipelineDirectory);
    paths.push(path.join(pipelinesRoot, 'prompts', filename));

    return paths;
}

/**
 * Resolve a prompt file path to an absolute path
 * 
 * Resolution rules:
 * - Absolute paths: returned as-is
 * - Paths with separators (e.g., "prompts/map.prompt.md"): resolved relative to pipelineDirectory
 * - Bare filenames (e.g., "analyze.prompt.md"): searched using getSearchPaths()
 * 
 * @param promptFile Path or filename from config
 * @param pipelineDirectory Pipeline package directory (where pipeline.yaml lives)
 * @returns Absolute path to the prompt file
 * @throws PromptResolverError if file not found
 */
export function resolvePromptPath(promptFile: string, pipelineDirectory: string): string {
    // Absolute path - use as-is
    if (path.isAbsolute(promptFile)) {
        if (!fs.existsSync(promptFile)) {
            throw new PromptResolverError(
                `Prompt file not found: ${promptFile}`,
                [promptFile]
            );
        }
        return promptFile;
    }

    // Path with separators - resolve relative to pipeline directory
    if (hasPathSeparators(promptFile)) {
        const resolvedPath = path.resolve(pipelineDirectory, promptFile);
        if (!fs.existsSync(resolvedPath)) {
            throw new PromptResolverError(
                `Prompt file not found: ${promptFile}`,
                [resolvedPath]
            );
        }
        return resolvedPath;
    }

    // Bare filename - search in order
    const searchPaths = getSearchPaths(promptFile, pipelineDirectory);
    for (const searchPath of searchPaths) {
        if (fs.existsSync(searchPath)) {
            return searchPath;
        }
    }

    // Not found anywhere
    throw new PromptResolverError(
        `Prompt file "${promptFile}" not found. Searched paths:\n  - ${searchPaths.join('\n  - ')}`,
        searchPaths
    );
}

/**
 * Extract prompt content from file content, stripping frontmatter if present
 * 
 * Frontmatter format:
 * ---
 * version: 1.0
 * description: Bug analysis prompt
 * variables: [title, description, priority]
 * ---
 * 
 * Actual prompt content starts here...
 * 
 * @param fileContent Raw file content
 * @returns Object with content and whether frontmatter was stripped
 */
export function extractPromptContent(fileContent: string): { content: string; hadFrontmatter: boolean } {
    const match = fileContent.match(FRONTMATTER_REGEX);
    
    if (match) {
        const content = fileContent.slice(match[0].length).trim();
        return {
            content,
            hadFrontmatter: true
        };
    }

    return {
        content: fileContent.trim(),
        hadFrontmatter: false
    };
}

/**
 * Resolve and load a prompt file
 * 
 * This is the main API for loading prompts from files.
 * 
 * @param promptFile Path or filename from config
 * @param pipelineDirectory Pipeline package directory (where pipeline.yaml lives)
 * @returns Prompt content string (frontmatter stripped)
 * @throws PromptResolverError if file not found or empty
 * 
 * @example
 * // Simple - prompt in same folder
 * const prompt = await resolvePromptFile('analyze.prompt.md', '/path/to/pipeline');
 * 
 * // With prompts subfolder
 * const prompt = await resolvePromptFile('prompts/map.prompt.md', '/path/to/pipeline');
 * 
 * // Using shared prompts
 * const prompt = await resolvePromptFile('../shared/prompts/common.prompt.md', '/path/to/pipeline');
 */
export async function resolvePromptFile(
    promptFile: string,
    pipelineDirectory: string
): Promise<string> {
    const resolvedPath = resolvePromptPath(promptFile, pipelineDirectory);
    
    try {
        const fileContent = await fs.promises.readFile(resolvedPath, 'utf-8');
        const { content } = extractPromptContent(fileContent);
        
        if (!content) {
            throw new PromptResolverError(
                `Prompt file is empty after stripping frontmatter: ${promptFile}`,
                [resolvedPath]
            );
        }
        
        return content;
    } catch (error) {
        if (error instanceof PromptResolverError) {
            throw error;
        }
        throw new PromptResolverError(
            `Failed to read prompt file "${promptFile}": ${error instanceof Error ? error.message : String(error)}`,
            [resolvedPath]
        );
    }
}

/**
 * Resolve and load a prompt file synchronously
 * 
 * @param promptFile Path or filename from config
 * @param pipelineDirectory Pipeline package directory (where pipeline.yaml lives)
 * @returns Prompt content string (frontmatter stripped)
 * @throws PromptResolverError if file not found or empty
 */
export function resolvePromptFileSync(
    promptFile: string,
    pipelineDirectory: string
): string {
    const resolvedPath = resolvePromptPath(promptFile, pipelineDirectory);
    
    try {
        const fileContent = fs.readFileSync(resolvedPath, 'utf-8');
        const { content } = extractPromptContent(fileContent);
        
        if (!content) {
            throw new PromptResolverError(
                `Prompt file is empty after stripping frontmatter: ${promptFile}`,
                [resolvedPath]
            );
        }
        
        return content;
    } catch (error) {
        if (error instanceof PromptResolverError) {
            throw error;
        }
        throw new PromptResolverError(
            `Failed to read prompt file "${promptFile}": ${error instanceof Error ? error.message : String(error)}`,
            [resolvedPath]
        );
    }
}

/**
 * Resolve and load a prompt file with full result details
 * 
 * @param promptFile Path or filename from config
 * @param pipelineDirectory Pipeline package directory (where pipeline.yaml lives)
 * @returns Full resolution result with content, path, and frontmatter info
 * @throws PromptResolverError if file not found or empty
 */
export async function resolvePromptFileWithDetails(
    promptFile: string,
    pipelineDirectory: string
): Promise<PromptResolutionResult> {
    const resolvedPath = resolvePromptPath(promptFile, pipelineDirectory);
    
    try {
        const fileContent = await fs.promises.readFile(resolvedPath, 'utf-8');
        const { content, hadFrontmatter } = extractPromptContent(fileContent);
        
        if (!content) {
            throw new PromptResolverError(
                `Prompt file is empty after stripping frontmatter: ${promptFile}`,
                [resolvedPath]
            );
        }
        
        return {
            content,
            resolvedPath,
            hadFrontmatter
        };
    } catch (error) {
        if (error instanceof PromptResolverError) {
            throw error;
        }
        throw new PromptResolverError(
            `Failed to read prompt file "${promptFile}": ${error instanceof Error ? error.message : String(error)}`,
            [resolvedPath]
        );
    }
}

/**
 * Check if a prompt file exists (without loading it)
 * 
 * @param promptFile Path or filename from config
 * @param pipelineDirectory Pipeline package directory
 * @returns True if the file exists at any of the search locations
 */
export function promptFileExists(promptFile: string, pipelineDirectory: string): boolean {
    try {
        resolvePromptPath(promptFile, pipelineDirectory);
        return true;
    } catch {
        return false;
    }
}

/**
 * Validate that a prompt file can be resolved (for config validation)
 * 
 * @param promptFile Path or filename from config
 * @param pipelineDirectory Pipeline package directory
 * @returns Validation result with error message if invalid
 */
export function validatePromptFile(
    promptFile: string,
    pipelineDirectory: string
): { valid: boolean; error?: string; searchedPaths?: string[] } {
    try {
        resolvePromptPath(promptFile, pipelineDirectory);
        return { valid: true };
    } catch (error) {
        if (error instanceof PromptResolverError) {
            return {
                valid: false,
                error: error.message,
                searchedPaths: error.searchedPaths
            };
        }
        return {
            valid: false,
            error: error instanceof Error ? error.message : String(error)
        };
    }
}
