/**
 * Centralized, machine-scoped physical workspace ID generation.
 *
 * Physical repository workspaces are identified by BOTH the machine they live on
 * (the raw OS hostname) and their normalized root path. The same repository at
 * the same absolute path on two different machines therefore produces two
 * distinct IDs. This is what lets the dashboard aggregate clones from multiple
 * remote CoC servers without two machines collapsing into one entry.
 *
 * This module is the SINGLE source of truth for the physical workspace ID
 * scheme. Add Repo, Add Folder, Clone Repo, and server-side registration must
 * all route through {@link computeWorkspaceId} so the scheme cannot drift.
 *
 * Virtual/system workspaces (My Work, My Life, Global) keep their fixed,
 * machine-independent IDs and must NOT be passed through {@link computeWorkspaceId};
 * use {@link isPhysicalWorkspaceId} to tell them apart.
 */

import crypto from 'crypto';
import path from 'path';

/** Prefix for the machine-scoped (v2) physical workspace ID scheme. */
export const WORKSPACE_ID_V2_PREFIX = 'ws-v2-';

/**
 * Prefix shared by every physical workspace ID — both the legacy path-only
 * scheme (`ws-<base36hash>`) and the v2 machine-scoped scheme
 * (`ws-v2-<hash>`). Virtual workspace IDs never start with this prefix.
 */
export const PHYSICAL_WORKSPACE_ID_PREFIX = 'ws-';

/**
 * Delimiter between hostname and path in the hash input. A NUL byte can appear
 * in neither an OS hostname nor a filesystem path, so distinct (hostname, path)
 * pairs can never collapse to the same hash input (e.g. host `ab` + path `/c`
 * never aliases host `a` + path `b/c`). Built via fromCharCode so no literal
 * control character lives in source.
 */
const WORKSPACE_ID_DELIMITER = String.fromCharCode(0);

/** Fallback identity used when the OS hostname is empty/unavailable. */
const UNKNOWN_HOSTNAME = 'unknown-host';

/** Length (in hex chars) of the truncated sha256 digest embedded in v2 IDs. */
const WORKSPACE_ID_HASH_LENGTH = 24;

/**
 * Normalize a filesystem root path for stable workspace-ID hashing.
 *
 * Resolves to an absolute, canonical form (collapsing `.`/`..` and duplicate
 * separators) and strips any trailing separator so that `/foo/bar`, `/foo/bar/`
 * and `/foo//bar` all hash identically. Inputs are always absolute repo roots,
 * so `path.resolve` is deterministic and does not depend on the process CWD.
 */
export function normalizeWorkspaceRootPath(rootPath: string): string {
    const resolved = path.resolve(rootPath);
    if (resolved.length > 1) {
        return resolved.replace(/[/\\]+$/, '') || resolved;
    }
    return resolved;
}

/**
 * Normalize the raw OS hostname used as machine identity. Trims surrounding
 * whitespace and falls back to a stable sentinel when empty. The hostname is
 * otherwise used raw — not shortened, not the configured display name, not a
 * remote server label.
 */
export function normalizeWorkspaceHostname(rawHostname: string | null | undefined): string {
    const trimmed = (rawHostname ?? '').trim();
    return trimmed.length > 0 ? trimmed : UNKNOWN_HOSTNAME;
}

/**
 * Compute the canonical machine-scoped physical workspace ID.
 *
 * Format: `ws-v2-<hash>`, where `<hash>` is a truncated sha256 over
 * `<rawHostname><NUL><normalizedRootPath>`.
 *
 * @param rawHostname Raw OS hostname (e.g. `os.hostname()`).
 * @param rootPath Absolute repository root path.
 */
export function computeWorkspaceId(rawHostname: string | null | undefined, rootPath: string): string {
    const host = normalizeWorkspaceHostname(rawHostname);
    const normalizedPath = normalizeWorkspaceRootPath(rootPath);
    const digest = crypto
        .createHash('sha256')
        .update(host + WORKSPACE_ID_DELIMITER + normalizedPath)
        .digest('hex')
        .slice(0, WORKSPACE_ID_HASH_LENGTH);
    return `${WORKSPACE_ID_V2_PREFIX}${digest}`;
}

/** True for a machine-scoped (v2) physical workspace ID. */
export function isV2WorkspaceId(id: string | null | undefined): boolean {
    return typeof id === 'string' && id.startsWith(WORKSPACE_ID_V2_PREFIX);
}

/**
 * True for a physical workspace ID from the old path-only scheme
 * (`ws-<base36hash>`), i.e. a `ws-` ID that is not yet machine-scoped. These
 * are the IDs migrated to the v2 scheme on startup.
 */
export function isLegacyPhysicalWorkspaceId(id: string | null | undefined): boolean {
    return (
        typeof id === 'string' &&
        id.startsWith(PHYSICAL_WORKSPACE_ID_PREFIX) &&
        !id.startsWith(WORKSPACE_ID_V2_PREFIX)
    );
}

/**
 * True for any physical repository workspace ID (legacy or v2). Virtual/system
 * workspaces (My Work, My Life, Global) return false, so callers can exclude
 * them from machine-scoping and migration.
 */
export function isPhysicalWorkspaceId(id: string | null | undefined): boolean {
    return typeof id === 'string' && id.startsWith(PHYSICAL_WORKSPACE_ID_PREFIX);
}
