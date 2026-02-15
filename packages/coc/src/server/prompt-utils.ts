/**
 * Prompt File Utilities
 *
 * Discover and read `.prompt.md` files without VS Code dependencies.
 * Mirrors src/shortcuts/shared/prompt-files-utils.ts using
 * pipeline-core's findPromptFiles() for the actual scanning.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as fs from 'fs';
import * as path from 'path';
import { findPromptFiles } from '@plusplusoneplusplus/pipeline-core';
import type { PromptFileInfo } from '@plusplusoneplusplus/pipeline-core';

export type { PromptFileInfo };

/** Default location for prompt files. */
const DEFAULT_PROMPT_LOCATIONS = ['.github/prompts'];

/**
 * Discover `.prompt.md` files under the given project directory.
 *
 * @param projectDir - Root directory to search from
 * @param locations  - Folders to scan (default: ['.github/prompts'])
 * @returns Array of prompt file metadata
 */
export async function discoverPromptFiles(
    projectDir: string,
    locations?: string[],
): Promise<PromptFileInfo[]> {
    return findPromptFiles(projectDir, locations ?? DEFAULT_PROMPT_LOCATIONS);
}

/**
 * Read a prompt file's content, stripping YAML frontmatter if present.
 *
 * @param absolutePath - Full path to the prompt file
 * @returns File content with frontmatter stripped
 */
export async function readPromptFileContent(absolutePath: string): Promise<string> {
    const raw = await fs.promises.readFile(absolutePath, 'utf-8');
    return stripFrontmatter(raw);
}

/**
 * Strip YAML frontmatter (delimited by `---`) from content.
 */
function stripFrontmatter(content: string): string {
    if (!content.startsWith('---')) {
        return content;
    }
    // Find the closing `---` after the opening one
    const endIdx = content.indexOf('---', 3);
    if (endIdx === -1) {
        return content;
    }
    // Return everything after the closing frontmatter delimiter, trimmed of leading newlines
    const afterFrontmatter = content.substring(endIdx + 3);
    return afterFrontmatter.replace(/^\r?\n/, '');
}
