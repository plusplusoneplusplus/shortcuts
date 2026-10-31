import { EventEmitter } from 'node:events';
import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { manageElectronDownload } from '../src/electron-downloads';

function setup(admit = true) {
    let paused = false;
    const item = Object.assign(new EventEmitter(), {
        getFilename: () => '../CON.exe', getURL: () => 'https://user:secret@files.test/file?auth=token', getState: () => 'progressing',
        getReceivedBytes: () => 3, getTotalBytes: () => 10, isPaused: () => paused, canResume: () => paused,
        getSavePath: () => path.resolve('native-selected-file'), setSaveDialogOptions: vi.fn(),
        cancel: vi.fn(), pause: vi.fn(() => { paused = true; }), resume: vi.fn(() => { paused = false; }),
    });
    const update = vi.fn();
    let handle: any;
    const store = { start: vi.fn((_name, _url, incoming) => { handle = incoming; return admit ? { id: 'managed', update } : null; }) };
    expect(manageElectronDownload(store as any, item as any, path.resolve('Downloads'))).toBe(true === admit);
    return { item, store, update, handle };
}
describe('Electron native download adapter', () => {
    it('uses the native Save dialog and original request; exposes actual pause/resume progress', () => {
        const { item, update, handle } = setup();
        expect(item.setSaveDialogOptions).toHaveBeenCalledWith({ defaultPath: path.resolve('Downloads', 'download') });
        expect(update).toHaveBeenLastCalledWith({ state: 'downloading', received: 3, total: 10, canPause: true, canResume: false }, false, undefined);
        handle.pause(); expect(update.mock.lastCall![0]).toMatchObject({ state: 'paused', canPause: false, canResume: true });
        handle.resume(); expect(update.mock.lastCall![0].state).toBe('downloading');
        expect(() => handle.resume()).toThrow('unavailable');
        item.emit('updated', {}, 'interrupted'); expect(update.mock.lastCall![0]).toMatchObject({ state: 'interrupted', canResume: false });
        handle.cancel(); expect(item.cancel).toHaveBeenCalledOnce();
    });
    it.each(['completed', 'cancelled', 'interrupted'])('reports terminal %s honestly and detaches every listener', state => {
        const { item, update, handle } = setup();
        item.emit('done', {}, state);
        expect(update.mock.lastCall).toEqual([expect.objectContaining({ state, canPause: false, canResume: false }), true,
            state === 'completed' ? path.resolve('native-selected-file') : undefined]);
        handle.dispose();
        expect(item.listenerCount('updated')).toBe(0); expect(item.listenerCount('done')).toBe(0);
        const calls = update.mock.calls.length; item.emit('updated', {}, 'progressing');
        expect(update).toHaveBeenCalledTimes(calls);
    });
    it('does not retain or alter rejected transfers', () => {
        const { item, update } = setup(false);
        expect(item.listenerCount('updated')).toBe(0); expect(item.setSaveDialogOptions).not.toHaveBeenCalled(); expect(update).not.toHaveBeenCalled();
    });
});

/** Models the store's synchronous terminal disposal, including reentrant native events. */
function previewSetup(options: { admit?: boolean; aborted?: boolean; choose?: (context: any) => string | undefined; approve?: boolean } = {}) {
    const abort = new AbortController();
    if (options.aborted) abort.abort();
    const destination = path.resolve('chosen-folder', 'renamed.csv');
    const item = Object.assign(new EventEmitter(), {
        getFilename: vi.fn(() => '../CON.csv'), getURL: () => 'blob:file:///private-payload',
        getState: () => 'progressing', getReceivedBytes: () => 0, getTotalBytes: () => 110 * 1024 * 1024,
        isPaused: () => false, canResume: () => false, getSavePath: () => destination,
        setSavePath: vi.fn(), setSaveDialogOptions: vi.fn(), pause: vi.fn(), resume: vi.fn(),
        cancel: vi.fn(() => { item.emit('done', {}, 'cancelled'); }),
    });
    let handle: any;
    const update = vi.fn((_progress, final) => { if (final) handle.dispose(); });
    const store = { start: vi.fn((_name, _url, incoming) => { handle = incoming; return options.admit === false ? null : { id: 'preview', update }; }) };
    const approval = {
        signal: abort.signal,
        chooseDestination: vi.fn(() => options.choose ? options.choose({ abort, item, handle }) : destination),
        approve: vi.fn(() => options.approve !== false), cancel: vi.fn(() => abort.abort()), onFailure: vi.fn(),
    };
    const remove = vi.spyOn(abort.signal, 'removeEventListener');
    const result = manageElectronDownload(store as any, item as any, path.resolve('Downloads'), approval);
    return { abort, destination, item, handle, update, store, approval, result, remove };
}

