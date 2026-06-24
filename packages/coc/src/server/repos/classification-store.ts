/**
 * Classification Store
 *
 * File-based persistence for PR diff classification results. One JSON file per
 * (origin, pr, headSha) tuple when an origin scope is supplied, with a sibling
 * `.pending` marker while a classification task is in flight. Legacy
 * (workspace, repo, pr, headSha) files are migrated into the origin directory
 * on access.
 *
 * Layout:
 *   ~/.coc/repos/<originId>/classifications/<prId>_<headSha>.json
 *   ~/.coc/repos/<originId>/classifications/<prId>_<headSha>.json.pending
 *
 * No VS Code dependencies — uses only Node.js built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
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
import type {
    CriticalCallPathFrame,
    CriticalHunkMetadata,
    CriticalUsageEntry,
    DiffClassificationResult,
    HunkCategory,
    HunkClassification,
    HunkIntensity,
} from '../spa/client/react/features/pull-requests/classification-types';

// ============================================================================
// Types
// ============================================================================

/** Marker payload describing a classification task currently in flight. */
export interface ClassificationPending {
    processId: string;
    startedAt: string;
}

/** Stored payload for a completed classification. */
export interface ClassificationRecord {
    result: DiffClassificationResult;
    processId?: string;
    createdAt: string;
    headSha: string;
}

export interface ClassificationPaths {
    /** Absolute path to the completed `.json` file. */
    resultPath: string;
    /** Absolute path to the `.pending` marker file. */
    pendingPath: string;
    /** Directory containing all classifications for this workspace. */
    dir: string;
}

export interface ClassificationWriteOptions {
    processId?: string;
    createdAt?: string;
    storageScope?: PullRequestStorageScopeInput;
}

export interface ClassificationPendingOptions {
    startedAt?: string;
    storageScope?: PullRequestStorageScopeInput;
}

// ============================================================================
// Path helpers
// ============================================================================

const VALID_CATEGORIES: readonly HunkCategory[] = ['logic', 'mechanical', 'test', 'simple', 'generated'];
const VALID_INTENSITIES: readonly HunkIntensity[] = ['high', 'low'];

/** Replace filesystem-unsafe characters with `_`. */
function sanitizeKeyPart(part: string): string {
    return part.replace(/[^A-Za-z0-9._-]/g, '_');
}

/** Resolve the storage paths for a single (workspace, repo, pr, headSha) tuple. */
export function classificationPaths(
    dataDir: string,
    workspaceId: string,
    repoId: string,
    prId: string,
    headSha: string,
    scope?: PullRequestStorageScopeInput,
): ClassificationPaths {
    const storageId = resolvePullRequestStorageId(workspaceId, scope);
    const dir = getRepoDataPath(dataDir, storageId, 'classifications');
    const base = isPullRequestOriginScoped(workspaceId, scope)
        ? `${sanitizeKeyPart(prId)}_${sanitizeKeyPart(headSha)}`
        : `${sanitizeKeyPart(repoId)}_${sanitizeKeyPart(prId)}_${sanitizeKeyPart(headSha)}`;
    const resultPath = path.join(dir, `${base}.json`);
    const pendingPath = path.join(dir, `${base}.json.pending`);
    return { resultPath, pendingPath, dir };
}

function normalizeClassificationRecord(
    parsed: Partial<ClassificationRecord> | undefined,
    headSha: string,
): ClassificationRecord | undefined {
    if (!parsed || !parsed.result || !Array.isArray(parsed.result.classifications)) {
        return undefined;
    }
    return {
        result: parsed.result,
        processId: typeof parsed.processId === 'string' ? parsed.processId : undefined,
        createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : new Date(0).toISOString(),
        headSha: typeof parsed.headSha === 'string' ? parsed.headSha : headSha,
    };
}

function readClassificationFile(filePath: string, headSha: string): ClassificationRecord | undefined {
    try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        return normalizeClassificationRecord(JSON.parse(raw) as Partial<ClassificationRecord>, headSha);
    } catch {
        return undefined;
    }
}

