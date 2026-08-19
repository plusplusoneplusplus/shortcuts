/**
 * Host-reachable path resolution for "copy path" affordances in the dashboard.
 *
 * The browser has no way to know whether the CoC server lives inside WSL, so the
 * server decides: when it runs natively inside WSL, a workspace's Linux path is
 * rewritten to the Windows-reachable UNC form (`\\wsl.localhost\<distro>\...`)
 * so it can be pasted into Windows apps. Everywhere else the path is returned
 * unchanged.
 */
import { toWslUncPath } from '@plusplusoneplusplus/forge';
import { isNativeWslEnvironment } from './endev/endev-detector';

export interface HostCopyPathOptions {
    /** Override WSL detection (tests). Defaults to `isNativeWslEnvironment()`. */
    isNativeWsl?: boolean;
    /** Override the distro name (tests). Defaults to `WSL_DISTRO_NAME`. */
    wslDistro?: string;
}

/**
 * Return the path a user should get when they copy `rootPath` from the UI.
 *
 * Falls back to the raw path whenever translation does not apply — not WSL, no
 * distro name available, or the path is already a WSL UNC path.
 */
export function resolveHostCopyPath(rootPath: string, options: HostCopyPathOptions = {}): string {
    if (!rootPath) {
        return rootPath;
    }
    const nativeWsl = options.isNativeWsl ?? isNativeWslEnvironment();
    if (!nativeWsl) {
        return rootPath;
    }
    const distro = options.wslDistro ?? process.env.WSL_DISTRO_NAME;
    return toWslUncPath(rootPath, distro);
}
