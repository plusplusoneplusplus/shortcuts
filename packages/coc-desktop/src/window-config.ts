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

/**
 * CSS injected by the main process on macOS to keep the SPA's top bar clear of
 * the hiddenInset traffic lights and to make it act as the window drag handle.
 *
 * Injected from the main process (not the SPA) so it applies regardless of the
 * served SPA's version or its own platform detection — the main process is the
 * single source of truth for whether hiddenInset is active.
 */
export function buildMacInsetCss(): string {
    return [
        // Clear the traffic lights (3 buttons ending ~x=70) with comfortable margin.
        'header[data-react] { padding-left: 88px !important; -webkit-app-region: drag; }',
        // Interactive elements inside the drag region must remain clickable.
        'header[data-react] button,',
        'header[data-react] a,',
        'header[data-react] input,',
        'header[data-react] select,',
        'header[data-react] [role="button"],',
        'header[data-react] [role="combobox"],',
        'header[data-react] [role="tab"] { -webkit-app-region: no-drag; }',
    ].join('\n');
}
