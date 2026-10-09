import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { isBrowserEngine, validateBrowserUrl, type BrowserEngine } from './browser-view-policy';

export const BROWSER_HISTORY_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
export const BROWSER_HISTORY_MAX_ENTRIES = 10_000;

interface EngineVisits {
    title: string;
    lastVisited: number;
    visitCount: number;
}

interface StoredEntry {
    url: string;
    engines: Partial<Record<BrowserEngine, EngineVisits>>;
}

interface HistoryData {
    version: 1;
    recording: boolean;
    entries: StoredEntry[];
}

export interface BrowserHistoryEntry extends EngineVisits {
    url: string;
}

export interface BrowserHistoryPage {
    entries: BrowserHistoryEntry[];
    total: number;
    recording: boolean;
    storageError: string | null;
}

export interface BrowserHistorySuggestion extends BrowserHistoryEntry {
    /** Full URL, or scheme-omitted URL, whose suffix may be selected inline. Null for title/substring matches and empty input. */
    completion: string | null;
}

export interface BrowserHistorySuggestions extends BrowserHistoryPage {
    entries: BrowserHistorySuggestion[];
}

/** Apply the browser URL policy and remove embedded credentials before indexing. */
export function sanitizeHistoryUrl(value: unknown): string | null {
    const checked = validateBrowserUrl(value);
    if (!checked.ok) return null;
    const url = new URL(checked.url);
    url.username = '';
    url.password = '';
    return url.href;
}

function publicEntry(entry: StoredEntry): BrowserHistoryEntry {
    const visits = Object.values(entry.engines).sort((a, b) => b.lastVisited - a.lastVisited);
    return {
        url: entry.url, title: visits[0].title, lastVisited: visits[0].lastVisited,
        visitCount: Math.min(Number.MAX_SAFE_INTEGER, visits.reduce((sum, visit) => sum + visit.visitCount, 0)),
    };
}

function recentFirst(a: BrowserHistoryEntry, b: BrowserHistoryEntry): number {
    return b.lastVisited - a.lastVisited || (a.url < b.url ? -1 : a.url > b.url ? 1 : 0);
}

