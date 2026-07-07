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
 * CSS injected by the main process on macOS to keep the SPA's top bars clear of
 * the hiddenInset traffic lights and to make them act as the window drag handle.
 *
 * Injected from the main process (not the SPA) so it applies regardless of the
 * served SPA's version or its own platform detection — the main process is the
 * single source of truth for whether hiddenInset is active.
 *
 * Two elements can reach the window's top-left under the traffic lights:
 *  - `header[data-react]` — the SPA's own top bar, always at the top.
 *  - the fullscreen canvas panel header — a `fixed inset-0` overlay whose header
 *    covers the top of the window, so its title would sit under the lights too.
 */
export function buildMacInsetCss(): string {
    const topBars = [
        'header[data-react]',
        // The header is the first child of the maximized (fullscreen) canvas panel.
        '[data-testid="canvas-panel"][data-fullscreen="true"] > div:first-child',
    ];
    const interactive = [
        'button',
        'a',
        'input',
        'select',
        '[role="button"]',
        '[role="combobox"]',
        '[role="tab"]',
        '[role="menuitem"]',
    ];
    // Clear the traffic lights (3 buttons ending ~x=70) with comfortable margin,
    // and make the cleared bar the window drag handle.
    const clearRules = topBars.map(
        bar => `${bar} { padding-left: 88px !important; -webkit-app-region: drag; }`,
    );
    // Interactive elements inside the drag region must remain clickable.
    const noDragSelectors = topBars.flatMap(bar => interactive.map(el => `${bar} ${el}`));
    const noDragRule = `${noDragSelectors.join(',\n')} { -webkit-app-region: no-drag; }`;
    return [...clearRules, noDragRule].join('\n');
}
