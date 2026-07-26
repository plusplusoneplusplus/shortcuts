/**
 * Codex rollout context-usage reader.
 *
 * The Codex SDK's `turn.completed.usage` carries only per-turn token counts and
 * no context-window information. Codex core, however, emits an
 * `EventMsg::TokenCount` after every model request and persists it to the
 * session rollout JSONL under `~/.codex/sessions/YYYY/MM/DD/`. That event holds
 * both the canonical occupancy (`last_token_usage.total_tokens`) and the
 * provider's real context window (`model_context_window`) — the exact numbers
 * codex's own TUI meter uses.
 *
 * This module tail-reads the newest `token_count` envelope from a thread's
 * rollout file so CoC can report a real context meter for codex conversations.
 * It is display metadata only: every failure path returns `undefined` and the
 * caller falls back to the registry-derived estimate.
 *
 * Envelope shape (pinned to `@openai/codex-sdk` 0.144.4 / `rust-v0.144.4`):
 *   { timestamp, type: "event_msg", payload: {
 *       type: "token_count",
 *       info: { total_token_usage, last_token_usage, model_context_window } | null,
 *       rate_limits } }
 * `info` may be `null`; `model_context_window` is `Option<i64>` (nullable).
 * Field names are upstream-owned — the parser skips anything that does not match
 * so format drift degrades to the fallback rather than breaking turns.
 */

import * as fs from 'fs/promises';
import * as path from 'path';

/** Bounded tail read: `token_count` fires every request, so the last one always
 * sits within a few KB of EOF. */
const TAIL_WINDOW_BYTES = 64 * 1024;

/** Context-window fields resolved from a thread's rollout `token_count` event. */
export interface CodexRolloutContextUsage {
    /** `last_token_usage.total_tokens` — codex's canonical occupancy. */
    currentTokens: number;
    /** `model_context_window` — omitted when upstream reports it as null. */
    tokenLimit?: number;
    /** Absolute path of the rollout file the usage was read from (for caching). */
    rolloutPath: string;
}

export interface ReadCodexRolloutOptions {
    /** `~/.codex/sessions` root to search. */
    sessionsRoot: string;
    /**
     * Previously resolved rollout path for this thread. When it still exists the
     * directory walk is skipped; when it is gone the walk runs again.
     */
    cachedPath?: string;
}

interface RolloutTokenUsage {
    currentTokens: number;
    tokenLimit?: number;
}

/**
 * Read the latest `token_count` context usage for `threadId` from its rollout
 * file. Returns `undefined` when the root/file is missing, no `token_count`
 * sits within the tail window, or the values are malformed. Never throws.
 */
export async function readCodexRolloutContextUsage(
    threadId: string,
    opts: ReadCodexRolloutOptions,
): Promise<CodexRolloutContextUsage | undefined> {
    if (!threadId || !opts.sessionsRoot) return undefined;
    const filePath = await locateRolloutFile(threadId, opts.sessionsRoot, opts.cachedPath);
    if (!filePath) return undefined;
    const usage = await readTailContextUsage(filePath);
    if (!usage) return undefined;
    return { ...usage, rolloutPath: filePath };
}

/**
 * Find `rollout-*-<threadId>.jsonl`. Uses the cached path when it still exists,
 * otherwise walks the date directories (`YYYY/MM/DD`) newest-first and stops at
 * the first directory containing a match, so the common case touches only
 * today's directory. When a single directory holds more than one match (should
 * not happen) the newest by mtime wins.
 */
