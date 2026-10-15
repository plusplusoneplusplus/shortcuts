import { describe, expect, it, vi } from 'vitest';
import * as path from 'path';
import { TemplateWatcher } from '../../src/server/templates/template-watcher';
import { WorkflowWatcher } from '../../src/server/workflows/workflow-watcher';
import { FakeNativeWatchService } from '../helpers/fake-native-watch-service';

describe.each([
    ['templates', TemplateWatcher],
    ['workflows', WorkflowWatcher],
] as const)('%s repo-root subscription', (folder, Watcher) => {
    it('subscribes to the repo root and selects only its subtree in TypeScript', () => {
        const service = new FakeNativeWatchService();
        const changed = vi.fn();
        const watcher = new Watcher(changed, service);
        const root = path.resolve('repo');
        watcher.watchWorkspace('one', root);
        expect(service.subscriptions.get(1)!.options).toEqual({
            workspaceId: 'one', root, recursive: true, debounceMs: 300,
            ignoreDirs: [], extensions: [], respectGitignore: false,
        });
        service.emit(1, ['src/a.ts', `.vscode/${folder}-other/a.yaml`]);
        expect(changed).not.toHaveBeenCalled();
        service.emit(1, [`.vscode/${folder}/a.yaml`, `.vscode/${folder}/nested/b.json`]);
        expect(changed).toHaveBeenCalledExactlyOnceWith('one');
    });

    it('reloads for subtree and ancestor directory changes and native rescan', () => {
        const service = new FakeNativeWatchService();
        const changed = vi.fn();
        const watcher = new Watcher(changed, service);
        watcher.watchWorkspace('one', path.resolve('repo'));
        service.emit(1, [`.vscode/${folder}`]);
        service.emit(1, ['.vscode']);
        service.emit(1, [], true);
        expect(changed.mock.calls).toEqual([['one'], ['one'], ['one']]);
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
