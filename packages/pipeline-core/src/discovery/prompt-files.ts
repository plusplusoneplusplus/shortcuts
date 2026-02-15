import * as fs from 'fs';
import * as path from 'path';
import { getLogger } from '../logger';
import type { PromptFileInfo } from './types';

/** Default location when no locations are specified */
const DEFAULT_PROMPT_LOCATION = '.github/prompts';

/**
 * Discover all .prompt.md files under the given root directory.
 *
 * Adapted from extension's getPromptFiles() + findPromptFilesInFolder()
 * (src/shortcuts/shared/prompt-files-utils.ts:58-121) — same recursive
 * walk logic but with explicit location parameters instead of VS Code
 * settings.
 *
 * @param rootDir   Workspace/project root (absolute path)
 * @param locations Folders to scan, relative to rootDir or absolute.
 *                  Defaults to ['.github/prompts'].
 * @returns Array of discovered prompt files
 */
export async function findPromptFiles(
    rootDir: string,
    locations?: string[]
): Promise<PromptFileInfo[]> {
    const folders = locations?.length ? locations : [DEFAULT_PROMPT_LOCATION];
    const results: PromptFileInfo[] = [];

    for (const loc of folders) {
        const folderPath = path.isAbsolute(loc) ? loc : path.join(rootDir, loc);
        try {
            if (!fs.existsSync(folderPath)) {
                continue;
            }
            scanFolder(folderPath, rootDir, loc, results);
        } catch (error) {
            getLogger().debug('Discovery', `Error reading folder ${folderPath}: ${error}`);
        }
    }

    return results;
}

function scanFolder(
    folderPath: string,
    rootDir: string,
    sourceFolder: string,
    results: PromptFileInfo[]
): void {
    const entries = fs.readdirSync(folderPath, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(folderPath, entry.name);
        if (entry.isDirectory()) {
            scanFolder(fullPath, rootDir, sourceFolder, results);
        } else if (entry.isFile() && entry.name.endsWith('.prompt.md')) {
            results.push({
                absolutePath: fullPath,
                relativePath: path.relative(rootDir, fullPath),
                name: entry.name.replace('.prompt.md', ''),
                sourceFolder,
            });
        }
    }
}
