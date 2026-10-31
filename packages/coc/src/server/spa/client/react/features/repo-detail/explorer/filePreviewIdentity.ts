/**
 * filePreviewIdentity — the exact file a `PreviewPane` shows, and the policy
 * that follows from it: which transport reads and writes it, whether it is
 * editable, which key scopes its dirty state, and which workspaces may own a
 * definition it navigates to.
 *
 * Pure: no React, no Monaco. Every per-file decision the pane makes is derived
 * here once, so reads, writes, dirty tracking and language eligibility cannot
 * disagree about what file this is.
 */

import { TRUSTED_PATH_PREFIX } from './ExactOpen';
import { explorerApi } from './explorerApi';
import { beginExplorerFileSave } from './explorerDirtyStore';
import { WORKSPACE_PREVIEW_PREFIX, readWorkspacePreview, workspacePreviewClient } from '../../../shared/file-viewer/workspacePreview';
import { parseRemoteCloneKey } from '../../../repos/cloneIdentity';
import type { UseFileContentOptions } from '../../../shared/file-viewer/useFileContent';

/** How the pane reaches the file. */
export type FilePreviewKind = 'repo' | 'trusted' | 'workspace-preview';

export interface FilePreviewIdentity {
    workspaceId: string;
    /** Concrete clone route; `undefined` keeps the legacy unrouted transport. */
    routingRef?: string | null;
    editingScope?: string;
    kind: FilePreviewKind;
    /** The path as the host passed it, prefix included. */
    filePath: string;
    /** The path with any trusted / workspace-preview prefix removed. */
    path: string;
    /** Owner key for dirty tracking, deletion locks and Explorer state. */
    ownerKey: string;
    /** Buffer key: changes exactly when the file session must restart. */
    contentKey: string;
    /** Trusted absolute paths and workspace previews never accept writes. */
    readOnly: boolean;
}

export function resolveFilePreviewIdentity(input: {
    workspaceId: string;
    routingRef?: string | null;
    editingScope?: string;
    filePath: string;
}): FilePreviewIdentity {
    const { workspaceId, routingRef, editingScope, filePath } = input;
    const kind: FilePreviewKind = filePath.startsWith(TRUSTED_PATH_PREFIX) ? 'trusted'
        : filePath.startsWith(WORKSPACE_PREVIEW_PREFIX) ? 'workspace-preview' : 'repo';
    const path = kind === 'trusted' ? filePath.slice(TRUSTED_PATH_PREFIX.length)
        : kind === 'workspace-preview' ? filePath.slice(WORKSPACE_PREVIEW_PREFIX.length) : filePath;
    const ownerKey = routingRef ?? workspaceId;
    return {
        workspaceId,
        routingRef,
        editingScope,
        kind,
        filePath,
        path,
        ownerKey,
        contentKey: `${ownerKey}:${filePath}`,
        readOnly: kind !== 'repo',
    };
}

export interface FilePreviewTransport {
    read: UseFileContentOptions['read'];
    /** Absent for read-only identities. */
    write?: UseFileContentOptions['write'];
}

/**
 * The read/write pair for one identity. Writes hold the Explorer save lock
 * for their owner/path so a concurrent delete cannot race them.
 */
export function createFilePreviewTransport(identity: FilePreviewIdentity): FilePreviewTransport {
    const { workspaceId, routingRef, kind, path, ownerKey } = identity;
    const read = async (signal: AbortSignal) => {
        if (kind !== 'trusted' && parseRemoteCloneKey(routingRef)) workspacePreviewClient(workspaceId, routingRef);
        return kind === 'workspace-preview'
            ? readWorkspacePreview(workspaceId, path, routingRef, signal)
            : kind === 'trusted'
                ? explorerApi.readTrustedBlob(path, { signal })
                : routingRef === undefined
                    ? explorerApi.readBlob(workspaceId, path, { signal })
                    : explorerApi.readBlob(workspaceId, path, { signal }, routingRef);
    };
    if (identity.readOnly) return { read };
    const write = async (content: string) => {
        if (parseRemoteCloneKey(routingRef)) workspacePreviewClient(workspaceId, routingRef);
        const finish = beginExplorerFileSave(ownerKey, path);
        try {
            await (routingRef === undefined
                ? explorerApi.writeBlob(workspaceId, path, content)
                : explorerApi.writeBlob(workspaceId, path, content, routingRef));
        } finally {
            finish();
        }
    };
    return { read, write };
}

/** A workspace whose files a definition may open, with its concrete route. */
export interface DefinitionOwner {
    workspaceId: string;
    routingRef?: string | null;
}

/**
 * Which workspace ids this pane may resolve definitions into. The pane's own
 * workspace always maps to its own route. A repo-group member maps only when
 * exactly one supplied owner carries that id: an ambiguous id is left out, so
 * a definition there is declined instead of read from the wrong clone.
 */
export function buildDefinitionOwnerMap(
    identity: Pick<FilePreviewIdentity, 'workspaceId' | 'routingRef'>,
    owners: readonly DefinitionOwner[] | undefined,
): ReadonlyMap<string, DefinitionOwner> {
    const map = new Map<string, DefinitionOwner>();
    const ambiguous = new Set<string>();
    for (const owner of owners ?? []) {
        if (owner.workspaceId === identity.workspaceId || ambiguous.has(owner.workspaceId)) continue;
        if (map.has(owner.workspaceId)) {
            map.delete(owner.workspaceId);
            ambiguous.add(owner.workspaceId);
            continue;
        }
        map.set(owner.workspaceId, owner);
    }
    map.set(identity.workspaceId, { workspaceId: identity.workspaceId, routingRef: identity.routingRef });
    return map;
}

/** The editing-model registry scope for one concrete owner and editing scope. */
export function editingModelScope(
    workspaceId: string,
    routingRef: string | null | undefined,
    editingScope: string | undefined,
): string {
    return JSON.stringify([workspaceId, routingRef === undefined ? workspaceId : routingRef, editingScope ?? '']);
}
