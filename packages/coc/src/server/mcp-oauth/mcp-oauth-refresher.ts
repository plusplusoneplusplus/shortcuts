/**
 * Background maintenance for the Copilot SDK's MCP OAuth cache at
 * `~/.copilot/mcp-oauth-config/`. Dedups duplicate entries the SDK
 * accumulates per `serverUrl` across reauth flows and refreshes AAD tokens
 * before they expire so users on remote machines don't have to redo the
 * localhost PKCE redirect.
 */

import * as fs from 'fs';
import * as path from 'path';
import { getLogger, LogCategory } from '@plusplusoneplusplus/forge';
import type { Logger } from '@plusplusoneplusplus/forge';
import { getMcpOauthCacheDir } from './mcp-oauth-token-cache';

const DEFAULT_INTERVAL_MS = 5 * 60_000;
const DEFAULT_EXPIRY_WINDOW_SECONDS = 10 * 60;
const MIN_INTERVAL_MS = 60_000;

interface CachedMetadata {
    serverUrl?: string;
    authorizationServerUrl?: string;
    clientId?: string;
    resourceUrl?: string;
}

interface CachedTokens {
    accessToken?: string;
    expiresAt?: number;
    refreshToken?: string;
    scope?: string;
}

interface CacheEntry {
    hash: string;
    metaPath: string;
    tokensPath: string;
    metadata: CachedMetadata;
    tokens: CachedTokens;
    tokensMtimeMs: number;
}

export interface MaintenancePassResult {
    dedup: {
        groups: number;
        duplicatesRemoved: number;
    };
    refresh: {
        attempted: number;
        succeeded: number;
        invalidated: number;
        transientFailures: number;
    };
}

export interface MaintenancePassOptions {
    homeDir?: string;
    expiryWindowSeconds?: number;
    now?: () => number;
    fetch?: typeof fetch;
    logger?: Logger;
}

export interface MaintenanceTimerOptions extends MaintenancePassOptions {
    intervalMs?: number;
    runOnStart?: boolean;
}

export interface MaintenanceTimerHandle {
    stop: () => void;
    runNow: () => Promise<MaintenancePassResult>;
}

export async function runMcpOauthMaintenancePass(
    options: MaintenancePassOptions = {},
): Promise<MaintenancePassResult> {
    const log = options.logger ?? getLogger();
    const cacheDir = getMcpOauthCacheDir(options.homeDir);
    const result: MaintenancePassResult = {
        dedup: { groups: 0, duplicatesRemoved: 0 },
        refresh: { attempted: 0, succeeded: 0, invalidated: 0, transientFailures: 0 },
    };

    if (!fs.existsSync(cacheDir)) {
        return result;
    }

    const entries = loadCacheEntries(cacheDir);
    const survivors = dedupByServerUrl(entries, log, result);
    await refreshNearExpiry(survivors, options, log, result);

    if (
        result.dedup.duplicatesRemoved > 0
        || result.refresh.succeeded > 0
        || result.refresh.invalidated > 0
        || result.refresh.transientFailures > 0
    ) {
        log.info(
            LogCategory.MCP,
            `[McpOauthRefresher] pass complete: groups=${result.dedup.groups} `
            + `duplicatesRemoved=${result.dedup.duplicatesRemoved} `
            + `refresh.attempted=${result.refresh.attempted} `
            + `refresh.succeeded=${result.refresh.succeeded} `
            + `refresh.invalidated=${result.refresh.invalidated} `
            + `refresh.transientFailures=${result.refresh.transientFailures}`,
        );
    }
    return result;
}

/**
 * Start a recurring maintenance timer. The timer is `unref`'d so it does
 * not by itself keep the Node event loop alive.
 */
