import * as path from 'path';
import { getLogger, LogCategory } from '../logger';
import { ensureDirectoryExists, safeCopyFile, safeReadDir, safeStats } from '../utils';

/**
 * Copy a skill directory recursively.
 */
export async function copySkillDirectory(sourcePath: string, targetPath: string): Promise<void> {
    const logger = getLogger();

    ensureDirectoryExists(targetPath);

    const readResult = safeReadDir(sourcePath);
    if (!readResult.success || !readResult.data) {
        throw new Error(`Failed to read source directory: ${sourcePath}`);
    }

    for (const item of readResult.data) {
        const itemSourcePath = path.join(sourcePath, item);
        const itemTargetPath = path.join(targetPath, item);
        const statsResult = safeStats(itemSourcePath);

        if (!statsResult.success || !statsResult.data) {
            continue;
        }

        if (statsResult.data.isDirectory()) {
            await copySkillDirectory(itemSourcePath, itemTargetPath);
        } else if (statsResult.data.isFile()) {
            const copyResult = safeCopyFile(itemSourcePath, itemTargetPath);
            if (!copyResult.success) {
                throw new Error(`Failed to copy file ${item}: ${copyResult.error}`);
            }
            logger.debug(LogCategory.GENERAL, `Copied bundled skill file: ${item}`);
        }
    }
}
