/**
 * The persistent C-family symbol-index capability.
 *
 * The generated binding owns extraction, SQLite persistence, incremental
 * refresh, and queries. This module only narrows the loaded addon.
 */

import { loadNativeAddon, nativeAddonStatus, NativeAddonLoadError } from './loader';
import type * as Bindings from './native-bindings';
import type { NativeAddonStatus } from './types';

export type NativeSymbolIndex = Bindings.SymbolIndex;
export type NativeSymbolMatch = Bindings.SymbolMatch;
export type NativeSymbolSearchOptions = Bindings.SymbolSearchOptions;

export interface NativeSymbolIndexAddon {
    buildSymbolIndex: typeof Bindings.buildSymbolIndex;
}

function isSymbolIndexAddon(addon: unknown): addon is NativeSymbolIndexAddon {
    return typeof (addon as NativeSymbolIndexAddon | null)?.buildSymbolIndex === 'function';
}

export function loadNativeSymbolIndex(): NativeSymbolIndexAddon {
    const addon = loadNativeAddon();
    if (isSymbolIndexAddon(addon)) return addon;
    const { binaryPath } = nativeAddonStatus();
    throw new NativeAddonLoadError(
        `@plusplusoneplusplus/coc-native: ${binaryPath} loaded but does not export a symbol index.\n` +
            'The binary predates the symbol-index capability — rebuild it with ' +
            '`npm run build:native -w packages/coc-native`.',
    );
}

export function nativeSymbolIndexStatus(): NativeAddonStatus {
    const status = nativeAddonStatus();
    if (!status.loaded) return status;
    if (isSymbolIndexAddon(loadNativeAddon())) return status;
    return {
        loaded: false,
        binaryPath: status.binaryPath,
        reason: `${status.binaryPath} does not export a symbol index`,
    };
}