export function startMcpOauthMaintenanceTimer(
    options: MaintenanceTimerOptions = {},
): MaintenanceTimerHandle {
    const log = options.logger ?? getLogger();
    const intervalMs = Math.max(MIN_INTERVAL_MS, options.intervalMs ?? DEFAULT_INTERVAL_MS);
    const runOnStart = options.runOnStart ?? true;

    let stopped = false;
    let inFlight = false;

    const runOnce = async (): Promise<MaintenancePassResult> => {
        if (inFlight) {
            return {
                dedup: { groups: 0, duplicatesRemoved: 0 },
                refresh: { attempted: 0, succeeded: 0, invalidated: 0, transientFailures: 0 },
            };
        }
        inFlight = true;
        try {
            return await runMcpOauthMaintenancePass(options);
        } catch (err) {
            log.warn(
                LogCategory.MCP,
                `[McpOauthRefresher] pass threw: ${err instanceof Error ? err.message : String(err)}`,
            );
            return {
                dedup: { groups: 0, duplicatesRemoved: 0 },
                refresh: { attempted: 0, succeeded: 0, invalidated: 0, transientFailures: 0 },
            };
        } finally {
            inFlight = false;
        }
    };

    const handle = setInterval(() => {
        if (stopped) return;
        void runOnce();
    }, intervalMs);
    if (typeof handle.unref === 'function') handle.unref();

    if (runOnStart) {
        setImmediate(() => { if (!stopped) void runOnce(); });
    }

    log.info(
        LogCategory.MCP,
        `[McpOauthRefresher] maintenance timer started: intervalMs=${intervalMs} runOnStart=${runOnStart}`,
    );

    return {
        stop: () => {
            if (stopped) return;
            stopped = true;
            clearInterval(handle);
            log.debug(LogCategory.MCP, `[McpOauthRefresher] maintenance timer stopped`);
        },
        runNow: runOnce,
    };
}

function loadCacheEntries(cacheDir: string): CacheEntry[] {
    let files: string[];
    try {
        files = fs.readdirSync(cacheDir);
    } catch {
        return [];
    }
    const entries: CacheEntry[] = [];
    for (const file of files) {
        if (!file.endsWith('.json') || file.includes('.tokens.')) continue;
        const hash = file.replace(/\.json$/, '');
        const metaPath = path.join(cacheDir, file);
        const tokensPath = path.join(cacheDir, `${hash}.tokens.json`);
        const metadata = readJson<CachedMetadata>(metaPath);
        if (!metadata || typeof metadata.serverUrl !== 'string' || metadata.serverUrl.length === 0) continue;
        const tokens = readJson<CachedTokens>(tokensPath);
        if (!tokens) continue;
        let tokensMtimeMs = 0;
        try { tokensMtimeMs = fs.statSync(tokensPath).mtimeMs; } catch { tokensMtimeMs = 0; }
        entries.push({ hash, metaPath, tokensPath, metadata, tokens, tokensMtimeMs });
    }
    return entries;
}

function readJson<T>(p: string): T | undefined {
    try {
        return JSON.parse(fs.readFileSync(p, 'utf-8')) as T;
    } catch {
        return undefined;
    }
}

function dedupByServerUrl(
    entries: CacheEntry[],
    log: Logger,
    result: MaintenancePassResult,
): CacheEntry[] {
    const byUrl = new Map<string, CacheEntry[]>();
    for (const e of entries) {
        const url = e.metadata.serverUrl!;
        const list = byUrl.get(url) ?? [];
        list.push(e);
        byUrl.set(url, list);
    }

    result.dedup.groups = byUrl.size;
    const survivors: CacheEntry[] = [];

    for (const [url, group] of byUrl) {
        if (group.length === 1) {
            survivors.push(group[0]);
            continue;
        }
        const sorted = [...group].sort((a, b) => {
            const ax = a.tokens.expiresAt ?? -1;
            const bx = b.tokens.expiresAt ?? -1;
            if (bx !== ax) return bx - ax;
            return b.tokensMtimeMs - a.tokensMtimeMs;
        });
        const keep = sorted[0];
        survivors.push(keep);
        for (let i = 1; i < sorted.length; i++) {
            const drop = sorted[i];
            const removed = deletePair(drop);
            if (removed) {
                result.dedup.duplicatesRemoved++;
                log.info(
                    LogCategory.MCP,
                    `[McpOauthRefresher] dedup: removed stale entry hash=${drop.hash.slice(0, 12)}.. `
                    + `for url=${url} (keeping hash=${keep.hash.slice(0, 12)}..)`,
                );
            }
        }
    }
    return survivors;
}

function deletePair(entry: CacheEntry): boolean {
    let removed = false;
    try { fs.unlinkSync(entry.tokensPath); removed = true; } catch { /* ignore */ }
    try { fs.unlinkSync(entry.metaPath); removed = true; } catch { /* ignore */ }
    return removed;
}

export function aadTokenEndpoint(authorizationServerUrl: string | undefined): string | undefined {
    if (!authorizationServerUrl) return undefined;
    const m = authorizationServerUrl.match(
        /^(https:\/\/login\.microsoftonline\.com\/[^/]+)(?:\/.*)?$/i,
    );
    if (!m) return undefined;
    return `${m[1]}/oauth2/v2.0/token`;
}