function prefixCompletion(url: string, needle: string): string | null {
    if (!needle) return null;
    if (url.toLowerCase().startsWith(needle)) return url;
    const withoutScheme = url.replace(/^https?:\/\//, '');
    return withoutScheme.toLowerCase().startsWith(needle) ? withoutScheme : null;
}

function prune(data: HistoryData, now: number): void {
    data.entries = data.entries.filter(entry => Object.keys(entry.engines).length > 0)
        .filter(entry => publicEntry(entry).lastVisited > now - BROWSER_HISTORY_RETENTION_MS)
        .sort((a, b) => recentFirst(publicEntry(a), publicEntry(b)))
        .slice(0, BROWSER_HISTORY_MAX_ENTRIES);
}

function readData(value: unknown): HistoryData {
    if (!value || typeof value !== 'object') throw new Error('Invalid browser history');
    const raw = value as Record<string, unknown>;
    if (raw.version !== 1 || typeof raw.recording !== 'boolean' || !Array.isArray(raw.entries)) {
        throw new Error('Unsupported or invalid browser history');
    }
    const entries = new Map<string, StoredEntry>();
    for (const item of raw.entries) {
        if (!item || typeof item !== 'object') continue;
        const url = sanitizeHistoryUrl(item.url);
        if (!url || !item.engines || typeof item.engines !== 'object') continue;
        const entry = entries.get(url) ?? { url, engines: {} };
        for (const engine of ['electron', 'webview2'] as const) {
            const visit = item.engines[engine];
            if (!visit || typeof visit.title !== 'string' || !Number.isSafeInteger(visit.lastVisited)
                || visit.lastVisited < 0 || !Number.isSafeInteger(visit.visitCount) || visit.visitCount < 1) continue;
            // A duplicate persisted URL must not multiply its visit count on restart.
            if (!entry.engines[engine] || visit.lastVisited > entry.engines[engine]!.lastVisited) {
                entry.engines[engine] = { title: visit.title.slice(0, 1024), lastVisited: visit.lastVisited, visitCount: visit.visitCount };
            }
        }
        if (Object.keys(entry.engines).length) entries.set(url, entry);
    }
    return { version: 1, recording: raw.recording, entries: [...entries.values()] };
}

/**
 * One instance belongs to the desktop main process, shared by all windows and
 * workspaces. Only successful navigation events may call recordVisit; snapshots
 * and title events use updateTitle. Mutations publish only after atomic saving.
 */
export class BrowserHistoryStore {
    readonly filename: string;
    private data: HistoryData = { version: 1, recording: true, entries: [] };
    private pending: Promise<unknown> = Promise.resolve();
    private error: string | null = null;

    constructor(desktopDataDir: string, private readonly now: () => number = Date.now,
        private readonly changed: () => void = () => {}) {
        this.filename = path.join(desktopDataDir, 'browser', 'history.json');
        try {
            this.data = readData(JSON.parse(fs.readFileSync(this.filename, 'utf8')));
            // Maintenance shares the write queue; a failed cleanup stays visible.
            void this.pruneExpired().catch(() => {});
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.error = String(error);
        }
    }

    /** Bounded, case-insensitive URL/title search with stable recency pagination. */
    async query(search = '', offset = 0, limit = 50): Promise<BrowserHistoryPage> {
        if (typeof search !== 'string' || search.length > 8192 || !Number.isSafeInteger(offset) || offset < 0
            || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new TypeError('Invalid history query');
        await this.pending;
        const entries = this.matchingEntries(search).sort(recentFirst);
        return { entries: entries.slice(offset, offset + limit), total: entries.length,
            recording: this.data.recording, storageError: this.error };
    }

    /** Fixed eight-result address suggestions; rank before limiting, across all retained entries. */
    async suggest(search = ''): Promise<BrowserHistorySuggestions> {
        await this.pending;
        const entries = this.matchingEntries(search);
        const needle = search.trim().toLowerCase();
        const ranked = entries.map(entry => ({ ...entry, completion: prefixCompletion(entry.url, needle) }))
            .sort((a, b) => needle
                ? Number(b.completion !== null) - Number(a.completion !== null)
                    || b.lastVisited - a.lastVisited || b.visitCount - a.visitCount
                    || (a.url < b.url ? -1 : a.url > b.url ? 1 : 0)
                : recentFirst(a, b));
        // Whitespace is useful for searching, but must not cause an inline replacement.
        return { entries: ranked.slice(0, 8).map(entry => ({ ...entry,
            completion: search === search.trim() ? entry.completion : null })), total: entries.length,
            recording: this.data.recording, storageError: this.error };
    }

    private matchingEntries(search: string): BrowserHistoryEntry[] {
        if (typeof search !== 'string' || search.length > 8192) throw new TypeError('Invalid history query');
        const needle = search.trim().toLowerCase();
        const cutoff = this.now() - BROWSER_HISTORY_RETENTION_MS;
        return this.data.entries.map(publicEntry)
            .filter(entry => entry.lastVisited > cutoff)
            .filter(entry => entry.url.toLowerCase().includes(needle) || entry.title.toLowerCase().includes(needle));
    }

    /** Drain queued saves before desktop shutdown. Failures stay visible through storageError. */
    async flush(): Promise<void> {
        await this.pending;
    }

    recordVisit(engine: BrowserEngine, value: unknown, title: string): Promise<boolean> {
        this.validateVisit(engine, title);
        const url = sanitizeHistoryUrl(value);
        if (!url) return Promise.resolve(false);
        const visitedAt = this.now();
        return this.mutate(data => {
            if (!data.recording) return false;
            let entry = data.entries.find(item => item.url === url);
            if (!entry) { entry = { url, engines: {} }; data.entries.push(entry); }
            const previous = entry.engines[engine];
            entry.engines[engine] = { title: title.slice(0, 1024), lastVisited: visitedAt,
                visitCount: Math.min(Number.MAX_SAFE_INTEGER, (previous?.visitCount ?? 0) + 1) };
            return true;
        });
    }

    /** Never creates an entry or revives a deleted engine contribution. */
    updateTitle(engine: BrowserEngine, value: unknown, title: string): Promise<boolean> {
        this.validateVisit(engine, title);
        const url = sanitizeHistoryUrl(value);
        return this.mutate(data => {
            const visit = data.entries.find(item => item.url === url)?.engines[engine];
            if (!visit || visit.title === title.slice(0, 1024)) return false;
            visit.title = title.slice(0, 1024);
            return true;
        });
    }

    delete(value: unknown): Promise<boolean> {
        const url = sanitizeHistoryUrl(value);
        return this.mutate(data => {
            const length = data.entries.length;
            data.entries = data.entries.filter(entry => entry.url !== url);
            return length !== data.entries.length;
        });
    }

    clear(): Promise<boolean> {
        return this.mutate(data => {
            // Persist even an empty clear to replace corrupt or expired storage.
            data.entries = [];
            return true;
        });
    }

    /** Also called by the main-process maintenance timer while recording is paused. */
    pruneExpired(): Promise<boolean> {
        return this.mutate(() => false);
    }

    clearEngine(engine: BrowserEngine): Promise<boolean> {
        if (!isBrowserEngine(engine)) throw new TypeError('Invalid browser engine');
        return this.mutate(data => {
            let changed = false;
            for (const entry of data.entries) {
                if (entry.engines[engine]) { delete entry.engines[engine]; changed = true; }
            }
            return changed;
        });
    }

    setRecording(recording: boolean): Promise<boolean> {
        if (typeof recording !== 'boolean') throw new TypeError('Invalid recording setting');
        return this.mutate(data => {
            if (data.recording === recording) return false;
            data.recording = recording;
            return true;
        });
    }

    private validateVisit(engine: BrowserEngine, title: string): void {
        if (!isBrowserEngine(engine) || typeof title !== 'string') throw new TypeError('Invalid history visit');
    }

    private notify(): void {
        // A disconnected renderer must never turn a committed save into a failure.
        try { this.changed(); } catch (error) { console.error('[coc-desktop] Browser history notification failed:', error); }
    }

    private mutate(change: (data: HistoryData) => boolean): Promise<boolean> {
        const operation = this.pending.then(async () => {
            const next = structuredClone(this.data);
            const previousLength = next.entries.length;
            prune(next, this.now());
            if (!change(next) && previousLength === next.entries.length) return false;
            prune(next, this.now());
            const temporary = `${this.filename}.${process.pid}.${randomUUID()}.tmp`;
            try {
                await fs.promises.mkdir(path.dirname(this.filename), { recursive: true });
                await fs.promises.writeFile(temporary, JSON.stringify(next) + '\n', { mode: 0o600 });
                await fs.promises.rename(temporary, this.filename);
                this.data = next;
                this.error = null;
                this.notify();
                return true;
            } catch (error) {
                this.error = String(error);
                this.notify();
                throw error;
            } finally {
                await fs.promises.rm(temporary, { force: true }).catch(() => {});
            }
        });
        // A failed save rejects its caller but does not poison subsequent writes.
        this.pending = operation.catch(() => {});
        return operation;
    }
}
