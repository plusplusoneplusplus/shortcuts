/**
 * PR Review Progress Store
 *
 * File-based persistence for PR popout reviewer progress (AC-04).
 *
 * One JSON file per (origin, pr) tuple when an origin scope is supplied. Legacy
 * (workspace, repo, pr) files are migrated into the origin file on access. The headSha is stored
 * inside the payload — when the caller asks for a different headSha than
 * what is on disk, the stale record is ignored (the reviewer starts fresh
 * for the new head commit), so PR head churn never causes "phantom
 * reviewed" rows.
 *
 * Layout:
 *   ~/.coc/repos/<originId>/review-progress/<prId>.json
 *
 * Pure Node.js. Cross-platform compatible (Linux/Mac/Windows).
 */

import * as fs from 'fs';
import * as path from 'path';
import { getRepoDataPath } from '../paths';
import {
    isPullRequestOriginScoped,
    resolvePullRequestLegacyScopes,
    resolvePullRequestStorageId,
    type PullRequestStorageScopeInput,
} from './pr-origin-scope';

// ============================================================================
// Types
// ============================================================================

/** Persisted PR review-progress payload. */
export interface ReviewProgressRecord {
    repoId: string;
    prId: string;
    headSha: string;
    reviewedFiles: string[];
    visitedFiles: string[];
    lastSelectedFile: string | null;
    updatedAt: string;
}

export interface ReviewProgressPaths {
    /** Absolute path to the JSON file. */
    filePath: string;
    /** Directory containing all review-progress files for this workspace. */
    dir: string;
}

// ============================================================================
// Limits
// ============================================================================

/** Cap on the number of file paths persisted per set to keep payloads bounded. */
export const MAX_FILES_PER_SET = 5000;
/** Cap on individual file path length to avoid runaway payloads. */
export const MAX_FILE_PATH_LENGTH = 4096;

// ============================================================================
// Path helpers
// ============================================================================

/** Replace filesystem-unsafe characters with `_`. Mirrors classification-store. */
function sanitizeKeyPart(part: string): string {
    return part.replace(/[^A-Za-z0-9._-]/g, '_');
}

/** Resolve the storage paths for a single (workspace, repo, pr) tuple. */
export function reviewProgressPaths(
    dataDir: string,
    workspaceId: string,
    repoId: string,
    prId: string,
    scope?: PullRequestStorageScopeInput,
): ReviewProgressPaths {
    const storageId = resolvePullRequestStorageId(workspaceId, scope);
    const dir = getRepoDataPath(dataDir, storageId, 'review-progress');
    const base = isPullRequestOriginScoped(workspaceId, scope)
        ? sanitizeKeyPart(prId)
        : `${sanitizeKeyPart(repoId)}_${sanitizeKeyPart(prId)}`;
    const filePath = path.join(dir, `${base}.json`);
    return { filePath, dir };
}

// ============================================================================
// Validation
// ============================================================================

export type ReviewProgressValidation =
    | {
        ok: true;
        record: {
            headSha: string;
            reviewedFiles: string[];
            visitedFiles: string[];
            lastSelectedFile: string | null;
        };
    }
    | { ok: false; error: string };

function isStringArrayClean(value: unknown): value is string[] {
    return Array.isArray(value) && value.every(v => typeof v === 'string');
}

function dedupeClampPaths(paths: string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const p of paths) {
        if (p.length === 0 || p.length > MAX_FILE_PATH_LENGTH) continue;
        if (seen.has(p)) continue;
        seen.add(p);
        out.push(p);
        if (out.length >= MAX_FILES_PER_SET) break;
    }
    return out;
}

/**
 * Validate caller-provided progress input. Coerces missing optionals to
 * sensible defaults; rejects malformed payloads.
 */
export function validateReviewProgressInput(input: unknown): ReviewProgressValidation {
    if (!input || typeof input !== 'object') {
        return { ok: false, error: 'body must be a JSON object' };
    }
    const o = input as Record<string, unknown>;
    if (typeof o.headSha !== 'string' || o.headSha.trim().length === 0) {
        return { ok: false, error: 'headSha must be a non-empty string' };
    }
    if (o.reviewedFiles !== undefined && !isStringArrayClean(o.reviewedFiles)) {
        return { ok: false, error: 'reviewedFiles must be an array of strings' };
    }
    if (o.visitedFiles !== undefined && !isStringArrayClean(o.visitedFiles)) {
        return { ok: false, error: 'visitedFiles must be an array of strings' };
    }
    if (
        o.lastSelectedFile !== undefined &&
        o.lastSelectedFile !== null &&
        typeof o.lastSelectedFile !== 'string'
    ) {
        return { ok: false, error: 'lastSelectedFile must be a string or null' };
    }
    const reviewedFiles = dedupeClampPaths((o.reviewedFiles as string[] | undefined) ?? []);
    const visitedFiles = dedupeClampPaths((o.visitedFiles as string[] | undefined) ?? []);
    let lastSelectedFile: string | null = null;
    if (typeof o.lastSelectedFile === 'string' && o.lastSelectedFile.length > 0 && o.lastSelectedFile.length <= MAX_FILE_PATH_LENGTH) {
        lastSelectedFile = o.lastSelectedFile;
    }
    return {
        ok: true,
        record: {
            headSha: o.headSha.trim(),
            reviewedFiles,
            visitedFiles,
            lastSelectedFile,
        },
    };
}

// ============================================================================
// Read / Write
// ============================================================================

