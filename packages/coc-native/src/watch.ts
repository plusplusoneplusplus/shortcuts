import { loadNativeAddon, nativeAddonStatus, NativeAddonLoadError } from './loader';
import type * as Bindings from './native-bindings';
import type { NativeAddonStatus } from './types';

export type NativeWatchBatch = Bindings.WatchBatch;
export type NativeWatchSubscriptionOptions = Bindings.NativeWatchSubscriptionOptions;
export type NativeWatchHandle = Bindings.NativeWatchService;

export interface NativeWatchAddon {
    NativeWatchService: typeof Bindings.NativeWatchService;
}

const METHODS = ['subscribe', 'unsubscribe', 'unwatchWorkspace', 'dispose'] as const;

function isWatchAddon(addon: unknown): addon is NativeWatchAddon {
    const candidate = addon as Partial<NativeWatchAddon> | null;
    const constructor = candidate?.NativeWatchService;
    return typeof constructor === 'function' &&
        METHODS.every(method => typeof constructor.prototype?.[method] === 'function');
}

/** Required native watch capability; a missing or stale addon never falls back. */
export function loadNativeWatch(): NativeWatchAddon {
    const addon = loadNativeAddon();
    if (isWatchAddon(addon)) return addon;
    throw new NativeAddonLoadError(
        `@plusplusoneplusplus/coc-native: ${nativeAddonStatus().binaryPath} loaded but does not export watch service.\n` +
            'Rebuild it with `npm run build:native -w packages/coc-native`.',
    );
}

export function nativeWatchStatus(): NativeAddonStatus {
    const status = nativeAddonStatus();
    if (!status.loaded || isWatchAddon(loadNativeAddon())) return status;
    return { loaded: false, binaryPath: status.binaryPath, reason: `${status.binaryPath} does not export watch service` };
}
