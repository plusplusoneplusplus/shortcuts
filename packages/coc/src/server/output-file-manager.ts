/**
 * Output File Manager
 *
 * Manages persisting full AI conversation output to disk as Markdown files.
 * Files are stored in `<dataDir>/outputs/<processId>.md`.
 *
 * No VS Code dependencies — uses only Node.js built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as fs from 'fs/promises';
import * as path from 'path';

const OUTPUTS_SUBDIR = 'outputs';

export class OutputFileManager {
    /**
     * Write full conversation output to `<dataDir>/outputs/<processId>.md`.
     * Creates the outputs/ directory on first write.
     * Returns the absolute file path, or undefined if content is empty.
     */
    static async saveOutput(processId: string, content: string, dataDir: string): Promise<string | undefined> {
        if (!content) { return undefined; }
        const dir = path.join(dataDir, OUTPUTS_SUBDIR);
        await fs.mkdir(dir, { recursive: true });
        const filePath = path.join(dir, `${processId}.md`);
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
