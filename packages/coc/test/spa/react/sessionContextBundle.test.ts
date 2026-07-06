/**
 * Tests for the multi-select drag bundle (AC-02): a drag started inside an
 * active selection carries every selected item, while a single-item drag keeps
 * its existing single-MIME shape. Also covers within-bundle dedupe (AC-03).
 */

import { describe, expect, it } from 'vitest';
import {
    POINTER_CONTEXT_DRAG_MIME,
    SESSION_CONTEXT_BUNDLE_DRAG_MIME,
    SESSION_CONTEXT_DRAG_MIME,
    writeSessionContextDragBundle,
    type GitCommitContextDragPayload,
    type SessionContextAttachmentDragPayload,
    type SessionContextDragPayload,
} from '../../../src/server/spa/client/react/features/chat/sessionContextDrag';
import {
    dataTransferHasSessionContext,
    readSessionContextBundleDragPayloads,
    readSessionContextDropPayload,
    readSessionContextDropPayloads,
} from '../../../src/server/spa/client/react/features/chat/sessionContextDrop';

function makeCommit(hash: string, short: string): GitCommitContextDragPayload {
    return {
        kind: 'coc.git-commit-context',
        version: 1,
        sourceWorkspaceId: 'ws-1',
        commitHash: hash,
        shortHash: short,
        label: `Commit ${short}`,
        subject: `Subject ${short}`,
        title: `Subject ${short}`,
    };
}

function makeChat(processId: string): SessionContextDragPayload {
    return {
        kind: 'coc.session-context',
        version: 1,
        sourceWorkspaceId: 'ws-1',
        sourceProcessId: processId,
        title: `Chat ${processId}`,
        status: 'completed',
        lastActivityAt: '2026-01-01T00:00:00.000Z',
    };
}

/** A minimal DataTransfer that records setData and serves it back via getData. */
function makeRecordingDataTransfer() {
    const store = new Map<string, string>();
    return {
        effectAllowed: 'none' as DataTransfer['effectAllowed'],
        setData(format: string, data: string) { store.set(format, data); },
        getData(format: string) { return store.get(format) ?? ''; },
        get types() { return Array.from(store.keys()); },
    };
}

describe('session-context drag bundle (AC-02)', () => {
    it('writes the primary single MIME plus a bundle MIME for a multi-item drag', () => {
        const [a, b, c] = [makeCommit('a'.repeat(40), 'aaaaaaa'), makeCommit('b'.repeat(40), 'bbbbbbb'), makeCommit('c'.repeat(40), 'ccccccc')];
        const dt = makeRecordingDataTransfer();

        writeSessionContextDragBundle(dt, [a, b, c]);

        expect(dt.effectAllowed).toBe('copy');
        // Primary (dragged) item is still on the single-item MIME for singular readers.
        expect(dt.getData(POINTER_CONTEXT_DRAG_MIME)).toBe(JSON.stringify(a));
        // Full ordered array is on the bundle MIME.
        expect(JSON.parse(dt.getData(SESSION_CONTEXT_BUNDLE_DRAG_MIME))).toEqual([a, b, c]);
    });

    it('reads back every bundled item, in order', () => {
        const items = [makeCommit('a'.repeat(40), 'aaaaaaa'), makeCommit('b'.repeat(40), 'bbbbbbb'), makeCommit('c'.repeat(40), 'ccccccc')];
        const dt = makeRecordingDataTransfer();
        writeSessionContextDragBundle(dt, items);

        const read = readSessionContextDropPayloads(dt);
        expect(read.map(p => (p as GitCommitContextDragPayload).commitHash)).toEqual(items.map(i => i.commitHash));
    });

    it('keeps the primary readable via the singular reader (backward compatible)', () => {
        const a = makeCommit('a'.repeat(40), 'aaaaaaa');
        const dt = makeRecordingDataTransfer();
        writeSessionContextDragBundle(dt, [a, makeCommit('b'.repeat(40), 'bbbbbbb')]);

        expect(readSessionContextDropPayload(dt)).toEqual(a);
        expect(dataTransferHasSessionContext(dt)).toBe(true);
    });

    it('does not write a bundle MIME for a single-item drag', () => {
        const a = makeCommit('a'.repeat(40), 'aaaaaaa');
        const dt = makeRecordingDataTransfer();
        writeSessionContextDragBundle(dt, [a]);

        expect(dt.getData(SESSION_CONTEXT_BUNDLE_DRAG_MIME)).toBe('');
        expect(readSessionContextDropPayloads(dt)).toEqual([a]);
    });

    it('is a no-op for an empty payload list', () => {
        const dt = makeRecordingDataTransfer();
        writeSessionContextDragBundle(dt, []);
        expect(dt.types).toEqual([]);
        expect(readSessionContextDropPayloads(dt)).toEqual([]);
    });

    it('bundles chat/session payloads too', () => {
        const items = [makeChat('proc-1'), makeChat('proc-2')];
        const dt = makeRecordingDataTransfer();
        writeSessionContextDragBundle(dt, items);

        // Primary on the chat single MIME.
        expect(dt.getData(SESSION_CONTEXT_DRAG_MIME)).toBe(JSON.stringify(items[0]));
        const read = readSessionContextDropPayloads(dt) as SessionContextDragPayload[];
        expect(read.map(p => p.sourceProcessId)).toEqual(['proc-1', 'proc-2']);
    });

    it('deduplicates logically identical items carried within one bundle (AC-03)', () => {
        const a = makeCommit('a'.repeat(40), 'aaaaaaa');
        const b = makeCommit('b'.repeat(40), 'bbbbbbb');
        const dt = makeRecordingDataTransfer();
        // Same logical commit twice + a distinct one.
        writeSessionContextDragBundle(dt, [a, { ...a }, b]);

        const read = readSessionContextDropPayloads(dt) as GitCommitContextDragPayload[];
        expect(read.map(p => p.commitHash)).toEqual([a.commitHash, b.commitHash]);
    });

    it('skips malformed bundle entries without dropping the valid ones', () => {
        const a = makeCommit('a'.repeat(40), 'aaaaaaa');
        const dt = makeRecordingDataTransfer();
        // Hand-craft a bundle MIME containing one good and one broken entry.
        const broken = { kind: 'coc.git-commit-context', version: 1 } as unknown as SessionContextAttachmentDragPayload;
        dt.setData(SESSION_CONTEXT_BUNDLE_DRAG_MIME, JSON.stringify([a, broken]));

        expect(readSessionContextBundleDragPayloads(dt)).toEqual([a]);
    });

    it('returns [] from the bundle reader when no bundle MIME is present', () => {
        const dt = makeRecordingDataTransfer();
        dt.setData(POINTER_CONTEXT_DRAG_MIME, JSON.stringify(makeCommit('a'.repeat(40), 'aaaaaaa')));
        expect(readSessionContextBundleDragPayloads(dt)).toEqual([]);
    });
});
