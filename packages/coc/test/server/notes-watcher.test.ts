import { describe, expect, it, vi } from 'vitest';
import * as path from 'path';
import { NotesWatcher } from '../../src/server/notes/notes-watcher';
import { FakeNativeWatchService } from '../helpers/fake-native-watch-service';

describe('NotesWatcher', () => {
    it('requests Markdown filtering and forwards normalized native paths', () => {
        const service = new FakeNativeWatchService();
        const changed = vi.fn();
        const watcher = new NotesWatcher(changed, service);
        watcher.watchWorkspace('one', path.resolve('notes'));
        expect(service.subscriptions.get(1)!.options).toMatchObject({
            workspaceId: 'one', extensions: ['md'], recursive: true, debounceMs: 300,
            respectGitignore: false,
        });
        service.emit(1, ['a.md', 'nested/b.md']);
        expect(changed).toHaveBeenCalledExactlyOnceWith('one', ['a.md', 'nested/b.md']);
    });

    it('signals a full notes reload with an empty path list on rescan', () => {
        const service = new FakeNativeWatchService();
        const changed = vi.fn();
        const watcher = new NotesWatcher(changed, service);
        watcher.watchWorkspace('one', path.resolve('notes'));
        service.emit(1, ['partial.md'], true);
        expect(changed).toHaveBeenCalledExactlyOnceWith('one', []);
    });

    it('ignores empty ordinary batches and duplicate workspace subscriptions', () => {
        const service = new FakeNativeWatchService();
        const changed = vi.fn();
        const watcher = new NotesWatcher(changed, service);
        watcher.watchWorkspace('one', path.resolve('notes'));
        watcher.watchWorkspace('one', path.resolve('notes'));
        service.emit(1);
        expect(service.subscriptions.size).toBe(1);
        expect(changed).not.toHaveBeenCalled();
    });

    it('isolates workspace removal and suppresses stale callbacks', () => {
        const service = new FakeNativeWatchService();
        const changed = vi.fn();
        const watcher = new NotesWatcher(changed, service);
        watcher.watchWorkspace('one', path.resolve('notes'));
        watcher.watchWorkspace('two', path.resolve('notes'));
        const stale = service.subscriptions.get(1)!.onBatch;
        watcher.unwatchWorkspace('one');
        stale({ subscriptionId: 1, paths: ['a.md'], rescan: false });
        service.emit(2, ['b.md']);
        expect(changed).toHaveBeenCalledExactlyOnceWith('two', ['b.md']);
        watcher.closeAll();
        expect(service.subscriptions.size).toBe(0);
        expect(watcher.isWatching('two')).toBe(false);
    });
});
