/**
 * Recent Opened Pull Requests Store
 *
 * File-based persistence for the Pull Requests tab's "Recently opened" list.
 *
 * Layout:
 *   ~/.coc/repos/<workspaceId>/recent-opened-pull-requests/<repoId>.json
 *
 * The file contains only minimal display metadata and is scoped by the target
 * workspace/repo tuple so multi-repo dashboards never share recent entries.
 */

import * as fs from 'fs';
import * as path from 'path';
import { getRepoDataPath } from '../paths';

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
): RecentOpenedPullRequestsPaths {
    const dir = getRepoDataPath(dataDir, workspaceId, 'recent-opened-pull-requests');
    const filePath = path.join(dir, `${sanitizeKeyPart(repoId)}.json`);
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

export function listRecentOpenedPullRequests(
    dataDir: string,
    workspaceId: string,
    repoId: string,
): RecentOpenedPullRequestEntry[] {
    const { filePath } = recentOpenedPullRequestsPaths(dataDir, workspaceId, repoId);
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

    return entries
        .filter(isRecentEntry)
        .filter(entry => entry.workspaceId === workspaceId && entry.repoId === repoId)
        .slice(0, MAX_RECENT_OPENED_PULL_REQUESTS);
}

function writeRecentOpenedPullRequests(
    dataDir: string,
    workspaceId: string,
    repoId: string,
    entries: RecentOpenedPullRequestEntry[],
): RecentOpenedPullRequestEntry[] {
    const { filePath, dir } = recentOpenedPullRequestsPaths(dataDir, workspaceId, repoId);
    fs.mkdirSync(dir, { recursive: true });
    const bounded = entries.slice(0, MAX_RECENT_OPENED_PULL_REQUESTS);
    const tmpPath = `${filePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify({ entries: bounded }, null, 2), 'utf-8');
    fs.renameSync(tmpPath, filePath);
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
): RecentOpenedPullRequestEntry[] {
    const openedAt = options?.openedAt ?? new Date().toISOString();
    const existing = listRecentOpenedPullRequests(dataDir, workspaceId, repoId);
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
    return writeRecentOpenedPullRequests(dataDir, workspaceId, repoId, next);
}

export function removeRecentOpenedPullRequest(
    dataDir: string,
    workspaceId: string,
    repoId: string,
    number: number,
): RecentOpenedPullRequestEntry[] {
    const existing = listRecentOpenedPullRequests(dataDir, workspaceId, repoId);
    return writeRecentOpenedPullRequests(
        dataDir,
        workspaceId,
        repoId,
        existing.filter(entry => entry.number !== number),
    );
}