function writeClassificationFile(resultPath: string, dir: string, record: ClassificationRecord): void {
    fs.mkdirSync(dir, { recursive: true });
    const tmpPath = `${resultPath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(record, null, 2), 'utf-8');
    fs.renameSync(tmpPath, resultPath);
}

function readPendingFile(pendingPath: string): ClassificationPending | undefined {
    try {
        const raw = fs.readFileSync(pendingPath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.processId === 'string' && typeof parsed.startedAt === 'string') {
            return parsed as ClassificationPending;
        }
    } catch {
        /* missing or unreadable */
    }
    return undefined;
}

function writePendingFile(pendingPath: string, dir: string, pending: ClassificationPending): void {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(pendingPath, JSON.stringify(pending, null, 2), 'utf-8');
}

function removePendingFile(pendingPath: string): void {
    try {
        fs.unlinkSync(pendingPath);
    } catch {
        /* ok */
    }
}

function migrateClassification(
    dataDir: string,
    workspaceId: string,
    repoId: string,
    prId: string,
    headSha: string,
    scope?: PullRequestStorageScopeInput,
): void {
    if (!isPullRequestOriginScoped(workspaceId, scope)) return;

    const target = classificationPaths(dataDir, workspaceId, repoId, prId, headSha, scope);
    const targetRecord = readClassificationFile(target.resultPath, headSha);
    let newestRecord = targetRecord;
    for (const legacy of resolvePullRequestLegacyScopes(workspaceId, repoId, scope)) {
        const legacyPath = classificationPaths(dataDir, legacy.workspaceId, legacy.repoId, prId, headSha);
        if (legacyPath.resultPath === target.resultPath) continue;
        const candidate = readClassificationFile(legacyPath.resultPath, headSha);
        if (!candidate) continue;
        if (!newestRecord || candidate.createdAt > newestRecord.createdAt) {
            newestRecord = candidate;
        }
    }

    if (newestRecord) {
        if (JSON.stringify(newestRecord) !== JSON.stringify(targetRecord)) {
            writeClassificationFile(target.resultPath, target.dir, newestRecord);
        }
        removePendingFile(target.pendingPath);
        return;
    }

    const targetPending = readPendingFile(target.pendingPath);
    let newestPending = targetPending;
    for (const legacy of resolvePullRequestLegacyScopes(workspaceId, repoId, scope)) {
        const legacyPath = classificationPaths(dataDir, legacy.workspaceId, legacy.repoId, prId, headSha);
        if (legacyPath.pendingPath === target.pendingPath) continue;
        const candidate = readPendingFile(legacyPath.pendingPath);
        if (!candidate) continue;
        if (!newestPending || candidate.startedAt > newestPending.startedAt) {
            newestPending = candidate;
        }
    }
    if (newestPending && JSON.stringify(newestPending) !== JSON.stringify(targetPending)) {
        writePendingFile(target.pendingPath, target.dir, newestPending);
    }
}

// ============================================================================
// Read / Write
// ============================================================================

/** Read the completed classification record, if any. Returns undefined when missing or corrupt. */
export function readClassification(
    dataDir: string,
    workspaceId: string,
    repoId: string,
    prId: string,
    headSha: string,
    scope?: PullRequestStorageScopeInput,
): ClassificationRecord | undefined {
    migrateClassification(dataDir, workspaceId, repoId, prId, headSha, scope);
    const { resultPath } = classificationPaths(dataDir, workspaceId, repoId, prId, headSha, scope);
    return readClassificationFile(resultPath, headSha);
}

/**
 * Write a completed classification atomically, then remove any `.pending` marker.
 * Validates the result before writing — throws if invalid.
 */
export function writeClassification(
    dataDir: string,
    workspaceId: string,
    repoId: string,
    prId: string,
    headSha: string,
    result: DiffClassificationResult,
    options?: ClassificationWriteOptions,
): ClassificationRecord {
    const validation = validateClassificationResult(result);
    if (!validation.ok) {
        throw new Error(validation.error);
    }

    const { resultPath, pendingPath, dir } = classificationPaths(dataDir, workspaceId, repoId, prId, headSha, options?.storageScope);

    const record: ClassificationRecord = {
        result: { classifications: validation.classifications },
        processId: options?.processId,
        createdAt: options?.createdAt ?? new Date().toISOString(),
        headSha,
    };

    writeClassificationFile(resultPath, dir, record);

    // Best-effort cleanup of the pending marker.
    removePendingFile(pendingPath);

    return record;
}

/** Write the `.pending` marker file. */
export function writePending(
    dataDir: string,
    workspaceId: string,
    repoId: string,
    prId: string,
    headSha: string,
    processId: string,
    options?: ClassificationPendingOptions,
): ClassificationPending {
    const { pendingPath, dir } = classificationPaths(dataDir, workspaceId, repoId, prId, headSha, options?.storageScope);
    const pending: ClassificationPending = {
        processId,
        startedAt: options?.startedAt ?? new Date().toISOString(),
    };
    writePendingFile(pendingPath, dir, pending);
    return pending;
}

/** Read the `.pending` marker if present. */
export function readPending(
    dataDir: string,
    workspaceId: string,
    repoId: string,
    prId: string,
    headSha: string,
    scope?: PullRequestStorageScopeInput,
): ClassificationPending | undefined {
    migrateClassification(dataDir, workspaceId, repoId, prId, headSha, scope);
    const { pendingPath } = classificationPaths(dataDir, workspaceId, repoId, prId, headSha, scope);
    return readPendingFile(pendingPath);
}

/** Best-effort removal of the `.pending` marker. */
export function clearPending(
    dataDir: string,
    workspaceId: string,
    repoId: string,
    prId: string,
    headSha: string,
    scope?: PullRequestStorageScopeInput,
): void {
    const { pendingPath } = classificationPaths(dataDir, workspaceId, repoId, prId, headSha, scope);
    removePendingFile(pendingPath);
    if (isPullRequestOriginScoped(workspaceId, scope)) {
        for (const legacy of resolvePullRequestLegacyScopes(workspaceId, repoId, scope)) {
            const legacyPath = classificationPaths(dataDir, legacy.workspaceId, legacy.repoId, prId, headSha);
            if (legacyPath.pendingPath !== pendingPath) {
                removePendingFile(legacyPath.pendingPath);
            }
        }
    }
}

// ============================================================================
// Validation
// ============================================================================

export type ClassificationValidation =
    | { ok: true; classifications: HunkClassification[] }
    | { ok: false; error: string };

/**
 * Strict validation of a `DiffClassificationResult`. Returns the typed
 * classifications on success, or a human-readable error message on failure.
 */
export function validateClassificationResult(
    result: unknown,
): ClassificationValidation {
    if (!result || typeof result !== 'object') {
        return { ok: false, error: 'result must be an object' };
    }
    const arr = (result as { classifications?: unknown }).classifications;
    if (!Array.isArray(arr)) {
        return { ok: false, error: 'result.classifications must be an array' };
    }
    if (arr.length === 0) {
        return { ok: false, error: 'result.classifications must contain at least one entry' };
    }

    const out: HunkClassification[] = [];
    for (let i = 0; i < arr.length; i++) {
        const entry = arr[i];
        if (!entry || typeof entry !== 'object') {
            return { ok: false, error: `classifications[${i}] must be an object` };
        }
        const e = entry as Record<string, unknown>;
        if (typeof e.file !== 'string' || e.file.length === 0) {
            return { ok: false, error: `classifications[${i}].file must be a non-empty string` };
        }
        if (typeof e.hunkIndex !== 'number' || !Number.isInteger(e.hunkIndex) || e.hunkIndex < 0) {
            return { ok: false, error: `classifications[${i}].hunkIndex must be a non-negative integer` };
        }
        if (typeof e.category !== 'string' || !VALID_CATEGORIES.includes(e.category as HunkCategory)) {
            return { ok: false, error: `classifications[${i}].category must be one of: ${VALID_CATEGORIES.join(', ')}` };
        }
        const category = e.category as HunkCategory;
        if (typeof e.intensity !== 'string' || !VALID_INTENSITIES.includes(e.intensity as HunkIntensity)) {
            return { ok: false, error: `classifications[${i}].intensity must be one of: ${VALID_INTENSITIES.join(', ')}` };
        }
        if (typeof e.reason !== 'string' || e.reason.length === 0) {
            return { ok: false, error: `classifications[${i}].reason must be a non-empty string` };
        }

        let testFidelityComment: string | undefined;
        if (category === 'test') {
            if (!isNonEmptyString(e.testFidelityComment)) {
                return { ok: false, error: `classifications[${i}].testFidelityComment must be a non-empty string for test hunks` };
            }
            testFidelityComment = e.testFidelityComment;
        } else if (e.testFidelityComment !== undefined) {
            if (!isNonEmptyString(e.testFidelityComment)) {
                return { ok: false, error: `classifications[${i}].testFidelityComment must be a non-empty string when provided` };
            }
            testFidelityComment = e.testFidelityComment;
        }

        let summaryComment: string | undefined;
        if (category === 'logic') {
            if (!isNonEmptyString(e.summaryComment)) {
                return { ok: false, error: `classifications[${i}].summaryComment must be a non-empty string for logic hunks` };
            }
            summaryComment = e.summaryComment;
        } else if (e.summaryComment !== undefined) {
            if (!isNonEmptyString(e.summaryComment)) {
                return { ok: false, error: `classifications[${i}].summaryComment must be a non-empty string when provided` };
            }
            summaryComment = e.summaryComment;
        }

        const criticalValidation = validateCriticalMetadata(e.critical, i);
        if (!criticalValidation.ok) {
            return criticalValidation;
        }

        const classification: HunkClassification = {
            file: e.file,
            hunkIndex: e.hunkIndex,
            category,
            intensity: e.intensity as HunkIntensity,
            reason: e.reason,
        };
        if (testFidelityComment !== undefined) {
            classification.testFidelityComment = testFidelityComment;
        }
        if (summaryComment !== undefined) {
            classification.summaryComment = summaryComment;
        }
        if (criticalValidation.critical !== undefined) {
            classification.critical = criticalValidation.critical;
        }
        out.push(classification);
    }

    return { ok: true, classifications: out };
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

function validateOptionalLineNumber(value: unknown, fieldPath: string): string | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
        return `${fieldPath} must be a positive integer when provided`;
    }
    return undefined;
}

type CriticalValidation =
    | { ok: true; critical?: CriticalHunkMetadata }
    | { ok: false; error: string };

function validateCriticalMetadata(raw: unknown, classificationIndex: number): CriticalValidation {
    if (raw === undefined) {
        return { ok: true };
    }
    const prefix = `classifications[${classificationIndex}].critical`;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return { ok: false, error: `${prefix} must be an object when provided` };
    }
    const c = raw as Record<string, unknown>;
    if (!isNonEmptyString(c.label)) {
        return { ok: false, error: `${prefix}.label must be a non-empty string` };
    }
    if (!isNonEmptyString(c.impactSummary)) {
        return { ok: false, error: `${prefix}.impactSummary must be a non-empty string` };
    }
    if (!Array.isArray(c.usages)) {
        return { ok: false, error: `${prefix}.usages must be an array` };
    }
    if (c.usages.length > 3) {
        return { ok: false, error: `${prefix}.usages must contain at most 3 entries` };
    }
    if (!Array.isArray(c.callPath)) {
        return { ok: false, error: `${prefix}.callPath must be an array` };
    }
    if (c.callPath.length > 4) {
        return { ok: false, error: `${prefix}.callPath must contain at most 4 frames` };
    }
    if (c.usageNotDetermined !== undefined && typeof c.usageNotDetermined !== 'boolean') {
        return { ok: false, error: `${prefix}.usageNotDetermined must be a boolean when provided` };
    }
    if (c.callStackNotDetermined !== undefined && typeof c.callStackNotDetermined !== 'boolean') {
        return { ok: false, error: `${prefix}.callStackNotDetermined must be a boolean when provided` };
    }
    if (c.usages.length === 0 && c.usageNotDetermined !== true) {
        return { ok: false, error: `${prefix}.usages must include evidence or set usageNotDetermined to true` };
    }
    if (c.callPath.length === 0 && c.callStackNotDetermined !== true) {
        return { ok: false, error: `${prefix}.callPath must include evidence or set callStackNotDetermined to true` };
    }

    const usages: CriticalUsageEntry[] = [];
    for (let i = 0; i < c.usages.length; i++) {
        const usage = c.usages[i];
        const usagePath = `${prefix}.usages[${i}]`;
        if (!usage || typeof usage !== 'object' || Array.isArray(usage)) {
            return { ok: false, error: `${usagePath} must be an object` };
        }
        const u = usage as Record<string, unknown>;
        if (!isNonEmptyString(u.file)) {
            return { ok: false, error: `${usagePath}.file must be a non-empty string` };
        }
        if (u.symbol !== undefined && !isNonEmptyString(u.symbol)) {
            return { ok: false, error: `${usagePath}.symbol must be a non-empty string when provided` };
        }
        const lineError = validateOptionalLineNumber(u.line, `${usagePath}.line`);
        if (lineError) {
            return { ok: false, error: lineError };
        }
        const usageLine = typeof u.line === 'number' ? u.line : undefined;
        if (!isNonEmptyString(u.description)) {
            return { ok: false, error: `${usagePath}.description must be a non-empty string` };
        }
        usages.push({
            file: u.file,
            ...(u.symbol !== undefined ? { symbol: u.symbol } : {}),
            ...(usageLine !== undefined ? { line: usageLine } : {}),
            description: u.description,
        });
    }

    const callPath: CriticalCallPathFrame[] = [];
    for (let i = 0; i < c.callPath.length; i++) {
        const frame = c.callPath[i];
        const framePath = `${prefix}.callPath[${i}]`;
        if (!frame || typeof frame !== 'object' || Array.isArray(frame)) {
            return { ok: false, error: `${framePath} must be an object` };
        }
        const f = frame as Record<string, unknown>;
        if (!isNonEmptyString(f.file)) {
            return { ok: false, error: `${framePath}.file must be a non-empty string` };
        }
        if (!isNonEmptyString(f.symbol)) {
            return { ok: false, error: `${framePath}.symbol must be a non-empty string` };
        }
        const lineError = validateOptionalLineNumber(f.line, `${framePath}.line`);
        if (lineError) {
            return { ok: false, error: lineError };
        }
        const frameLine = typeof f.line === 'number' ? f.line : undefined;
        if (f.description !== undefined && !isNonEmptyString(f.description)) {
            return { ok: false, error: `${framePath}.description must be a non-empty string when provided` };
        }
        callPath.push({
            file: f.file,
            symbol: f.symbol,
            ...(frameLine !== undefined ? { line: frameLine } : {}),
            ...(f.description !== undefined ? { description: f.description } : {}),
        });
    }

    return {
        ok: true,
        critical: {
            label: c.label,
            impactSummary: c.impactSummary,
            usages,
            callPath,
            ...(c.usageNotDetermined !== undefined ? { usageNotDetermined: c.usageNotDetermined } : {}),
            ...(c.callStackNotDetermined !== undefined ? { callStackNotDetermined: c.callStackNotDetermined } : {}),
        },
    };
}

// ============================================================================
// Pruning
// ============================================================================

/**
 * Remove classification files older than `maxAgeDays` for a single storage
 * scope. Pass `scope` to prune the canonical origin directory rather than the
 * raw `workspaceId` directory. Returns the number of files removed.
 * Best-effort: errors are swallowed.
 */
export function pruneStaleClassifications(
    dataDir: string,
    workspaceId: string,
    maxAgeDays = 30,
    scope?: PullRequestStorageScopeInput,
): number {
    if (maxAgeDays <= 0) return 0;
    const storageId = resolvePullRequestStorageId(workspaceId, scope);
    const dir = getRepoDataPath(dataDir, storageId, 'classifications');
    let removed = 0;
    let entries: string[] = [];
    try {
        entries = fs.readdirSync(dir);
    } catch {
        return 0;
    }

    const cutoffMs = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
    for (const name of entries) {
        if (!name.endsWith('.json') && !name.endsWith('.pending')) continue;
        const full = path.join(dir, name);
        try {
            const st = fs.statSync(full);
            if (st.mtimeMs < cutoffMs) {
                fs.unlinkSync(full);
                removed++;
            }
        } catch {
            /* skip */
        }
    }
    return removed;
}

/**
 * Prune every workspace directory under `<dataDir>/repos`. Returns total files removed.
 */
export function pruneAllStaleClassifications(dataDir: string, maxAgeDays = 30): number {
    const reposRoot = path.join(dataDir, 'repos');
    let total = 0;
    let entries: fs.Dirent[] = [];
    try {
        entries = fs.readdirSync(reposRoot, { withFileTypes: true });
    } catch {
        return 0;
    }
    for (const entry of entries) {
        if (entry.isDirectory()) {
            total += pruneStaleClassifications(dataDir, entry.name, maxAgeDays);
        }
    }
    return total;
}
