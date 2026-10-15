import { describe, it, expect, vi } from 'vitest';
import * as path from 'path';
import { NativeAddonLoadError } from '@plusplusoneplusplus/coc-native';
import { FileWatcher } from '../../../src/server/wiki/file-watcher';
import type { ComponentGraph } from '../../../src/server/wiki/types';
import { FakeNativeWatchService } from '../../helpers/fake-native-watch-service';

function graph(): ComponentGraph {
    return {
        project: { name: 'test', description: 'test', language: 'TypeScript', buildSystem: 'npm' },
        categories: [],
        components: [
            { id: 'auth', name: 'Auth', category: 'core', path: 'src/auth', purpose: 'Auth',
                complexity: 'medium', keyFiles: ['config/auth.ts'], dependencies: [], dependents: [] },
            { id: 'api', name: 'API', category: 'core', path: 'src/api', purpose: 'API',
                complexity: 'high', keyFiles: ['src/api/routes.ts'], dependencies: [], dependents: [] },
        ],
    };
}

function setup(overrides: Partial<ConstructorParameters<typeof FileWatcher>[0]> = {}) {
    const watchService = new FakeNativeWatchService();
    const onChange = vi.fn();
    const watcher = new FileWatcher({
        workspaceId: 'ws-a', repoPath: path.resolve('repo'), wikiDir: path.resolve('wiki'),
        componentGraph: graph(), watchService, onChange, ...overrides,
    });
    return { watcher, watchService, onChange };
}

describe('FileWatcher native batches', () => {
    it('subscribes once with workspace ownership, native debounce, and existing ignore directories', () => {
        const { watcher, watchService } = setup();
        watcher.start();
        watcher.start();
        expect(watcher.isWatching).toBe(true);
        expect(watchService.subscriptions.size).toBe(1);
        expect(watchService.subscriptions.get(1)?.options).toEqual({
            workspaceId: 'ws-a', root: path.resolve('repo'), recursive: true,
            ignoreDirs: expect.arrayContaining(['node_modules', '.git', '.wiki-cache', 'dist', 'target']),
            extensions: [], respectGitignore: true, debounceMs: 2000,
        });
        watcher.stop();
        watcher.stop();
        expect(watcher.isWatching).toBe(false);
        expect(watchService.subscriptions.size).toBe(0);
    });

    it('forwards a debounce override and delivers a native batch immediately with unique affected ids', () => {
        const { watcher, watchService, onChange } = setup({ debounceMs: 75 });
        watcher.start();
        expect(watchService.subscriptions.get(1)?.options.debounceMs).toBe(75);
        watchService.emit(1, ['src/auth/a.ts', 'src\\auth\\b.ts', 'src/api/routes.ts']);
        expect(onChange).toHaveBeenCalledExactlyOnceWith(['auth', 'api']);
        watcher.stop();
    });

    it('preserves exact, prefix, and key-file suffix mapping without matching sibling prefixes', () => {
        const { watcher, watchService, onChange } = setup();
        watcher.start();
        watchService.emit(1, ['src/auth-other/a.ts', 'README.md']);
        watchService.emit(1);
        expect(onChange).not.toHaveBeenCalled();
        watchService.emit(1, ['src/auth']);
        expect(onChange).toHaveBeenLastCalledWith(['auth']);
        watchService.emit(1, ['config/auth.ts', 'nested/config/auth.ts']);
        expect(onChange).toHaveBeenLastCalledWith(['auth']);
        watcher.stop();
    });

    it('preserves ignored segment and generated-file exclusions', () => {
        const { watcher, watchService, onChange } = setup();
        watcher.start();
        watchService.emit(1, [
            'src/auth/node_modules/file.ts', 'src/auth/.git/config', 'src/auth/dist/a.ts',
            'src/auth/a.map', 'src/auth/a.lock', 'src/auth/a.log',
        ]);
        expect(onChange).not.toHaveBeenCalled();
        watcher.stop();
    });

    it('treats a rescan as all components even without matching changed paths', () => {
        const { watcher, watchService, onChange } = setup();
        watcher.start();
        watchService.emit(1, [], true);
        expect(onChange).toHaveBeenCalledExactlyOnceWith(['auth', 'api']);
        watcher.stop();
    });

    it('notifies an empty graph on rescan so the manager still reloads it', () => {
        const { watcher, watchService, onChange } = setup({ componentGraph: { ...graph(), components: [] } });
        watcher.start();
        watchService.emit(1, [], true);
        expect(onChange).toHaveBeenCalledExactlyOnceWith([]);
        watcher.stop();
    });

    it('ignores callbacks from stopped subscriptions even after restarting', () => {
        const { watcher, watchService, onChange } = setup();
        watcher.start();
        const stale = watchService.subscriptions.get(1)!.onBatch;
        watcher.stop();
        stale({ subscriptionId: 1, paths: [], rescan: true });
        watcher.start();
        stale({ subscriptionId: 1, paths: ['src/auth/a.ts'], rescan: false });
        expect(onChange).not.toHaveBeenCalled();
        watchService.emit(2, ['src/api/a.ts']);
        expect(onChange).toHaveBeenCalledExactlyOnceWith(['api']);
        watcher.stop();
    });

    it('stops only its own subscription on a shared root and shared workspace', () => {
        const { watcher, watchService } = setup();
        const other = new FileWatcher({
            workspaceId: 'ws-b', repoPath: path.resolve('repo'), wikiDir: path.resolve('wiki'),
            componentGraph: graph(), watchService, onChange: vi.fn(),
        });
        watcher.start();
        other.start();
        watcher.stop();
        expect(watchService.subscriptions.size).toBe(1);
        expect(watchService.subscriptions.get(2)?.options.workspaceId).toBe('ws-b');
        other.stop();
    });

    it.each([new Error('native watch failed'), new NativeAddonLoadError('missing watch')])(
        'propagates subscription errors and remains restartable: %s', error => {
            const { watcher, watchService } = setup();
            vi.spyOn(watchService, 'subscribe').mockImplementationOnce(() => { throw error; });
            expect(() => watcher.start()).toThrow(error);
            expect(watcher.isWatching).toBe(false);
            watcher.start();
            expect(watcher.isWatching).toBe(true);
            watcher.stop();
        },
    );
});
