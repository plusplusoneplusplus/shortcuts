import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { sanitizeHistoryUrl } from './browser-history';

export const BROWSER_FAVORITES_MAX_ENTRIES = 500;

export interface BrowserFavorite {
    url: string;
    title: string;
    added: number;
}

interface FavoritesData {
    version: 1;
    favorites: BrowserFavorite[];
}

export interface BrowserFavoritesPage {
    favorites: BrowserFavorite[];
    storageError: string | null;
}

function readData(value: unknown): FavoritesData {
    const raw = value as Record<string, unknown> | null;
    if (!raw || typeof raw !== 'object' || raw.version !== 1 || !Array.isArray(raw.favorites)) {
        throw new Error('Unsupported or invalid browser favorites');
    }
    const favorites = new Map<string, BrowserFavorite>();
    for (const item of raw.favorites) {
        const url = sanitizeHistoryUrl(item?.url);
        if (!url || favorites.has(url) || typeof item.title !== 'string'
            || !Number.isSafeInteger(item.added) || item.added < 0) continue;
        favorites.set(url, { url, title: item.title.slice(0, 1024), added: item.added });
    }
    return { version: 1, favorites: [...favorites.values()].slice(0, BROWSER_FAVORITES_MAX_ENTRIES) };
}

/**
 * Installation-wide favorites owned by the desktop main process. Independent of
 * history: recording pause, history clearing and engine data cleanup keep them.
 * Mutations publish only after atomic saving.
 */
export class BrowserFavoritesStore {
    readonly filename: string;
    private data: FavoritesData = { version: 1, favorites: [] };
    private pending: Promise<unknown> = Promise.resolve();
    private error: string | null = null;

    constructor(desktopDataDir: string, private readonly now: () => number = Date.now,
        private readonly changed: () => void = () => {}) {
        this.filename = path.join(desktopDataDir, 'browser', 'favorites.json');
        try {
            this.data = readData(JSON.parse(fs.readFileSync(this.filename, 'utf8')));
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.error = String(error);
        }
    }

    /** Most recently saved first. */
    async list(): Promise<BrowserFavoritesPage> {
        await this.pending;
        return { favorites: this.data.favorites.map(item => ({ ...item })), storageError: this.error };
    }

    /** Saving a saved URL only refreshes its title. Rejects invalid URLs and a full list. */
    add(value: unknown, title: unknown): Promise<boolean> {
        const url = sanitizeHistoryUrl(value);
        if (!url || typeof title !== 'string') return Promise.reject(new TypeError('Invalid favorite'));
        return this.mutate(data => {
            const existing = data.favorites.find(item => item.url === url);
            if (existing) {
                if (existing.title === title.slice(0, 1024)) return false;
                existing.title = title.slice(0, 1024);
                return true;
            }
            if (data.favorites.length >= BROWSER_FAVORITES_MAX_ENTRIES) {
                throw new RangeError(`Favorites are limited to ${BROWSER_FAVORITES_MAX_ENTRIES} pages`);
            }
            data.favorites.unshift({ url, title: title.slice(0, 1024), added: this.now() });
            return true;
        });
    }

    remove(value: unknown): Promise<boolean> {
        const url = sanitizeHistoryUrl(value);
        if (!url) return Promise.reject(new TypeError('Invalid favorite URL'));
        return this.mutate(data => {
            const length = data.favorites.length;
            data.favorites = data.favorites.filter(item => item.url !== url);
            return length !== data.favorites.length;
        });
    }

    /** Drain queued saves before desktop shutdown. */
    async flush(): Promise<void> {
        await this.pending;
    }

    private notify(): void {
        try { this.changed(); } catch (error) { console.error('[coc-desktop] Browser favorites notification failed:', error); }
    }

    private mutate(change: (data: FavoritesData) => boolean): Promise<boolean> {
        const operation = this.pending.then(async () => {
            const next = structuredClone(this.data);
            if (!change(next)) return false;
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
