/**
 * Pull Request Coworker Roster Store
 *
 * File-based persistence for the Pull Requests tab's Team roster.
 *
 * Layout:
 *   ~/.coc/repos/<originId>/pr-coworker-roster/index.json
 *
 * Legacy workspace/repo tuple files are migrated into the origin file on access
 * when an origin storage scope is supplied.
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

export const MAX_PR_COWORKER_ID_LENGTH = 256;
export const MAX_PR_COWORKER_DISPLAY_NAME_LENGTH = 200;
export const MAX_PR_COWORKER_EMAIL_LENGTH = 320;
export const MAX_PR_COWORKER_AVATAR_URL_LENGTH = 2048;

export interface PullRequestCoworkerRosterEntry {
    id: string;
    displayName: string;
    email?: string;
    avatarUrl?: string;
    addedAt: string;
}

export interface PullRequestCoworkerRosterPaths {
    filePath: string;
    dir: string;
}

export type PullRequestCoworkerRosterValidation =
    | {
        ok: true;
        entry: {
            id: string;
            displayName: string;
            email?: string;
            avatarUrl?: string;
        };
    }
    | { ok: false; error: string };

function sanitizeKeyPart(part: string): string {
    return part.replace(/[^A-Za-z0-9._-]/g, '_');
}

export function pullRequestCoworkerRosterPaths(
    dataDir: string,
    workspaceId: string,
    repoId: string,
    scope?: PullRequestStorageScopeInput,
): PullRequestCoworkerRosterPaths {
    const storageId = resolvePullRequestStorageId(workspaceId, scope);
    const dir = getRepoDataPath(dataDir, storageId, 'pr-coworker-roster');
    const fileName = isPullRequestOriginScoped(workspaceId, scope)
        ? 'index.json'
        : `${sanitizeKeyPart(repoId)}.json`;
    const filePath = path.join(dir, fileName);
    return { filePath, dir };
}

function sanitizeOptionalString(
    value: unknown,
    fieldName: string,
    maxLength: number,
): { ok: true; value?: string } | { ok: false; error: string } {
    if (value === undefined || value === null) return { ok: true };
    if (typeof value !== 'string') return { ok: false, error: `${fieldName} must be a string when provided` };
    const trimmed = value.trim();
    if (!trimmed) return { ok: true };
    if (trimmed.length > maxLength) {
        return { ok: false, error: `${fieldName} must be at most ${maxLength} characters` };
    }
    return { ok: true, value: trimmed };
}

function sanitizeAvatarUrl(value: unknown): { ok: true; avatarUrl?: string } | { ok: false; error: string } {
    if (value === undefined || value === null) return { ok: true };
    if (typeof value !== 'string') return { ok: false, error: 'avatarUrl must be a string when provided' };
    const trimmed = value.trim();
    if (!trimmed) return { ok: true };
    if (trimmed.length > MAX_PR_COWORKER_AVATAR_URL_LENGTH) {
        return { ok: false, error: `avatarUrl must be at most ${MAX_PR_COWORKER_AVATAR_URL_LENGTH} characters` };
    }

    let parsed: URL;
    try {
        parsed = new URL(trimmed);
    } catch {
        return { ok: false, error: 'avatarUrl must be a valid URL' };
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return { ok: false, error: 'avatarUrl must use http or https' };
    }
    if (parsed.username || parsed.password) {
        return { ok: false, error: 'avatarUrl must not contain credentials' };
    }

    parsed.search = '';
    parsed.hash = '';
    return { ok: true, avatarUrl: parsed.toString() };
}

export function validatePullRequestCoworkerRosterInput(input: unknown): PullRequestCoworkerRosterValidation {
    if (!input || typeof input !== 'object') {
        return { ok: false, error: 'body must be a JSON object' };
    }

    const body = input as Record<string, unknown>;
    const idResult = sanitizeOptionalString(body.id, 'id', MAX_PR_COWORKER_ID_LENGTH);
    if (!idResult.ok) return idResult;

    if (typeof body.displayName !== 'string') {
        return { ok: false, error: 'displayName must be a non-empty string' };
    }
    const displayName = body.displayName.trim();
    if (!displayName) {
        return { ok: false, error: 'displayName must be a non-empty string' };
    }
    if (displayName.length > MAX_PR_COWORKER_DISPLAY_NAME_LENGTH) {
        return { ok: false, error: `displayName must be at most ${MAX_PR_COWORKER_DISPLAY_NAME_LENGTH} characters` };
    }

    const emailResult = sanitizeOptionalString(body.email, 'email', MAX_PR_COWORKER_EMAIL_LENGTH);
    if (!emailResult.ok) return emailResult;

    const avatarUrlResult = sanitizeAvatarUrl(body.avatarUrl);
    if (!avatarUrlResult.ok) return avatarUrlResult;

    return {
        ok: true,
        entry: {
            id: idResult.value ?? '',
            displayName,
            ...(emailResult.value ? { email: emailResult.value } : {}),
            ...(avatarUrlResult.avatarUrl ? { avatarUrl: avatarUrlResult.avatarUrl } : {}),
        },
    };
}

function isCoworkerRosterEntry(value: unknown): value is PullRequestCoworkerRosterEntry {
    if (!value || typeof value !== 'object') return false;
    const entry = value as Partial<PullRequestCoworkerRosterEntry>;
    return (
        typeof entry.id === 'string' &&
        typeof entry.displayName === 'string' &&
        typeof entry.addedAt === 'string' &&
        (entry.email === undefined || typeof entry.email === 'string') &&
        (entry.avatarUrl === undefined || typeof entry.avatarUrl === 'string')
    );
}

export function pullRequestCoworkerRosterEntryKey(
    entry: Pick<PullRequestCoworkerRosterEntry, 'id' | 'displayName'>,
): string {
    const id = entry.id.trim();
    return (id || entry.displayName).trim().toLowerCase();
}

function readPullRequestCoworkerRosterFile(filePath: string): PullRequestCoworkerRosterEntry[] {
    let raw: string;
    try {
        raw = fs.readFileSync(filePath, 'utf-8');
    } catch {
        return [];
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return [];
    }

    const entries = (
        parsed &&
        typeof parsed === 'object' &&
        Array.isArray((parsed as { entries?: unknown }).entries)
    )
        ? (parsed as { entries: unknown[] }).entries
        : [];

    return entries.filter(isCoworkerRosterEntry);
}

function mergePullRequestCoworkerRosterEntries(
    current: readonly PullRequestCoworkerRosterEntry[],
    incoming: readonly PullRequestCoworkerRosterEntry[],
): PullRequestCoworkerRosterEntry[] {
    const byKey = new Map<string, PullRequestCoworkerRosterEntry>();
    for (const entry of [...current, ...incoming]) {
        const key = pullRequestCoworkerRosterEntryKey(entry);
        const existing = byKey.get(key);
        if (!existing || entry.addedAt > existing.addedAt) {
            byKey.set(key, entry);
        }
    }
    return [...byKey.values()].sort((a, b) => a.addedAt.localeCompare(b.addedAt));
}

function persistPullRequestCoworkerRoster(filePath: string, dir: string, entries: PullRequestCoworkerRosterEntry[]): void {
    fs.mkdirSync(dir, { recursive: true });
    const tmpPath = `${filePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify({ entries }, null, 2), 'utf-8');
    fs.renameSync(tmpPath, filePath);
}

function migratePullRequestCoworkerRoster(
    dataDir: string,
    workspaceId: string,
    repoId: string,
    scope?: PullRequestStorageScopeInput,
): void {
    if (!isPullRequestOriginScoped(workspaceId, scope)) return;
    const target = pullRequestCoworkerRosterPaths(dataDir, workspaceId, repoId, scope);
    let merged = readPullRequestCoworkerRosterFile(target.filePath);
    const before = JSON.stringify(merged);
    for (const legacy of resolvePullRequestLegacyScopes(workspaceId, repoId, scope)) {
        const legacyPath = pullRequestCoworkerRosterPaths(dataDir, legacy.workspaceId, legacy.repoId);
        if (legacyPath.filePath === target.filePath) continue;
        merged = mergePullRequestCoworkerRosterEntries(merged, readPullRequestCoworkerRosterFile(legacyPath.filePath));
    }
    if (merged.length > 0 && JSON.stringify(merged) !== before) {
        persistPullRequestCoworkerRoster(target.filePath, target.dir, merged);
    }
}

export function listPullRequestCoworkerRoster(
    dataDir: string,
    workspaceId: string,
    repoId: string,
    scope?: PullRequestStorageScopeInput,
): PullRequestCoworkerRosterEntry[] {
    migratePullRequestCoworkerRoster(dataDir, workspaceId, repoId, scope);
    const { filePath } = pullRequestCoworkerRosterPaths(dataDir, workspaceId, repoId, scope);
    return readPullRequestCoworkerRosterFile(filePath);
}

function writePullRequestCoworkerRoster(
    dataDir: string,
    workspaceId: string,
    repoId: string,
    entries: PullRequestCoworkerRosterEntry[],
    scope?: PullRequestStorageScopeInput,
): PullRequestCoworkerRosterEntry[] {
    const { filePath, dir } = pullRequestCoworkerRosterPaths(dataDir, workspaceId, repoId, scope);
    persistPullRequestCoworkerRoster(filePath, dir, entries);
    return entries;
}

export function addPullRequestCoworkerToRoster(
    dataDir: string,
    workspaceId: string,
    repoId: string,
    entry: {
        id: string;
        displayName: string;
        email?: string;
        avatarUrl?: string;
    },
    options?: { addedAt?: string },
    scope?: PullRequestStorageScopeInput,
): PullRequestCoworkerRosterEntry[] {
    const existing = listPullRequestCoworkerRoster(dataDir, workspaceId, repoId, scope);
    const addedAt = options?.addedAt ?? new Date().toISOString();
    const nextEntry: PullRequestCoworkerRosterEntry = {
        id: entry.id,
        displayName: entry.displayName,
        ...(entry.email ? { email: entry.email } : {}),
        ...(entry.avatarUrl ? { avatarUrl: entry.avatarUrl } : {}),
        addedAt,
    };
    const nextKey = pullRequestCoworkerRosterEntryKey(nextEntry);

    let replaced = false;
    const next = existing.map(candidate => {
        if (pullRequestCoworkerRosterEntryKey(candidate) !== nextKey) return candidate;
        replaced = true;
        return {
            ...nextEntry,
            addedAt: candidate.addedAt,
        };
    });

    if (!replaced) {
        next.push(nextEntry);
    }

    return writePullRequestCoworkerRoster(dataDir, workspaceId, repoId, next, scope);
}

export function removePullRequestCoworkerFromRoster(
    dataDir: string,
    workspaceId: string,
    repoId: string,
    coworkerKey: string,
    scope?: PullRequestStorageScopeInput,
): PullRequestCoworkerRosterEntry[] {
    const normalizedKey = coworkerKey.trim().toLowerCase();
    const existing = listPullRequestCoworkerRoster(dataDir, workspaceId, repoId, scope);
    return writePullRequestCoworkerRoster(
        dataDir,
        workspaceId,
        repoId,
        existing.filter(entry => pullRequestCoworkerRosterEntryKey(entry) !== normalizedKey),
        scope,
    );
}
