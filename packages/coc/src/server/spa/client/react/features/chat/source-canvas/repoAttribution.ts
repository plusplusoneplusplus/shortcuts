/**
 * Repo attribution for the source canvas — which member repo a previewed file
 * came from, in a repo-group chat.
 *
 * A repo-group chat (`wsId` = `group-…`) previews files from several member
 * repos through one panel, so `core.py` alone is ambiguous and two members can
 * contribute the same file name. The header chip and the grouped file switcher
 * both label a file with its owning member repo plus a stable per-repo color.
 *
 * The owning member is only known AFTER the preview endpoint probes the group
 * members (`resolvedWorkspaceId`), so callers fill in a per-file cache lazily as
 * files get opened; files never opened yet fall into the "Other" bucket.
 */
import type { ResolvableWorkspace } from '../../../repos/workspacesWithRemote';
import { getConversationSourceFileKey, type ConversationSourceFile } from './conversationSourceFiles';
import { getSourceCanvasDisplayPath } from './resolve';

/**
 * VS Code-ish accents, picked to stay legible on both the light (`#f8f8f8`) and
 * dark (`#252526`) panel chrome. Small on purpose: repeats read as "some other
 * repo", which is better than a wide palette of near-identical hues.
 */
export const REPO_ACCENT_COLORS = [
    '#3794ff',
    '#c586c0',
    '#4ec9b0',
    '#d7ba7d',
    '#ce9178',
    '#9cdcfe',
    '#b5cea8',
    '#f48771',
] as const;

/** Accent used for files whose owning member repo is not known yet. */
export const UNRESOLVED_REPO_COLOR = '#848484';

/** Label used for the switcher bucket of not-yet-resolved files. */
export const UNRESOLVED_REPO_LABEL = 'Other';

function basename(p: string): string {
    const normalized = p.replace(/\\/g, '/').replace(/\/+$/, '');
    return normalized.split('/').pop() || p;
}

/**
 * Stable color for a workspace id (FNV-1a over the normalized id). Same repo →
 * same color for the life of the id, with no palette state to keep in sync
 * between the header chip and the switcher.
 */
export function getRepoAccentColor(wsId: string): string {
    const key = wsId.trim().toLowerCase();
    let hash = 0x811c9dc5;
    for (let i = 0; i < key.length; i++) {
        hash ^= key.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return REPO_ACCENT_COLORS[hash % REPO_ACCENT_COLORS.length];
}

/** Display name for a member workspace: its name, else its root basename, else the id. */
export function getRepoLabel(
    wsId: string,
    workspaces: readonly ResolvableWorkspace[] = [],
): string {
    const workspace = workspaces.find((ws) => ws.id === wsId);
    return workspace?.name?.trim()
        || (workspace?.rootPath ? basename(workspace.rootPath) : '')
        || wsId;
}

/** True when the panel is previewing a repo-group chat's files. */
export function isRepoGroupWorkspaceId(wsId?: string | null): boolean {
    return !!wsId && wsId.startsWith('group-');
}

/**
 * Repo attribution shown for the currently previewed file, or `null` when the
 * chat is a plain single-repo chat (no chip — the repo is never in doubt) or
 * when the owning member has not been reported yet.
 */
export function getActiveRepoAttribution(
    chatWsId: string | null | undefined,
    resolvedWsId: string | null | undefined,
    workspaces: readonly ResolvableWorkspace[] = [],
): { wsId: string; label: string; color: string } | null {
    const inGroupChat = isRepoGroupWorkspaceId(chatWsId)
        || (!!resolvedWsId && !!chatWsId && resolvedWsId !== chatWsId);
    if (!inGroupChat || !resolvedWsId || isRepoGroupWorkspaceId(resolvedWsId)) {
        return null;
    }
    return {
        wsId: resolvedWsId,
        label: getRepoLabel(resolvedWsId, workspaces),
        color: getRepoAccentColor(resolvedWsId),
    };
}

export interface SourceFileRepoGroup {
    /** Owning member workspace id, or `null` for the not-yet-resolved bucket. */
    wsId: string | null;
    label: string;
    color: string;
    files: ConversationSourceFile[];
}

/**
 * Bucket switcher entries by owning member repo, keeping each repo's files in
 * their original (most-recent-first) order. Groups appear in first-appearance
 * order; the unresolved bucket always sorts last.
 */
export function groupSourceFilesByRepo(
    sourceFiles: readonly ConversationSourceFile[],
    repoByFileKey: ReadonlyMap<string, string>,
    workspaces: readonly ResolvableWorkspace[] = [],
): SourceFileRepoGroup[] {
    const groups: SourceFileRepoGroup[] = [];
    const byWsId = new Map<string, SourceFileRepoGroup>();
    let unresolved: SourceFileRepoGroup | null = null;

    for (const sourceFile of sourceFiles) {
        const key = getConversationSourceFileKey(sourceFile.wsId, sourceFile.fullPath);
        const owner = repoByFileKey.get(key);
        if (!owner || isRepoGroupWorkspaceId(owner)) {
            unresolved ??= {
                wsId: null,
                label: UNRESOLVED_REPO_LABEL,
                color: UNRESOLVED_REPO_COLOR,
                files: [],
            };
            unresolved.files.push(sourceFile);
            continue;
        }
        let group = byWsId.get(owner);
        if (!group) {
            group = {
                wsId: owner,
                label: getRepoLabel(owner, workspaces),
                color: getRepoAccentColor(owner),
                files: [],
            };
            byWsId.set(owner, group);
            groups.push(group);
        }
        group.files.push(sourceFile);
    }

    return unresolved ? [...groups, unresolved] : groups;
}

/** Repo-relative display path for a switcher entry, given its owning member root. */
export function getSourceFileDisplayPath(
    sourceFile: ConversationSourceFile,
    ownerWsId: string | null,
    workspaces: readonly ResolvableWorkspace[],
    fallbackRootPath?: string | null,
): string {
    if (sourceFile.displayPath) {
        return sourceFile.displayPath;
    }
    const ownerRoot = ownerWsId
        ? workspaces.find((ws) => ws.id === ownerWsId)?.rootPath
        : undefined;
    return getSourceCanvasDisplayPath(sourceFile.fullPath, ownerRoot || fallbackRootPath);
}
