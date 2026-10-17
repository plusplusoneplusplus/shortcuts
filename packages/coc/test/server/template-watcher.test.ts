import { describe, expect, it, vi } from 'vitest';
import * as path from 'path';
import { TemplateWatcher } from '../../src/server/templates/template-watcher';
import { WorkflowWatcher } from '../../src/server/workflows/workflow-watcher';
import { FakeNativeWatchService } from '../helpers/fake-native-watch-service';

describe.each([
    ['templates', TemplateWatcher],
    ['workflows', WorkflowWatcher],
] as const)('%s configuration-directory subscription', (folder, Watcher) => {
    it('limits recursive watching to .vscode and selects only its subtree', () => {
        const service = new FakeNativeWatchService();
        const changed = vi.fn();
        const watcher = new Watcher(changed, service);
        const root = path.resolve('repo');
        watcher.watchWorkspace('one', root);
        expect(service.subscriptions.get(1)!.options).toEqual({
            workspaceId: 'one', root: path.join(root, '.vscode'), recursive: true, debounceMs: 300,
            ignoreDirs: [], extensions: [], respectGitignore: false,
        });
        service.emit(1, ['settings.json', `${folder}-other/a.yaml`]);
        expect(changed).not.toHaveBeenCalled();
        service.emit(1, [`${folder}/a.yaml`, `${folder}/nested/b.json`]);
        expect(changed).toHaveBeenCalledExactlyOnceWith('one');
    });

    it('reloads for subtree changes and native rescan on .vscode creation or replacement', () => {
        const service = new FakeNativeWatchService();
        const changed = vi.fn();
        const watcher = new Watcher(changed, service);
        watcher.watchWorkspace('one', path.resolve('repo'));
        service.emit(1, [folder]);
        service.emit(1, [], true);
        expect(changed.mock.calls).toEqual([['one'], ['one']]);
    });

    it('registers missing configuration directories without probing or watching the repo tree', () => {
        const service = new FakeNativeWatchService();
        const changed = vi.fn();
        const watcher = new Watcher(changed, service);
        const roots = [path.resolve('missing-one'), path.resolve('missing-two')];
        roots.forEach((root, index) => watcher.watchWorkspace(String(index), root));
        expect([...service.subscriptions.values()].map(entry => entry.options.root)).toEqual(
            roots.map(root => path.join(root, '.vscode')),
        );
        service.emit(1, [], true);
        service.emit(2, [], true);
        expect(changed.mock.calls).toEqual([['0'], ['1']]);
    });

    it('does not retain a failed subscription and surfaces the failure for retry', () => {
        const service = new FakeNativeWatchService();
        const subscribe = vi.spyOn(service, 'subscribe').mockImplementationOnce(() => {
            throw new Error('watch failed');
        });
        const watcher = new Watcher(vi.fn(), service);
        const root = path.resolve('repo');
        expect(() => watcher.watchWorkspace('one', root)).toThrow('watch failed');
        expect(watcher.isWatching('one')).toBe(false);
        watcher.watchWorkspace('one', root);
        expect(watcher.isWatching('one')).toBe(true);
        expect(subscribe).toHaveBeenCalledTimes(2);
    });

    it('keeps workspace lifecycles independent and ignores retired subscriptions', () => {
        const service = new FakeNativeWatchService();
        const changed = vi.fn();
        const watcher = new Watcher(changed, service);
        watcher.watchWorkspace('one', path.resolve('repo'));
        watcher.watchWorkspace('one', path.resolve('repo'));
        watcher.watchWorkspace('two', path.resolve('repo'));
        expect(service.subscriptions.size).toBe(2);
        const stale = service.subscriptions.get(1)!.onBatch;
        watcher.unwatchWorkspace('one');
        stale({ subscriptionId: 1, paths: [], rescan: true });
        service.emit(2, [], true);
        expect(changed).toHaveBeenCalledExactlyOnceWith('two');
        watcher.closeAll();
        expect(service.subscriptions.size).toBe(0);
        expect(watcher.isWatching('one')).toBe(false);
        expect(watcher.isWatching('two')).toBe(false);
    });
});
