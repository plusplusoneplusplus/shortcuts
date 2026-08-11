/**
 * PopOutDevToolsShell — standalone shell for Dev Tools in a separate window.
 *
 * Rendered when `window.location.hash` starts with `#popout/dev-tools`.
 * URL format: `/#popout/dev-tools`
 *
 * The tool cards are pure client-side widgets (no API, no app state), so this
 * shell only needs the theme so the popped-out window matches the main window's
 * light/dark setting.
 */

import { useEffect } from 'react';
import { ThemeProvider } from './ThemeProvider';
import { DevToolsPanel } from '../features/dev-tools/DevToolsPanel';
import { getHostname } from '../utils/config';

/** Window name, so re-popping focuses the existing window instead of duplicating it. */
export const DEV_TOOLS_POPOUT_WINDOW_NAME = 'coc-dev-tools';

export function isPopOutDevToolsRoute(hash: string): boolean {
    return hash.replace(/^#/, '').startsWith('popout/dev-tools');
}

/** Absolute URL for the Dev Tools pop-out window. */
export function devToolsPopOutUrl(): string {
    return `${window.location.origin}${window.location.pathname}#popout/dev-tools`;
}

function PopOutDevToolsContent() {
    useEffect(() => {
        const hostname = getHostname();
        const brand = hostname ? `CoC @ ${hostname}` : 'CoC';
        document.title = `Dev Tools — ${brand}`;
    }, []);

    return (
        <div
            className="h-screen overflow-y-auto bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc]"
            data-testid="popout-dev-tools-shell"
        >
            <div className="mx-auto max-w-[900px] p-4 flex flex-col gap-3">
                <h1 className="text-base font-semibold">Dev Tools</h1>
                <DevToolsPanel />
            </div>
        </div>
    );
}

export function PopOutDevToolsShell() {
    return (
        <ThemeProvider>
            <PopOutDevToolsContent />
        </ThemeProvider>
    );
}
