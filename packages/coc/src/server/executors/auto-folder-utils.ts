import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { AutoFolderContext } from '@plusplusoneplusplus/forge';
import type { ChatMode } from '../tasks/task-types';
import { normalizeChatMode } from '../tasks/task-types';
import { getRepoDataPath } from '../paths';
import { resolveTaskRoot } from '../tasks/task-root-resolver';

/**
 * Returns true when a directory name is a valid task folder - i.e. it is
 * neither a hidden/system directory (starting with '.') nor a reserved name.
 *
 * Callers may additionally exclude 'archive' at their own discretion, but
 * this predicate deliberately does not hard-code that since 'archive' is a
 * legitimate user-facing concept handled separately in the auto-folder logic.
 */
export function isValidTaskFolder(name: string): boolean {
    return !name.startsWith('.');
}

export interface ResolveAutoFolderContextOptions {
    dataDir?: string;
    workingDirectory: string;
    workspaceId?: string;
    mode?: ChatMode;
    resolveWorkspaceIdForPath: (rootPath: string) => Promise<string>;
}

/**
 * Resolve the target root directory and list existing user-facing folders.
 *
 * Ask mode targets repo notes/Plans so generated plans appear in the Notes tab.
 * Other active modes target the repo task root. Legacy `plan` inputs are
 * normalized to Ask before this decision.
 */
export async function resolveAutoFolderContext(
    options: ResolveAutoFolderContextOptions,
): Promise<AutoFolderContext> {
    const wsId = options.workspaceId
        || await options.resolveWorkspaceIdForPath(options.workingDirectory);
    const effectiveDataDir = options.dataDir ?? path.join(os.homedir(), '.coc');

    let folderRoot: string;
    if (normalizeChatMode(options.mode) === 'ask') {
        folderRoot = path.join(getRepoDataPath(effectiveDataDir, wsId, 'notes'), 'Plans');
        await fs.promises.mkdir(folderRoot, { recursive: true });
    } else {
        folderRoot = resolveTaskRoot({
            dataDir: effectiveDataDir,
            rootPath: options.workingDirectory,
            workspaceId: wsId,
        }).absolutePath;
    }

    const entries = await fs.promises
        .readdir(folderRoot, { withFileTypes: true })
        .catch(() => [] as fs.Dirent[]);
    const existingFolders = entries
        .filter(e => e.isDirectory() && isValidTaskFolder(e.name))
        .map(e => e.name);
    return { tasksRoot: folderRoot, existingFolders };
}
