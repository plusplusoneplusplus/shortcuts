/**
 * Git route request validators and response mappers.
 *
 * Shared parsing/validation for the git REST handlers so every route rejects
 * bad input with the same status codes and error payloads, and reports the
 * dirty/conflict taxonomy identically.
 *
 * Validators throw `APIError`s — `createRoute` turns those into responses via
 * `handleAPIError`, so handlers stay free of early-return plumbing.
 */

import type * as http from 'http';
import { parseBody } from '../core/api-handler';
import { badRequest, missingFields } from '../errors';

/** Abbreviated or full git object name. */
export const GIT_HASH_PATTERN = /^[a-fA-F0-9]{4,40}$/;

export function isGitHash(value: unknown): value is string {
    return typeof value === 'string' && GIT_HASH_PATTERN.test(value);
}

/**
 * Parse a JSON body that is allowed to be absent or malformed.
 * Used by routes where every field is optional.
 */
export async function parseOptionalBody(req: http.IncomingMessage): Promise<any> {
    try {
        return await parseBody(req);
    } catch {
        return {};
    }
}

/** Require a string field. Throws 400 `MISSING_FIELDS` when absent or not a string. */
export function requireString(body: any, field: string): string {
    const value = body?.[field];
    if (!value || typeof value !== 'string') throw missingFields([field]);
    return value;
}

/** Require a non-blank string field, returning the untrimmed original. */
export function requireNonBlankString(body: any, field: string): string {
    const value = requireString(body, field);
    if (!value.trim()) throw missingFields([field]);
    return value;
}

/** Return a trimmed non-empty string, or `undefined` for anything else. */
export function optionalTrimmedString(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}

/** Collect trimmed, non-empty strings out of an unknown array-ish value. */
export function collectStrings(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value
        .filter((entry): entry is string => typeof entry === 'string')
        .map(entry => entry.trim())
        .filter(entry => entry.length > 0);
}

/**
 * Require a non-empty list of git hashes.
 * Throws `MISSING_FIELDS` when empty and 400 `Missing or invalid hash` when any
 * entry is not a hash.
 */
export function requireHashList(value: unknown, field: string): string[] {
    const hashes = collectStrings(value);
    if (hashes.length === 0) throw missingFields([field]);
    if (!hashes.every(isGitHash)) throw badRequest('Missing or invalid hash');
    return hashes;
}

/** Require a single git hash field: missing → `MISSING_FIELDS`, malformed → 400. */
export function requireHash(body: any, field: string): string {
    const hash = requireString(body, field).trim();
    if (!isGitHash(hash)) throw badRequest('Missing or invalid hash');
    return hash;
}

/** Pick an allow-listed string value, falling back when absent or unknown. */
export function pickEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
    return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? value as T : fallback;
}

/** The failure shape shared by the `BranchService` mutations. */
export interface GitMutationOutcome {
    success: boolean;
    dirty?: boolean;
    conflicts?: boolean;
    message?: string;
}

/**
 * Map a failed mutation onto its 409 response body, or `undefined` when the
 * failure is neither dirty nor conflicted (caller decides — usually a 400).
 */
export function conflictResponseFor(
    result: GitMutationOutcome,
    extras: { dirty?: Record<string, unknown>; conflicts?: Record<string, unknown> } = {},
): { status: 409; payload: Record<string, unknown> } | undefined {
    if (result.dirty) {
        return { status: 409, payload: { error: result.message, dirty: true, ...extras.dirty } };
    }
    if (result.conflicts) {
        return { status: 409, payload: { error: result.message, conflicts: true, ...extras.conflicts } };
    }
    return undefined;
}
