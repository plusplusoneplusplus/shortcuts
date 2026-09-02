/**
 * Discover and read `.prompt.md` files without editor-host dependencies.
 * Scanning is delegated to forge's findPromptFiles().
 */

import * as fs from 'fs';
import { findPromptFiles } from '@plusplusoneplusplus/forge';
import type { PromptFileInfo } from '@plusplusoneplusplus/forge';

export type { PromptFileInfo };

const DEFAULT_PROMPT_LOCATIONS = ['.github/prompts'];

/**
 * Discover `.prompt.md` files under the given project directory.
 *
 * @param locations  - Folders to scan (default: ['.github/prompts'])
 */
export async function discoverPromptFiles(
    projectDir: string,
    locations?: string[],
): Promise<PromptFileInfo[]> {
    return findPromptFiles(projectDir, locations ?? DEFAULT_PROMPT_LOCATIONS);
}

/**
 * Read a prompt file's content, stripping YAML frontmatter if present.
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