/** Empty record shape returned when no on-disk progress exists or stale-head. */
export function emptyReviewProgress(repoId: string, prId: string, headSha: string): ReviewProgressRecord {
    return {
        repoId,
        prId,
        headSha,
        reviewedFiles: [],
        visitedFiles: [],
        lastSelectedFile: null,
        updatedAt: new Date(0).toISOString(),
    };
}

function readReviewProgressFile(filePath: string): Partial<ReviewProgressRecord> | undefined {
    let raw: string;
    try {
        raw = fs.readFileSync(filePath, 'utf-8');
    } catch {
        return undefined;
    }
    try {
        return JSON.parse(raw) as Partial<ReviewProgressRecord>;
    } catch {
        return undefined;
    }
}

function normalizeStoredReviewProgress(
    parsed: Partial<ReviewProgressRecord> | undefined,
    repoId: string,
    prId: string,
): ReviewProgressRecord | undefined {
    if (
        !parsed ||
        typeof parsed.headSha !== 'string' ||
        !isStringArrayClean(parsed.reviewedFiles) ||
        !isStringArrayClean(parsed.visitedFiles)
    ) {
        return undefined;
    }
    return {
        repoId,
        prId,
        headSha: parsed.headSha,
        reviewedFiles: dedupeClampPaths(parsed.reviewedFiles),
        visitedFiles: dedupeClampPaths(parsed.visitedFiles),
        lastSelectedFile:
            typeof parsed.lastSelectedFile === 'string' && parsed.lastSelectedFile.length > 0
                ? parsed.lastSelectedFile
                : null,
        updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date(0).toISOString(),
    };
}

function writeReviewProgressFile(filePath: string, dir: string, record: ReviewProgressRecord): void {
    fs.mkdirSync(dir, { recursive: true });
    const tmpPath = `${filePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(record, null, 2), 'utf-8');
    fs.renameSync(tmpPath, filePath);
}

function migrateReviewProgress(
    dataDir: string,
    workspaceId: string,
    repoId: string,
    prId: string,
    scope?: PullRequestStorageScopeInput,
): void {
    if (!isPullRequestOriginScoped(workspaceId, scope)) return;
    const target = reviewProgressPaths(dataDir, workspaceId, repoId, prId, scope);
    let newest = normalizeStoredReviewProgress(readReviewProgressFile(target.filePath), repoId, prId);
    for (const legacy of resolvePullRequestLegacyScopes(workspaceId, repoId, scope)) {
        const legacyPath = reviewProgressPaths(dataDir, legacy.workspaceId, legacy.repoId, prId);
        if (legacyPath.filePath === target.filePath) continue;
        const candidate = normalizeStoredReviewProgress(readReviewProgressFile(legacyPath.filePath), repoId, prId);
        if (!candidate) continue;
        if (!newest || candidate.updatedAt > newest.updatedAt) {
            newest = candidate;
        }
    }
    if (newest) {
        writeReviewProgressFile(target.filePath, target.dir, newest);
    }
}

/**
 * Read the progress record for a (workspace, repo, pr) tuple. Returns the
 * stored record only when its headSha matches the supplied `headSha`;
 * otherwise an empty record is returned (stale-head reset).
 *
 * Returns `undefined` only if the dataDir/workspaceId itself is invalid.
 */
export function readReviewProgress(
    dataDir: string,
    workspaceId: string,
    repoId: string,
    prId: string,
    headSha: string,
    scope?: PullRequestStorageScopeInput,
): ReviewProgressRecord {
    migrateReviewProgress(dataDir, workspaceId, repoId, prId, scope);
    const { filePath } = reviewProgressPaths(dataDir, workspaceId, repoId, prId, scope);
    const record = normalizeStoredReviewProgress(readReviewProgressFile(filePath), repoId, prId);
    if (!record) {
        return emptyReviewProgress(repoId, prId, headSha);
    }
    // Stale-head reset: never serve progress for a different head.
    if (record.headSha !== headSha) {
        return emptyReviewProgress(repoId, prId, headSha);
    }
    return record;
}

/** Write a progress record atomically. */
export function writeReviewProgress(
    dataDir: string,
    workspaceId: string,
    repoId: string,
    prId: string,
    record: {
        headSha: string;
        reviewedFiles: string[];
        visitedFiles: string[];
        lastSelectedFile: string | null;
    },
    options?: { updatedAt?: string },
    scope?: PullRequestStorageScopeInput,
): ReviewProgressRecord {
    migrateReviewProgress(dataDir, workspaceId, repoId, prId, scope);
    const { filePath, dir } = reviewProgressPaths(dataDir, workspaceId, repoId, prId, scope);
    const out: ReviewProgressRecord = {
        repoId,
        prId,
        headSha: record.headSha,
        reviewedFiles: dedupeClampPaths(record.reviewedFiles),
        visitedFiles: dedupeClampPaths(record.visitedFiles),
        lastSelectedFile: record.lastSelectedFile,
        updatedAt: options?.updatedAt ?? new Date().toISOString(),
    };
    writeReviewProgressFile(filePath, dir, out);
    return out;
}

/** Best-effort delete of the progress file for a (workspace, repo, pr) tuple. */
export function clearReviewProgress(
    dataDir: string,
    workspaceId: string,
    repoId: string,
    prId: string,
    scope?: PullRequestStorageScopeInput,
): void {
    migrateReviewProgress(dataDir, workspaceId, repoId, prId, scope);
    const { filePath } = reviewProgressPaths(dataDir, workspaceId, repoId, prId, scope);
    try {
        fs.unlinkSync(filePath);
    } catch {
        /* missing — ok */
    }
}
