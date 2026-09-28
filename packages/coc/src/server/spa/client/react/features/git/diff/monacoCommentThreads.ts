/**
 * monacoCommentThreads — where diff comments go in a Monaco diff editor, and
 * the view-zone bookkeeping that keeps one zone per comment thread (AC-05).
 *
 * Pure: placement runs through `diffCoords` (no line math here) and the zone
 * manager talks only to the narrow `CommentZoneHost` slice of the owned
 * `DiffEditorAdapter`, so both are testable without Monaco.
 *
 * View zones are editor state, not model state: a model swap drops every
 * zone. The manager keeps each thread's DOM node across swaps and moves (so
 * the React portal inside it — and any half-typed reply — survives) and only
 * re-adds the zone. `invalidate()` marks that the editor already dropped them.
 */

import type { DiffComment } from '../../../../comments/diff-comment-types';
import {
    createLineSource,
    selectionToMonaco,
    threadZoneAnchor,
    type DiffLineChange,
    type DiffSideRange,
    type ThreadZoneAnchor,
} from './diffCoords';
import type { CommentDecoration, DiffEditorAdapter } from './monacoDiffController';

/**
 * - `exact`: placed from the stored file lines.
 * - `recovered`: placed by the anchor fingerprint (legacy comment).
 * - `orphaned`: the commented text is gone; no zone, listed separately.
 */
export type CommentThreadStatus = 'exact' | 'recovered' | 'orphaned';

export interface PlacedCommentThread {
    comment: DiffComment;
    status: 'exact' | 'recovered';
    range: DiffSideRange;
    zone: ThreadZoneAnchor;
}

export type CommentThreadPlacement = PlacedCommentThread | { comment: DiffComment; status: 'orphaned' };

export interface PlaceDiffCommentsInput {
    comments: readonly DiffComment[];
    /** Text of the models the diff was computed for. */
    original: string;
    modified: string;
    lineChanges: readonly DiffLineChange[];
    viewMode: 'unified' | 'split';
}

/** Places every comment; placed threads are ordered by side, line, then age. */
export function placeDiffComments(input: PlaceDiffCommentsInput): CommentThreadPlacement[] {
    const original = createLineSource(input.original);
    const modified = createLineSource(input.modified);
    const placed: PlacedCommentThread[] = [];
    const orphaned: CommentThreadPlacement[] = [];
    for (const comment of input.comments) {
        // Relocation already found the anchor text gone: the classic viewer
        // hides such comments from the diff, so the editor does too.
        if (comment.status === 'orphaned') {
            orphaned.push({ comment, status: 'orphaned' });
            continue;
        }
        const placement = selectionToMonaco(comment.selection, { original, modified, anchor: comment.anchor });
        if (placement.status === 'unresolved') {
            orphaned.push({ comment, status: 'orphaned' });
            continue;
        }
        placed.push({
            comment,
            status: placement.status,
            range: placement.range,
            zone: threadZoneAnchor(placement.range, input.viewMode, input.lineChanges),
        });
    }
    placed.sort((a, b) => {
        if (a.zone.side !== b.zone.side) return a.zone.side === 'original' ? -1 : 1;
        if (a.zone.afterLineNumber !== b.zone.afterLineNumber) return a.zone.afterLineNumber - b.zone.afterLineNumber;
        return a.comment.createdAt.localeCompare(b.comment.createdAt);
    });
    return [...placed, ...orphaned];
}

/** Range decorations for placed threads: open, resolved (muted) or recovered. */
export function buildCommentDecorations(placements: readonly CommentThreadPlacement[]): CommentDecoration[] {
    const decorations: CommentDecoration[] = [];
    for (const p of placements) {
        if (p.status === 'orphaned') continue;
        const kind = p.status === 'recovered' ? 'recovered'
            : p.comment.status === 'resolved' ? 'resolved' : 'open';
        const { side, ...range } = p.range;
        decorations.push({ side, range, kind });
    }
    return decorations;
}

/** Unresolved threads open by default; resolved ones start collapsed. */
export function isThreadInitiallyExpanded(comment: Pick<DiffComment, 'status'>): boolean {
    return comment.status !== 'resolved';
}

export type CommentZoneHost = Pick<DiffEditorAdapter, 'addViewZone' | 'layoutViewZone' | 'removeViewZone'>;

export interface CommentZoneEntry {
    id: string;
    anchor: ThreadZoneAnchor;
}

export interface CommentZoneManager {
    /**
     * Makes the editor's zones match `entries` (one per id): adds new ones,
     * moves changed ones, removes missing ones. Returns id → zone DOM node;
     * the same Map instance while the set of nodes is unchanged.
     */
    sync(entries: readonly CommentZoneEntry[]): ReadonlyMap<string, HTMLElement>;
    /** Records a thread's measured height and relayouts its zone if it changed. */
    setHeight(id: string, heightInPx: number): void;
    /** The editor dropped every zone (model swap); the next sync re-adds them. */
    invalidate(): void;
    /** Removes every zone. The manager is unusable afterwards. */
    dispose(): void;
}

/** Height a zone starts with, before its thread is measured. */
export const INITIAL_THREAD_ZONE_HEIGHT = 32;

interface ZoneRecord {
    node: HTMLElement;
    anchor: ThreadZoneAnchor;
    zoneId: string | null;
    height: number;
}

export function createCommentZoneManager(
    host: CommentZoneHost,
    createNode: () => HTMLElement,
): CommentZoneManager {
    const records = new Map<string, ZoneRecord>();
    let nodes: ReadonlyMap<string, HTMLElement> = new Map();
    let disposed = false;

    const addZone = (record: ZoneRecord) => {
        record.zoneId = host.addViewZone({
            side: record.anchor.side,
            afterLineNumber: record.anchor.afterLineNumber,
            heightInPx: record.height,
            domNode: record.node,
        });
    };
    const removeZone = (record: ZoneRecord) => {
        if (record.zoneId !== null) host.removeViewZone(record.anchor.side, record.zoneId);
        record.zoneId = null;
    };

    return {
        sync(entries) {
            if (disposed) return nodes;
            const wanted = new Map(entries.map(e => [e.id, e.anchor]));
            let changed = false;
            for (const [id, record] of records) {
                if (wanted.has(id)) continue;
                removeZone(record);
                records.delete(id);
                changed = true;
            }
            for (const [id, anchor] of wanted) {
                let record = records.get(id);
                if (!record) {
                    record = { node: createNode(), anchor, zoneId: null, height: INITIAL_THREAD_ZONE_HEIGHT };
                    records.set(id, record);
                    changed = true;
                } else if (record.anchor.side !== anchor.side || record.anchor.afterLineNumber !== anchor.afterLineNumber) {
                    removeZone(record);
                    record.anchor = anchor;
                }
                if (record.zoneId === null) addZone(record);
            }
            if (changed) nodes = new Map([...records].map(([id, r]) => [id, r.node]));
            return nodes;
        },
        setHeight(id, heightInPx) {
            const record = records.get(id);
            if (disposed || !record || record.height === heightInPx) return;
            record.height = heightInPx;
            if (record.zoneId !== null) host.layoutViewZone(record.anchor.side, record.zoneId, heightInPx);
        },
        invalidate() {
            for (const record of records.values()) record.zoneId = null;
        },
        dispose() {
            if (disposed) return;
            disposed = true;
            for (const record of records.values()) removeZone(record);
            records.clear();
            nodes = new Map();
        },
    };
}
