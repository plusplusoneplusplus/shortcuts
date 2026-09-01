/**
 * Patch-transfer metadata sanitization.
 *
 * A patch transfer records where a commit came from so the target workspace can
 * show provenance. The source side is untrusted input (it may come from another
 * CoC server), and the metadata is persisted and rendered, so every field is
 * length-capped, stripped of newlines, and screened for local filesystem paths
 * that would leak someone's directory layout.
 *
 * Pure functions only — no I/O, no git.
 */

import { normalizeRemoteUrl } from '@plusplusoneplusplus/forge';
import type {
    GitOpCommitMetadata,
    GitOpMetadata,
    GitOpServerMetadata,
    GitOpWorkspaceMetadata,
    WorkspaceInfo,
} from '@plusplusoneplusplus/forge';

/** Absolute POSIX path, Windows drive path, or UNC share — never safe to echo back. */
export function looksLikeLocalAbsolutePath(value: string): boolean {
    return value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\');
}

export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Trim, collapse newlines/tabs to spaces, reject local paths, and cap length. */
export function sanitizeMetadataString(value: unknown, maxLength = 200): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim().replace(/[\r\n\t]+/g, ' ');
    if (!trimmed || looksLikeLocalAbsolutePath(trimmed)) return undefined;
    return trimmed.slice(0, maxLength);
}

export function sanitizeHash(value: unknown): string | undefined {
    const hash = sanitizeMetadataString(value, 40);
    return hash && /^[a-fA-F0-9]{4,40}$/.test(hash) ? hash.toLowerCase() : undefined;
}

export function sanitizeNormalizedRemoteUrl(value: unknown): string | undefined {
    const raw = typeof value === 'string' ? value.trim() : '';
    if (!raw || looksLikeLocalAbsolutePath(raw)) return undefined;
    const normalized = normalizeRemoteUrl(raw).trim();
    if (!normalized || looksLikeLocalAbsolutePath(normalized)) return undefined;
    return normalized.slice(0, 500);
}

export function sanitizeTargetWorkspace(ws: WorkspaceInfo): GitOpWorkspaceMetadata {
    const name = sanitizeMetadataString(ws.name);
    return name ? { id: ws.id, name } : { id: ws.id };
}

export function sanitizeWorkspaceMetadata(value: unknown): GitOpWorkspaceMetadata | undefined {
    if (!isRecord(value)) return undefined;
    const id = sanitizeMetadataString(value.id);
    if (!id) return undefined;
    const name = sanitizeMetadataString(value.name);
    return name ? { id, name } : { id };
}

export function sanitizeServerMetadata(value: unknown): GitOpServerMetadata | undefined {
    if (!isRecord(value)) return undefined;
    const id = sanitizeMetadataString(value.id);
    if (!id) return undefined;
    const label = sanitizeMetadataString(value.label);
    return label ? { id, label } : { id };
}

export function sanitizeAuthorMetadata(value: unknown): { name?: string; email?: string; date?: string } | undefined {
    if (!isRecord(value)) return undefined;
    const name = sanitizeMetadataString(value.name);
    const email = sanitizeMetadataString(value.email);
    const date = sanitizeMetadataString(value.date);
    if (!name && !email && !date) return undefined;
    return {
        ...(name ? { name } : {}),
        ...(email ? { email } : {}),
        ...(date ? { date } : {}),
    };
}

export function sanitizeCommitMetadata(value: unknown): GitOpCommitMetadata | undefined {
    if (!isRecord(value)) return undefined;
    const hash = sanitizeHash(value.hash);
    if (!hash) return undefined;
    const subject = sanitizeMetadataString(value.subject, 500);
    const author = sanitizeAuthorMetadata(value.author);
    return {
        hash,
        ...(subject ? { subject } : {}),
        ...(author ? { author } : {}),
    };
}

export function sanitizeCommitMetadataArray(value: unknown): GitOpCommitMetadata[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const commits = value
        .map(sanitizeCommitMetadata)
        .filter((commit): commit is GitOpCommitMetadata => Boolean(commit));
    return commits.length > 0 ? commits : undefined;
}

/** Convert a `BranchService` patch-export payload into provenance metadata. */
export function toGitOpCommitMetadata(payload: {
    commitHash: string;
    subject: string;
    authorName: string;
    authorEmail: string;
    authorDate: string;
}): GitOpCommitMetadata {
    return {
        hash: payload.commitHash,
        subject: payload.subject,
        author: {
            name: payload.authorName,
            email: payload.authorEmail,
            date: payload.authorDate,
        },
    };
}

/**
 * Build the `cherry-pick-transfer` job metadata from the (untrusted) request
 * body plus the locally-known target state.
 *
 * An explicit `normalizedSourceRemoteUrl: null` is preserved — it means the
 * source proved it has no remote, which is different from "not reported".
 */
export function buildPatchTransferMetadata(
    body: Record<string, unknown>,
    targetWorkspace: WorkspaceInfo,
    targetBranch: string,
    targetHead: string | undefined,
    stashed: boolean,
): GitOpMetadata {
    const metadata: GitOpMetadata = {
        kind: 'patch-transfer',
        targetWorkspace: sanitizeTargetWorkspace(targetWorkspace),
        targetBranch: sanitizeMetadataString(targetBranch) ?? null,
        stashed,
    };
    const safeTargetHead = sanitizeHash(targetHead);
    if (safeTargetHead) {
        metadata.targetHead = safeTargetHead;
        metadata.newCommitHash = safeTargetHead;
    }
    const sourceServer = sanitizeServerMetadata(body.sourceServer);
    if (sourceServer) metadata.sourceServer = sourceServer;
    const sourceWorkspace = sanitizeWorkspaceMetadata(body.sourceWorkspace);
    if (sourceWorkspace) metadata.sourceWorkspace = sourceWorkspace;
    const sourceCommit = sanitizeCommitMetadata(body.sourceCommit);
    if (sourceCommit) metadata.sourceCommit = sourceCommit;
    const sourceCommits = sanitizeCommitMetadataArray(body.sourceCommits);
    if (sourceCommits) metadata.sourceCommits = sourceCommits;
    if (body.normalizedSourceRemoteUrl === null) {
        metadata.normalizedSourceRemoteUrl = null;
    } else {
        const normalizedSourceRemoteUrl = sanitizeNormalizedRemoteUrl(body.normalizedSourceRemoteUrl);
        if (normalizedSourceRemoteUrl) metadata.normalizedSourceRemoteUrl = normalizedSourceRemoteUrl;
    }
    return metadata;
}
