/**
 * Pull Request Coworker Roster Store
 *
 * File-based persistence for the Pull Requests tab's Team roster.
 *
 * Layout:
 *   ~/.coc/repos/<workspaceId>/pr-coworker-roster/<repoId>.json
 */

import * as fs from 'fs';
import * as path from 'path';
import { getRepoDataPath } from '../paths';

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
): PullRequestCoworkerRosterPaths {
    const dir = getRepoDataPath(dataDir, workspaceId, 'pr-coworker-roster');
    const filePath = path.join(dir, `${sanitizeKeyPart(repoId)}.json`);
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

export function listPullRequestCoworkerRoster(
    dataDir: string,
    workspaceId: string,
    repoId: string,
): PullRequestCoworkerRosterEntry[] {
    const { filePath } = pullRequestCoworkerRosterPaths(dataDir, workspaceId, repoId);
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

function writePullRequestCoworkerRoster(
    dataDir: string,
    workspaceId: string,
    repoId: string,
    entries: PullRequestCoworkerRosterEntry[],
): PullRequestCoworkerRosterEntry[] {
    const { filePath, dir } = pullRequestCoworkerRosterPaths(dataDir, workspaceId, repoId);
    fs.mkdirSync(dir, { recursive: true });
    const tmpPath = `${filePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify({ entries }, null, 2), 'utf-8');
    fs.renameSync(tmpPath, filePath);
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
): PullRequestCoworkerRosterEntry[] {
    const existing = listPullRequestCoworkerRoster(dataDir, workspaceId, repoId);
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

    return writePullRequestCoworkerRoster(dataDir, workspaceId, repoId, next);
}

export function removePullRequestCoworkerFromRoster(
    dataDir: string,
    workspaceId: string,
    repoId: string,
    coworkerKey: string,
): PullRequestCoworkerRosterEntry[] {
    const normalizedKey = coworkerKey.trim().toLowerCase();
    const existing = listPullRequestCoworkerRoster(dataDir, workspaceId, repoId);
    return writePullRequestCoworkerRoster(
        dataDir,
        workspaceId,
        repoId,
        existing.filter(entry => pullRequestCoworkerRosterEntryKey(entry) !== normalizedKey),
    );
}
