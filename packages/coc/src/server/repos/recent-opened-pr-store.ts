/**
 * Recent Opened Pull Requests Store
 *
 * File-based persistence for the Pull Requests tab's "Recently opened" list.
 *
 * Layout:
 *   ~/.coc/repos/<originId>/recent-opened-pull-requests/index.json
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

export const MAX_RECENT_OPENED_PULL_REQUESTS = 10;
export const MAX_RECENT_PR_TITLE_LENGTH = 500;
export const MAX_RECENT_PR_WEB_URL_LENGTH = 2048;

export interface RecentOpenedPullRequestEntry {
    workspaceId: string;
    repoId: string;
    number: number;
    title: string;
    webUrl?: string;
    openedAt: string;
}

export interface RecentOpenedPullRequestsPaths {
    filePath: string;
    dir: string;
}

export type RecentOpenedPullRequestValidation =
    | {
        ok: true;
        entry: {
            number: number;
            title: string;
            webUrl?: string;
        };
    }
    | { ok: false; error: string };

function sanitizeKeyPart(part: string): string {
    return part.replace(/[^A-Za-z0-9._-]/g, '_');
}

export function recentOpenedPullRequestsPaths(
    dataDir: string,
    workspaceId: string,
    repoId: string,
    scope?: PullRequestStorageScopeInput,
): RecentOpenedPullRequestsPaths {
    const storageId = resolvePullRequestStorageId(workspaceId, scope);
    const dir = getRepoDataPath(dataDir, storageId, 'recent-opened-pull-requests');
    const fileName = isPullRequestOriginScoped(workspaceId, scope)
        ? 'index.json'
        : `${sanitizeKeyPart(repoId)}.json`;
    const filePath = path.join(dir, fileName);
    return { filePath, dir };
}

function sanitizeWebUrl(value: unknown): { ok: true; webUrl?: string } | { ok: false; error: string } {
    if (value === undefined || value === null) return { ok: true };
    if (typeof value !== 'string') return { ok: false, error: 'webUrl must be a string when provided' };
    const trimmed = value.trim();
    if (!trimmed) return { ok: true };
    if (trimmed.length > MAX_RECENT_PR_WEB_URL_LENGTH) {
        return { ok: false, error: `webUrl must be at most ${MAX_RECENT_PR_WEB_URL_LENGTH} characters` };
    }

    let parsed: URL;
    try {
        parsed = new URL(trimmed);
    } catch {
        return { ok: false, error: 'webUrl must be a valid URL' };
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return { ok: false, error: 'webUrl must use http or https' };
    }
    if (parsed.username || parsed.password) {
        return { ok: false, error: 'webUrl must not contain credentials' };
    }

    parsed.search = '';
    parsed.hash = '';
    return { ok: true, webUrl: parsed.toString() };
}

export function validateRecentOpenedPullRequestInput(input: unknown): RecentOpenedPullRequestValidation {
    if (!input || typeof input !== 'object') {
        return { ok: false, error: 'body must be a JSON object' };
    }

    const body = input as Record<string, unknown>;
    if (!Number.isSafeInteger(body.number) || (body.number as number) <= 0) {
        return { ok: false, error: 'number must be a positive integer' };
    }

    if (typeof body.title !== 'string') {
        return { ok: false, error: 'title must be a non-empty string' };
    }
    const title = body.title.trim();
    if (!title) {
        return { ok: false, error: 'title must be a non-empty string' };
    }
    if (title.length > MAX_RECENT_PR_TITLE_LENGTH) {
        return { ok: false, error: `title must be at most ${MAX_RECENT_PR_TITLE_LENGTH} characters` };
    }

    const webUrlResult = sanitizeWebUrl(body.webUrl);
    if (!webUrlResult.ok) return webUrlResult;

    return {
        ok: true,
        entry: {
            number: body.number as number,
            title,
            webUrl: webUrlResult.webUrl,
        },
    };
}

function isRecentEntry(value: unknown): value is RecentOpenedPullRequestEntry {
    if (!value || typeof value !== 'object') return false;
    const entry = value as Partial<RecentOpenedPullRequestEntry>;
    return (
        typeof entry.workspaceId === 'string' &&
        typeof entry.repoId === 'string' &&
        Number.isSafeInteger(entry.number) &&
        typeof entry.title === 'string' &&
        typeof entry.openedAt === 'string' &&
        (entry.webUrl === undefined || typeof entry.webUrl === 'string')
    );
}

function readRecentOpenedPullRequestsFile(filePath: string): RecentOpenedPullRequestEntry[] {
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

    return entries.filter(isRecentEntry);
}

function mergeRecentOpenedEntries(
    current: readonly RecentOpenedPullRequestEntry[],
    incoming: readonly RecentOpenedPullRequestEntry[],
): RecentOpenedPullRequestEntry[] {
    const byNumber = new Map<number, RecentOpenedPullRequestEntry>();
    for (const entry of [...current, ...incoming]) {
        const existing = byNumber.get(entry.number);
        if (!existing || entry.openedAt > existing.openedAt) {
            byNumber.set(entry.number, entry);
        }
    }
    return [...byNumber.values()]
        .sort((a, b) => b.openedAt.localeCompare(a.openedAt))
        .slice(0, MAX_RECENT_OPENED_PULL_REQUESTS);
}

function persistRecentOpenedPullRequests(filePath: string, dir: string, entries: RecentOpenedPullRequestEntry[]): void {
    fs.mkdirSync(dir, { recursive: true });
    const tmpPath = `${filePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify({ entries }, null, 2), 'utf-8');
    fs.renameSync(tmpPath, filePath);
}

function migrateRecentOpenedPullRequests(
    dataDir: string,
    workspaceId: string,
    repoId: string,
    scope?: PullRequestStorageScopeInput,
): void {
    if (!isPullRequestOriginScoped(workspaceId, scope)) return;
    const target = recentOpenedPullRequestsPaths(dataDir, workspaceId, repoId, scope);
    let merged = readRecentOpenedPullRequestsFile(target.filePath);
    const before = JSON.stringify(merged);
    for (const legacy of resolvePullRequestLegacyScopes(workspaceId, repoId, scope)) {
        const legacyPath = recentOpenedPullRequestsPaths(dataDir, legacy.workspaceId, legacy.repoId);
        if (legacyPath.filePath === target.filePath) continue;
        merged = mergeRecentOpenedEntries(merged, readRecentOpenedPullRequestsFile(legacyPath.filePath));
    }
    if (merged.length > 0 && JSON.stringify(merged) !== before) {
        persistRecentOpenedPullRequests(target.filePath, target.dir, merged);
    }
}

export function listRecentOpenedPullRequests(
    dataDir: string,
    workspaceId: string,
    repoId: string,
    scope?: PullRequestStorageScopeInput,
): RecentOpenedPullRequestEntry[] {
    migrateRecentOpenedPullRequests(dataDir, workspaceId, repoId, scope);
    const { filePath } = recentOpenedPullRequestsPaths(dataDir, workspaceId, repoId, scope);
    return readRecentOpenedPullRequestsFile(filePath)
        .filter(entry => isPullRequestOriginScoped(workspaceId, scope) || (entry.workspaceId === workspaceId && entry.repoId === repoId))
        .slice(0, MAX_RECENT_OPENED_PULL_REQUESTS);
}

function writeRecentOpenedPullRequests(
    dataDir: string,
    workspaceId: string,
    repoId: string,
    entries: RecentOpenedPullRequestEntry[],
    scope?: PullRequestStorageScopeInput,
): RecentOpenedPullRequestEntry[] {
    const { filePath, dir } = recentOpenedPullRequestsPaths(dataDir, workspaceId, repoId, scope);
    const bounded = entries.slice(0, MAX_RECENT_OPENED_PULL_REQUESTS);
    persistRecentOpenedPullRequests(filePath, dir, bounded);
    return bounded;
}

export function recordRecentOpenedPullRequest(
    dataDir: string,
    workspaceId: string,
    repoId: string,
    entry: {
        number: number;
        title: string;
        webUrl?: string;
    },
    options?: { openedAt?: string },
    scope?: PullRequestStorageScopeInput,
): RecentOpenedPullRequestEntry[] {
    const openedAt = options?.openedAt ?? new Date().toISOString();
    const existing = listRecentOpenedPullRequests(dataDir, workspaceId, repoId, scope);
    const next: RecentOpenedPullRequestEntry[] = [
        {
            workspaceId,
            repoId,
            number: entry.number,
            title: entry.title,
            ...(entry.webUrl ? { webUrl: entry.webUrl } : {}),
            openedAt,
        },
        ...existing.filter(candidate => candidate.number !== entry.number),
    ];
    return writeRecentOpenedPullRequests(dataDir, workspaceId, repoId, next, scope);
}

export function removeRecentOpenedPullRequest(
    dataDir: string,
    workspaceId: string,
    repoId: string,
    number: number,
    scope?: PullRequestStorageScopeInput,
): RecentOpenedPullRequestEntry[] {
    const existing = listRecentOpenedPullRequests(dataDir, workspaceId, repoId, scope);
    return writeRecentOpenedPullRequests(
        dataDir,
        workspaceId,
        repoId,
        existing.filter(entry => entry.number !== number),
        scope,
    );
}