async function locateRolloutFile(
    threadId: string,
    sessionsRoot: string,
    cachedPath?: string,
): Promise<string | undefined> {
    if (cachedPath) {
        try {
            await fs.access(cachedPath);
            return cachedPath;
        } catch {
            // Cached file gone (e.g. rotated) — fall through and re-walk.
        }
    }

    const suffix = `-${threadId}.jsonl`;
    for (const year of await sortedSubdirsDesc(sessionsRoot)) {
        const yearDir = path.join(sessionsRoot, year);
        for (const month of await sortedSubdirsDesc(yearDir)) {
            const monthDir = path.join(yearDir, month);
            for (const day of await sortedSubdirsDesc(monthDir)) {
                const match = await findMatchInDir(path.join(monthDir, day), suffix);
                if (match) return match;
            }
        }
    }
    return undefined;
}

/** Directory names (dirs only) sorted descending. For zero-padded YYYY/MM/DD
 * names, lexical-descending equals numeric-descending (newest-first). */
async function sortedSubdirsDesc(dir: string): Promise<string[]> {
    let entries: import('fs').Dirent[];
    try {
        entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
        return [];
    }
    return entries
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name)
        .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
}

async function findMatchInDir(dir: string, suffix: string): Promise<string | undefined> {
    let entries: import('fs').Dirent[];
    try {
        entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
        return undefined;
    }
    const matches = entries
        .filter(entry => entry.isFile() && entry.name.startsWith('rollout-') && entry.name.endsWith(suffix))
        .map(entry => path.join(dir, entry.name));
    if (matches.length === 0) return undefined;
    if (matches.length === 1) return matches[0];

    let best: string | undefined;
    let bestMtime = -Infinity;
    for (const candidate of matches) {
        try {
            const stat = await fs.stat(candidate);
            if (stat.mtimeMs > bestMtime) {
                bestMtime = stat.mtimeMs;
                best = candidate;
            }
        } catch {
            // Skip a candidate we cannot stat.
        }
    }
    return best;
}

/**
 * Read the last ≤64 KB of the file and scan backwards for the newest parseable
 * `token_count` envelope carrying a finite `last_token_usage.total_tokens`.
 */
async function readTailContextUsage(filePath: string): Promise<RolloutTokenUsage | undefined> {
    let handle: fs.FileHandle;
    try {
        handle = await fs.open(filePath, 'r');
    } catch {
        return undefined;
    }
    try {
        const { size } = await handle.stat();
        if (size <= 0) return undefined;
        const readSize = Math.min(size, TAIL_WINDOW_BYTES);
        const start = size - readSize;
        const buffer = Buffer.alloc(readSize);
        await handle.read(buffer, 0, readSize, start);

        let text = buffer.toString('utf8');
        // When the read did not start at byte 0, the first line is likely a
        // partial record — drop it.
        if (start > 0) {
            const firstNewline = text.indexOf('\n');
            text = firstNewline === -1 ? '' : text.slice(firstNewline + 1);
        }

        const lines = text.split('\n');
        for (let i = lines.length - 1; i >= 0; i--) {
            const line = lines[i].trim();
            if (!line) continue;
            const usage = parseTokenCountLine(line);
            if (usage) return usage;
        }
        return undefined;
    } catch {
        return undefined;
    } finally {
        await handle.close();
    }
}

/** Parse one JSONL line into a `token_count` usage, or `undefined` when it is
 * not a well-formed `token_count` envelope. Bad JSON is skipped, not thrown. */
function parseTokenCountLine(line: string): RolloutTokenUsage | undefined {
    let record: unknown;
    try {
        record = JSON.parse(line);
    } catch {
        return undefined;
    }
    if (!isRecord(record)) return undefined;
    const payload = record.payload;
    if (!isRecord(payload) || payload.type !== 'token_count') return undefined;
    const info = payload.info;
    if (!isRecord(info)) return undefined;
    const last = info.last_token_usage;
    if (!isRecord(last)) return undefined;

    const total = last.total_tokens;
    if (typeof total !== 'number' || !Number.isFinite(total)) return undefined;

    const usage: RolloutTokenUsage = { currentTokens: total };
    const window = info.model_context_window;
    if (typeof window === 'number' && Number.isFinite(window)) {
        usage.tokenLimit = window;
    }
    return usage;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}
