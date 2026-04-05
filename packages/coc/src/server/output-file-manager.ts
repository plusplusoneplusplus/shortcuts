/**
 * Output File Manager
 *
 * Manages persisting full AI conversation output to disk as Markdown files.
 * Files are stored per-repo at `<dataDir>/repos/<workspaceId>/<subfolder>/<processId>.md`.
 * - Chat sessions use subfolder `chat/`
 * - Other executors (shell scripts, etc.) use subfolder `outputs/`
 * When no workspaceId is available, falls back to the `_shared` workspace.
 *
 * No VS Code dependencies — uses only Node.js built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { getRepoDataPath } from './paths';

const SHARED_WORKSPACE = '_shared';

export class OutputFileManager {
    /**
     * Write full conversation output to `<dataDir>/repos/<workspaceId>/<subfolder>/<processId>.md`.
     * Falls back to `_shared` workspace when workspaceId is not provided.
     * Creates the subfolder directory on first write.
     * Returns the absolute file path, or undefined if content is empty.
     *
     * @param subfolder - Subfolder under the workspace repo dir. Use `'chat'` for chat sessions,
     *                    `'outputs'` (default) for other executor types.
     */
    static async saveOutput(processId: string, content: string, dataDir: string, workspaceId?: string, subfolder: string = 'outputs'): Promise<string | undefined> {
        if (!content) { return undefined; }
        const wsId = workspaceId || SHARED_WORKSPACE;
        const filePath = getRepoDataPath(dataDir, wsId, path.join(subfolder, `${processId}.md`));
        const dir = path.dirname(filePath);
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(filePath, content, 'utf-8');
        return filePath;
    }

    /**
     * Read a previously saved output file.
     * Returns the content string, or undefined if the file doesn't exist.
     */
    static async loadOutput(filePath: string): Promise<string | undefined> {
        try {
            return await fs.readFile(filePath, 'utf-8');
        } catch {
            return undefined;
        }
    }

    /**
     * Delete a saved output file (cleanup helper).
     */
    static async deleteOutput(filePath: string): Promise<void> {
        try {
            await fs.unlink(filePath);
        } catch {
            // Ignore if already deleted
        }
    }
}
