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

/**
 * Input for {@link suppressesAutoFolder}: a queued chat payload (first turn),
 * a process metadata record (follow-up turns), or both.
 */
export interface SuppressesAutoFolderInput {
    payload?: unknown;
    metadata?: Record<string, unknown> | null;
}

function isNonEmptyRecord(value: unknown): boolean {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Chat kinds bound to a specific artifact - a note, a commit, or a pull
 * request - never get the plan save-location block. Those conversations are
 * scoped to the thing they are about; a standing `notes/Plans/<name>.plan.md`
 * save target invites unrequested file writes and, for note chats, competes
 * with the note the chat is actually editing.
 *
 * Ralph grilling suppression is handled separately at its own call site: it
 * replaces the block with a user-message directive rather than dropping it.
 */
export function suppressesAutoFolder(input: SuppressesAutoFolderInput): boolean {
    const payloadContext = isNonEmptyRecord(input.payload)
        ? (input.payload as { context?: unknown }).context
        : undefined;
    const context = isNonEmptyRecord(payloadContext)
        ? payloadContext as Record<string, unknown>
        : undefined;
    if (context) {
        if (isNonEmptyRecord(context.pullRequestChat)) return true;
        if (isNonEmptyRecord(context.commitChat)) return true;
        if (isNonEmptyRecord(context.noteChat)) return true;
    }

    const metadata = isNonEmptyRecord(input.metadata)
        ? input.metadata as Record<string, unknown>
        : undefined;
    if (metadata) {
        if (isNonEmptyRecord(metadata.pullRequestChat)) return true;
        if (isNonEmptyRecord(metadata.commitChat)) return true;
        if (typeof metadata.notePath === 'string' && metadata.notePath.trim()) return true;
    }

    return false;
}
