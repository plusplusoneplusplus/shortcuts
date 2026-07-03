/**
 * Pure helper for BrowserWindow constructor options that vary by platform.
 * Kept separate from main.ts so it can be unit-tested without an Electron runtime.
 */

/**
 * Returns the platform-specific portion of the BrowserWindow constructor options.
 * On macOS, we use `hiddenInset` so the traffic-light buttons overlay the SPA's
 * own top bar, reclaiming the ~28 px that the native title bar would otherwise
 * occupy. The SPA adds a corresponding left-padding and -webkit-app-region:drag
 * to that header so the window remains draggable.
 */
export function buildWindowOptions(platform: NodeJS.Platform): Partial<Electron.BrowserWindowConstructorOptions> {
    if (platform === 'darwin') {
        return {
            titleBarStyle: 'hiddenInset',
            // Center the traffic lights vertically inside the SPA's 40 px (h-10) top bar.
            trafficLightPosition: { x: 12, y: 13 },
        };
    }
    return {};
}
