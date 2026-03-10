/**
 * useDraftStore — localStorage-backed draft persistence for chat input.
 *
 * Key: `coc-chat-drafts` → `{ [taskId]: { text, mode, updatedAt } }`
 * Provides `getDraft`, `setDraft`, `clearDraft`, and `pruneExpired`.
 * All operations are wrapped in try/catch to gracefully handle quota
 * errors or disabled storage.
 */

export interface Draft {
    text: string;
    mode: string;
    updatedAt: number;
}

type DraftMap = Record<string, Draft>;

const STORAGE_KEY = 'coc-chat-drafts';
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

function readMap(): DraftMap {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return {};
        return JSON.parse(raw) as DraftMap;
    } catch {
        return {};
    }
}

function writeMap(map: DraftMap): void {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
    } catch {
        // Quota exceeded or storage disabled — silently ignore.
    }
}

/** Return the draft for a given taskId, or null if none exists. */
export function getDraft(taskId: string): Draft | null {
    const map = readMap();
    return map[taskId] ?? null;
}

/**
 * Persist a draft for the given taskId.
 * If text is empty, delegates to clearDraft instead.
 */
export function setDraft(taskId: string, text: string, mode: string): void {
    if (!text) {
        clearDraft(taskId);
        return;
    }
    const map = readMap();
    map[taskId] = { text, mode, updatedAt: Date.now() };
    writeMap(map);
}

/** Remove the draft for the given taskId. */
export function clearDraft(taskId: string): void {
    const map = readMap();
    if (!(taskId in map)) return;
    delete map[taskId];
    writeMap(map);
}

/** Remove all draft entries older than TTL_MS. Call once on app init. */
export function pruneExpired(): void {
    const map = readMap();
    const now = Date.now();
    let changed = false;
    for (const key of Object.keys(map)) {
        if (now - map[key].updatedAt > TTL_MS) {
            delete map[key];
            changed = true;
        }
    }
    if (changed) writeMap(map);
}
