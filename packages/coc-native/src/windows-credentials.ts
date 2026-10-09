import { loadNativeAddon, NativeAddonLoadError } from './loader';
import type * as Bindings from './native-bindings';

interface WindowsCredentialAddon {
    readWindowsCredential: typeof Bindings.readWindowsCredential;
}

function isWindowsCredentialAddon(addon: unknown): addon is WindowsCredentialAddon {
    return typeof (addon as WindowsCredentialAddon | null)?.readWindowsCredential === 'function';
}

export function readWindowsCredential(target: string): Promise<string | null> {
    const addon = loadNativeAddon();
    if (!isWindowsCredentialAddon(addon)) {
        throw new NativeAddonLoadError(
            '@plusplusoneplusplus/coc-native: missing Windows credential reader. ' +
            'Rebuild with `npm run build:native -w packages/coc-native`.',
        );
    }
    return addon.readWindowsCredential(target);
}
