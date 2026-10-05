/**
 * The loaded text behind an external definition, shared between Peek and the
 * read-only tab that Peek's result opens.
 *
 * A capability belongs to the attachment that received the definition response.
 * Navigating to the result unmounts the pane holding that attachment, which
 * would revoke the capability before the new tab could use it — so the content
 * is handed over instead of re-fetched. Peek publishes what it loaded, the
 * navigation handler retains it while the opener still runs, and the tab holds
 * the retain until it closes.
 *
 * A published record nobody retains is kept briefly and then dropped, which
 * covers the gap between Peek loading a source and the user choosing it.
 *
 * Semantic tokens ride on the same record for the same reason: they are asked
 * for through the attachment that is about to go away, so the tab colors from
 * what Peek received, and falls back to basic syntax colors when nothing came.
 */

import type { ExternalSourceContent } from './externalSource';

/** How long an unreferenced record survives before it is dropped. */
export const EXTERNAL_SOURCE_ORPHAN_TIMEOUT_MS = 60_000;

export interface ExternalSourceRecord extends ExternalSourceContent {
    resourceId: string;
    /**
     * Why the read failed, in the host's own words. A failed read is published
     * too, because the reason is the only thing the tab can show that helps.
     * `content` carries the same text for the Peek model.
     */
    failure?: string;
    /** Semantic tokens for `content`, already in CoC's legend. */
    semanticTokens?: Uint32Array;
}

interface Entry {
    record: ExternalSourceRecord;
    refCount: number;
    timer: ReturnType<typeof setTimeout> | null;
}

const entries = new Map<string, Entry>();
const listeners = new Map<string, Set<() => void>>();

function notify(resourceId: string): void {
    for (const listener of [...(listeners.get(resourceId) ?? [])]) listener();
}

function clearOrphanTimer(entry: Entry): void {
    if (entry.timer) {
        clearTimeout(entry.timer);
        entry.timer = null;
    }
}

function scheduleOrphanDrop(resourceId: string, entry: Entry): void {
    clearOrphanTimer(entry);
    entry.timer = setTimeout(() => {
        const current = entries.get(resourceId);
        if (current === entry && current.refCount === 0) {
            entries.delete(resourceId);
        }
    }, EXTERNAL_SOURCE_ORPHAN_TIMEOUT_MS);
    entry.timer.unref?.();
}

/** Record what an authorized read returned, replacing any earlier content. */
export function publishExternalSource(record: ExternalSourceRecord): void {
    const existing = entries.get(record.resourceId);
    if (existing) {
        // Tokens describe text; they survive a republish of the same text only.
        const carried = !record.semanticTokens && existing.record.content === record.content && !record.failure
            ? existing.record.semanticTokens
            : undefined;
        existing.record = carried ? { ...record, semanticTokens: carried } : record;
        if (existing.refCount === 0) scheduleOrphanDrop(record.resourceId, existing);
        notify(record.resourceId);
        return;
    }
    const entry: Entry = { record, refCount: 0, timer: null };
    entries.set(record.resourceId, entry);
    scheduleOrphanDrop(record.resourceId, entry);
    notify(record.resourceId);
}

/**
 * Attach semantic tokens to a loaded record. Dropped when the record is gone
 * or failed, or when its text is no longer the text they were computed for.
 */
export function publishExternalSemanticTokens(resourceId: string, content: string, tokens: Uint32Array): void {
    const entry = entries.get(resourceId);
    if (!entry || entry.record.failure || entry.record.content !== content) return;
    entry.record = { ...entry.record, semanticTokens: tokens };
    notify(resourceId);
}

/** Called whenever the record for `resourceId` is published or gains tokens. */
export function onExternalSourceChange(resourceId: string, listener: () => void): () => void {
    let set = listeners.get(resourceId);
    if (!set) {
        set = new Set();
        listeners.set(resourceId, set);
    }
    set.add(listener);
    return () => {
        const current = listeners.get(resourceId);
        if (!current) return;
        current.delete(listener);
        if (current.size === 0) listeners.delete(resourceId);
    };
}

/** The record for `resourceId`, or undefined once it has been released. */
export function readExternalSourceRecord(resourceId: string): ExternalSourceRecord | undefined {
    return entries.get(resourceId)?.record;
}

/**
 * Hold `resourceId` alive. Returns the release; calling it twice is harmless,
 * so a consumer can release on unmount without tracking whether it already did.
 */
export function retainExternalSource(resourceId: string): () => void {
    const entry = entries.get(resourceId);
    if (!entry) return () => {};
    entry.refCount += 1;
    clearOrphanTimer(entry);
    let released = false;
    return () => {
        if (released) return;
        released = true;
        entry.refCount -= 1;
        if (entry.refCount <= 0 && entries.get(resourceId) === entry) {
            scheduleOrphanDrop(resourceId, entry);
        }
    };
}

/** Drop every record, so a test starts clean. */
export function resetExternalSourceStoreForTests(): void {
    for (const entry of entries.values()) clearOrphanTimer(entry);
    entries.clear();
    listeners.clear();
}
