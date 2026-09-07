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

/**
 * Whether this chat is in a Ralph grilling phase, read from the payload
 * (first turn) or the denormalized `metadata.ralph` projection (follow-ups).
 *
 * Grilling owns its own output contract — a `.goal.md` file for general Ralph,
 * a Work Item content version for Goal items — so it must never also receive
 * the generic `.plan.md` destination.
 */
export function isRalphGrillingContext(input: SuppressesAutoFolderInput): boolean {
    const sources: unknown[] = [];
    if (isNonEmptyRecord(input.payload)) sources.push((input.payload as { context?: unknown }).context);
    if (isNonEmptyRecord(input.metadata)) sources.push((input.metadata as { ralph?: unknown }).ralph);

    for (const source of sources) {
        if (!isNonEmptyRecord(source)) continue;
        const record = source as Record<string, unknown>;
        if (record.phase === 'grilling') return true;
        if (isNonEmptyRecord(record.workItemGoalGrilling)) return true;
        const ralph = record.ralph;
        if (isNonEmptyRecord(ralph) && (ralph as Record<string, unknown>).phase === 'grilling') return true;
    }
    return false;
}

/**
 * Whether this turn must not receive the generic plan save destination.
 *
 * The union of the two independent exclusions: artifact-bound chats (see
 * {@link suppressesAutoFolder}) and Ralph grilling
 * ({@link isRalphGrillingContext}). Shared by the first-turn and follow-up
 * paths so the two cannot drift apart on eligibility.
 */
export function suppressesPlanSaveGuidance(input: SuppressesAutoFolderInput): boolean {
    return suppressesAutoFolder(input) || isRalphGrillingContext(input);
}
