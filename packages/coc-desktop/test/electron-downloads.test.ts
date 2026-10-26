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