describe('preview native Save As handoff', () => {
    it('admits before showing native Save As, sanitizes its suggestion and uses only the changed native destination', () => {
        const context = previewSetup();
        const { item, approval, destination, store, update } = context;
        expect(context.result).toBe(true);
        expect(store.start.mock.invocationCallOrder[0]).toBeLessThan(approval.chooseDestination.mock.invocationCallOrder[0]);
        expect(approval.chooseDestination).toHaveBeenCalledExactlyOnceWith(path.resolve('Downloads', 'download'));
        expect(approval.chooseDestination.mock.invocationCallOrder[0]).toBeLessThan(approval.approve.mock.invocationCallOrder[0]);
        expect(approval.approve.mock.invocationCallOrder[0]).toBeLessThan(item.setSavePath.mock.invocationCallOrder[0]);
        expect(item.setSavePath).toHaveBeenCalledExactlyOnceWith(destination);
        expect(item.setSaveDialogOptions).not.toHaveBeenCalled();
        expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ total: 110 * 1024 * 1024 }), false, undefined);
        item.emit('done', {}, 'completed');
        expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'completed' }), true, destination);
        expect(item.listenerCount('updated')).toBe(0);
        expect(item.listenerCount('done')).toBe(0);
    });

    it.each(['', '../outside.csv', 'bad\0name'])('never saves invalid native result %j', destination => {
        const { item, update, approval } = previewSetup({ choose: () => destination });
        expect(item.setSavePath).not.toHaveBeenCalled();
        expect(approval.approve).not.toHaveBeenCalled();
        expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ state: destination ? 'failed' : 'cancelled' }), true);
        expect(item.cancel).toHaveBeenCalledOnce();
        expect(item.listenerCount('done')).toBe(0);
    });

    it('quietly retires native dialog cancellation with no approval or destination write', () => {
        const { item, update, approval, remove } = previewSetup({ choose: () => undefined });
        expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'cancelled' }), true);
        expect(approval.approve).not.toHaveBeenCalled();
        expect(item.setSavePath).not.toHaveBeenCalled();
        expect(remove).toHaveBeenCalled();
        expect(approval.cancel).toHaveBeenCalledOnce();
        expect(approval.onFailure).not.toHaveBeenCalled();
    });

    it('does not show a dialog for expired admission or unavailable store capacity', () => {
        for (const context of [previewSetup({ aborted: true }), previewSetup({ admit: false })]) {
            expect(context.approval.chooseDestination).not.toHaveBeenCalled();
            expect(context.item.setSavePath).not.toHaveBeenCalled();
            expect(context.approval.cancel).toHaveBeenCalledOnce();
            expect(context.item.listenerCount('done')).toBe(0);
        }
    });

    it('rejects a late native result following source revocation', () => {
        const { item, approval, update } = previewSetup({ choose: ({ abort }) => { abort.abort(); return path.resolve('late.csv'); } });
        expect(item.setSavePath).not.toHaveBeenCalled();
        expect(approval.approve).not.toHaveBeenCalled();
        expect(item.cancel).toHaveBeenCalledOnce();
        expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'cancelled' }), true);
        expect(item.listenerCount('updated')).toBe(0);
    });

    it('rechecks the live lease after Save As and rejects a stale approval', () => {
        const { item, approval, update } = previewSetup({ approve: false });
        expect(approval.approve).toHaveBeenCalledOnce();
        expect(item.setSavePath).not.toHaveBeenCalled();
        expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'cancelled' }), true);
    });

    it('leaves an approved transfer independent of later source revocation', () => {
        const { abort, item, update } = previewSetup();
        abort.abort();
        expect(item.cancel).not.toHaveBeenCalled();
        item.emit('updated', {}, 'progressing');
        item.emit('done', {}, 'completed');
        expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'completed' }), true, expect.any(String));
    });

    it('cannot pause or resume while a native decision is pending', () => {
        previewSetup({ choose: ({ handle }) => {
            expect(() => handle.pause()).toThrow('Pause unavailable');
            expect(() => handle.resume()).toThrow('Resume unavailable');
            return undefined;
        } });
    });

    it.each(['completed', 'cancelled', 'interrupted'])('does not adopt a result if the original handle became %s during Save As', state => {
        const { item, approval, update } = previewSetup({ choose: ({ item }) => {
            item.emit('done', {}, state);
            return path.resolve('late.csv');
        } });
        expect(approval.approve).not.toHaveBeenCalled();
        expect(item.setSavePath).not.toHaveBeenCalled();
        expect(item.listenerCount('updated')).toBe(0);
        expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ state: state === 'completed' ? 'failed' : state }), true, undefined);
    });

    it('retires pending authorization and ignores a late native result on shutdown disposal', () => {
        const { item, approval } = previewSetup({ choose: ({ handle }) => {
            handle.cancel(); handle.dispose();
            return path.resolve('late.csv');
        } });
        expect(approval.approve).not.toHaveBeenCalled();
        expect(item.setSavePath).not.toHaveBeenCalled();
        expect(item.listenerCount('done')).toBe(0);
    });

    it('fails without replay or leaked listeners if native Save As throws', () => {
        const { item, update, approval } = previewSetup({ choose: () => { throw new Error('private native path'); } });
        expect(update).toHaveBeenLastCalledWith({ state: 'failed', received: 0, total: 0, canPause: false, canResume: false }, true);
        expect(approval.cancel).toHaveBeenCalledOnce();
        expect(item.setSavePath).not.toHaveBeenCalled();
        expect(item.listenerCount('done')).toBe(0);
        expect(approval.onFailure).toHaveBeenCalledExactlyOnceWith();
    });

    it('fails without retry if assigning the native destination fails after approval', () => {
        const { item, update, approval } = previewSetup({ choose: ({ item }) => {
            item.setSavePath.mockImplementation(() => { throw new Error('native write failure'); });
            return path.resolve('selected.csv');
        } });
        expect(approval.approve).toHaveBeenCalledOnce();
        expect(item.setSavePath).toHaveBeenCalledOnce();
        expect(item.cancel).toHaveBeenCalledOnce();
        expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'failed' }), true);
        expect(item.listenerCount('done')).toBe(0);
        expect(approval.onFailure).toHaveBeenCalledExactlyOnceWith();
    });

    it.each(['interrupted', 'failed'])('reports %s once before terminal lease disposal without private data', state => {
        const { item, approval, update } = previewSetup();
        approval.onFailure.mockImplementation(() => { expect(approval.signal.aborted).toBe(false); });
        item.emit('updated', {}, state);
        item.emit('done', {}, state);
        expect(approval.onFailure).toHaveBeenCalledExactlyOnceWith();
        expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ state }), true, undefined);
        expect(item.listenerCount('updated')).toBe(0);
        expect(item.listenerCount('done')).toBe(0);
    });

    it.each(['completed', 'cancelled'])('keeps %s quiet', state => {
        const { item, approval } = previewSetup();
        item.emit('done', {}, state);
        expect(approval.onFailure).not.toHaveBeenCalled();
    });

    it('keeps revocation quiet and ignores late native failures after disposal', () => {
        const { item, approval } = previewSetup({ choose: ({ abort }) => { abort.abort(); return undefined; } });
        item.emit('done', {}, 'interrupted');
        expect(approval.onFailure).not.toHaveBeenCalled();
    });

    it('preserves terminal state and cleanup if failure feedback throws', () => {
        const { item, approval, update } = previewSetup();
        approval.onFailure.mockImplementation(() => { throw new Error('owner unavailable'); });
        expect(() => item.emit('done', {}, 'interrupted')).not.toThrow();
        expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'interrupted' }), true, undefined);
        expect(item.listenerCount('done')).toBe(0);
        expect(item.cancel).not.toHaveBeenCalled();
    });
});