async function refreshNearExpiry(
    survivors: CacheEntry[],
    options: MaintenancePassOptions,
    log: Logger,
    result: MaintenancePassResult,
): Promise<void> {
    const now = (options.now ?? (() => Date.now()))();
    const nowSec = Math.floor(now / 1000);
    const windowSec = options.expiryWindowSeconds ?? DEFAULT_EXPIRY_WINDOW_SECONDS;
    const fetchFn = options.fetch ?? globalThis.fetch;
    if (typeof fetchFn !== 'function') {
        log.debug(LogCategory.MCP, `[McpOauthRefresher] no fetch available; skipping refresh`);
        return;
    }

    for (const entry of survivors) {
        if (!entry.tokens.refreshToken) continue;
        if (typeof entry.tokens.expiresAt !== 'number') continue;
        if (entry.tokens.expiresAt - nowSec > windowSec) continue;
        const tokenEndpoint = aadTokenEndpoint(entry.metadata.authorizationServerUrl);
        if (!tokenEndpoint) continue;
        if (!entry.metadata.clientId) continue;
        result.refresh.attempted++;

        try {
            const body = new URLSearchParams({
                client_id: entry.metadata.clientId,
                grant_type: 'refresh_token',
                refresh_token: entry.tokens.refreshToken,
                scope: composeRefreshScope(entry.tokens.scope),
            });
            const response = await fetchFn(tokenEndpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body,
            });
            const text = await response.text();
            if (!response.ok) {
                if (isInvalidGrant(response.status, text)) {
                    deletePair(entry);
                    result.refresh.invalidated++;
                    log.warn(
                        LogCategory.MCP,
                        `[McpOauthRefresher] refresh token rejected for url=${entry.metadata.serverUrl} `
                        + `status=${response.status}; cleared entry hash=${entry.hash.slice(0, 12)}..`,
                    );
                } else {
                    result.refresh.transientFailures++;
                    log.warn(
                        LogCategory.MCP,
                        `[McpOauthRefresher] transient refresh failure for url=${entry.metadata.serverUrl} `
                        + `status=${response.status}; left entry untouched`,
                    );
                }
                continue;
            }
            const parsed = safeParse(text);
            if (!parsed || typeof parsed.access_token !== 'string' || typeof parsed.expires_in !== 'number') {
                result.refresh.transientFailures++;
                log.warn(
                    LogCategory.MCP,
                    `[McpOauthRefresher] malformed refresh response for url=${entry.metadata.serverUrl}; left entry untouched`,
                );
                continue;
            }

            const updated: CachedTokens = {
                accessToken: parsed.access_token,
                expiresAt: Math.floor(now / 1000) + parsed.expires_in,
                scope: typeof parsed.scope === 'string' ? parsed.scope : entry.tokens.scope,
                refreshToken: typeof parsed.refresh_token === 'string' && parsed.refresh_token.length > 0
                    ? parsed.refresh_token
                    : entry.tokens.refreshToken,
            };
            fs.writeFileSync(entry.tokensPath, JSON.stringify(updated));
            result.refresh.succeeded++;
            log.info(
                LogCategory.MCP,
                `[McpOauthRefresher] refreshed url=${entry.metadata.serverUrl} `
                + `hash=${entry.hash.slice(0, 12)}.. expiresIn=${parsed.expires_in}s`,
            );
        } catch (err) {
            result.refresh.transientFailures++;
            log.warn(
                LogCategory.MCP,
                `[McpOauthRefresher] refresh threw for url=${entry.metadata.serverUrl}: `
                + `${err instanceof Error ? err.message : String(err)}`,
            );
        }
    }
}

// AAD requires the original scope (or a subset) on refresh, plus offline_access
// to keep the next refresh token rolling forward.
function composeRefreshScope(originalScope: string | undefined): string {
    const base = originalScope?.trim() ?? '';
    if (!base) return 'offline_access';
    if (/\boffline_access\b/.test(base)) return base;
    return `${base} offline_access`;
}

function isInvalidGrant(status: number, body: string): boolean {
    if (status >= 500) return false;
    const parsed = safeParse(body);
    if (parsed && typeof parsed.error === 'string') {
        return parsed.error === 'invalid_grant' || parsed.error === 'invalid_request';
    }
    return /invalid_grant|interaction_required|consent_required/i.test(body);
}

function safeParse(text: string): Record<string, unknown> | undefined {
    try {
        const v = JSON.parse(text) as unknown;
        return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : undefined;
    } catch {
        return undefined;
    }
}
