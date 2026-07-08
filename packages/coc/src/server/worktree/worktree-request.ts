/**
 * Worktree execution request parsing and validation.
 *
 * Shared by every execution launch surface that accepts an opt-in Git worktree
 * request under the `worktree` body key (Work Item execute, Ralph direct
 * launch, Ralph start). This module only validates the request *shape*; whether
 * the target server actually supports worktree execution (feature flag) and
 * whether `baseRef` resolves against Git are enforced later by the worktree
 * service, not here.
 *
 * Contract:
 *   - `worktree` absent/null -> no request (existing behavior preserved).
 *   - `worktree: { enabled: false }` -> treated as opted-out (no request).
 *   - `worktree: { enabled: true, baseRef? }` -> a request; `baseRef` optional.
 *   - anything else malformed -> an error (handlers return HTTP 400).
 */

import type { WorktreeExecutionRequest } from '@plusplusoneplusplus/coc-client';

export type { WorktreeExecutionRequest };

/** Result of parsing a raw `worktree` body field. */
export type ParseWorktreeRequestResult =
    /** Valid: `value` is the request, or `undefined` when opted out / omitted. */
    | { ok: true; value: WorktreeExecutionRequest | undefined }
    /** Malformed: `error` is a client-facing 400 message. */
    | { ok: false; error: string };

/** Maximum accepted length for a base ref string. */
const MAX_BASE_REF_LENGTH = 255;

/**
 * Whether the string contains any whitespace or control character (code point
 * at most 0x20, or DEL 0x7f). Such characters are never valid inside a single
 * Git revision. Implemented by code point rather than a regex so the check
 * stays unambiguous.
 */
function hasWhitespaceOrControl(value: string): boolean {
    for (let i = 0; i < value.length; i++) {
        const code = value.charCodeAt(i);
        if (code <= 0x20 || code === 0x7f) {
            return true;
        }
    }
    return false;
}

/**
 * Lightweight base-ref sanity check. Actual "does it resolve on this server"
 * validation happens in the worktree service; here we only reject values that
 * could never be a valid single revision or that are unsafe as a Git argument.
 * Returns an error message, or `undefined` when the ref looks plausible.
 */
function validateBaseRef(value: string): string | undefined {
    if (value.length > MAX_BASE_REF_LENGTH) {
        return `worktree.baseRef must be at most ${MAX_BASE_REF_LENGTH} characters`;
    }
    if (value.startsWith('-')) {
        // Avoid a ref being interpreted as a git flag.
        return 'worktree.baseRef must not start with "-"';
    }
    if (hasWhitespaceOrControl(value)) {
        return 'worktree.baseRef must not contain whitespace or control characters';
    }
    if (value.includes('..')) {
        // ".." is range syntax, not a single revision.
        return 'worktree.baseRef must not contain ".."';
    }
    return undefined;
}

/**
 * Parse and validate the raw `worktree` field from an execution launch body.
 */
export function parseWorktreeExecutionRequest(raw: unknown): ParseWorktreeRequestResult {
    if (raw === undefined || raw === null) {
        return { ok: true, value: undefined };
    }
    if (typeof raw !== 'object' || Array.isArray(raw)) {
        return { ok: false, error: 'worktree must be an object' };
    }

    const obj = raw as Record<string, unknown>;

    if (obj.enabled === false) {
        // Explicitly opted out - behave exactly as if omitted.
        return { ok: true, value: undefined };
    }
    if (obj.enabled !== true) {
        return { ok: false, error: 'worktree.enabled must be a boolean' };
    }

    // enabled === true: optional baseRef.
    if (obj.baseRef === undefined || obj.baseRef === null) {
        return { ok: true, value: { enabled: true } };
    }
    if (typeof obj.baseRef !== 'string') {
        return { ok: false, error: 'worktree.baseRef must be a string' };
    }

    const trimmed = obj.baseRef.trim();
    if (trimmed.length === 0) {
        // Empty base ref means "use current HEAD" - same as omitting it.
        return { ok: true, value: { enabled: true } };
    }

    const baseRefError = validateBaseRef(trimmed);
    if (baseRefError) {
        return { ok: false, error: baseRefError };
    }

    return { ok: true, value: { enabled: true, baseRef: trimmed } };
}
