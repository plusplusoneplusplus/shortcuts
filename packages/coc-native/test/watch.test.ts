import { afterEach, describe, expect, it, vi } from 'vitest';

const loader = vi.hoisted(() => ({
    loadNativeAddon: vi.fn(),
    nativeAddonStatus: vi.fn(),
}));

vi.mock('../src/loader', async importOriginal => ({
    ...await importOriginal<typeof import('../src/loader')>(),
    ...loader,
}));

import { NativeAddonLoadError } from '../src/loader';
import { loadNativeWatch, nativeWatchStatus } from '../src/watch';
import type { NativeWatchBatch, NativeWatchSubscriptionOptions } from '../src/watch';

const status = { loaded: true, binaryPath: 'fixture.node' };

function fakeService() {
    return class {
        constructor(readonly onBatch: (batch: NativeWatchBatch) => void) {}
        subscribe = undefined;
    };
}

function completeAddon() {
    class Service {
        constructor(readonly onBatch: (batch: NativeWatchBatch) => void) {}
        subscribe(_options: NativeWatchSubscriptionOptions) { return 42; }
        unsubscribe(_id: number) {}
        unwatchWorkspace(_workspaceId: string) {}
        dispose() {}
    }
    return { NativeWatchService: Service };
}

afterEach(() => vi.resetAllMocks());

describe('required native watch capability', () => {
    it('loads the complete constructor without wrapping callbacks or options', () => {
        const addon = completeAddon();
        loader.loadNativeAddon.mockReturnValue(addon);
        loader.nativeAddonStatus.mockReturnValue(status);
        expect(loadNativeWatch()).toBe(addon);
        expect(nativeWatchStatus()).toBe(status);
        const onBatch = vi.fn();
        const handle = new (loadNativeWatch().NativeWatchService)(onBatch);
        const options: NativeWatchSubscriptionOptions = {
            workspaceId: 'workspace-a', root: '.', recursive: false, ignoreDirs: ['.git'],
            extensions: ['.md'], respectGitignore: true, debounceMs: 25,
        };
        expect(handle.subscribe(options)).toBe(42);
        (handle as unknown as InstanceType<typeof addon.NativeWatchService>).onBatch({
            subscriptionId: 42, paths: ['notes.md'], rescan: false,
        });
        expect(onBatch).toHaveBeenCalledExactlyOnceWith({
            subscriptionId: 42, paths: ['notes.md'], rescan: false,
        });
    });

    it.each(['subscribe', 'unsubscribe', 'unwatchWorkspace', 'dispose'] as const)(
        'rejects a stale addon missing %s',
        method => {
            const addon = completeAddon();
            Object.defineProperty(addon.NativeWatchService.prototype, method, { value: undefined });
            loader.loadNativeAddon.mockReturnValue(addon);
            loader.nativeAddonStatus.mockReturnValue(status);
            expect(() => loadNativeWatch()).toThrow(NativeAddonLoadError);
            expect(() => loadNativeWatch()).toThrow('npm run build:native');
            expect(nativeWatchStatus()).toEqual({
                loaded: false, binaryPath: 'fixture.node',
                reason: 'fixture.node does not export watch service',
            });
        },
    );

    it.each([null, {}, { NativeWatchService: {} }, { NativeWatchService: fakeService() }])(
        'rejects an absent or malformed constructor: %j',
        addon => {
            loader.loadNativeAddon.mockReturnValue(addon);
            loader.nativeAddonStatus.mockReturnValue(status);
            expect(() => loadNativeWatch()).toThrow(NativeAddonLoadError);
        },
    );

    it('preserves missing-addon errors and reports failed status without loading', () => {
        const error = new NativeAddonLoadError('native addon unavailable');
        loader.loadNativeAddon.mockImplementation(() => { throw error; });
        loader.nativeAddonStatus.mockReturnValue({ loaded: false, reason: error.message });
        expect(() => loadNativeWatch()).toThrow(error);
        loader.loadNativeAddon.mockClear();
        expect(nativeWatchStatus()).toEqual({ loaded: false, reason: error.message });
        expect(loader.loadNativeAddon).not.toHaveBeenCalled();
    });
});
