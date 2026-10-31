import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FilePreviewDownloadGate, type FilePreviewDownloadScope } from '../src/file-preview-download-gate';

function fixture(patch: Partial<FilePreviewDownloadScope> = {}) {
    const scope: FilePreviewDownloadScope = {
        ownerId: 1, sessionKey: 'remote-a:workspace', viewId: 'html-page:one', guestId: 2, document: {}, ...patch,
    };
    const gate = new FilePreviewDownloadGate(scope);
    gate.setVisible(true);
    return { gate, scope };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
});

describe('HTML preview download admission', () => {
    it.each(['blob:null/local-id', 'data:text/csv,hello', 'data:application/zip;base64,AA==', 'DATA:,'])
    ('consumes one desktop action for %s without handling payload bytes', url => {
        const { gate, scope } = fixture();
        expect(gate.request(scope, url)).toBeUndefined();
        expect(gate.recordUserAction(scope)).toBe(true);
        const pending = gate.request(scope, url)!;
        expect(pending).toBeDefined();
        expect(gate.request(scope, url)).toBeUndefined();
        expect(gate.recordUserAction(scope)).toBe(false);
        expect(pending.approve(scope)).toBe(true);
        expect(pending.approve(scope)).toBe(false);
        expect(gate.request(scope, url)).toBeUndefined();
        gate.close();
        pending.cancel();
        expect(pending.signal.aborted).toBe(false);
    });

    it.each(['https://example.test/file', 'file:///local/file', 'javascript:void(0)', 'about:blank', ' blob:null/id'])
    ('rejects unsupported target %s before creating pending approval', url => {
        const { gate, scope } = fixture();
        gate.recordUserAction(scope);
        expect(gate.request(scope, url)).toBeUndefined();
    });

    it('expires async generation intent and requires a fresh action', () => {
        const { gate, scope } = fixture();
        gate.recordUserAction(scope);
        vi.advanceTimersByTime(5_000);
        expect(gate.request(scope, 'blob:null/id')).toBeUndefined();
        gate.recordUserAction(scope);
        vi.advanceTimersByTime(4_999);
        const pending = gate.request(scope, 'blob:null/id')!;
        expect(pending.approve(scope)).toBe(true);
    });

    it.each([
        { ownerId: 9 }, { sessionKey: 'remote-b:workspace' }, { viewId: 'html-page:two' }, { guestId: 3 }, { document: {} },
    ])('rejects foreign identity at action, admission and approval: %j', patch => {
        const { gate, scope } = fixture();
        const foreign = { ...scope, ...patch };
        expect(gate.recordUserAction(foreign)).toBe(false);
        gate.recordUserAction(scope);
        expect(gate.request(foreign, 'data:,private')).toBeUndefined();
        const pending = gate.request(scope, 'data:,private')!;
        expect(pending.approve(foreign)).toBe(false);
        expect(pending.approve(scope)).toBe(true);
    });

    it('isolates repeated labels and shared documents across windows and servers', () => {
        const first = fixture();
        const second = fixture({ document: first.scope.document, ownerId: 9, sessionKey: 'remote-b:workspace' });
        first.gate.recordUserAction(first.scope);
        expect(second.gate.request(second.scope, 'data:,')).toBeUndefined();
        const pending = first.gate.request(first.scope, 'data:,')!;
        second.gate.close();
        expect(pending.signal.aborted).toBe(false);
        expect(pending.approve(second.scope)).toBe(false);
        expect(pending.approve(first.scope)).toBe(true);
    });

    it.each(['hide', 'close', 'cancel', 'timeout'])('revokes pending approval on %s and rejects late approval', reason => {
        const { gate, scope } = fixture();
        gate.recordUserAction(scope);
        const pending = gate.request(scope, 'data:,')!;
        const cancelled = vi.fn();
        pending.signal.addEventListener('abort', cancelled, { once: true });
        if (reason === 'hide') gate.setVisible(false);
        if (reason === 'close') gate.close();
        if (reason === 'cancel') pending.cancel();
        if (reason === 'timeout') vi.advanceTimersByTime(60_000);
        gate.setVisible(true);
        expect(pending.signal.aborted).toBe(true);
        expect(pending.approve(scope)).toBe(false);
        pending.cancel();
        gate.close();
        expect(cancelled).toHaveBeenCalledOnce();
    });

    it('does not restore unused intent after hiding or closing', () => {
        const { gate, scope } = fixture();
        gate.recordUserAction(scope);
        gate.setVisible(false);
        gate.setVisible(true);
        expect(gate.request(scope, 'data:,')).toBeUndefined();
        gate.close();
        expect(gate.recordUserAction(scope)).toBe(false);
    });

    it('permits an explicit retry after cancellation without adopting the old request', () => {
        const { gate, scope } = fixture();
        gate.recordUserAction(scope);
        const old = gate.request(scope, 'data:,')!;
        old.cancel();
        expect(gate.request(scope, 'data:,')).toBeUndefined();
        gate.recordUserAction(scope);
        const retry = gate.request(scope, 'data:,')!;
        expect(old.approve(scope)).toBe(false);
        old.cancel();
        expect(retry.approve(scope)).toBe(true);
    });

    it('rejects late approval even when the timeout callback has not run', () => {
        const { gate, scope } = fixture();
        gate.recordUserAction(scope);
        const pending = gate.request(scope, 'data:,')!;
        const now = performance.now();
        const clock = vi.spyOn(performance, 'now').mockReturnValue(now + 60_000);
        try {
            expect(pending.approve(scope)).toBe(false);
            expect(pending.signal.aborted).toBe(true);
        } finally {
            clock.mockRestore();
        }
    });

    it('leaves approved transfers independent of visibility, closure and approval timeout', () => {
        const { gate, scope } = fixture();
        gate.recordUserAction(scope);
        const pending = gate.request(scope, 'data:,')!;
        expect(pending.approve(scope)).toBe(true);
        gate.setVisible(false);
        gate.close();
        vi.advanceTimersByTime(60_000);
        expect(pending.signal.aborted).toBe(false);
    });

    it('copies owner identity so caller mutation cannot reassign a gate', () => {
        const { gate, scope } = fixture();
        const original = { ...scope };
        Object.assign(scope, { ownerId: 9, sessionKey: 'other' });
        expect(gate.recordUserAction(scope)).toBe(false);
        expect(gate.recordUserAction(original)).toBe(true);
        gate.close();
    });
});
